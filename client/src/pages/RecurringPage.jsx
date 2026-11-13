import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  CalendarDays,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  TrendingUp
} from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import RecurringModal from '../components/RecurringModal.jsx';
import {
  formatCurrency,
  formatDateDisplay,
  FREQUENCY_LABELS,
  TRANSACTION_TYPE_LABELS
} from '../utils/format.js';

export default function RecurringPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterType, setFilterType] = useState('all');

  // Fetch recurring items
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.getRecurring()
  });

  // Fetch monthly summary
  const { data: summary } = useQuery({
    queryKey: ['recurring-summary'],
    queryFn: () => api.getRecurringSummary()
  });

  // Deactivate mutation
  const deactivateMutation = useMutation({
    mutationFn: (id) => api.deleteRecurring(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }
  });

  function handleDeactivate(item) {
    const confirmed = window.confirm(
      `Deseja desativar o movimento recorrente "${item.name}"? As ocorrências futuras não confirmadas serão removidas.`
    );
    if (confirmed) {
      deactivateMutation.mutate(item.id);
    }
  }

  const filteredItems = items.filter((item) => {
    if (filterType === 'all') return true;
    return item.type === filterType;
  });

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Movimentos Recorrentes
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Receitas regulares, despesas fixas e transferências automáticas
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          Novo Recorrente
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-1">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
              Receitas Mensais Regulares
            </span>
            <div className="text-xl font-bold text-emerald-600">
              {formatCurrency(summary.income_cents)}
            </div>
            <p className="text-[11px] text-slate-400">Equivalente mensal consolidado</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-1">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-rose-600" />
              Despesas Fixas Mensais
            </span>
            <div className="text-xl font-bold text-rose-600">
              {formatCurrency(summary.expense_cents)}
            </div>
            <p className="text-[11px] text-slate-400">Equivalente mensal consolidado</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-1">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-teal-600" />
              Excedente Mensal Estimado
            </span>
            <div
              className={`text-xl font-bold ${
                summary.surplus_cents >= 0 ? 'text-teal-700' : 'text-red-700'
              }`}
            >
              {formatCurrency(summary.surplus_cents)}
            </div>
            <p className="text-[11px] text-slate-400">Margem antes de despesas variáveis</p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-xs max-w-fit">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            filterType === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Todos ({items.length})
        </button>
        <button
          onClick={() => setFilterType('expense')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            filterType === 'expense' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Despesas
        </button>
        <button
          onClick={() => setFilterType('income')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            filterType === 'income' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Receitas
        </button>
        <button
          onClick={() => setFilterType('transfer')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            filterType === 'transfer' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Transferências
        </button>
      </div>

      {/* Items List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">A carregar itens recorrentes...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Repeat className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-800">Nenhum movimento recorrente registado.</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl shadow-xs"
            >
              Criar primeiro recorrente
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const isExpense = item.type === 'expense';
              const isIncome = item.type === 'income';
              const isTransfer = item.type === 'transfer';

              return (
                <div
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        isExpense
                          ? 'bg-rose-50 text-rose-600'
                          : isIncome
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {isExpense && <ArrowDownLeft className="w-4 h-4" />}
                      {isIncome && <ArrowUpRight className="w-4 h-4" />}
                      {isTransfer && <ArrowLeftRight className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900">{item.name}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {FREQUENCY_LABELS[item.frequency] || item.frequency}
                        </span>
                        {item.is_estimate && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Estimativa
                          </span>
                        )}
                        {!item.active && (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            Inativo
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>Desde {formatDateDisplay(item.start_date)}</span>
                        {item.end_date && <span>até {formatDateDisplay(item.end_date)}</span>}
                        <span>•</span>
                        {isTransfer ? (
                          <span className="font-medium text-slate-700">
                            {item.account_name} → {item.to_account_name}
                          </span>
                        ) : (
                          <span>
                            {item.category_name} • {item.account_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Amounts & Deactivate */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-right">
                      <div
                        className={`font-mono text-base font-bold ${
                          isExpense ? 'text-rose-600' : isIncome ? 'text-emerald-600' : 'text-blue-600'
                        }`}
                      >
                        {formatCurrency(item.amount_cents)}
                      </div>
                      {item.frequency !== 'monthly' && (
                        <div className="text-[11px] text-slate-400 font-mono">
                          ~{formatCurrency(item.monthly_equivalent_cents)} / mês
                        </div>
                      )}
                    </div>

                    {item.active ? (
                      <button
                        onClick={() => handleDeactivate(item)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        title="Desativar recorrente"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Desativado</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecurringModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
