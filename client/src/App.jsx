import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, Wallet } from 'lucide-react';

export default function App() {
  const { data: health, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Falha ao contactar servidor');
      return res.json();
    }
  });

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 shadow-xs sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-600 text-white rounded-lg shadow-xs">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Orçamento Pessoal</h1>
              <p className="text-xs text-slate-500">Gestão financeira local</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Milestone 1 — Base
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
            <Activity className="w-5 h-5 text-emerald-600" />
            <span>Estado da Ligação ao Servidor</span>
          </div>

          {isLoading && (
            <p className="text-sm text-slate-500 animate-pulse">A verificar disponibilidade do servidor...</p>
          )}

          {isError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              Não foi possível estabelecer ligação à API em <code className="font-mono">/api/health</code>.
            </div>
          )}

          {health && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-900 space-y-1">
                <p className="font-medium">Servidor operacional e base de dados SQLite ativa</p>
                <p className="text-xs text-emerald-700 font-mono">
                  Timestamp: {health.timestamp}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-xs">
            <h3 className="font-semibold text-slate-900 text-sm mb-1">Base de Dados SQLite</h3>
            <p className="text-xs text-slate-500">
              Esquema inicial e categorias pt-PT pré-carregadas via migrações idempotentes com suporte a WAL mode.
            </p>
          </div>
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-xs">
            <h3 className="font-semibold text-slate-900 text-sm mb-1">Interface Mobile-First</h3>
            <p className="text-xs text-slate-500">
              Configurado com Tailwind CSS, React e TanStack Query, preparado para acesso via rede local ou Tailscale.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-400">
        Milestone 1 — Scaffolding concluído com sucesso
      </footer>
    </div>
  );
}
