import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
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

export default function MailGenerationPage() {
  const { projectId } = useParams();

  // ── Config state ─────────────────────────────────────────────────────────────
  const [totalParts, setTotalParts]   = useState(4);
  const [selectedParts, setSelectedParts] = useState(new Set([1, 2, 3, 4]));
  const [appName,    setAppName]      = useState('');
  const [plantName,  setPlantName]    = useState('');
  const [goLiveDate, setGoLiveDate]   = useState('');

  // ── Results state ─────────────────────────────────────────────────────────────
  const [results,  setResults]  = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [preview,  setPreview]  = useState(null); // { subject, html, role, wave }

  // ── Project defaults ─────────────────────────────────────────────────────────
  useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => client.get(`/projects/${projectId}`).then(r => r.data),
    onSuccess: p => {
      if (!appName   && p.application_name) setAppName(p.application_name);
      if (!plantName && p.plant_name)       setPlantName(p.plant_name);
      if (!goLiveDate && p.go_live_date)    setGoLiveDate(p.go_live_date.slice(0, 10));
    },
  });

  // ── Roles list ───────────────────────────────────────────────────────────────
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['generate-roles', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/generate/roles`).then(r => r.data),
  });

  // ── Generation mutation ───────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: () => client.post(`/projects/${projectId}/generate/bulk`, {
      total_parts:       totalParts,
      parts_to_generate: [...selectedParts],
      app_name:          appName   || undefined,
      plant_name:        plantName || undefined,
      go_live_date:      goLiveDate || undefined,
    }),
    onSuccess: res => {
      setResults(res.data.results);
      setWarnings(res.data.warnings || []);
      setPreview(null);
    },
  });

  // ── Part toggle helpers ───────────────────────────────────────────────────────
  function togglePart(n) {
    setSelectedParts(prev => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  }

  function onTotalPartsChange(n) {
    setTotalParts(n);
    setSelectedParts(prev => new Set([...prev].filter(p => p <= n)));
  }

  const allSelected = useMemo(() =>
    PART_OPTIONS.slice(0, totalParts).every(p => selectedParts.has(p)),
  [selectedParts, totalParts]);

  function toggleAll() {
    if (allSelected) {
      setSelectedParts(new Set());
    } else {
      setSelectedParts(new Set(PART_OPTIONS.slice(0, totalParts)));
    }
  }

  // ── Group results by role ─────────────────────────────────────────────────────
  const resultsByRole = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      if (!map.has(r.role)) map.set(r.role, []);
      map.get(r.role).push(r);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Mail Generation</h1>
      <p className="text-sm text-slate-500 mb-6">Generate training communications from the user list</p>

      {/* ── Config ── */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Campaign settings</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Application name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={appName}
              onChange={e => setAppName(e.target.value)}
              placeholder="e.g. PDM"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Plant name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={plantName}
              onChange={e => setPlantName(e.target.value)}
              placeholder="e.g. Grenoble"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Go-live date</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={goLiveDate}
              onChange={e => setGoLiveDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Total parts</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={totalParts}
              onChange={e => onTotalPartsChange(Number(e.target.value))}
            >
              {PART_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">Generate drafts for</label>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                All
              </label>
              {PART_OPTIONS.slice(0, totalParts).map(n => (
                <label key={n} className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedParts.has(n)}
                    onChange={() => togglePart(n)}
                  />
                  Part {n}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || selectedParts.size === 0}
            className="bg-[#3DCD58] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#35b84e] disabled:opacity-40"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate'}
          </button>
          {rolesLoading && <span className="text-xs text-slate-400">Loading roles...</span>}
          {roles.length > 0 && !generateMutation.isPending && (
            <span className="text-xs text-slate-400">
              {roles.length} role{roles.length > 1 ? 's' : ''} detected
            </span>
          )}
        </div>

        {generateMutation.isError && (
          <p className="text-sm text-red-500 mt-2">
            {generateMutation.error?.response?.data?.error || 'Generation failed'}
          </p>
        )}
      </div>

      {/* ── Roles detected ── */}
      {roles.length > 0 && (
        <div className="bg-white border rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Detected roles in user list</h2>
          <div className="flex flex-wrap gap-2">
            {roles.map(r => (
              <span key={r.role} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                {r.role} <span className="text-slate-400">({r.user_count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-700">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Results table ── */}
      {resultsByRole.length > 0 && (
        <div className="bg-white border rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            {results.length} email{results.length > 1 ? 's' : ''} generated
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
                          onClick={() => setPreview(item)}
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

      {/* ── Preview panel ── */}
      {preview && (
        <div className="bg-white border rounded-xl p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">{preview.subject}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                To: {preview.to.join(', ')}
                {preview.cc.length > 0 && <> &nbsp; Cc: {preview.cc.join(', ')}</>}
              </p>
            </div>
            <button
              className="text-xs text-slate-400 hover:text-slate-600"
              onClick={() => setPreview(null)}
            >
              Close
            </button>
          </div>
          <div
            className="border rounded-lg overflow-auto bg-slate-50 p-4 max-h-[70vh]"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}
    </div>
  );
}
