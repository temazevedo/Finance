import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  EyeOff,
  FileUp,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
  XCircle
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import ImportProfileModal from '../components/ImportProfileModal.jsx';
import { formatCurrency, formatDateDisplay } from '../utils/format.js';

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'needs_category', label: 'Sem categoria' },
  { key: 'ambiguous', label: 'Ambíguas' },
  { key: 'matched', label: 'Correspondidas' },
  { key: 'duplicate', label: 'Duplicadas' }
];

const STATUS_LABELS = {
  matched: { label: 'Correspondida', cls: 'bg-emerald-100 text-emerald-800' },
  ambiguous: { label: 'Ambígua', cls: 'bg-amber-100 text-amber-800' },
  needs_category: { label: 'Sem categoria', cls: 'bg-rose-100 text-rose-800' },
  duplicate: { label: 'Duplicada', cls: 'bg-slate-100 text-slate-500' }
};

export default function ImportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  // ---- setup step state
  const [accountId, setAccountId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [setupError, setSetupError] = useState('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [agentConfig, setAgentConfig] = useState(null);
  const [proposing, setProposing] = useState(false);

  // ---- review step state
  const [batch, setBatch] = useState(null);
  const [filter, setFilter] = useState('all');
  const [rowError, setRowError] = useState('');

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => api.getAccounts() });
  const { data: profiles = [] } = useQuery({ queryKey: ['import-profiles'], queryFn: api.getImportProfiles });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories() });

  const leafCategories = useMemo(() => categories.filter((c) => c.is_leaf), [categories]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const activeRows = useMemo(
    () => (batch ? batch.rows.filter((r) => !r.excluded && r.match_status !== 'duplicate') : []),
    [batch]
  );
  const unresolvedRows = activeRows.filter(
    (r) => r.type === 'transfer' ? r.to_account_id == null : r.category_id == null && !r.planned_accepted
  );
  const canCommit = activeRows.length > 0 && unresolvedRows.length === 0;

  function pickFile(e) {
    setSelectedFile(e.target.files[0] || null);
  }

  function openProfileEditor(withAgentConfig = false) {
    setAgentConfig(withAgentConfig ? agentConfig : null);
    setProfileModalOpen(true);
  }

  async function handleAgentProposal() {
    if (!selectedFile) {
      setSetupError('Escolha primeiro o ficheiro CSV');
      return;
    }
    setSetupError('');
    setProposing(true);
    try {
      const proposal = await api.proposeImportProfile(selectedFile);
      setAgentConfig(proposal.config);
      openProfileEditor(true);
    } catch (err) {
      setSetupError(err.message || 'A proposta automática falhou');
    } finally {
      setProposing(false);
    }
  }

  function profileSaved(saved) {
    setProfileModalOpen(false);
    setAgentConfig(null);
    if (saved?.id) setProfileId(String(saved.id));
  }

  const uploadMutation = useMutation({
    mutationFn: () =>
      api.uploadImport(Number(accountId), selectedFile, {
        profileId: profileId ? Number(profileId) : undefined
      }),
    onSuccess: (created) => {
      setBatch(created);
      setFilter('all');
      setSetupError('');
    },
    onError: (err) => setSetupError(err.message || 'Erro ao importar o ficheiro')
  });

  function handleUpload(e) {
    e.preventDefault();
    setSetupError('');
    if (!accountId) return setSetupError('Escolha a conta de destino');
    if (!selectedFile) return setSetupError('Escolha o ficheiro CSV');
    if (!profileId) return setSetupError('Escolha um perfil de importação (ou crie um novo)');
    uploadMutation.mutate();
  }

  function patchRow(row, patch) {
    setRowError('');
    return api
      .updateImportRow(batch.id, row.id, patch)
      .then((updated) => setBatch(updated))
      .catch((err) => {
        setRowError(err.message || 'Erro ao atualizar a linha');
        throw err;
      });
  }

  function applyCategoryToSameDescription(row, categoryId) {
    const sameDesc = batch.rows.filter(
      (r) => r.id !== row.id && !r.excluded && r.match_status !== 'duplicate' &&
        r.type === row.type && r.description === row.description
    );
    patchRow(row, { category_id: categoryId }).then(() => {
      Promise.allSettled(
        sameDesc.map((r) => api.updateImportRow(batch.id, r.id, { category_id: categoryId }))
      ).then((results) => {
        const last = results.find((r) => r.status === 'fulfilled');
        if (last) setBatch(last.value.value);
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) setRowError('Algumas linhas não puderam ser atualizadas em massa');
      });
    });
  }

  function convertToTransfer(row, toAccountId) {
    patchRow(row, { type: 'transfer', to_account_id: Number(toAccountId) }).catch(() => {});
  }

  const commitMutation = useMutation({
    mutationFn: () => api.commitImport(batch.id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-balances'] });
      queryClient.invalidateQueries({ queryKey: ['budget-vs-actual'] });
      navigate('/transactions', {
        state: {
          importSummary: `${result.created} movimento(s) criado(s), ${result.reconciled} planeado(s) confirmado(s).`
        }
      });
    },
    onError: (err) => setRowError(err.message || 'Erro ao confirmar a importação')
  });

  function handleDiscard() {
    if (!window.confirm('Descartar esta importação? Nenhum movimento foi gravado.')) return;
    api
      .discardImport(batch.id)
      .then(() => {
        setBatch(null);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      })
      .catch((err) => setRowError(err.message || 'Erro ao descartar'));
  }

  // ------------------------------------------------------------ render

  if (batch) {
    return (
      <ReviewStep
        batch={batch}
        setBatch={setBatch}
        filter={filter}
        setFilter={setFilter}
        leafCategories={leafCategories}
        catById={catById}
        accounts={accounts.filter((a) => a.id !== batch.account_id)}
        unresolvedCount={unresolvedRows.length}
        canCommit={canCommit}
        committing={commitMutation.isPending}
        rowError={rowError}
        onPatchRow={patchRow}
        onApplyToSame={applyCategoryToSameDescription}
        onConvertToTransfer={convertToTransfer}
        onCommit={() => commitMutation.mutate()}
        onDiscard={handleDiscard}
      />
    );
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Importar Extracto Bancário</h1>
        <p className="text-xs sm:text-sm text-slate-500">
          As categorias são reaproveitadas do seu histórico. Nada é gravado antes da confirmação final.
        </p>
      </div>

      <form onSubmit={handleUpload} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 max-w-2xl">
        {setupError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{setupError}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Conta de destino</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="">Selecione a conta...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Perfil de importação</label>
            <div className="flex gap-2">
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="flex-1 text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="">Selecione o perfil...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => openProfileEditor(false)}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                title="Criar perfil manual"
              >
                Novo
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Ficheiro CSV</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={pickFile}
            className="w-full text-sm text-slate-600 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 file:border file:border-emerald-200 hover:file:bg-emerald-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={uploadMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs disabled:opacity-50"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Analisar ficheiro
          </button>
          <button
            type="button"
            onClick={handleAgentProposal}
            disabled={proposing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
            title="Para formatos desconhecidos: envia o cabeçalho e as primeiras linhas para um serviço externo (IA)"
          >
            {proposing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Propor perfil com IA
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          A proposta automática envia o cabeçalho e uma amostra de até 10 linhas para um serviço externo e é
          opcional — também pode configurar o perfil manualmente com o botão “Novo”.
        </p>
      </form>

      <ImportProfileModal isOpen={profileModalOpen} onClose={profileSaved} initialConfig={agentConfig} />
    </div>
  );
}

function ReviewStep({
  batch,
  filter,
  setFilter,
  leafCategories,
  catById,
  accounts,
  unresolvedCount,
  canCommit,
  committing,
  rowError,
  onPatchRow,
  onApplyToSame,
  onConvertToTransfer,
  onCommit,
  onDiscard
}) {
  const [choosingTransferRow, setChoosingTransferRow] = useState(null);

  function startTransferConversion(row) {
    setChoosingTransferRow(row.id);
  }

  function handleTransferDestination(row, toAccountId) {
    setChoosingTransferRow(null);
    if (toAccountId) onConvertToTransfer(row, toAccountId);
  }

  const visibleRows = batch.rows.filter((r) => filter === 'all' || r.match_status === filter);

  return (
    <div className="space-y-4 pb-20 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Rever Importação</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            {batch.filename} • {batch.account_name} • {batch.rows.length} linha(s)
            {batch.parse_errors?.length > 0 && ` • ${batch.parse_errors.length} linha(s) ignorada(s) com erros`}
          </p>
        </div>
        <button
          onClick={onDiscard}
          className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Descartar
        </button>
      </div>

      {/* Counters / filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? batch.rows.length : batch.counts[f.key] || 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                filter === f.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {rowError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {rowError}
        </div>
      )}

      {batch.parse_errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Linhas ignoradas (não válidas)
          </p>
          {batch.parse_errors.slice(0, 5).map((e, i) => (
            <p key={i}>Linha {e.line}: {e.message}</p>
          ))}
          {batch.parse_errors.length > 5 && <p>… e mais {batch.parse_errors.length - 5}</p>}
        </div>
      )}

      {/* Rows table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-100 overflow-hidden">
        {visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nenhuma linha neste filtro.</div>
        ) : (
          visibleRows.map((row) => (
            <div
              key={row.id}
              className={`p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${
                row.excluded || row.match_status === 'duplicate' ? 'opacity-50' : ''
              }`}
            >
              {/* Date + amount */}
              <div className="flex items-center gap-3 sm:w-44 shrink-0">
                <div
                  className={`p-2 rounded-xl shrink-0 ${
                    row.type === 'expense' ? 'bg-rose-50 text-rose-600' : row.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                  }`}
                >
                  {row.type === 'transfer' ? <ArrowLeftRight className="w-4 h-4" /> : <FileUp className="w-4 h-4" />}
                </div>
                <div>
                  <div className="font-mono text-sm font-bold text-slate-800">
                    {row.type === 'expense' ? '−' : '+'}
                    {formatCurrency(row.amount_cents)}
                  </div>
                  <div className="text-[11px] text-slate-400">{formatDateDisplay(row.date)}</div>
                </div>
              </div>

              {/* Description + name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{row.description}</p>
                {row.name && row.name !== row.description && (
                  <p className="text-[11px] text-slate-400 truncate">como “{row.name}”</p>
                )}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${STATUS_LABELS[row.match_status].cls}`}>
                    {STATUS_LABELS[row.match_status].label}
                  </span>
                  {row.planned_transaction_id && !row.planned_accepted && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                      Planeado proposto
                    </span>
                  )}
                </div>
              </div>

              {/* Category picker */}
              {row.type !== 'transfer' && row.match_status !== 'duplicate' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    value={row.category_id ?? ''}
                    onChange={(e) => onPatchRow(row, { category_id: e.target.value ? Number(e.target.value) : null })}
                    className="text-xs bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 max-w-44"
                  >
                    <option value="">Sem categoria...</option>
                    {leafCategories
                      .filter((c) => c.kind === row.type)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.parent_name ? `${c.parent_name} → ${c.name}` : c.name}
                        </option>
                      ))}
                  </select>
                  {row.category_id != null && (
                    <button
                      onClick={() => onApplyToSame(row, row.category_id)}
                      className="p-1.5 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 transition-colors"
                      title="Aplicar esta categoria a todas as linhas com a mesma descrição"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Transfer destination */}
              {row.type === 'transfer' && (
                <div className="shrink-0">
                  <select
                    value={row.to_account_id ?? ''}
                    onChange={(e) => e.target.value && onConvertToTransfer(row, e.target.value)}
                    className="text-xs bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="">Conta de destino...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Planned reconciliation */}
              {row.planned_transaction_id && !row.planned_accepted && row.match_status !== 'duplicate' && (
                <button
                  onClick={() => onPatchRow(row, { accept_planned: true }).catch(() => {})}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors"
                  title="Confirmar o movimento planeado com esta data e montante em vez de criar um duplicado"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmar planeado
                </button>
              )}
              {row.planned_accepted && (
                <span className="shrink-0 text-[11px] font-semibold text-sky-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Planeado confirmado
                </span>
              )}

              {/* Convert to transfer + exclude */}
              {row.match_status !== 'duplicate' && row.type !== 'transfer' && accounts.length > 0 && (
    choosingTransferRow === row.id ? (
                  <select
                    autoFocus
                    value=""
                    onChange={(e) => handleTransferDestination(row, e.target.value)}
                    onBlur={() => setChoosingTransferRow(null)}
                    className="shrink-0 text-xs bg-white border border-blue-300 rounded-xl px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Conta de destino...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
    ) : (
                  <button
                    onClick={() => startTransferConversion(row)}
                    className="shrink-0 p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                    title="Converter em transferência para outra conta"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </button>
    )
              )}
              {row.match_status !== 'duplicate' && (
                <button
                  onClick={() => onPatchRow(row, { excluded: !row.excluded }).catch(() => {})}
                  className="shrink-0 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  title={row.excluded ? 'Incluir linha' : 'Excluir linha'}
                >
                  {row.excluded ? <EyeOff className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {unresolvedCount > 0 ? (
            <span className="text-amber-700 font-semibold">
              {unresolvedCount} linha(s) sem categoria — resolva antes de confirmar
            </span>
          ) : (
            <span>Tudo pronto. Nada foi gravado ainda.</span>
          )}
        </div>
        <button
          onClick={onCommit}
          disabled={!canCommit || committing}
          className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Confirmar Importação
        </button>
      </div>
    </div>
  );
}
