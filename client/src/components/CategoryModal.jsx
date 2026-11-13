import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { BUDGET_GROUP_LABELS } from '../utils/format.js';

/**
 * Create/edit category modal.
 * Pass a `category` object to edit; omit it to create a new category.
 * Pass `tree` (root categories with children) for the parent selector.
 * Pass `initialParentId` to pre-select a parent in create mode.
 */
export default function CategoryModal({ isOpen, onClose, category = null, tree = [], initialParentId = null }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(category);
  // Edited roots come from the tree payload (with children); child categories never have children.
  const hasChildren =
    isEdit && tree.some((p) => p.id === category.id && p.children && p.children.length > 0);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const [parentId, setParentId] = useState('');
  const [budgetGroup, setBudgetGroup] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (category) {
      setName(category.name || '');
      setKind(category.kind || 'expense');
      setParentId(category.parent_id ? String(category.parent_id) : '');
      setBudgetGroup(category.budget_group || '');
    } else {
      setName('');
      setKind('expense');
      setParentId(initialParentId ? String(initialParentId) : '');
      setBudgetGroup('');
    }
    setErrorMsg('');
  }, [isOpen, category, initialParentId]);

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit ? api.updateCategory(category.id, payload) : api.createCategory(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      handleClose();
    },
    onError: (err) => {
      setErrorMsg(err.message || (isEdit ? 'Erro ao atualizar categoria' : 'Erro ao criar categoria'));
    }
  });

  function handleClose() {
    setName('');
    setKind('expense');
    setParentId('');
    setBudgetGroup('');
    setErrorMsg('');
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('O nome da categoria é obrigatório');
      return;
    }

    const payload = {
      name: name.trim(),
      kind: effectiveKind,
      parent_id: parentId ? Number(parentId) : null,
      budget_group: effectiveKind === 'expense' && budgetGroup ? budgetGroup : null
    };

    mutation.mutate(payload);
  }

  if (!isOpen) return null;

  // A subcategory's kind is inherited from its parent; a parent's kind is shared with its children.
  const selectedParent = tree.find((p) => String(p.id) === parentId);
  const kindLocked = Boolean(selectedParent) || (isEdit && (hasChildren || Boolean(category.parent_id)));
  const kindEditable = !kindLocked;
  const effectiveKind = selectedParent ? selectedParent.kind : kind;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? 'Editar Categoria' : 'Nova Categoria'}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nome</label>
            <input
              type="text"
              placeholder="Ex: Supermercado, Salário..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Categoria superior
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={isEdit && hasChildren}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">— Categoria principal (sem pai) —</option>
              {tree
                .filter((p) => !isEdit || p.id !== category.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            {isEdit && hasChildren && (
              <p className="text-xs text-slate-400 mt-1">
                Uma categoria com subcategorias não pode ser movida para baixo de outra.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo</label>
            <select
              value={effectiveKind}
              onChange={(e) => setKind(e.target.value)}
              disabled={kindLocked}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
            {kindLocked && (
              <p className="text-xs text-slate-400 mt-1">
                O tipo é herdado da categoria pai e partilhado pelas subcategorias.
              </p>
            )}
          </div>

          {effectiveKind === 'expense' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Grupo de orçamento (opcional)
              </label>
              <select
                value={budgetGroup}
                onChange={(e) => setBudgetGroup(e.target.value)}
                className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">— Sem grupo —</option>
                {Object.entries(BUDGET_GROUP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
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
              {mutation.isPending ? 'A gravar...' : isEdit ? 'Guardar Alterações' : 'Criar Categoria'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
