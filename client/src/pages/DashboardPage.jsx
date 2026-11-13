import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  CreditCard,
  Plus,
  Receipt,
  TrendingUp,
  Wallet
} from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import AccountModal from '../components/AccountModal.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import {
  ACCOUNT_TYPE_LABELS,
  formatCurrency,
  formatDateDisplay,
  TRANSACTION_TYPE_LABELS
} from '../utils/format.js';

export default function DashboardPage() {
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [isAccModalOpen, setIsAccModalOpen] = useState(false);

  // Balances
  const { data: balances = [], isLoading: isLoadingBalances } = useQuery({
    queryKey: ['accounts-balances'],
    queryFn: () => api.getAccountBalances()
  });

  // Recent transactions
  const { data: txData, isLoading: isLoadingTx } = useQuery({
    queryKey: ['transactions', { limit: 5 }],
    queryFn: () => api.getTransactions({ limit: 5 })
  });

  const recentTransactions = txData?.data || [];
  const totalBalanceCents = balances.reduce((sum, acc) => sum + (acc.balance_cents || 0), 0);

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Painel Principal</h1>
          <p className="text-xs sm:text-sm text-slate-500">Resumo financeiro e movimentos recentes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAccModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <CreditCard className="w-4 h-4 text-slate-500" />
            Nova Conta
          </button>
          <button
            onClick={() => setIsTxModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Nova Transação
          </button>
        </div>
      </div>

      {/* Net Worth Card */}
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-emerald-100 uppercase tracking-wider">
              Património Líquido Total
            </span>
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {isLoadingBalances ? '...' : formatCurrency(totalBalanceCents)}
            </div>
          </div>
          <div className="p-3 bg-white/10 backdrop-blur-xs rounded-xl">
            <TrendingUp className="w-6 h-6 text-emerald-200" />
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-4 text-xs text-emerald-100">
          <span>{balances.length} conta(s) ativa(s)</span>
          <span>•</span>
          <span>Saldos confirmados</span>
        </div>
      </div>

      {/* Accounts Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Contas & Saldos</h2>
          <Link to="/accounts" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
            Ver todas →
          </Link>
        </div>

        {isLoadingBalances ? (
          <p className="text-xs text-slate-400">A carregar contas...</p>
        ) : balances.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-3">
            <Wallet className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-600">Ainda não tem contas registadas.</p>
            <button
              onClick={() => setIsAccModalOpen(true)}
              className="text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl"
            >
              Criar primeira conta
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {balances.map((acc) => (
              <div
                key={acc.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:border-slate-300 transition-all space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 truncate">{acc.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                    {ACCOUNT_TYPE_LABELS[acc.type] || acc.type}
                  </span>
                </div>
                <div className="text-lg font-bold text-slate-900">
                  {formatCurrency(acc.balance_cents)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Inicial: {formatCurrency(acc.initial_balance_cents)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Transactions List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Últimas Transações</h2>
          <Link to="/transactions" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
            Ver todas →
          </Link>
        </div>

        {isLoadingTx ? (
          <p className="text-xs text-slate-400">A carregar movimentos...</p>
        ) : recentTransactions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-3">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-600">Ainda não registou nenhuma transação.</p>
            <button
              onClick={() => setIsTxModalOpen(true)}
              className="text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl"
            >
              Criar primeira transação
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-xs overflow-hidden">
            {recentTransactions.map((tx) => {
              const isExpense = tx.type === 'expense';
              const isIncome = tx.type === 'income';
              const isTransfer = tx.type === 'transfer';

              return (
                <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 ${
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
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">
                        {tx.name || (isTransfer ? 'Transferência entre contas' : 'Sem descrição')}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {isTransfer
                          ? `${tx.account_name} → ${tx.to_account_name}`
                          : `${tx.category_name || 'Sem categoria'} • ${tx.account_name}`}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-4">
                    <div
                      className={`font-mono text-sm font-bold ${
                        isExpense ? 'text-rose-600' : isIncome ? 'text-emerald-600' : 'text-blue-600'
                      }`}
                    >
                      {isExpense && '-'}
                      {isIncome && '+'}
                      {formatCurrency(tx.amount_cents)}
                    </div>
                    <div className="text-[11px] text-slate-400">{formatDateDisplay(tx.date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <TransactionModal isOpen={isTxModalOpen} onClose={() => setIsTxModalOpen(false)} />
      <AccountModal isOpen={isAccModalOpen} onClose={() => setIsAccModalOpen(false)} />
    </div>
  );
}
