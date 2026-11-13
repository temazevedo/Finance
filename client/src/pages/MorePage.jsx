import { CalendarClock, CreditCard, FolderTree, Repeat, Settings, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const links = [
  { to: '/recurring', label: 'Movimentos Recorrentes', description: 'Receitas, despesas fixas e transferências', icon: Repeat },
  { to: '/accounts', label: 'Contas', description: 'Gestão de contas e saldos iniciais', icon: CreditCard },
  { to: '/categories', label: 'Categorias', description: 'Árvore de categorias e orçamento', icon: FolderTree },
  { to: '/upcoming', label: 'Próximos Movimentos', description: 'Confirmar movimentos planeados', icon: CalendarClock },
  { to: '/settings', label: 'Definições', description: 'Método de orçamento, backup e exportação', icon: Settings }
];

export default function MorePage() {
  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Mais</h1>
        <p className="text-xs sm:text-sm text-slate-500">Acesso às restantes secções da aplicação</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-100 overflow-hidden">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{link.label}</p>
                <p className="text-[11px] text-slate-500">{link.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
