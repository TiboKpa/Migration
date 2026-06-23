import React, { useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

const PART_OPTIONS = [1, 2, 3, 4, 5, 6];

function Badge({ children, color = 'slate' }) {
  const colors = {
    slate:  'bg-slate-100 text-slate-600',
    green:  'bg-green-100 text-green-700',
    amber:  'bg-amber-100 text-amber-700',
    red:    'bg-red-100 text-red-600',
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
      {children}
    </span>
  );
}

function PreviewModal({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
          <div>
            <p className="text-sm font-semibold text-slate-800">{item.subject}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              To: {item.to.join(', ')}
              {item.cc && item.cc.length > 0 && <> &nbsp; Cc: {item.cc.join(', ')}</>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-4"
          >
            &#x2715;
          </button>
        </div>
        <div
          className="flex-1 overflow-auto p-4 bg-slate-50"
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
      </div>
    </div>
  );
}

function RoleConfigRow({ role, userCount, config, onChange, onPreview, isPreviewing }) {
  const { total_parts, parts_to_generate } = config;

  function setTotalParts(n) {
    onChange({
      total_parts: n,
      parts_to_generate: parts_to_generate.filter(p => p <= n),
    });
  }

  function togglePart(n) {
    const next = parts_to_generate.includes(n)
      ? parts_to_generate.filter(p => p !== n)
      : [...parts_to_generate, n].sort((a, b) => a - b);
    onChange({ total_parts, parts_to_generate: next });
  }

  function toggleAll() {
    const all = PART_OPTIONS.slice(0, total_parts);
    const isAllSelected = all.every(p => parts_to_generate.includes(p));
    onChange({ total_parts, parts_to_generate: isAllSelected ? [] : all });
  }

  const allSelected = PART_OPTIONS.slice(0, total_parts).every(p => parts_to_generate.includes(p));

  return (
    <tr className="border-b last:border-0 hover:bg-slate-50">
      <td className="py-3 pr-4">
        <span className="text-sm font-medium text-slate-800">{role}</span>
        <span className="ml-2 text-xs text-slate-400">{userCount} user{userCount !== 1 ? 's' : ''}</span>
      </td>
      <td className="py-3 pr-4">
        <select
          className="border rounded-lg px-2 py-1 text-sm"
          value={total_parts}
          onChange={e => setTotalParts(Number(e.target.value))}
        >
          {PART_OPTIONS.map(n => <option key={n} value={n}>{n} part{n > 1 ? 's' : ''}</option>)}
        </select>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-xs cursor-pointer text-slate-500">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            All
          </label>
          {PART_OPTIONS.slice(0, total_parts).map(n => (
            <label key={n} className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={parts_to_generate.includes(n)}
                onChange={() => togglePart(n)}
              />
              Part {n}
            </label>
          ))}
        </div>
      </td>
      <td className="py-3 text-right">
        <button
          onClick={onPreview}
          disabled={isPreviewing || parts_to_generate.length === 0}
          className="text-xs text-blue-600 hover:underline disabled:opacity-40"
        >
          {isPreviewing ? 'Loading...' : 'Preview'}
        </button>
      </td>
    </tr>
  );
}

export default function MailGenerationPage() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();

  // ── Per-role configs: Map<roleName, { total_parts, parts_to_generate }> ──────
  const [roleConfigs, setRoleConfigs] = useState(new Map());

  // ── Campaign selection / creation ─────────────────────────────────────────────
  const [campaignMode, setCampaignMode]   = useState('existing'); // 'existing' | 'new'
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [newCampaignName, setNewCampaignName]        = useState('');

  // ── Results & preview state ───────────────────────────────────────────────────
  const [results,       setResults]       = useState([]);
  const [warnings,      setWarnings]      = useState([]);
  const [previewItem,   setPreviewItem]   = useState(null);
  const [previewingRole, setPreviewingRole] = useState(null);

  // ── Project data (read-only) ───────────────────────────────────────────────────
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => client.get(`/projects/${projectId}`).then(r => r.data),
  });

  // ── Campaigns list ────────────────────────────────────────────────────────────
  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/campaigns`).then(r => r.data),
  });

  // ── Roles list ────────────────────────────────────────────────────────────────
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['generate-roles', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/generate/roles`).then(r => r.data),
    onSuccess: rows => {
      setRoleConfigs(prev => {
        const next = new Map(prev);
        for (const r of rows) {
          if (!next.has(r.role)) {
            next.set(r.role, { total_parts: 4, parts_to_generate: [1, 2, 3, 4] });
          }
        }
        return next;
      });
    },
  });

  function updateRoleConfig(role, patch) {
    setRoleConfigs(prev => {
      const next = new Map(prev);
      next.set(role, { ...prev.get(role), ...patch });
      return next;
    });
  }

  // ── Create campaign mutation ───────────────────────────────────────────────────
  const createCampaignMutation = useMutation({
    mutationFn: (name) => client.post(`/projects/${projectId}/campaigns`, { campaign_name: name }).then(r => r.data),
    onSuccess: (c) => {
      queryClient.invalidateQueries(['campaigns', projectId]);
      setSelectedCampaignId(String(c.id));
      setCampaignMode('existing');
    },
  });

  // ── Generation mutation ───────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: (campaignId) => {
      const role_configs = roles
        .filter(r => roleConfigs.has(r.role))
        .map(r => ({
          role: r.role,
          ...roleConfigs.get(r.role),
        }))
        .filter(rc => rc.parts_to_generate.length > 0);

      return client.post(`/projects/${projectId}/generate/bulk`, {
        campaign_id: Number(campaignId),
        role_configs,
      });
    },
    onSuccess: res => {
      setResults(res.data.results);
      setWarnings(res.data.warnings || []);
      queryClient.invalidateQueries(['campaigns', projectId]);
    },
  });

  // ── Preview mutation (per role) ────────────────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: ({ role, config }) => client.post(
      `/projects/${projectId}/generate/preview`,
      { role, total_parts: config.total_parts, parts_to_generate: config.parts_to_generate }
    ).then(r => r.data),
    onSuccess: (data, variables) => {
      setPreviewingRole(null);
      if (data.results.length > 0) setPreviewItem(data.results[0]);
    },
    onError: () => setPreviewingRole(null),
  });

  function handlePreview(role) {
    const config = roleConfigs.get(role);
    if (!config || config.parts_to_generate.length === 0) return;
    setPreviewingRole(role);
    previewMutation.mutate({ role, config });
  }

  async function handleGenerate() {
    let campaignId = selectedCampaignId;
    if (campaignMode === 'new') {
      if (!newCampaignName.trim()) return;
      const c = await createCampaignMutation.mutateAsync(newCampaignName.trim());
      campaignId = String(c.id);
    }
    if (!campaignId) return;
    generateMutation.mutate(campaignId);
  }

  const resultsByRole = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      if (!map.has(r.role)) map.set(r.role, []);
      map.get(r.role).push(r);
    }
    return [...map.entries()];
  }, [results]);

  const canGenerate = (
    (campaignMode === 'existing' && selectedCampaignId) ||
    (campaignMode === 'new' && newCampaignName.trim())
  ) && roles.some(r => (roleConfigs.get(r.role)?.parts_to_generate.length ?? 0) > 0);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Mail Generation</h1>
      <p className="text-sm text-slate-500 mb-6">Configure per-role communications and add them to a campaign</p>

      {/* ── Project info (read-only) ── */}
      {project && (
        <div className="bg-slate-50 border rounded-xl px-5 py-3 mb-4 flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-slate-400">Application</p>
            <p className="text-sm font-medium text-slate-700">{project.application_name || <span className="text-slate-400 italic">not set</span>}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Plant</p>
            <p className="text-sm font-medium text-slate-700">{project.plant_name || <span className="text-slate-400 italic">not set</span>}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Go-live date</p>
            <p className="text-sm font-medium text-slate-700">{project.go_live_date ? project.go_live_date.slice(0, 10) : <span className="text-slate-400 italic">not set</span>}</p>
          </div>
          <p className="text-xs text-slate-400 self-end pb-0.5">Edit these values in Project Settings</p>
        </div>
      )}

      {/* ── Campaign selection ── */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Target campaign</h2>
        <div className="flex gap-3 mb-3">
          <button
            onClick={() => setCampaignMode('existing')}
            className={`text-sm px-4 py-1.5 rounded-lg border font-medium ${
              campaignMode === 'existing'
                ? 'bg-[#3DCD58] text-white border-[#3DCD58]'
                : 'text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Add to existing
          </button>
          <button
            onClick={() => setCampaignMode('new')}
            className={`text-sm px-4 py-1.5 rounded-lg border font-medium ${
              campaignMode === 'new'
                ? 'bg-[#3DCD58] text-white border-[#3DCD58]'
                : 'text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Create new
          </button>
        </div>

        {campaignMode === 'existing' && (
          campaigns.length === 0
            ? <p className="text-sm text-slate-400">No campaigns yet. Create one first.</p>
            : <select
                className="border rounded-lg px-3 py-2 text-sm w-full max-w-sm"
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
              >
                <option value="">Select a campaign...</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.campaign_name}</option>
                ))}
              </select>
        )}

        {campaignMode === 'new' && (
          <input
            className="border rounded-lg px-3 py-2 text-sm w-full max-w-sm"
            placeholder="Campaign name"
            value={newCampaignName}
            onChange={e => setNewCampaignName(e.target.value)}
          />
        )}
      </div>

      {/* ── Per-role configuration ── */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Role configuration</h2>

        {rolesLoading && <p className="text-sm text-slate-400">Loading roles...</p>}

        {!rolesLoading && roles.length === 0 && (
          <p className="text-sm text-slate-400">No roles found in the user list.</p>
        )}

        {roles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500 text-left">
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Total parts</th>
                  <th className="pb-2 pr-4 font-medium">Generate drafts for</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <RoleConfigRow
                    key={r.role}
                    role={r.role}
                    userCount={Number(r.user_count)}
                    config={roleConfigs.get(r.role) || { total_parts: 4, parts_to_generate: [1,2,3,4] }}
                    onChange={patch => updateRoleConfig(r.role, patch)}
                    onPreview={() => handlePreview(r.role)}
                    isPreviewing={previewingRole === r.role}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Generate button ── */}
      <div className="mb-4">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generateMutation.isPending}
          className="bg-[#3DCD58] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#35b84e] disabled:opacity-40"
        >
          {generateMutation.isPending ? 'Generating...' : 'Add communications to campaign'}
        </button>
        {generateMutation.isError && (
          <p className="text-sm text-red-500 mt-2">
            {generateMutation.error?.response?.data?.error || 'Generation failed'}
          </p>
        )}
      </div>

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => <li key={i} className="text-xs text-amber-700">{w}</li>)}
          </ul>
        </div>
      )}

      {/* ── Results table ── */}
      {resultsByRole.length > 0 && (
        <div className="bg-white border rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            {results.length} communication{results.length > 1 ? 's' : ''} added to campaign
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500 text-left">
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Part</th>
                  <th className="pb-2 pr-4 font-medium">Recipients</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Modules</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {resultsByRole.map(([role, waves]) =>
                  waves.map((item, wi) => (
                    <tr key={`${role}-${item.wave}`} className="border-b last:border-0 hover:bg-slate-50">
                      {wi === 0 && (
                        <td className="py-2 pr-4 font-medium text-slate-800 align-top" rowSpan={waves.length}>
                          {role}
                        </td>
                      )}
                      <td className="py-2 pr-4">
                        <Badge color="green">Part {item.wave}/{item.total_parts}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{item.to.length}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.wave_hours}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.module_count}</td>
                      <td className="py-2">
                        <button
                          className="text-xs text-blue-600 hover:underline"
                          onClick={() => setPreviewItem(item)}
                        >
                          Preview
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Preview modal ── */}
      <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}
