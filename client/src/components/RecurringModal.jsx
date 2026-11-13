import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Sparkles, X } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import { FREQUENCY_LABELS, getTodayYMD, parseCurrencyToCents } from '../utils/format.js';

const QUICK_CHIPS = [
  { name: 'Renda / Prestação Casa', type: 'expense', categoryMatch: 'Renda / Prestação', freq: 'monthly', isEst: false },
  { name: 'Eletricidade (EDP / Endesa)', type: 'expense', categoryMatch: 'Eletricidade', freq: 'monthly', isEst: true },
  { name: 'Água', type: 'expense', categoryMatch: 'Água', freq: 'monthly', isEst: true },
  { name: 'Gás', type: 'expense', categoryMatch: 'Gás', freq: 'monthly', isEst: true },
  { name: 'Internet / TV (MEO / NOS / Vodafone)', type: 'expense', categoryMatch: 'Internet', freq: 'monthly', isEst: false },
  { name: 'Seguro Automóvel', type: 'expense', categoryMatch: 'Seguro automóvel', freq: 'annual', isEst: false },
  { name: 'Subscrições (Netflix, Spotify, etc.)', type: 'expense', categoryMatch: 'Streaming', freq: 'monthly', isEst: false },
  { name: 'Ginásio', type: 'expense', categoryMatch: 'Ginásio', freq: 'monthly', isEst: false },
  { name: 'Salário Base', type: 'income', categoryMatch: 'Salário', freq: 'monthly', isEst: false },
  { name: 'Subsídio de Alimentação', type: 'income', categoryMatch: 'Subsídio de Alimentação', freq: 'monthly', isEst: false }
];

export default function RecurringModal({ isOpen, onClose, initialType = 'expense', onCreated }) {
  const queryClient = useQueryClient();
  const today = getTodayYMD();

  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [isEstimate, setIsEstimate] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.getAccounts()
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories()
  });

  const availableCategories = categories.filter(
    (c) => c.is_leaf && (type === 'transfer' ? false : c.kind === type)
  );

  const mutation = useMutation({
    mutationFn: (payload) => api.createRecurring(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      if (onCreated) onCreated(data);
      handleClose();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Erro ao criar item recorrente');
    }
  });

  function handleClose() {
    setName('');
    setType(initialType);
    setAccountId('');
    setToAccountId('');
    setCategoryId('');
    setAmountStr('');
    setFrequency('monthly');
    setStartDate(today);
    setEndDate('');
    setIsEstimate(false);
    setErrorMsg('');
    onClose();
  }

  function handleApplyChip(chip) {
    setName(chip.name);
    setType(chip.type);
    setFrequency(chip.freq);
    setIsEstimate(chip.isEst);

    // Try finding matching category
    const found = availableCategories.find((c) =>
      c.name.toLowerCase().includes(chip.categoryMatch.toLowerCase())
    );
    if (found) {
      setCategoryId(String(found.id));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');

    const parsedAmount = parseCurrencyToCents(amountStr);
    if (!parsedAmount) {
      setErrorMsg('Por favor insira um montante válido maior que zero');
      return;
    }

    if (!accountId) {
      setErrorMsg('Por favor selecione a conta');
      return;
    }

    if (type === 'transfer') {
      if (!toAccountId) {
        setErrorMsg('Por favor selecione a conta de destino');
        return;
      }
      if (toAccountId === accountId) {
        setErrorMsg('A conta de destino tem de ser diferente da conta de origem');
        return;
      }
    } else {
      if (!categoryId) {
        setErrorMsg('Por favor selecione a categoria');
        return;
      }
    }

    mutation.mutate({
      type,
      name: name.trim(),
      account_id: Number(accountId),
      to_account_id: type === 'transfer' ? Number(toAccountId) : null,
      category_id: type !== 'transfer' ? Number(categoryId) : null,
      amount_cents: parsedAmount,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      is_estimate: isEstimate ? 1 : 0
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">Novo Movimento Recorrente</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add Chips */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Sugestões rápidas:</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-0.5">
            {QUICK_CHIPS.filter((c) => (type === 'transfer' ? false : c.type === type)).map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleApplyChip(chip)}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700 transition-colors font-medium"
              >
                + {chip.name}
              </button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Toggle */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setType('expense');
                setCategoryId('');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                type === 'expense'
                  ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4 text-rose-600" />
              Despesa Fixa
            </button>
            <button
              type="button"
              onClick={() => {
                setType('income');
                setCategoryId('');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                type === 'income'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              Receita Regular
            </button>
            <button
              type="button"
              onClick={() => {
                setType('transfer');
                setCategoryId('');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                type === 'transfer'
                  ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ArrowLeftRight className="w-4 h-4 text-blue-600" />
              Transferência
            </button>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Designação</label>
            <input
              type="text"
              placeholder="Ex: Renda Casa, Vencimento, Seguro..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Accounts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {type === 'transfer' ? 'Conta de Origem' : 'Conta Associada'}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">Selecione a conta...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {type === 'transfer' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Conta de Destino</label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  required
                  className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">Selecione o destino...</option>
                  {accounts
                    .filter((acc) => String(acc.id) !== accountId)
                    .map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          {/* Category */}
          {type !== 'transfer' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Categoria Folha</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">Selecione uma categoria...</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent_name ? `${c.parent_name} → ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Amount and Frequency */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Montante (€)</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="0,00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  required
                  className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-3 pr-8 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <span className="absolute right-3 top-2 text-sm text-slate-400">€</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Periodicidade</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                {Object.entries(FREQUENCY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data Âncora / Início
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Data de Fim (opcional)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Variable Estimate Checkbox */}
          {type === 'expense' && (
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isEstimate}
                onChange={(e) => setIsEstimate(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-600">
                Valor variável / estimativa (ex: eletricidade, gás, água)
              </span>
            </label>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-5 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs disabled:opacity-50"
            >
              {mutation.isPending ? 'A gravar...' : 'Guardar Recorrente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
