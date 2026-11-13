import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ClipboardList,
  Building2,
  CreditCard,
  Landmark,
  PiggyBank,
  Plus,
  Sparkles,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import AccountModal from '../components/AccountModal.jsx';
import RecurringModal from '../components/RecurringModal.jsx';
import {
  ACCOUNT_TYPE_LABELS,
  centsToInput,
  formatCurrency,
  FREQUENCY_LABELS,
  parseCurrencyToCents
} from '../utils/format.js';

const STEP_META = [
  { n: 1, label: 'Contas', title: 'Contas e saldos iniciais', icon: Building2 },
  { n: 2, label: 'Receitas', title: 'Receitas regulares', icon: TrendingUp },
  { n: 3, label: 'Despesas', title: 'Despesas fixas e transferências', icon: ArrowDownLeft },
  { n: 4, label: 'Variáveis', title: 'Despesas variáveis estimadas', icon: Sparkles },
  { n: 5, label: 'Resumo', title: 'Resumo e confirmação', icon: ClipboardList }
];

export default function OnboardingPage() {
  const queryClient = useQueryClient();

  // Onboarding state (step + persisted wizard data)
  const { data: onboardingState, isLoading: stateLoading } = useQuery({
    queryKey: ['onboarding-state'],
    queryFn: api.getOnboardingState
  });

  const [step, setStep] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [recurringModalType, setRecurringModalType] = useState(null); // 'income' | 'expense' | 'transfer' | null
  const [variableDrafts, setVariableDrafts] = useState({}); // { [categoryId]: amount string }
  const [completeError, setCompleteError] = useState('');

  // Data used across steps
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.getAccounts()
  });
  const { data: recurringItems = [] } = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.getRecurring()
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories()
  });

  // Hydrate wizard position and step-4 drafts from persisted state (once)
  useEffect(() => {
    if (onboardingState && !hydrated) {
      const savedStep = Number(onboardingState.step) || 1;
      setStep(Math.min(Math.max(savedStep, 1), 5));

      const savedBudgets = onboardingState.data?.variable_budgets || [];
      const drafts = {};
      for (const b of savedBudgets) {
        drafts[b.category_id] = centsToInput(b.amount_cents);
      }
      setVariableDrafts(drafts);
      setHydrated(true);
    }
  }, [onboardingState, hydrated]);

  // Persist wizard progress after every step change
  const saveStepMutation = useMutation({
    mutationFn: ({ step, data }) => api.saveOnboardingStep(step, data),
    onSuccess: (state) => {
      queryClient.setQueryData(['onboarding-state'], state);
    }
  });

  function collectVariableBudgets() {
    return Object.entries(variableDrafts)
      .map(([categoryId, amountStr]) => ({
        category_id: Number(categoryId),
        amount_cents: parseCurrencyToCents(amountStr) || 0
      }))
      .filter((b) => b.category_id > 0 && b.amount_cents >= 0);
  }

  function goTo(nextStep, options = {}) {
    const clamped = Math.min(Math.max(nextStep, 1), 5);
    setStep(clamped);
    if (clamped === 4 || options.withVariableBudgets) {
      saveStepMutation.mutate({ step: clamped, data: { variable_budgets: collectVariableBudgets() } });
    } else if (clamped !== 5) {
      saveStepMutation.mutate({ step: clamped });
    }
  }

  // Completing onboarding: create initial budgets, run generator, set completion flag
  const completeMutation = useMutation({
    mutationFn: () =>
      api.completeOnboarding({
        budgets: collectVariableBudgets().filter((b) => b.amount_cents > 0)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-state'] });
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
    },
    onError: (err) => {
      setCompleteError(err.message || 'Erro ao finalizar configuração inicial');
    }
  });

  // Derived data
  const activeRecurring = recurringItems.filter((i) => i.active);
  const incomeItems = activeRecurring.filter((i) => i.type === 'income');
  const expenseItems = activeRecurring.filter((i) => i.type === 'expense');
  const transferItems = activeRecurring.filter((i) => i.type === 'transfer');

  const variableCategories = categories.filter((c) => c.is_leaf && c.kind === 'expense');

  const { data: summary } = useQuery({
    queryKey: ['recurring-summary'],
    queryFn: api.getRecurringSummary,
    enabled: step === 5
  });

  const variableTotalCents = Object.values(variableDrafts).reduce((sum, amountStr) => {
    return sum + (parseCurrencyToCents(amountStr) || 0);
  }, 0);

  const finalSurplusCents = summary ? summary.surplus_cents - variableTotalCents : null;

  if (stateLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        A carregar configuração inicial…
      </div>
    );
  }

  const canContinue = {
    1: accounts.length > 0,
    2: true, // skipping income requires confirmation below
    3: true,
    4: true,
    5: true
  };

  function handleContinueFromStep2() {
    if (incomeItems.length === 0) {
      const confirmed = window.confirm(
        'Ainda não declarou nenhuma receita regular. As estimativas de excedente ficarão incompletas. Deseja continuar à mesma?'
      );
      if (!confirmed) return;
    }
    goTo(3);
  }

  function handleConfirmComplete() {
    const confirmed = window.confirm(
      'Confirmar a configuração inicial? Serão criados os orçamentos do mês corrente e os movimentos planeados serão gerados.'
    );
    if (confirmed) {
      setCompleteError('');
      goTo(5, { withVariableBudgets: true });
      completeMutation.mutate();
    }
  }

  function renderVariableDraft(categoryId) {
    return variableDrafts[categoryId] || '';
  }

  function handleVariableChange(categoryId, value) {
    setVariableDrafts((prev) => ({ ...prev, [categoryId]: value }));
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6 sm:py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Brand + progress */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-600 text-white rounded-2xl shadow-xs">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Configuração Inicial</h1>
              <p className="text-xs text-slate-500">
                Vamos preparar o seu orçamento. Pode fechar o navegador — o progresso é guardado.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {STEP_META.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => s.n < step && goTo(s.n)}
                  disabled={s.n > step}
                  className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border transition-colors ${
                    s.n === step
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : s.n < step
                      ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer'
                      : 'bg-white border-slate-100 text-slate-300 cursor-default'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step content card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 sm:p-6 space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wide">
              Passo {step} de 5
            </p>
            <h2 className="text-lg font-bold text-slate-900">{STEP_META[step - 1].title}</h2>
          </div>

          {/* STEP 1 — accounts */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Crie pelo menos uma conta (conta à ordem, poupança, dinheiro ou investimento) e indique o saldo atual.
              </p>

              <div className="space-y-2">
                {accounts.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
                    <Landmark className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs text-slate-500">Nenhuma conta criada.</p>
                  </div>
                ) : (
                  accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600">
                          <CreditCard className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{acc.name}</p>
                          <p className="text-[11px] text-slate-500">{ACCOUNT_TYPE_LABELS[acc.type] || acc.type}</p>
                        </div>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-800">
                        {formatCurrency(acc.initial_balance_cents)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsAccountModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nova Conta
              </button>

              {accounts.length === 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  É necessária pelo menos uma conta para continuar.
                </p>
              )}
            </div>
          )}

          {/* STEP 2 — regular incomes */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Declare todas as receitas regulares com a sua periodicidade (ex: salário mensal, subsídios).
              </p>

              <div className="space-y-2">
                {incomeItems.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
                    <TrendingUp className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs text-slate-500">Nenhuma receita regular declarada.</p>
                  </div>
                ) : (
                  incomeItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {FREQUENCY_LABELS[item.frequency] || item.frequency} • {item.category_name} •{' '}
                          {item.account_name}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-emerald-600">
                        {formatCurrency(item.amount_cents)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={() => setRecurringModalType('income')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Adicionar Receita Regular
              </button>
            </div>
          )}

          {/* STEP 3 — regular expenses & transfers */}
          {step === 3 && (
            <div className="space-y-5">
              <p className="text-xs text-slate-500">
                Declare despesas fixas regulares (com sugestões rápidas para renda, eletricidade, etc.) e
                transferências regulares (ex: poupança mensal).
              </p>

              {/* Expenses */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                  Despesas Fixas ({expenseItems.length})
                </p>
                {expenseItems.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-xs text-slate-500">Nenhuma despesa fixa declarada.</p>
                  </div>
                ) : (
                  expenseItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-rose-50/50 border border-rose-100 rounded-xl"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1">
                          {FREQUENCY_LABELS[item.frequency] || item.frequency} • {item.category_name} •{' '}
                          {item.account_name}
                          {item.is_estimate && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              Estimativa
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-rose-600">
                        {formatCurrency(item.amount_cents)}
                      </span>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setRecurringModalType('expense')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-slate-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Despesa Fixa
                </button>
              </div>

              {/* Transfers */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                  Transferências Regulares ({transferItems.length})
                </p>
                {transferItems.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-xs text-slate-500">Nenhuma transferência regular declarada (opcional).</p>
                  </div>
                ) : (
                  transferItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-blue-50/50 border border-blue-100 rounded-xl"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {FREQUENCY_LABELS[item.frequency] || item.frequency} • {item.account_name} →{' '}
                          {item.to_account_name}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-blue-600">
                        {formatCurrency(item.amount_cents)}
                      </span>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setRecurringModalType('transfer')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 text-slate-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Transferência Regular
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — variable spending */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Defina um orçamento mensal estimado por categoria para despesas variáveis (alimentação,
                combustível, lazer…). Este passo é opcional — os valores fixos já declarados são usados à mesma.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {variableCategories.map((c) => (
                  <div key={c.id} className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-600">
                      {c.parent_name ? `${c.parent_name} → ${c.name}` : c.name}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={renderVariableDraft(c.id)}
                        onChange={(e) => handleVariableChange(c.id, e.target.value)}
                        className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-3 pr-8 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <span className="absolute right-3 top-2 text-sm text-slate-400">€</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className="text-xs font-semibold text-slate-700">Total variável mensal</span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {formatCurrency(variableTotalCents)}
                </span>
              </div>
            </div>
          )}

          {/* STEP 5 — summary */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Confirme os valores estimados. Ao confirmar, criamos os orçamentos do mês corrente e geramos os
                movimentos planeados.
              </p>

              {summary ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                      Receitas regulares (mensal)
                    </span>
                    <span className="font-mono text-sm font-bold text-emerald-700">
                      {formatCurrency(summary.income_cents)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-rose-50/60 border border-rose-100 rounded-xl">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <ArrowDownLeft className="w-4 h-4 text-rose-600" />
                      Despesas fixas (mensal)
                    </span>
                    <span className="font-mono text-sm font-bold text-rose-700">
                      {formatCurrency(summary.expense_cents)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-amber-50/60 border border-amber-100 rounded-xl">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      Orçamento variável estimado
                    </span>
                    <span className="font-mono text-sm font-bold text-amber-700">
                      {formatCurrency(variableTotalCents)}
                    </span>
                  </div>

                  <div
                    className={`flex items-center justify-between p-4 rounded-xl border ${
                      finalSurplusCents >= 0
                        ? 'bg-teal-50 border-teal-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <PiggyBank
                        className={`w-5 h-5 ${finalSurplusCents >= 0 ? 'text-teal-600' : 'text-red-600'}`}
                      />
                      Excedente mensal estimado
                    </span>
                    <span
                      className={`font-mono text-lg font-bold ${
                        finalSurplusCents >= 0 ? 'text-teal-700' : 'text-red-700'
                      }`}
                    >
                      {formatCurrency(finalSurplusCents)}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Excedente = receitas − despesas fixas − orçamento variável.
                  </p>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-400">A calcular resumo…</div>
              )}

              {completeError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {completeError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-3 pb-8">
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            disabled={step === 1}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Anterior
          </button>

          {step < 5 ? (
            <button
              type="button"
              onClick={() => (step === 2 ? handleContinueFromStep2() : goTo(step + 1))}
              disabled={!canContinue[step]}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continuar
              <Check className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmComplete}
              disabled={completeMutation.isPending || !summary}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {completeMutation.isPending ? 'A finalizar…' : 'Concluir Configuração'}
            </button>
          )}
        </div>
      </div>

      {/* Reused modals */}
      <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} />
      <RecurringModal
        isOpen={recurringModalType !== null}
        initialType={recurringModalType || 'expense'}
        onClose={() => setRecurringModalType(null)}
      />
    </div>
  );
}
