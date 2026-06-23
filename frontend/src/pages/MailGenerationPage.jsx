import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

// Modal that shows all generated parts for a role preview, with a tab per part.
function PreviewModal({ items, onClose }) {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => { setActiveIdx(0); }, [items]);

  if (!items || items.length === 0) return null;

  const item = items[activeIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-sm font-semibold text-slate-800 truncate">{item.subject}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              <span className="font-medium text-slate-500">To:</span> {item.to.join(', ')}
              {item.cc && item.cc.length > 0 && (
                <> &nbsp; <span className="font-medium text-slate-500">Cc:</span> {item.cc.join(', ')}</>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            &#x2715;
          </button>
        </div>

        {/* Tabs -- only shown when more than one part */}
        {items.length > 1 && (
          <div className="flex gap-1 px-5 pt-3 border-b shrink-0">
            {items.map((it, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                  i === activeIdx
                    ? 'border-[#3DCD58] text-[#3DCD58]'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Part {it.wave}/{it.total_parts}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div
          className="flex-1 overflow-auto p-4 bg-slate-50"
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
      </div>
    </div>
  );
}

export default function MailGenerationPage() {
  const { projectId } = useParams();
  const queryClient   = useQueryClient();

  const [totalParts,      setTotalParts]      = useState(4);
  const [partsToGenerate, setPartsToGenerate] = useState([1, 2, 3, 4]);

  const [campaignName,       setCampaignName]       = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [results,            setResults]            = useState([]);
  const [warnings,           setWarnings]           = useState([]);

  // previewItems: array of result objects (one per part) shown in the modal
  const [previewItems,    setPreviewItems]    = useState(null);
  const [previewingRole,  setPreviewingRole]  = useState(null);
  const [previewError,    setPreviewError]    = useState(null);
  const [generating,      setGenerating]      = useState(false);
  const [generateError,   setGenerateError]   = useState(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => client.get(`/projects/${projectId}`).then(r => r.data),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/templates`).then(r => r.data),
  });

  useEffect(() => {
    if (selectedTemplateId === null && templates.length > 0) {
      const def = templates.find(t => t.is_default) || templates[0];
      setSelectedTemplateId(def.id);
    }
  }, [templates, selectedTemplateId]);

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['generate-roles', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/generate/roles`).then(r => r.data),
  });

  function setTotalPartsAndTrim(n) {
    setTotalParts(n);
    setPartsToGenerate(prev => prev.filter(p => p <= n));
  }

  function togglePart(n) {
    setPartsToGenerate(prev =>
      prev.includes(n) ? prev.filter(p => p !== n) : [...prev, n].sort((a, b) => a - b)
    );
  }

  function toggleAllParts() {
    const all    = PART_OPTIONS.slice(0, totalParts);
    const allSel = all.every(p => partsToGenerate.includes(p));
    setPartsToGenerate(allSel ? [] : all);
  }

  const allPartsSelected = PART_OPTIONS.slice(0, totalParts).every(p => partsToGenerate.includes(p));

  async function handlePreview(role) {
    setPreviewError(null);
    if (!selectedTemplateId)        { setPreviewError('Select a template first.'); return; }
    if (partsToGenerate.length === 0){ setPreviewError('Select at least one part.'); return; }
    setPreviewingRole(role);
    try {
      const { data } = await client.post(`/projects/${projectId}/generate/preview`, {
        role,
        total_parts:       totalParts,
        parts_to_generate: partsToGenerate,
        template_id:       selectedTemplateId,
      });
      if (data.results && data.results.length > 0) {
        // show all returned results (one per part) in the tabbed modal
        setPreviewItems(data.results);
      } else {
        const warn = data.warnings && data.warnings.length > 0 ? ` ${data.warnings[0]}` : '';
        setPreviewError(`No preview for "${role}".${warn}`);
      }
    } catch (err) {
      setPreviewError(err?.response?.data?.error || err.message || 'Preview failed.');
    } finally {
      setPreviewingRole(null);
    }
  }

  async function handleGenerate() {
    setGenerateError(null);
    if (!campaignName.trim())         { setGenerateError('Enter a campaign name.'); return; }
    if (!selectedTemplateId)          { setGenerateError('Select a template.'); return; }
    if (partsToGenerate.length === 0) { setGenerateError('Select at least one part to generate.'); return; }
    if (roles.length === 0)           { setGenerateError('No roles found in the user list.'); return; }

    const role_configs = roles.map(r => ({
      role:              r.role,
      total_parts:       totalParts,
      parts_to_generate: partsToGenerate,
    }));

    setGenerating(true);
    try {
      const campaign = await client.post(`/projects/${projectId}/campaigns`, {
        campaign_name: campaignName.trim(),
      }).then(r => r.data);

      const { data: res } = await client.post(`/projects/${projectId}/generate/bulk`, {
        campaign_id:  campaign.id,
        template_id:  selectedTemplateId,
        role_configs,
      });

      setResults(res.results || []);
      setWarnings(res.warnings || []);
      setCampaignName('');
      queryClient.invalidateQueries(['campaigns', projectId]);
    } catch (err) {
      setGenerateError(err?.response?.data?.error || err.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  // group results by playlist_name for the results table
  const resultsByPlaylist = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const key = r.playlist_name || r.roles?.join(', ') || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()];
  }, [results]);

  const canGenerate = !!campaignName.trim() && !!selectedTemplateId && partsToGenerate.length > 0 && roles.length > 0;

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Mail Generation</h1>
      <p className="text-sm text-slate-500 mb-6">
        Emails are generated per training group (primary playlist + additional trainings).
        Each group of users sharing the same training content receives one email series.
      </p>

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
            <p className="text-sm font-medium text-slate-700">
              {project.go_live_date ? project.go_live_date.slice(0, 10) : <span className="italic text-slate-400">not set</span>}
            </p>
          </div>
          <p className="text-xs text-slate-400 self-end pb-0.5">Edit in Project Settings</p>
        </div>
      )}

      {/* Campaign setup */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Campaign setup</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Campaign name</label>
            <input
              className="border rounded-lg px-3 py-2 text-sm w-full"
              placeholder="e.g. Wave 1 - June 2026"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">A new campaign will be created with this name.</p>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Email template</label>
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400 mt-2">No templates. Upload one in the Templates page.</p>
            ) : (
              <select
                className="border rounded-lg px-3 py-2 text-sm w-full"
                value={selectedTemplateId ?? ''}
                onChange={e => setSelectedTemplateId(Number(e.target.value))}
              >
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

      {/* Wave schedule */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Wave schedule</h2>
        <p className="text-xs text-slate-400 mb-4">
          How many parts to split each training into, and which parts to include in this campaign.
        </p>
        <div className="flex flex-wrap items-start gap-8">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Total parts</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={totalParts}
              onChange={e => setTotalPartsAndTrim(Number(e.target.value))}
            >
              {PART_OPTIONS.map(n => (
                <option key={n} value={n}>{n} part{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-2">Parts to generate in this campaign</label>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer text-slate-500">
                <input type="checkbox" checked={allPartsSelected} onChange={toggleAllParts} /> All
              </label>
              {PART_OPTIONS.slice(0, totalParts).map(n => (
                <label key={n} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={partsToGenerate.includes(n)}
                    onChange={() => togglePart(n)}
                  />
                  Part {n}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Roles covered */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Roles covered</h2>
        <p className="text-xs text-slate-400 mb-4">
          All roles below will be included. Each user's training group is resolved via the role matrix.
          Click Preview on any role to see what will be generated.
        </p>
        {rolesLoading && <p className="text-sm text-slate-400">Loading...</p>}
        {!rolesLoading && roles.length === 0 && (
          <p className="text-sm text-slate-400">No roles found in the user list.</p>
        )}
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {roles.map(r => (
              <div
                key={r.role}
                className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-slate-50"
              >
                <span className="text-sm font-medium text-slate-700">{r.role}</span>
                <span className="text-xs text-slate-400">
                  {Number(r.user_count)} user{Number(r.user_count) !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => handlePreview(r.role)}
                  disabled={previewingRole === r.role || !selectedTemplateId || partsToGenerate.length === 0}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed ml-1"
                  title={!selectedTemplateId ? 'Select a template first' : ''}
                >
                  {previewingRole === r.role ? 'Loading...' : 'Preview'}
                </button>
              </div>
            ))}
          </div>
        )}
        {previewError && (
          <p className="text-xs text-red-500 mt-3">{previewError}</p>
        )}
      </div>

      {/* Generate button */}
      <div className="mb-4">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className="bg-[#3DCD58] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#35b84e] disabled:opacity-40"
        >
          {generating ? 'Generating...' : 'Create campaign and generate communications'}
        </button>
        {generateError && <p className="text-sm text-red-500 mt-2">{generateError}</p>}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => <li key={i} className="text-xs text-amber-700">{w}</li>)}
          </ul>
        </div>
      )}

      {/* Results */}
      {resultsByPlaylist.length > 0 && (
        <div className="bg-white border rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            {results.length} communication{results.length > 1 ? 's' : ''} added to campaign
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500 text-left">
                  <th className="pb-2 pr-4 font-medium">Training group</th>
                  <th className="pb-2 pr-4 font-medium">Roles</th>
                  <th className="pb-2 pr-4 font-medium">Part</th>
                  <th className="pb-2 pr-4 font-medium">Recipients</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Modules</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {resultsByPlaylist.map(([playlistName, waves]) =>
                  waves.map((item, wi) => (
                    <tr key={`${playlistName}-${item.wave}`} className="border-b last:border-0 hover:bg-slate-50">
                      {wi === 0 && (
                        <td className="py-2 pr-4 font-medium text-slate-800 align-top" rowSpan={waves.length}>
                          {playlistName}
                        </td>
                      )}
                      {wi === 0 && (
                        <td className="py-2 pr-4 text-slate-500 text-xs align-top" rowSpan={waves.length}>
                          {(item.roles || []).join(', ')}
                        </td>
                      )}
                      <td className="py-2 pr-4">
                        <Badge color="green">Part {item.wave}/{item.total_parts}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{item.to.length}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.wave_hours}</td>
                      <td className="py-2 pr-4 text-slate-600">{item.module_count}</td>
                      <td className="py-2">
                        {/* open all waves for this playlist in the tabbed modal */}
                        <button
                          className="text-xs text-blue-600 hover:underline"
                          onClick={() => setPreviewItems(waves)}
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

      <PreviewModal items={previewItems} onClose={() => setPreviewItems(null)} />
    </div>
  );
}
