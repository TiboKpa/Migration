import React, { useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const BOOL_FLAGS = [
  { key: 'pbom_champion', label: 'PBOM Champion' },
  { key: 'boc_admin',     label: 'BOC Admin' },
  { key: 'boc_member',   label: 'BOC Member' },
  { key: 'eto_user',     label: 'ETO User' },
  { key: 'team_manager', label: 'Team Manager' },
];

const EMPTY_FORM = {
  function: '', role: '',
  pbom_champion: false, boc_admin: false, boc_member: false,
  eto_user: false, team_manager: false,
  pdm_role: '', tlg_group: '',
  recommended_training_id: '',
  complementary_items: [],
};

function normalizeYesNo(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'yes';
  return false;
}

function parseMatrixExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  let targetSheet = null, headerIdx = -1;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const row = raw[i].map(c => String(c).trim());
      if (row.includes('Function') && row.includes('Role') && row.includes('Concatenate')) {
        targetSheet = raw; headerIdx = i; break;
      }
    }
    if (targetSheet) break;
  }
  if (!targetSheet || headerIdx === -1) throw new Error('Could not find a header row with Function / Role / Concatenate in any sheet.');
  const headers = targetSheet[headerIdx].map(c => String(c).trim());
  const idx = (kw) => headers.findIndex(h => h.includes(kw));
  const fnIdx = headers.indexOf('Function'), roleIdx = headers.indexOf('Role');
  const entries = [];
  for (let i = headerIdx + 1; i < targetSheet.length; i++) {
    const row = targetSheet[i];
    const fn = String(row[fnIdx] || '').trim(), role = String(row[roleIdx] || '').trim();
    if (!fn || !role) continue;
    entries.push({
      function: fn, role,
      pbom_champion: normalizeYesNo(row[idx('PBOM')]),
      boc_admin:     normalizeYesNo(row[idx('BOC Admin')]),
      boc_member:    normalizeYesNo(row[idx('BOC Member')]),
      eto_user:      normalizeYesNo(row[idx('ETO')]),
      team_manager:  normalizeYesNo(row[idx('Team Manager')]),
      pdm_role:      String(row[idx('PDM Role')] || '').trim(),
      tlg_group:     String(row[idx('TLG')]      || '').trim(),
    });
  }
  if (entries.length === 0) throw new Error('No data rows found after the header row.');
  return entries;
}

function buildPivot(entries) {
  const map = {};
  for (const e of entries) {
    const key = `${e.function}||${e.role}`;
    if (!map[key]) map[key] = { function: e.function, role: e.role, combos: [] };
    map[key].combos.push(e);
  }
  return Object.values(map).sort((a, b) =>
    a.function.localeCompare(b.function) || a.role.localeCompare(b.role)
  );
}

function matchCombo(combos, profile) {
  return combos.find(c =>
    c.pbom_champion === profile.pbom_champion &&
    c.boc_admin     === profile.boc_admin &&
    c.boc_member    === profile.boc_member &&
    c.eto_user      === profile.eto_user &&
    c.team_manager  === profile.team_manager
  ) || null;
}

