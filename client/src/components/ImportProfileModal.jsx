import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const EMPTY_CONFIG = {
  encoding: 'utf8',
  delimiter: ';',
  skip_rows: 0,
  has_header_row: true,
  date_format: 'DD-MM-YYYY',
  decimal_separator: ',',
  thousand_separator: '.',
  columns: { date: 0, description: 1, amount: 2, debit: null, credit: null },
  cleanup_rules: []
};

/**
 * Create/edit an import profile (AGENT.md 14.2). `initialConfig` can come
 * from an agent proposal — the user always reviews it before saving.
 */
export default function ImportProfileModal({ isOpen, onClose, profile = null, initialConfig = null }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(profile);

  const [name, setName] = useState('');
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (profile) {
      setName(profile.name);
      setConfig({ ...EMPTY_CONFIG, ...profile.config, columns: { ...EMPTY_CONFIG.columns, ...profile.config.columns } });
    } else if (initialConfig) {
      setConfig({ ...EMPTY_CONFIG, ...initialConfig, columns: { ...EMPTY_CONFIG.columns, ...initialConfig.columns } });
      setName('');
    } else {
      setConfig(EMPTY_CONFIG);
      setName('');
    }
    setErrorMsg('');
  }, [isOpen, profile, initialConfig]);

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit ? api.updateImportProfile(profile.id, payload) : api.createImportProfile(payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['import-profiles'] });
      handleClose(saved);
    },
    onError: (err) => setErrorMsg(err.message || 'Erro ao gravar perfil')
  });

  function handleClose(saved = null) {
    setName('');
    setConfig(EMPTY_CONFIG);
    setErrorMsg('');
    onClose(saved);
  }

  function setField(key, value) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  function setColumn(key, value) {
    setConfig((c) => ({ ...c, columns: { ...c.columns, [key]: value === '' ? null : Number(value) } }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');
    if (!name.trim()) {
      setErrorMsg('O nome do perfil é obrigatório');
      return;
    }
    if (config.columns.amount == null && (config.columns.debit == null || config.columns.credit == null)) {
      setErrorMsg('Indique a coluna de montante ou as colunas de débito e crédito');
      return;
    }
    mutation.mutate({ name: name.trim(), config });
  }

  if (!isOpen) return null;

  const inputCls =
    'w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500';
  const labelCls = 'block text-xs font-semibold text-slate-700 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? 'Editar Perfil de Importação' : 'Novo Perfil de Importação'}
          </h2>
          <button
            onClick={() => handleClose()}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isEdit && initialConfig && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            Configuração proposta automaticamente a partir de uma amostra do ficheiro
            (enviada para um serviço externo). Reveja todos os campos antes de gravar.
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{errorMsg}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Nome do perfil</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: CGD Movimentos, ActivoBank..."
              required
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Codificação</label>
              <select value={config.encoding} onChange={(e) => setField('encoding', e.target.value)} className={inputCls}>
                <option value="utf8">UTF-8</option>
                <option value="windows-1252">Windows-1252 (ANSI)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Separador de colunas</label>
              <select value={config.delimiter} onChange={(e) => setField('delimiter', e.target.value)} className={inputCls}>
                <option value=";">Ponto e vírgula (;)</option>
                <option value=",">Vírgula (,)</option>
                <option value={'\t'}>Tabulação</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Linhas a ignorar no início</label>
              <input
                type="number"
                min="0"
                value={config.skip_rows}
                onChange={(e) => setField('skip_rows', Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Linha de cabeçalho</label>
              <select
                value={config.has_header_row ? '1' : '0'}
                onChange={(e) => setField('has_header_row', e.target.value === '1')}
                className={inputCls}
              >
                <option value="1">Sim (ignorar após as linhas iniciais)</option>
                <option value="0">Não</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Formato da data</label>
              <select value={config.date_format} onChange={(e) => setField('date_format', e.target.value)} className={inputCls}>
                <option value="DD-MM-YYYY">DD-MM-AAAA</option>
                <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                <option value="YYYY-MM-DD">AAAA-MM-DD</option>
                <option value="DD/MM/YY">DD/MM/AA</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Separador decimal</label>
              <select
                value={config.decimal_separator}
                onChange={(e) => setField('decimal_separator', e.target.value)}
                className={inputCls}
              >
                <option value=",">Vírgula (12,34)</option>
                <option value=".">Ponto (12.34)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Separador de milhares</label>
              <select
                value={config.thousand_separator}
                onChange={(e) => setField('thousand_separator', e.target.value)}
                className={inputCls}
              >
                <option value=".">Ponto (1.234)</option>
                <option value=",">Vírgula (1,234)</option>
                <option value=" ">Espaço</option>
                <option value="">Nenhum</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Colunas (0 = primeira coluna)</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Data</label>
                <input
                  type="number"
                  min="0"
                  value={config.columns.date}
                  onChange={(e) => setColumn('date', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Descrição</label>
                <input
                  type="number"
                  min="0"
                  value={config.columns.description}
                  onChange={(e) => setColumn('description', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Montante (com sinal)</label>
                <input
                  type="number"
                  min="0"
                  value={config.columns.amount ?? ''}
                  onChange={(e) => setColumn('amount', e.target.value)}
                  placeholder="—"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Débito</label>
                <input
                  type="number"
                  min="0"
                  value={config.columns.debit ?? ''}
                  onChange={(e) => setColumn('debit', e.target.value)}
                  placeholder="—"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Crédito</label>
                <input
                  type="number"
                  min="0"
                  value={config.columns.credit ?? ''}
                  onChange={(e) => setColumn('credit', e.target.value)}
                  placeholder="—"
                  className={inputCls}
                />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Use <strong>Montante</strong> para colunas com sinal (−17,10 = despesa) ou o par <strong>Débito/Crédito</strong>.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleClose()}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-5 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs disabled:opacity-50"
            >
              {mutation.isPending ? 'A gravar...' : 'Gravar Perfil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
