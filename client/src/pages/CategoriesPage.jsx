import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, FolderTree, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import CategoryModal from '../components/CategoryModal.jsx';
import { BUDGET_GROUP_LABELS } from '../utils/format.js';

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [filterKind, setFilterKind] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [createParentId, setCreateParentId] = useState(null);

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['categories-tree'],
    queryFn: () => api.getCategoryTree()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteCategory(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      if (result?.archived) {
        alert('A categoria estava em uso e foi arquivada (o histórico foi mantido).');
      }
    },
    onError: (err) => {
      alert(err.message || 'Erro ao eliminar categoria');
    }
  });

  const filteredTree = tree.filter((parent) => {
    if (filterKind === 'all') return true;
    return parent.kind === filterKind;
  });

  function openCreate(parent = null) {
    setEditingCategory(null);
    setCreateParentId(parent ? parent.id : null);
    setModalOpen(true);
  }

  function openEdit(category) {
    setEditingCategory(category);
    setCreateParentId(null);
    setModalOpen(true);
  }

  function handleDelete(category) {
    const message = `Deseja eliminar a categoria "${category.name}"?\n\nSe tiver movimentos, subcategorias ou orçamentos associados, será arquivada em vez de eliminada (o histórico é mantido).`;
    if (window.confirm(message)) {
      deleteMutation.mutate(category.id);
    }
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Categorias</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Estrutura hierárquica (máximo 2 níveis). Transações associam-se apenas a categorias folha.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-xs">
            <button
              onClick={() => setFilterKind('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filterKind === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setFilterKind('expense')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filterKind === 'expense' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Despesas
            </button>
            <button
              onClick={() => setFilterKind('income')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filterKind === 'income' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Receitas
            </button>
          </div>
          <button
            onClick={() => openCreate(null)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Nova Categoria
          </button>
        </div>
      </div>

      {/* Categories Tree */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">A carregar categorias...</div>
        ) : filteredTree.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">
            Nenhuma categoria encontrada.
          </div>
        ) : (
          filteredTree.map((parent) => (
            <div key={parent.id} className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
              <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderTree className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="font-bold text-sm text-slate-900 truncate">{parent.name}</span>
                  {parent.is_leaf && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      Folha Direta
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {parent.budget_group && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                      {BUDGET_GROUP_LABELS[parent.budget_group] || parent.budget_group}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      parent.kind === 'income'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {parent.kind === 'income' ? 'Receita' : 'Despesa'}
                  </span>
                  <button
                    onClick={() => openEdit(parent)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                    title="Editar categoria"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(parent)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                    title="Eliminar categoria"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {parent.children.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {parent.children.map((child) => (
                    <div
                      key={child.id}
                      className="p-3 pl-8 sm:pl-10 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-sm font-medium text-slate-800 truncate">{child.name}</span>
                        {child.is_leaf && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium shrink-0">
                            <CheckCircle2 className="w-3 h-3" />
                            Folha
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {child.budget_group && (
                          <span className="text-xs text-slate-400">
                            {BUDGET_GROUP_LABELS[child.budget_group] || child.budget_group}
                          </span>
                        )}
                        <button
                          onClick={() => openEdit(child)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="Editar subcategoria"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(child)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                          title="Eliminar subcategoria"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 pl-10 flex items-center justify-between">
                  <span className="text-xs text-slate-400 italic">
                    Categoria sem subcategorias (utilizável diretamente como categoria folha).
                  </span>
                  <button
                    onClick={() => openCreate(parent)}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    Adicionar subcategoria
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <CategoryModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCategory(null);
          setCreateParentId(null);
        }}
        category={editingCategory}
        initialParentId={createParentId}
        tree={tree}
      />
    </div>
  );
}