// ---- Edit Modal ----
function EditModal({ entry, profiles, complementaryOptions, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
  ];

  const [form, setForm] = useState({
    function: entry.function || '',
    role: entry.role || '',
    pbom_champion: !!entry.pbom_champion,
    boc_admin: !!entry.boc_admin,
    boc_member: !!entry.boc_member,
    eto_user: !!entry.eto_user,
    team_manager: !!entry.team_manager,
    pdm_role: entry.pdm_role || '',
    tlg_group: entry.tlg_group || '',
    recommended_training_id: entry.recommended_training_id ? String(entry.recommended_training_id) : '',
    complementary_items: Array.isArray(entry.complementary_items) ? entry.complementary_items : [],
  });

  // Primary training search
  const [primarySearch, setPrimarySearch] = useState('');
  const filteredProfiles = profiles.filter(p =>
    p.profile_name.toLowerCase().includes(primarySearch.toLowerCase())
  );
  const selectedProfile = profiles.find(p => String(p.id) === form.recommended_training_id) || null;

  // Complementary items search
  function toggleComplementary(item) {
    setForm(f => {
      const exists = f.complementary_items.some(i => i.type === item.type && i.id === item.id);
      return {
        ...f,
        complementary_items: exists
          ? f.complementary_items.filter(i => !(i.type === item.type && i.id === item.id))
          : [...f.complementary_items, { type: item.type, id: item.id, title: item.title }],
      };
    });
  }

  function isSelected(item) {
    return form.complementary_items.some(i => i.type === item.type && i.id === item.id);
  }

  const [itemSearch, setItemSearch] = useState('');
  const filteredItems = allItems.filter(i =>
    i.title.toLowerCase().includes(itemSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      {/* Modal widened to max-w-4xl to fit two columns side by side */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800">Edit rule</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {/* Function + Role */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Function</label>
            <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.function}
              onChange={e => setForm(f => ({ ...f, function: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Role</label>
            <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
          </div>
        </div>

        {/* Boolean flags */}
        <div className="mb-4">
          <label className="text-xs text-slate-500 block mb-2">Complementary flags</label>
          <div className="flex flex-wrap gap-4">
            {BOOL_FLAGS.map(flag => (
              <label key={flag.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form[flag.key]}
                  onChange={e => setForm(f => ({ ...f, [flag.key]: e.target.checked }))} className="rounded" />
                {flag.label}
              </label>
            ))}
          </div>
        </div>

        {/* PDM Role + TLG */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">PDM Recommended Training (text)</label>
            <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.pdm_role}
              onChange={e => setForm(f => ({ ...f, pdm_role: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">TLG Group</label>
            <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.tlg_group}
              onChange={e => setForm(f => ({ ...f, tlg_group: e.target.value }))} />
          </div>
        </div>

        {/* Primary Training + Complementary side by side */}
        <div className="grid grid-cols-2 gap-4 mb-5">

          {/* Left: Recommended Primary Training */}
          <div className="flex flex-col">
            <label className="text-xs text-slate-500 block mb-1">Recommended Primary Training</label>
            {selectedProfile && (
              <div className="flex flex-wrap gap-1 mb-2">
                <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-xs">
                  <span className="text-indigo-400 uppercase text-[10px] font-semibold">PLY</span>
                  {selectedProfile.profile_name}
                  <button
                    onClick={() => setForm(f => ({ ...f, recommended_training_id: '' }))}
                    className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none">&times;</button>
                </span>
              </div>
            )}
            <input
              className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1"
              placeholder="Search primary trainings..."
              value={primarySearch}
              onChange={e => setPrimarySearch(e.target.value)}
            />
            <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '11rem' }}>
              {filteredProfiles.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">No primary trainings found</p>
              )}
              {filteredProfiles.map(p => (
                <label key={p.id}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                    String(p.id) === form.recommended_training_id ? 'bg-indigo-50' : ''
                  }`}>
                  <input
                    type="radio"
                    name="recommended_training_id"
                    checked={String(p.id) === form.recommended_training_id}
                    onChange={() => setForm(f => ({ ...f, recommended_training_id: String(p.id) }))}
                    className="rounded"
                  />
                  <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">PLY</span>
                  <span className="text-xs text-slate-700">{p.profile_name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: Complementary Trainings */}
          <div className="flex flex-col">
            <label className="text-xs text-slate-500 block mb-1">Complementary Trainings (modules &amp; curricula)</label>
            {form.complementary_items.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {form.complementary_items.map(i => (
                  <span key={`${i.type}-${i.id}`}
                    className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                    <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : 'MOD'}</span>
                    {i.title}
                    <button onClick={() => toggleComplementary(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1"
              placeholder="Search modules or curricula..."
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
            />
            <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '11rem' }}>
              {filteredItems.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">No modules or curricula found</p>
              )}
              {filteredItems.map(item => (
                <label key={`${item.type}-${item.id}`}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                    isSelected(item) ? 'bg-blue-50' : ''
                  }`}>
                  <input type="checkbox" checked={isSelected(item)} onChange={() => toggleComplementary(item)} className="rounded" />
                  <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">
                    {item.type === 'curriculum' ? 'CUR' : 'MOD'}
                  </span>
                  <span className="text-xs text-slate-700">{item.title}</span>
                </label>
              ))}
            </div>
          </div>

        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave({
              ...form,
              recommended_training_id: form.recommended_training_id ? parseInt(form.recommended_training_id) : null,
            })}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >Save</button>
        </div>
      </div>
    </div>
  );
}

export default function RoleMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [viewMode, setViewMode] = useState('pivot');
  const [profile, setProfile] = useState({ pbom_champion: false, boc_admin: false, boc_member: false, eto_user: false, team_manager: false });
  const [filterFn, setFilterFn] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingEntry, setEditingEntry] = useState(null);
  const [importError, setImportError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['role-matrix', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data)
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['role-matrix-profiles', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/training-profiles`).then(r => r.data)
  });

  const { data: complementaryOptions = { modules: [], curricula: [] } } = useQuery({
    queryKey: ['role-matrix-complementary', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/complementary-options`).then(r => r.data)
  });

  const addMutation = useMutation({
    mutationFn: (data) => client.post(`/projects/${projectId}/role-matrix`, data),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setForm(EMPTY_FORM); setShowAddForm(false); }
  });
  const importMutation = useMutation({
    mutationFn: (e) => client.post(`/projects/${projectId}/role-matrix/import`, { entries: e }),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setImportError(''); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => client.put(`/projects/${projectId}/role-matrix/${id}`, data),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setEditingEntry(null); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => client.delete(`/projects/${projectId}/role-matrix/${id}`),
    onSuccess: () => qc.invalidateQueries(['role-matrix', projectId])
  });

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try { importMutation.mutate(parseMatrixExcel(evt.target.result)); }
      catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleExport() {
    const data = entries.map(e => ({
      Function: e.function, Role: e.role,
      'PBOM Champion': e.pbom_champion ? 'Yes' : 'No',
      'BOC Admin': e.boc_admin ? 'Yes' : 'No',
      'BOC Member': e.boc_member ? 'Yes' : 'No',
      'ETO User': e.eto_user ? 'Yes' : 'No',
      'Team Manager': e.team_manager ? 'Yes' : 'No',
      Concatenate: e.concatenate,
      'PDM Role': e.pdm_role,
      'TLG Group': e.tlg_group,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Role Matrix');
    XLSX.writeFile(wb, 'role-matrix-export.xlsx');
  }

  const pivot = useMemo(() => buildPivot(entries), [entries]);
  const uniqueFunctions = useMemo(() => [...new Set(pivot.map(r => r.function))].sort(), [pivot]);
  const filteredPivot = filterFn ? pivot.filter(r => r.function === filterFn) : pivot;

  const thClass = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';

  function resolveRecommended(entry) {
    if (!entry.recommended_training_id) return null;
    const p = profiles.find(p => p.id === entry.recommended_training_id);
    return p ? p.profile_name : null;
  }

  return (
    <div className="flex flex-col h-full">
      {editingEntry && (
        <EditModal
          entry={editingEntry}
          profiles={profiles}
          complementaryOptions={complementaryOptions}
          onSave={(data) => updateMutation.mutate({ id: editingEntry.id, data })}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">
            {viewMode === 'pivot'
              ? `${filteredPivot.length} role combinations`
              : `${entries.length} total rules`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex border rounded-lg overflow-hidden text-xs">
            <button onClick={() => setViewMode('pivot')}
              className={`px-3 py-1.5 font-medium ${ viewMode === 'pivot' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50' }`}>Pivot</button>
            <button onClick={() => setViewMode('flat')}
              className={`px-3 py-1.5 font-medium ${ viewMode === 'flat' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50' }`}>Full list</button>
          </div>
          <button onClick={() => setShowAddForm(v => !v)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Add rule</button>
          <button onClick={() => fileRef.current.click()} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Import Excel</button>
          <button onClick={handleExport} disabled={entries.length === 0} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Export Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importMutation.isPending && <p className="text-sm text-blue-600 mb-2">Importing...</p>}
      {importMutation.isSuccess && <p className="text-sm text-green-600 mb-2">Import complete</p>}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">New rule</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Function</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.function}
                placeholder="e.g. Engineering"
                onChange={e => setForm(f => ({ ...f, function: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Role</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.role}
                placeholder="e.g. Author"
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mb-3">
            {BOOL_FLAGS.map(flag => (
              <label key={flag.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form[flag.key]}
                  onChange={e => setForm(f => ({ ...f, [flag.key]: e.target.checked }))} className="rounded" />
                {flag.label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">PDM Recommended Training</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.pdm_role}
                onChange={e => setForm(f => ({ ...f, pdm_role: e.target.value }))} placeholder="e.g. PDM PBOM MCAD for ETO Authors" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">TLG Group</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={form.tlg_group}
                onChange={e => setForm(f => ({ ...f, tlg_group: e.target.value }))} placeholder="e.g. Heavy Author L1" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => addMutation.mutate(form)}
              disabled={!form.function || !form.role || addMutation.isPending}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">Save rule</button>
            <button onClick={() => { setShowAddForm(false); setForm(EMPTY_FORM); }}
              className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {/* PIVOT VIEW */}
      {viewMode === 'pivot' && (
        <>
          <div className="flex items-center gap-6 mb-3 px-4 py-2.5 bg-slate-50 border rounded-xl shrink-0">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">Profile preview</span>
            {BOOL_FLAGS.map(flag => (
              <label key={flag.key} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={profile[flag.key]}
                  onChange={e => setProfile(p => ({ ...p, [flag.key]: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600" />
                {flag.label}
              </label>
            ))}
            <button onClick={() => setProfile({ pbom_champion: false, boc_admin: false, boc_member: false, eto_user: false, team_manager: false })}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600">Reset</button>
            <select value={filterFn} onChange={e => setFilterFn(e.target.value)}
              className="border rounded-lg px-2 py-1 text-xs text-slate-600">
              <option value="">All functions</option>
              {uniqueFunctions.map(fn => <option key={fn} value={fn}>{fn}</option>)}
            </select>
          </div>

          <div className="overflow-auto rounded-xl border bg-white flex-1">
            <table className="min-w-max text-sm border-collapse w-full">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b">
                <tr>
                  <th className={thClass}>Function</th>
                  <th className={thClass}>Role</th>
                  <th className={`${thClass} w-64`}>PDM Training</th>
                  <th className={`${thClass} w-40`}>TLG Group</th>
                  <th className={`${thClass} w-52`}>Recommended Training</th>
                  <th className={`${thClass}`}>Complementary</th>
                  <th className="px-2 py-2 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>}
                {!isLoading && filteredPivot.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No rules yet. Import the Excel template or add rules manually.</td></tr>
                )}
                {filteredPivot.map(row => {
                  const match = matchCombo(row.combos, profile);
                  const isError = match?.pdm_role?.toLowerCase().startsWith('error');
                  const recName = match ? resolveRecommended(match) : null;
                  const compItems = match && Array.isArray(match.complementary_items) ? match.complementary_items : [];
                  return (
                    <tr key={`${row.function}-${row.role}`} className={`border-b hover:bg-slate-50/50 ${ isError ? 'bg-red-50' : '' }`}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-700 whitespace-nowrap">{row.function}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{row.role}</td>
                      <td className="px-3 py-2">
                        {match
                          ? <span className={`text-xs ${ isError ? 'text-red-500 font-medium' : 'text-slate-800 font-medium' }`}>{match.pdm_role}</span>
                          : <span className="text-xs text-slate-300">No rule for this combination</span>}
                      </td>
                      <td className="px-3 py-2">
                        {match && <span className={`text-xs ${ isError ? 'text-red-500' : 'text-slate-600' }`}>{match.tlg_group}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {recName && <span className="text-xs text-indigo-700 font-medium">{recName}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {compItems.map(i => (
                            <span key={`${i.type}-${i.id}`} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                              {i.title}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {match && (
                          <button onClick={() => setEditingEntry(match)}
                            className="text-xs text-slate-400 hover:text-blue-600">Edit</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* FLAT VIEW */}
      {viewMode === 'flat' && (
        <div className="overflow-auto rounded-xl border bg-white flex-1">
          <table className="min-w-max text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b">
              <tr>
                <th className={thClass}>Function</th>
                <th className={thClass}>Role</th>
                {BOOL_FLAGS.map(f => <th key={f.key} className={`${thClass} text-center w-24`}>{f.label}</th>)}
                <th className={`${thClass} w-64`}>PDM Training</th>
                <th className={`${thClass} w-40`}>TLG Group</th>
                <th className={`${thClass} w-48`}>Recommended Training</th>
                <th className={`${thClass}`}>Complementary</th>
                <th className="px-2 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>}
              {!isLoading && entries.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">No rules yet.</td></tr>}
              {entries.map(entry => {
                const recName = resolveRecommended(entry);
                const compItems = Array.isArray(entry.complementary_items) ? entry.complementary_items : [];
                return (
                  <tr key={entry.id} className={`border-b hover:bg-slate-50/50 ${entry.pdm_role?.startsWith('Error') ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-1.5 text-xs font-medium text-slate-700">{entry.function}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{entry.role}</td>
                    {BOOL_FLAGS.map(f => (
                      <td key={f.key} className="px-3 py-1.5 text-center">
                        <span className={`text-xs font-medium ${entry[f.key] ? 'text-green-600' : 'text-slate-300'}`}>{entry[f.key] ? 'Yes' : 'No'}</span>
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-xs text-slate-700">{entry.pdm_role}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{entry.tlg_group}</td>
                    <td className="px-3 py-1.5">
                      {recName && <span className="text-xs text-indigo-700 font-medium">{recName}</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {compItems.map(i => (
                          <span key={`${i.type}-${i.id}`} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{i.title}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <button onClick={() => setEditingEntry(entry)} className="text-slate-400 hover:text-blue-600 text-xs">Edit</button>
                        <button onClick={() => deleteMutation.mutate(entry.id)} className="text-red-300 hover:text-red-500 text-xs">Del</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
