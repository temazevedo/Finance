import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import TransactionModal from '../components/TransactionModal.jsx';
import {
  formatCurrency,
  formatDateDisplay,
  TRANSACTION_TYPE_LABELS
} from '../utils/format.js';

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filters state
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Fetch accounts for filter dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.getAccounts()
  });

  // Fetch transactions query
  const queryParams = {
    page,
    limit: 25,
    ...(q ? { q } : {}),
    ...(accountId ? { account_id: accountId } : {}),
    ...(type ? { type } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  };

  const { data: txResult, isLoading } = useQuery({
    queryKey: ['transactions', queryParams],
    queryFn: () => api.getTransactions(queryParams)
  });

  const transactions = txResult?.data || [];
  const pagination = txResult?.pagination || { page: 1, totalPages: 1, total: 0 };

  // Delete transaction mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
    }
  });

  function handleDelete(id, name) {
    const confirmed = window.confirm(`Tem a certeza que deseja eliminar esta transação "${name || 'sem nome'}"?`);
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  }

  function handleResetFilters() {
    setQ('');
    setAccountId('');
    setType('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Transações</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Registo e consulta de receitas, despesas e transferências
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          Nova Transação
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-500" />
            <span>Filtros de Pesquisa</span>
          </div>
          {(q || accountId || type || from || to) && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpar
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Search Q */}
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Pesquisar por descrição ou notas..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Account Filter */}
          <div>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="">Todas as contas</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Type Filter */}
          <div>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="">Todos os tipos</option>
              <option value="expense">Despesas</option>
              <option value="income">Receitas</option>
              <option value="transfer">Transferências</option>
            </select>
          </div>

          {/* Date from */}
          <div>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              placeholder="Desde"
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Transactions List / Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">A carregar transações...</div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-600">Nenhuma transação encontrada com os filtros selecionados.</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl shadow-xs"
            >
              Registar nova transação
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.map((tx) => {
              const isExpense = tx.type === 'expense';
              const isIncome = tx.type === 'income';
              const isTransfer = tx.type === 'transfer';

              return (
                <div
                  key={tx.id}
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
                        <span className="font-semibold text-sm text-slate-900">
                          {tx.name || (isTransfer ? 'Transferência' : 'Sem descrição')}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isExpense
                              ? 'bg-rose-50 text-rose-700'
                              : isIncome
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {TRANSACTION_TYPE_LABELS[tx.type]}
                        </span>
                        {tx.status === 'planned' && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Planeada
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>{formatDateDisplay(tx.date)}</span>
                        <span>•</span>
                        {isTransfer ? (
                          <span className="font-medium text-slate-700">
                            {tx.account_name} → {tx.to_account_name}
                          </span>
                        ) : (
                          <>
                            <span className="font-medium text-slate-700">
                              {tx.category_name || 'Sem categoria'}
                            </span>
                            <span>•</span>
                            <span>{tx.account_name}</span>
                          </>
                        )}
                        {tx.notes && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400 italic truncate max-w-xs">{tx.notes}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Amount and Delete Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div
                      className={`font-mono text-sm sm:text-base font-bold text-right ${
                        isExpense ? 'text-rose-600' : isIncome ? 'text-emerald-600' : 'text-blue-600'
                      }`}
                    >
                      {isExpense && '-'}
                      {isIncome && '+'}
                      {formatCurrency(tx.amount_cents)}
                    </div>

                    <button
                      onClick={() => handleDelete(tx.id, tx.name)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Eliminar transação"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>
              Total: {pagination.total} movimentos (Página {pagination.page} de {pagination.totalPages})
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
              >
                Seguinte
              </button>
            </div>
          </div>
        )}
      </div>

      <TransactionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
