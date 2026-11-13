import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import { parseCurrencyToCents } from '../utils/format.js';
import NameCombobox from './NameCombobox.jsx';

export default function TransactionModal({ isOpen, onClose }) {
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split('T')[0];

  const [type, setType] = useState('expense');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

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

  // Filter leaf categories matching current transaction type
  const availableCategories = categories.filter(
    (c) => c.is_leaf && (type === 'transfer' ? false : c.kind === type)
  );

  const mutation = useMutation({
    mutationFn: (payload) => api.createTransaction(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      handleClose();
    },
    onError: (err) => {
      setFormError(err.message || 'Erro ao criar transação');
    }
  });

  function handleSelectSuggestion(suggestion) {
    if (suggestion.last_amount_cents && suggestion.last_amount_cents > 0) {
      const eurosFormatted = (suggestion.last_amount_cents / 100).toFixed(2).replace('.', ',');
      setAmountStr(eurosFormatted);
    }
  }

  function handleClose() {
    setType('expense');
    setAccountId('');
    setToAccountId('');
    setCategoryId('');
    setName('');
    setAmountStr('');
    setDate(today);
    setNotes('');
    setFormError('');
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const parsedAmount = parseCurrencyToCents(amountStr);
    if (!parsedAmount) {
      setFormError('Por favor insira um montante válido maior que zero');
      return;
    }

    if (!accountId) {
      setFormError('Por favor selecione uma conta');
      return;
    }

    if (type === 'transfer') {
      if (!toAccountId) {
        setFormError('Por favor selecione a conta de destino');
        return;
      }
      if (toAccountId === accountId) {
        setFormError('A conta de destino deve ser diferente da conta de origem');
        return;
      }
    } else {
      if (!categoryId) {
        setFormError('Por favor selecione uma categoria');
        return;
      }
    }

    const payload = {
      date,
      type,
      amount_cents: parsedAmount,
      account_id: Number(accountId),
      to_account_id: type === 'transfer' ? Number(toAccountId) : null,
      category_id: type !== 'transfer' ? Number(categoryId) : null,
      name: name.trim() || null,
      notes: notes.trim() || null,
      status: 'confirmed'
    };

    mutation.mutate(payload);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">Nova Transação</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {formError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tipo de Movimento</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setType('expense');
                  setCategoryId('');
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  type === 'expense'
                    ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4 text-rose-600" />
                Despesa
              </button>
              <button
                type="button"
                onClick={() => {
                  setType('income');
                  setCategoryId('');
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  type === 'income'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                Receita
              </button>
              <button
                type="button"
                onClick={() => {
                  setType('transfer');
                  setCategoryId('');
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  type === 'transfer'
                    ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowLeftRight className="w-4 h-4 text-blue-600" />
                Transferência
              </button>
            </div>
          </div>

          {/* 2. Account & To Account (if transfer) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {type === 'transfer' ? 'Conta de Origem' : 'Conta'}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">Selecione uma conta...</option>
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

          {/* 3. Category (Leaf only, hidden for transfers) */}
          {type !== 'transfer' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Categoria <span className="text-slate-400 font-normal">(apenas subcategorias folha)</span>
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">Selecione a categoria...</option>
                {availableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.parent_name ? `${cat.parent_name} → ${cat.name}` : cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 4. Name / Payee (Combobox with suggestions for income/expense) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Entidade / Descrição
            </label>
            {type !== 'transfer' ? (
              <NameCombobox
                value={name}
                onChange={setName}
                onSelectSuggestion={handleSelectSuggestion}
                categoryId={categoryId ? Number(categoryId) : null}
                disabled={!categoryId}
                placeholder="Ex: Pingo Doce, Continente, Vencimento..."
              />
            ) : (
              <input
                type="text"
                placeholder="Ex: Poupança mensal, Reforço de conta..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            )}
          </div>

          {/* 5. Amount & Date */}
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* 6. Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Notas (opcional)</label>
            <textarea
              rows={2}
              placeholder="Detalhes adicionais..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Submit Actions */}
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
              {mutation.isPending ? 'A gravar...' : 'Gravar Transação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
