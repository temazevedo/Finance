import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CreditCard, Pencil, Plus, Wallet } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import AccountModal from '../components/AccountModal.jsx';
import { ACCOUNT_TYPE_LABELS, formatCurrency } from '../utils/format.js';

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: balances = [], isLoading } = useQuery({
    queryKey: ['accounts-balances', showArchived],
    queryFn: () => api.getAccountBalances(showArchived)
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }) => api.updateAccount(id, { archived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  function toggleArchive(acc) {
    const action = acc.archived ? 'reativar' : 'arquivar';
    const confirmed = window.confirm(`Deseja ${action} a conta "${acc.name}"?`);
    if (confirmed) {
      archiveMutation.mutate({ id: acc.id, archived: acc.archived ? 0 : 1 });
    }
  }

  const activeAccounts = balances.filter((a) => !a.archived);
  const totalBalanceCents = activeAccounts.reduce((sum, acc) => sum + (acc.balance_cents || 0), 0);

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Contas Financeiras</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Gestão de contas à ordem, poupança, carteiras e investimentos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived((s) => !s)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              showArchived
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showArchived ? 'Ocultar Arquivadas' : 'Ver Arquivadas'}
          </button>
          <button
            onClick={() => {
              setEditingAccount(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Nova Conta
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Total em Contas Ativas
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {formatCurrency(totalBalanceCents)}
            </div>
          </div>
        </div>
        <span className="text-xs text-slate-400 font-medium">{activeAccounts.length} conta(s)</span>
      </div>

      {/* Accounts List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full p-8 text-center text-xs text-slate-400">A carregar contas...</div>
        ) : balances.length === 0 ? (
          <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <CreditCard className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-600">Nenhuma conta encontrada.</p>
            <button
              onClick={() => {
                setEditingAccount(null);
                setIsModalOpen(true);
              }}
              className="text-xs font-semibold px-4 py-2 bg-emerald-600 text-white rounded-xl"
            >
              Criar primeira conta
            </button>
          </div>
        ) : (
          balances.map((acc) => (
            <div
              key={acc.id}
              className={`bg-white border rounded-2xl p-5 shadow-xs space-y-4 transition-all ${
                acc.archived ? 'border-dashed border-slate-300 opacity-60' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-base text-slate-900">{acc.name}</h3>
                  <span className="text-xs text-slate-500">{ACCOUNT_TYPE_LABELS[acc.type] || acc.type}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingAccount(acc);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                    title="Editar conta"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleArchive(acc)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                    title={acc.archived ? 'Reativar conta' : 'Arquivar conta'}
                  >
                    {acc.archived ? (
                      <ArchiveRestore className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Archive className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-slate-400">Saldo Atual (Confirmado)</div>
                <div className="text-2xl font-mono font-bold text-slate-900">
                  {formatCurrency(acc.balance_cents)}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>Saldo Inicial: {formatCurrency(acc.initial_balance_cents)}</span>
                {acc.archived ? (
                  <span className="text-[10px] font-bold text-amber-600 uppercase">Arquivada</span>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-600 uppercase">Ativa</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <AccountModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingAccount(null);
        }}
        account={editingAccount}
      />
    </div>
  );
}
