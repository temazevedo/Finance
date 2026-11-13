import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileUp,
  HardDriveDownload,
  PieChart,
  ShieldAlert,
  Wallet
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client.js';
import { formatCurrency } from '../utils/format.js';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState({});

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings
  });

  const saveMethodMutation = useMutation({
    mutationFn: (budget_method) => api.saveSettings({ budget_method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setErrors((prev) => ({ ...prev, method: '' }));
      setNotice('Preferência de método guardada.');
    },
    onError: (err) => setErrors((prev) => ({ ...prev, method: err.message }))
  });

  const methodOptions = [
    { id: '50_30_20', label: '50/30/20', description: 'Vistas por grupos: necessidades, desejos e poupança' },
    { id: 'zero_based', label: 'Base Zero', description: 'Cada euro do rendimento tem um destino atribuído' },
    { id: 'envelope', label: 'Envelopes', description: 'Limites por categoria com alertas e rollover' }
  ];

  const defaultMethod =
    methodOptions.find((m) => m.id === settings?.budget_method)?.id || null;

  function chooseMethod(methodId) {
    if (methodId === defaultMethod) return;
    saveMethodMutation.mutate(methodId);
  }

  async function handleDownload(endpoint, filename, key) {
    setErrors((prev) => ({ ...prev, [key]: '' }));
    setNotice('');
    try {
      await downloadFile(endpoint, filename);
      setNotice('Ficheiro descarregado com sucesso.');
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: err.message }));
    }
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Definições</h1>
        <p className="text-xs sm:text-sm text-slate-500">Método de orçamento e segurança dos dados</p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Budget method */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
            <PieChart className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Método de Orçamento</h2>
            <p className="text-[11px] text-slate-500">
              Define a vista predefinida na página de orçamento (os dados são os mesmos)
            </p>
          </div>
        </div>

        {errors.method && <p className="text-[11px] text-rose-600">{errors.method}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          {methodOptions.map((option) => {
            const selected = defaultMethod === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseMethod(option.id)}
                disabled={saveMethodMutation.isPending}
                className={`text-left p-3 rounded-xl border transition-colors space-y-1 ${
                  selected
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`text-xs font-bold block ${
                    selected ? 'text-emerald-700' : 'text-slate-800'
                  }`}
                >
                  {option.label}
                </span>
                <span className="text-[10px] text-slate-500 block leading-snug">{option.description}</span>
                {selected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> Ativo
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Import */}
      <Link
        to="/import"
        className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-3 block hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
            <FileUp className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Importar Extracto Bancário</h2>
            <p className="text-[11px] text-slate-500">
              Importar CSV do banco com deteção de duplicados e categorização a partir do histórico
            </p>
          </div>
        </div>
      </Link>

      {/* Data safety */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Cópia e Exportação de Dados</h2>
            <p className="text-[11px] text-slate-500">
              Descarregue os seus dados diretamente do navegador, no computador ou no telemóvel
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => handleDownload('/settings/backup', 'orcamento-backup.db', 'backup')}
            className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors text-left"
          >
            <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-xl text-blue-600 shrink-0">
              <HardDriveDownload className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">Descarregar Base de Dados</p>
              <p className="text-[10px] text-slate-500 leading-snug">
                Ficheiro SQLite completo (contas, transações, orçamentos). Guarde numa cópia do backup diário.
              </p>
              {errors.backup && <p className="text-[10px] text-rose-600 mt-1">{errors.backup}</p>}
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleDownload('/settings/export/csv', 'transacoes.csv', 'csv')}
            className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors text-left"
          >
            <div className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600 shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">Exportar Transações (CSV)</p>
              <p className="text-[10px] text-slate-500 leading-snug">
                Todas as transações em formato compatível com Excel (separador ; e vírgula decimal)
              </p>
              {errors.csv && <p className="text-[10px] text-rose-600 mt-1">{errors.csv}</p>}
            </div>
          </button>
        </div>

        <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-100 rounded-xl text-[11px] text-slate-600">
          <Database className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <span>
            É criada automaticamente uma cópia de segurança diária na pasta <code className="font-mono">data/backups/</code>{' '}
            (mantidas as últimas 14). Pode também criar cópias manuais em qualquer momento com{' '}
            <code className="font-mono">npm run backup</code>.
          </span>
        </div>
      </div>

      {/* About */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
            <Wallet className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">Sobre</h2>
        </div>
        <p className="text-[11px] text-slate-500">
          Aplicação local de orçamento pessoal e controlo de transações. Montantes guardados como inteiro em
          cêntimos ({formatCurrency(123456)} por exemplo). Autenticação e partilha externa serão adicionadas
          antes de expor a aplicação via Tailscale.
        </p>
      </div>
    </div>
  );
}
