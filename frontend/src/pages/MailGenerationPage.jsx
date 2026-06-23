import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

const PART_OPTIONS = [1, 2, 3, 4, 5, 6];

function Badge({ children, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red:   'bg-red-100 text-red-600',
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-4">&#x2715;</button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-slate-50" dangerouslySetInnerHTML={{ __html: item.html }} />
      </div>
    </div>
  );
}

function RoleConfigRow({ role, userCount, config, onChange, onPreview, isPreviewing }) {
  const { total_parts, parts_to_generate } = config;

  function setTotalParts(n) {
    onChange({ total_parts: n, parts_to_generate: parts_to_generate.filter(p => p <= n) });
  }

  function togglePart(n) {
    const next = parts_to_generate.includes(n)
      ? parts_to_generate.filter(p => p !== n)
      : [...parts_to_generate, n].sort((a, b) => a - b);
    onChange({ total_parts, parts_to_generate: next });
  }

  function toggleAll() {
    const all = PART_OPTIONS.slice(0, total_parts);
    const allSel = all.every(p => parts_to_generate.includes(p));
    onChange({ total_parts, parts_to_generate: allSel ? [] : all });
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
            <input type="checkbox" checked={allSelected} onChange={toggleAll} /> All
          </label>
          {PART_OPTIONS.slice(0, total_parts).map(n => (
            <label key={n} className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={parts_to_generate.includes(n)} onChange={() => togglePart(n)} />
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

  // per-role configs
  const [roleConfigs, setRoleConfigs] = useState(new Map());

  // campaign state
  const [campaignMode, setCampaignMode]         = useState('existing');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [newCampaignName, setNewCampaignName]    = useState('');

  // template selection (per generation run, linked to campaign)
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // results & ui state
  const [results,       setResults]       = useState([]);
  const [warnings,      setWarnings]      = useState([]);
  const [previewItem,   setPreviewItem]   = useState(null);
  const [previewingRole, setPreviewingRole] = useState(null);
  const [generateError, setGenerateError] = useState(null);

  // project (read-only)
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.get(`/projects/${projectId}`).then(r => r.data),
  });

  // campaigns list
  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', projectId],
    queryFn: () => client.get(`/projects/${projectId}/campaigns`).then(r => r.data),
  });

  // templates list
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => client.get(`/projects/${projectId}/templates`).then(r => r.data),
  });

  // auto-select default template
  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      const def = templates.find(t => t.is_default) || templates[0];
      setSelectedTemplateId(String(def.id));
    }
  }, [templates, selectedTemplateId]);

  // roles list -- initialise per-role configs on load
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['generate-roles', projectId],
    queryFn: () => client.get(`/projects/${projectId}/generate/roles`).then(r => r.data),
    onSuccess: rows => {
      setRoleConfigs(prev => {
        const next = new Map(prev);
        for (const r of rows) {
          if (!next.has(r.role)) next.set(r.role, { total_parts: 4, parts_to_generate: [1,2,3,4] });
        }
        return next;
      });
    },
  });

  function updateRoleConfig(role, patch) {
    setRoleConfigs(prev => { const next = new Map(prev); next.set(role, { ...prev.get(role), ...patch }); return next; });
  }

  // preview mutation
  const previewMutation = useMutation({
    mutationFn: ({ role, config, templateId }) => client.post(
      `/projects/${projectId}/generate/preview`,
      { role, total_parts: config.total_parts, parts_to_generate: config.parts_to_generate, template_id: Number(templateId) }
    ).then(r => r.data),
    onSuccess: data => {
      setPreviewingRole(null);
      if (data.results.length > 0) setPreviewItem(data.results[0]);
    },
    onError: () => setPreviewingRole(null),
  });

  function handlePreview(role) {
    const config = roleConfigs.get(role);
    if (!config || config.parts_to_generate.length === 0 || !selectedTemplateId) return;
    setPreviewingRole(role);
    previewMutation.mutate({ role, config, templateId: selectedTemplateId });
  }

  // main generate handler -- creates campaign if needed, then bulk generates
  async function handleGenerate() {
    setGenerateError(null);
    if (!selectedTemplateId) { setGenerateError('Please select a template.'); return; }

    let campaignId = selectedCampaignId;

    if (campaignMode === 'new') {
      if (!newCampaignName.trim()) { setGenerateError('Please enter a campaign name.'); return; }
      try {
        const created = await client.post(`/projects/${projectId}/campaigns`, {
          campaign_name: newCampaignName.trim(),
        }).then(r => r.data);
        campaignId = String(created.id);
        setSelectedCampaignId(campaignId);
        setCampaignMode('existing');
        setNewCampaignName('');
        queryClient.invalidateQueries(['campaigns', projectId]);
      } catch (err) {
        setGenerateError(err?.response?.data?.error || 'Failed to create campaign.');
        return;
      }
    }

    if (!campaignId) { setGenerateError('Please select or create a campaign.'); return; }

    const role_configs = roles
      .filter(r => roleConfigs.has(r.role) && (roleConfigs.get(r.role)?.parts_to_generate.length ?? 0) > 0)
      .map(r => ({ role: r.role, ...roleConfigs.get(r.role) }));

    if (role_configs.length === 0) { setGenerateError('No roles with parts selected.'); return; }

    try {
      const res = await client.post(`/projects/${projectId}/generate/bulk`, {
        campaign_id:  Number(campaignId),
        template_id:  Number(selectedTemplateId),
        role_configs,
      }).then(r => r.data);
      setResults(res.results);
      setWarnings(res.warnings || []);
      queryClient.invalidateQueries(['campaigns', projectId]);
    } catch (err) {
      setGenerateError(err?.response?.data?.error || 'Generation failed.');
    }
  }

  const resultsByRole = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      if (!map.has(r.role)) map.set(r.role, []);
      map.get(r.role).push(r);
    }
    return [...map.entries()];
  }, [results]);

  const canGenerate =
    selectedTemplateId &&
    ((campaignMode === 'existing' && selectedCampaignId) || (campaignMode === 'new' && newCampaignName.trim())) &&
    roles.some(r => (roleConfigs.get(r.role)?.parts_to_generate.length ?? 0) > 0);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Mail Generation</h1>
      <p className="text-sm text-slate-500 mb-6">Configure per-role communications and add them to a campaign</p>

      {/* project info */}
      {project && (
        <div className="bg-slate-50 border rounded-xl px-5 py-3 mb-4 flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-slate-400">Application</p>
            <p className="text-sm font-medium text-slate-700">{project.application_name || <span className="italic text-slate-400">not set</span>}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Plant</p>
            <p className="text-sm font-medium text-slate-700">{project.plant_name || <span className="italic text-slate-400">not set</span>}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Go-live date</p>
            <p className="text-sm font-medium text-slate-700">{project.go_live_date ? project.go_live_date.slice(0, 10) : <span className="italic text-slate-400">not set</span>}</p>
          </div>
          <p className="text-xs text-slate-400 self-end pb-0.5">Edit in Project Settings</p>
        </div>
      )}

      {/* campaign + template selection */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Campaign and template</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* campaign */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Target campaign</p>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setCampaignMode('existing')}
                className={`text-xs px-3 py-1 rounded-lg border font-medium ${
                  campaignMode === 'existing' ? 'bg-[#3DCD58] text-white border-[#3DCD58]' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Existing
              </button>
              <button
                onClick={() => setCampaignMode('new')}
                className={`text-xs px-3 py-1 rounded-lg border font-medium ${
                  campaignMode === 'new' ? 'bg-[#3DCD58] text-white border-[#3DCD58]' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                New
              </button>
            </div>
            {campaignMode === 'existing' ? (
              campaigns.length === 0
                ? <p className="text-xs text-slate-400">No campaigns yet. Switch to New.</p>
                : <select
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    value={selectedCampaignId}
                    onChange={e => setSelectedCampaignId(e.target.value)}
                  >
                    <option value="">Select a campaign...</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.campaign_name}</option>)}
                  </select>
            ) : (
              <input
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="New campaign name"
                value={newCampaignName}
                onChange={e => setNewCampaignName(e.target.value)}
              />
            )}
          </div>

          {/* template */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Email template</p>
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400">No templates. Upload one in the Templates page.</p>
            ) : (
              <select
                className="border rounded-lg px-3 py-2 text-sm w-full"
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
              >
                <option value="">Select a template...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.template_name}{t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* per-role configuration */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Role configuration</h2>
        {rolesLoading && <p className="text-sm text-slate-400">Loading roles...</p>}
        {!rolesLoading && roles.length === 0 && <p className="text-sm text-slate-400">No roles found in the user list.</p>}
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

      {/* generate button */}
      <div className="mb-4">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="bg-[#3DCD58] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#35b84e] disabled:opacity-40"
        >
          Add communications to campaign
        </button>
        {generateError && <p className="text-sm text-red-500 mt-2">{generateError}</p>}
      </div>

      {/* warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => <li key={i} className="text-xs text-amber-700">{w}</li>)}
          </ul>
        </div>
      )}

      {/* results */}
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
                        <td className="py-2 pr-4 font-medium text-slate-800 align-top" rowSpan={waves.length}>{role}</td>
                      )}
                      <td className="py-2 pr-4"><Badge color="green">Part {item.wave}/{item.total_parts}</Badge></td>
                      <td className="py-2 pr-4 text-slate-600">{item.to.length}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.wave_hours}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.module_count}</td>
                      <td className="py-2">
                        <button className="text-xs text-blue-600 hover:underline" onClick={() => setPreviewItem(item)}>Preview</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}
