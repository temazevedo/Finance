import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import { parseCurrencyToCents } from '../utils/format.js';

export default function AccountModal({ isOpen, onClose }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [initialBalanceStr, setInitialBalanceStr] = useState('0,00');
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = useMutation({
    mutationFn: (payload) => api.createAccount(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      handleClose();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Erro ao criar conta');
    }
  });

  function handleClose() {
    setName('');
    setType('checking');
    setInitialBalanceStr('0,00');
    setErrorMsg('');
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('O nome da conta é obrigatório');
      return;
    }

    const parsedCents = parseCurrencyToCents(initialBalanceStr);
    const initialBalanceCents = parsedCents !== null ? parsedCents : 0;

    mutation.mutate({
      name: name.trim(),
      type,
      initial_balance_cents: initialBalanceCents
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">Nova Conta</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nome da Conta</label>
            <input
              type="text"
              placeholder="Ex: CGD Ordem, ActivoBank, Carteira..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de Conta</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="checking">Conta à Ordem</option>
              <option value="savings">Conta Poupança</option>
              <option value="cash">Dinheiro / Carteira</option>
              <option value="investment">Investimento</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Saldo Inicial (€)</label>
            <div className="relative">
              <input
                type="text"
                placeholder="0,00"
                value={initialBalanceStr}
                onChange={(e) => setInitialBalanceStr(e.target.value)}
                className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-3 pr-8 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              <span className="absolute right-3 top-2 text-sm text-slate-400">€</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">Saldo disponível no momento da criação da conta</p>
          </div>

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
              {mutation.isPending ? 'A gravar...' : 'Criar Conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
