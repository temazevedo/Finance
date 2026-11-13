import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { centsToInput, parseCurrencyToCents } from '../utils/format.js';

/**
 * Create/edit account modal.
 * Pass an `account` object to edit an existing account; omit it to create a new one.
 */
export default function AccountModal({ isOpen, onClose, account = null }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(account);

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [initialBalanceStr, setInitialBalanceStr] = useState('0,00');
  const [interestRateStr, setInterestRateStr] = useState('');
  const [interestPeriod, setInterestPeriod] = useState('annual');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (account) {
      setName(account.name || '');
      setType(account.type || 'checking');
      setInitialBalanceStr(centsToInput(account.initial_balance_cents) || '0,00');
      setInterestRateStr(
        account.interest_rate !== null && account.interest_rate !== undefined
          ? String(account.interest_rate).replace('.', ',')
          : ''
      );
      setInterestPeriod(account.interest_period || 'annual');
    } else {
      setName('');
      setType('checking');
      setInitialBalanceStr('0,00');
      setInterestRateStr('');
      setInterestPeriod('annual');
    }
    setErrorMsg('');
  }, [isOpen, account]);

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit ? api.updateAccount(account.id, payload) : api.createAccount(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      handleClose();
    },
    onError: (err) => {
      setErrorMsg(err.message || (isEdit ? 'Erro ao atualizar conta' : 'Erro ao criar conta'));
    }
  });

  function handleClose() {
    setName('');
    setType('checking');
    setInitialBalanceStr('0,00');
    setInterestRateStr('');
    setInterestPeriod('annual');
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

    const payload = {
      name: name.trim(),
      type,
      initial_balance_cents: initialBalanceCents
    };

    // Interest fields only apply to investment accounts
    if (type === 'investment') {
      const cleanRate = interestRateStr.replace(',', '.').trim();
      const rate = cleanRate === '' ? null : parseFloat(cleanRate);
      if (cleanRate !== '' && (isNaN(rate) || rate < 0 || rate > 100)) {
        setErrorMsg('A taxa de juro deve ser um valor entre 0 e 100');
        return;
      }
      payload.interest_rate = rate;
      payload.interest_period = rate !== null ? interestPeriod : null;
    }

    mutation.mutate(payload);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? 'Editar Conta' : 'Nova Conta'}
          </h2>
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
            <p className="text-xs text-slate-400 mt-1">
              {isEdit
                ? 'Atenção: alterar o saldo inicial recalcula o saldo de todos os meses anteriores'
                : 'Saldo disponível no momento da criação da conta'}
            </p>
          </div>

          {type === 'investment' && (
            <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Taxa de juro (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 2,85"
                    value={interestRateStr}
                    onChange={(e) => setInterestRateStr(e.target.value)}
                    className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Periodicidade
                  </label>
                  <select
                    value={interestPeriod}
                    onChange={(e) => setInterestPeriod(e.target.value)}
                    className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    <option value="annual">Anual</option>
                    <option value="monthly">Mensal</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-amber-700">
                No fim de cada período é criado automaticamente um rendimento confirmado
                ("Juros") calculado sobre o saldo dessa data. Deixe a taxa vazia para não
                gerar juros automáticos.
              </p>
            </div>
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
              {mutation.isPending ? 'A gravar...' : isEdit ? 'Guardar Alterações' : 'Criar Conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
