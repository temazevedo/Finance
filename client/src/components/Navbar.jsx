import {
  CalendarClock,
  CreditCard,
  Ellipsis,
  FolderTree,
  LayoutDashboard,
  PieChart,
  Receipt,
  Repeat,
  Wallet
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

const desktopItems = [
  { to: '/', label: 'Painel', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transações', icon: Receipt },
  { to: '/upcoming', label: 'Próximos', icon: CalendarClock },
  { to: '/budgets', label: 'Orçamento', icon: PieChart },
  { to: '/recurring', label: 'Recorrentes', icon: Repeat },
  { to: '/accounts', label: 'Contas', icon: CreditCard },
  { to: '/categories', label: 'Categorias', icon: FolderTree }
];

const mobileItems = [
  { to: '/', label: 'Painel', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transações', icon: Receipt },
  { to: '/budgets', label: 'Orçamento', icon: PieChart },
  { to: '/upcoming', label: 'Próximos', icon: CalendarClock },
  { to: '/more', label: 'Mais', icon: Ellipsis }
];

export default function Navbar() {
  return (
    <>
      {/* Desktop Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-xs">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-slate-900 tracking-tight text-base">Orçamento</span>
              <span className="text-xs text-slate-400 block -mt-1">Finanças Pessoais</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {desktopItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-30 flex items-center justify-around py-2 shadow-lg">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-1 rounded-lg text-xs font-medium transition-colors ${
                  isActive ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-900'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
