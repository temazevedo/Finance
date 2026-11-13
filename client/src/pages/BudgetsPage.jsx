import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Equal,
  FolderTree,
  Layers,
  PieChart,
  Plus,
  Save,
  TrendingDown,
  Wallet
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  addMonthsToMonth,
  BUDGET_GROUP_LABELS,
  formatCurrency,
  formatMonthDisplay,
  getCurrentMonth,
  parseCurrencyToCents
} from '../utils/format.js';

const VIEWS = [
  { id: 'month', label: 'Gestão Mensal', icon: Layers },
  { id: '503020', label: '50/30/20', icon: PieChart },
  { id: 'zero', label: 'Base Zero', icon: Equal },
  { id: 'envelope', label: 'Envelopes', icon: Wallet }
];

function BudgetProgressBar({ actual, available }) {
  if (available <= 0) {
    return actual > 0 ? (
      <div className="h-1.5 w-full rounded-full bg-rose-200">
        <div className="h-1.5 w-full rounded-full bg-rose-600" />
      </div>
    ) : null;
  }
  const ratio = Math.min(actual / available, 1);
  const percent = Math.round((actual / available) * 100);
  const barColor = ratio >= 1 ? 'bg-rose-600' : ratio >= 0.85 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className={`text-[10px] font-medium ${percent >= 100 ? 'text-rose-600' : 'text-slate-400'}`}>
        {percent}% usado
      </p>
    </div>
  );
}

