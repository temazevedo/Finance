import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import { formatCurrency, formatDateDisplay, parseCurrencyToCents } from '../utils/format.js';

export default function UpcomingPage() {
  const queryClient = useQueryClient();
  const [selectedTx, setSelectedTx] = useState(null);
  const [confirmAmountStr, setConfirmAmountStr] = useState('');
  const [confirmDate, setConfirmDate] = useState('');

  // Fetch planned transactions
  const { data: txResult, isLoading } = useQuery({
    queryKey: ['transactions', { status: 'planned', limit: 100 }],
    queryFn: () => api.getTransactions({ status: 'planned', limit: 100 })
  });

  const plannedItems = txResult?.data || [];

  // Mutation to confirm planned transaction
  const confirmMutation = useMutation({
    mutationFn: ({ id, amount_cents, date }) =>
      api.updateTransaction(id, {
        status: 'confirmed',
        amount_cents,
        date
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      setSelectedTx(null);
    }
  });

  // Mutation to skip/delete planned transaction
  const skipMutation = useMutation({
    mutationFn: (id) => api.deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
    }
  });

  function openConfirm(tx) {
    setSelectedTx(tx);
    setConfirmAmountStr((tx.amount_cents / 100).toFixed(2).replace('.', ','));
    setConfirmDate(tx.date);
  }

  function handleConfirmSubmit(e) {
    e.preventDefault();
    if (!selectedTx) return;

    const parsedCents = parseCurrencyToCents(confirmAmountStr);
    if (!parsedCents) return;

    confirmMutation.mutate({
      id: selectedTx.id,
      amount_cents: parsedCents,
      date: confirmDate
    });
  }

  function handleSkip(tx) {
    const confirmed = window.confirm(
      `Deseja ignorar/saltar a ocorrência de "${tx.name || 'sem nome'}" de ${formatDateDisplay(
        tx.date
      )}? Não será gerada novamente.`
    );
    if (confirmed) {
      skipMutation.mutate(tx.id);
    }
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Próximos Movimentos</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Movimentos planeados para os próximos 60 dias. Confirme ou ajuste cada valor com um clique.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {plannedItems.length} pendente(s)
          </span>
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900 space-y-1">
          <p className="font-semibold">Confirmação de valores planeados</p>
          <p className="text-emerald-700">
            Os movimentos planeados não afetam o saldo das contas até serem confirmados. Ao confirmar, pode
            ajustar o montante real (ideal para faturas de água, luz ou gás com estimativas).
          </p>
        </div>
      </div>

      {/* List of Planned Transactions */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">A carregar movimentos planeados...</div>
        ) : plannedItems.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-slate-800">Tudo em dia!</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Não existem movimentos planeados pendentes nos próximos 60 dias.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {plannedItems.map((tx) => {
              const isTransfer = tx.type === 'transfer';
              const isExpense = tx.type === 'expense';

              return (
                <div
                  key={tx.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900">
                          {tx.name || (isTransfer ? 'Transferência planeada' : 'Movimento')}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          Planeado
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-slate-800">{formatDateDisplay(tx.date)}</span>
                        <span>•</span>
                        {isTransfer ? (
                          <span>
                            {tx.account_name} → {tx.to_account_name}
                          </span>
                        ) : (
                          <span>
                            {tx.category_name} • {tx.account_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Amount */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div
                      className={`font-mono text-base font-bold text-right ${
                        isExpense ? 'text-rose-600' : isTransfer ? 'text-blue-600' : 'text-emerald-600'
                      }`}
                    >
                      {formatCurrency(tx.amount_cents)}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openConfirm(tx)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
                        title="Confirmar movimento"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Confirmar
                      </button>

                      <button
                        onClick={() => handleSkip(tx)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        title="Saltar ocorrência"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Confirm Dialog */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900">Confirmar Movimento</h3>
              <button
                onClick={() => setSelectedTx(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Ajuste o valor final ou a data efetiva se necessário:
            </p>

            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Montante Efetivo (€)</label>
                <input
                  type="text"
                  value={confirmAmountStr}
                  onChange={(e) => setConfirmAmountStr(e.target.value)}
                  required
                  className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Data Efetiva</label>
                <input
                  type="date"
                  value={confirmDate}
                  onChange={(e) => setConfirmDate(e.target.value)}
                  required
                  className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTx(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={confirmMutation.isPending}
                  className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                >
                  {confirmMutation.isPending ? 'A confirmar...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
