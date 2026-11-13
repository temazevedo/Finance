import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, FolderTree } from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../api/client.js';
import { BUDGET_GROUP_LABELS } from '../utils/format.js';

export default function CategoriesPage() {
  const [filterKind, setFilterKind] = useState('all');

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['categories-tree'],
    queryFn: () => api.getCategoryTree()
  });

  const filteredTree = tree.filter((parent) => {
    if (filterKind === 'all') return true;
    return parent.kind === filterKind;
  });

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
                <div className="flex items-center gap-2.5">
                  <FolderTree className="w-4 h-4 text-slate-500" />
                  <span className="font-bold text-sm text-slate-900">{parent.name}</span>
                  {parent.is_leaf && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Folha Direta
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
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
                </div>
              </div>

              {parent.children.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {parent.children.map((child) => (
                    <div
                      key={child.id}
                      className="p-3 pl-8 sm:pl-10 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm font-medium text-slate-800">{child.name}</span>
                        {child.is_leaf && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            Folha
                          </span>
                        )}
                      </div>
                      {child.budget_group && (
                        <span className="text-xs text-slate-400">
                          {BUDGET_GROUP_LABELS[child.budget_group] || child.budget_group}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 pl-10 text-xs text-slate-400 italic">
                  Categoria sem subcategorias (utilizável diretamente como categoria folha).
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