export default function BudgetsPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(getCurrentMonth());
  const [view, setView] = useState('month');
  const [viewChanged, setViewChanged] = useState(false);
  const [drafts, setDrafts] = useState({}); // { [categoryId]: string }
  const [extraRows, setExtraRows] = useState([]); // categories added without data yet
  const [saveError, setSaveError] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings
  });

  // First visit: honour the persisted budget method preference from /settings
  const settingsMethod = settings?.budget_method;
  useEffect(() => {
    if (settingsMethod && !viewChanged) {
      const mapping = { '50_30_20': '503020', zero_based: 'zero', envelope: 'envelope' };
      if (mapping[settingsMethod]) setView(mapping[settingsMethod]);
    }
  }, [settingsMethod, viewChanged]);

  function handleViewChange(next) {
    setView(next);
    setViewChanged(true);
  }

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['budget-vs-actual', month],
    queryFn: () => api.getBudgetVsActual(month)
  });

  const { data: summary } = useQuery({
    queryKey: ['recurring-summary'],
    queryFn: api.getRecurringSummary
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories()
  });

  const leafExpenseCategories = useMemo(
    () => categories.filter((c) => c.is_leaf && c.kind === 'expense' && !c.archived),
    [categories]
  );

  const reportCategories = report?.categories || [];
  const knownIds = new Set(reportCategories.map((c) => c.category_id));
  const addable = leafExpenseCategories.filter((c) => !knownIds.has(c.id));

  // Rows shown (report rows + manually added empty rows)
  const allRows = useMemo(() => {
    const extras = extraRows
      .filter((id) => !knownIds.has(id))
      .map((id) => {
        const cat = leafExpenseCategories.find((c) => c.id === id);
        return cat
          ? {
              category_id: cat.id,
              category_name: cat.name,
              parent_category_id: cat.parent_id,
              parent_category_name: cat.parent_name,
              budget_group: cat.budget_group,
              budgeted_cents: 0,
              carryover_cents: 0,
              available_cents: 0,
              actual_cents: 0,
              remaining_cents: 0,
              is_overspent: false,
              has_budget: false,
              is_new_row: true
            }
          : null;
      })
      .filter(Boolean);
    return [...reportCategories, ...extras];
  }, [reportCategories, extraRows, knownIds, leafExpenseCategories]);

  // Clear drafts when switching months
  function goToMonth(next) {
    setMonth(next);
    setDrafts({});
    setExtraRows([]);
    setSaveError('');
  }

  const saveMutation = useMutation({
    mutationFn: (budgets) => api.saveBudgets(month, budgets),
    onSuccess: () => {
      setDrafts({});
      setExtraRows([]);
      setSaveError('');
      queryClient.invalidateQueries({ queryKey: ['budget-vs-actual', month] });
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (err) => setSaveError(err.message || 'Erro ao gravar orçamentos')
  });

  // Single source of truth for the editable amount of a row (string form)
  function draftDisplayValue(row) {
    if (row.category_id in drafts) return drafts[row.category_id];
    return row.budgeted_cents ? centsToDraftValue(row.budgeted_cents) : '';
  }

  function draftCents(row) {
    return parseCurrencyToCents(draftDisplayValue(row)) || 0;
  }

  function savedCents(row) {
    return row.budgeted_cents || 0;
  }

  const isDirty = allRows.some((row) => draftCents(row) !== savedCents(row));

  function handleSave() {
    const budgets = allRows.map((row) => ({
      category_id: row.category_id,
      amount_cents: draftCents(row)
    }));
    saveMutation.mutate(budgets);
  }

  function addCategoryRow() {
    if (addable.length === 0) return;
    setExtraRows((prev) => [...prev, addable[0].id]);
    setDrafts((prev) => ({ ...prev, [addable[0].id]: '' }));
  }

  // Group rows: by 50/30/20 group, by parent, or flat
  const groupedRows = useMemo(() => {
    const groups = new Map();
    for (const row of allRows) {
      let key, label;
      if (view === '503020') {
        key = row.budget_group || 'none';
        label = BUDGET_GROUP_LABELS[row.budget_group] || 'Sem grupo (definir categoria)';
      } else {
        key = row.parent_category_id || `root-${row.category_id}`;
        label = row.parent_category_name || row.category_name;
      }
      if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [allRows, view]);

  // Method view metrics (over the SAVED data, not the drafts)
  const savedLeafBudgetTotal = reportCategories.reduce((s, c) => s + c.budgeted_cents, 0);
  const incomeCents = summary?.income_cents || 0;
  const fixedExpenseCents = summary?.expense_cents || 0;
  const surplusCents = summary?.surplus_cents || 0;

  const groupTotals = useMemo(() => {
    const totals = { needs: 0, wants: 0, savings: 0 };
    for (const row of reportCategories) {
      if (row.budget_group && row.budget_group in totals) totals[row.budget_group] += row.budgeted_cents;
    }
    return totals;
  }, [reportCategories]);

  const pendingCount = reportCategories.filter((c) => !c.has_budget).length;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Orçamento</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Planeamento mensal por categoria com transição de saldos (rollover)
          </p>
        </div>

        {/* Month selector */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 shadow-xs self-start">
          <button
            onClick={() => goToMonth(addMonthsToMonth(month, -1))}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            title="Mês anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-900 min-w-[130px] text-center">
            {formatMonthDisplay(month)}
          </span>
          <button
            onClick={() => goToMonth(addMonthsToMonth(month, 1))}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            title="Mês seguinte"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Method view switcher */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-xs max-w-fit">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              onClick={() => handleViewChange(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                view === v.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Summary panels per view */}
      {report && view !== 'envelope' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Month overview card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Orçado vs Real</span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-slate-900">{formatCurrency(report.totals.actual_cents)}</span>
              <span className="text-xs text-slate-400">de {formatCurrency(report.totals.available_cents)}</span>
            </div>
            <BudgetProgressBar actual={report.totals.actual_cents} available={report.totals.available_cents} />
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
              <TrendingDown className={`w-3.5 h-3.5 ${report.totals.carryover_cents < 0 ? 'text-rose-500' : 'text-emerald-500'}`} />
              <span>
                Rollover de {report.totals.carryover_cents >= 0 ? 'excedente' : 'déficit'}:{' '}
                <span className="font-semibold">{formatCurrency(report.totals.carryover_cents)}</span>
              </span>
            </div>
          </div>

          {/* 50/30/20 or zero-based contextual panels */}
          {view === '503020' ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-2.5 sm:col-span-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Distribuição 50/30/20 (rendimento estimado: {formatCurrency(incomeCents)})
              </span>
              {[
                { group: 'needs', target: 0.5, color: 'bg-emerald-500' },
                { group: 'wants', target: 0.3, color: 'bg-amber-500' },
                { group: 'savings', target: 0.2, color: 'bg-blue-500' }
              ].map(({ group, target, color }) => {
                const assigned = groupTotals[group] || 0;
                const targetCents = Math.round(incomeCents * target);
                const share = incomeCents > 0 ? assigned / incomeCents : 0;
                const onTarget = Math.abs(assigned - targetCents) <= Math.round(incomeCents * 0.02);
                return (
                  <div key={group} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">
                        {BUDGET_GROUP_LABELS[group]} — {formatCurrency(assigned)}
                      </span>
                      <span className={onTarget ? 'text-emerald-600' : 'text-amber-600'}>
                        {Math.round(share * 100)}% (alvo {Math.round(target * 100)}% ={' '}
                        {formatCurrency(targetCents)})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className={`h-1.5 rounded-full ${color}`}
                        style={{ width: `${Math.min(share, 1) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : view === 'zero' ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-2 sm:col-span-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Base Zero — cada euro atribuído
              </span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-emerald-50 rounded-xl">
                  <p className="text-[10px] text-slate-500 font-semibold">Rendimento</p>
                  <p className="text-sm font-bold text-emerald-700">{formatCurrency(incomeCents)}</p>
                </div>
                <div className="p-2 bg-slate-50 rounded-xl">
                  <p className="text-[10px] text-slate-500 font-semibold">Atribuído</p>
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(savedLeafBudgetTotal)}</p>
                </div>
                <div
                  className={`p-2 rounded-xl ${
                    incomeCents - savedLeafBudgetTotal === 0 ? 'bg-emerald-50' : 'bg-amber-50'
                  }`}
                >
                  <p className="text-[10px] text-slate-500 font-semibold">Não atribuído</p>
                  <p
                    className={`text-sm font-bold ${
                      incomeCents - savedLeafBudgetTotal === 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {formatCurrency(incomeCents - savedLeafBudgetTotal)}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                {incomeCents - savedLeafBudgetTotal === 0
                  ? 'Orçamento equilibrado — todos os rendimentos têm destino.'
                  : 'Atribua o valor restante a categorias de despesa ou poupança.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-2 sm:col-span-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Excedente estimado do mês
              </span>
              <div className={`text-xl font-bold ${surplusCents >= 0 ? 'text-teal-700' : 'text-red-700'}`}>
                {formatCurrency(surplusCents)}
              </div>
              <p className="text-[11px] text-slate-500">
                Rendimento {formatCurrency(incomeCents)} − despesas fixas {formatCurrency(fixedExpenseCents)}. O
                orçamento variável consome parte deste excedente.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Envelope view: cards focusing on available/remaining with alerts */}
      {report && view === 'envelope' && (
        <div className="space-y-3">
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {pendingCount} categoria(s) com gastos mas sem envelope definido.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allRows.map((row) => (
              <div
                key={row.category_id}
                className={`bg-white border rounded-2xl p-4 shadow-xs space-y-2 ${
                  row.is_overspent ? 'border-rose-300' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900 truncate">{row.category_name}</p>
                  {row.is_overspent && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full shrink-0">
                      <AlertTriangle className="w-3 h-3" />
                      Déficit
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">{row.parent_category_name || 'Categoria raiz'}</p>
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-lg font-bold ${row.is_overspent ? 'text-rose-600' : 'text-slate-900'}`}>
                    {formatCurrency(row.remaining_cents)}
                  </span>
                  <span className="text-[11px] text-slate-400">restantes de {formatCurrency(row.available_cents)}</span>
                </div>
                <BudgetProgressBar actual={row.actual_cents} available={row.available_cents} />
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Envelopado: {formatCurrency(row.budgeted_cents)}</span>
                  <span>
                    Rollover: {formatCurrency(row.carryover_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editing table (all views except envelope) */}
      {view !== 'envelope' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {reportLoading ? (
            <div className="p-8 text-center text-xs text-slate-400">A carregar orçamento…</div>
          ) : allRows.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <FolderTree className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">Sem orçamentos para {formatMonthDisplay(month)}.</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Adicione categorias de despesa para começar a planear o mês.
              </p>
              {addable.length > 0 && (
                <button
                  onClick={addCategoryRow}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar categoria
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {groupedRows.map((group) => {
                const gBudgeted = group.rows.reduce((s, r) => s + r.budgeted_cents, 0);
                const gCarryover = group.rows.reduce((s, r) => s + r.carryover_cents, 0);
                const gActual = group.rows.reduce((s, r) => s + r.actual_cents, 0);
                const gRemaining = group.rows.reduce((s, r) => s + r.remaining_cents, 0);
                return (
                  <div key={group.key}>
                    {/* Group header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                        {view === '503020' ? <PieChart className="w-3.5 h-3.5 text-slate-400" /> : <FolderTree className="w-3.5 h-3.5 text-slate-400" />}
                        {group.label}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {formatCurrency(gBudgeted)}
                        {gCarryover !== 0 && (
                          <span className={gCarryover < 0 ? 'text-rose-500' : 'text-emerald-600'}>
                            {' '}
                            ({gCarryover > 0 ? '+' : ''}
                            {formatCurrency(gCarryover)})
                          </span>
                        )}
                        {' → '}
                        real {formatCurrency(gActual)} | resto {formatCurrency(gRemaining)}
                      </span>
                    </div>

                    {/* Rows */}
                    {group.rows.map((row) => {
                      const draftValue = draftDisplayValue(row);
                      const original = savedCents(row);
                      return (
                        <div
                          key={row.category_id}
                          className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${
                            !row.is_new_row ? 'hover:bg-slate-50' : ''
                          } transition-colors ${row.is_overspent ? 'bg-rose-50/40' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {row.category_name !== (row.parent_category_name || row.category_name)
                                  ? row.category_name
                                  : row.category_name}
                              </span>
                              {row.is_overspent && !row.is_new_row && (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                  <AlertTriangle className="w-3 h-3" />
                                  Excedido
                                </span>
                              )}
                              {row.category_id in drafts && parseCurrencyToCents(draftValue) !== original && (
                                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                  {original === 0 ? 'novo' : 'alterado'}
                                </span>
                              )}
                            </div>
                            {!row.is_new_row && (
                              <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                                <span>
                                  Disponível{' '}
                                  <span className="font-semibold text-slate-700">
                                    {formatCurrency(row.available_cents)}
                                  </span>
                                </span>
                                <span>
                                  Real{' '}
                                  <span
                                    className={`font-semibold ${
                                      row.actual_cents > row.available_cents ? 'text-rose-600' : 'text-slate-700'
                                    }`}
                                  >
                                    {formatCurrency(row.actual_cents)}
                                  </span>
                                </span>
                                <span className={row.remaining_cents < 0 ? 'text-rose-600 font-semibold' : ''}>
                                  Restante {formatCurrency(row.remaining_cents)}
                                </span>
                              </div>
                            )}
                            {!row.is_new_row && (
                              <div className="mt-1.5 max-w-[220px]">
                                <BudgetProgressBar actual={row.actual_cents} available={row.available_cents} />
                              </div>
                            )}
                          </div>

                          {/* Amount editor (reported rows are leaf expense categories) */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={draftValue === null ? '' : draftValue}
                                onChange={(e) =>
                                  setDrafts((prev) => ({ ...prev, [row.category_id]: e.target.value }))
                                }
                                className="w-28 text-sm bg-white border border-slate-200 rounded-xl pl-3 pr-7 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                              />
                              <span className="absolute right-2.5 top-2 text-xs text-slate-400">€</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Footer actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  {addable.length > 0 && (
                    <button
                      onClick={addCategoryRow}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar categoria ({addable.length} disponíveis)
                    </button>
                  )}
                  {pendingCount > 0 && (
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {pendingCount} categoria(s) com gastos sem orçamento
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {saveError && <span className="text-[11px] text-rose-600">{saveError}</span>}
                  <button
                    onClick={handleSave}
                    disabled={!isDirty || saveMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saveMutation.isPending ? 'A gravar…' : 'Gravar Orçamento'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function centsToDraftValue(cents) {
  if (typeof cents !== 'number' || cents === 0) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}
