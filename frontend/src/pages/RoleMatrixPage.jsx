import React, { useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const TLG_PRIMARY_OPTIONS = [
  'Heavy Author L1',
  'Medium Author L2',
  'Light Author L3',
  'Viewer L5',
  'Error',
];

const TLG_ADDON_OPTIONS = [
  'SE_TLG_Supplier_Management',
  'SE_TLG_BOM_Transformation',
  'SE_TLG_MPM_Process_Plan',
];

const SKIP_COLS = new Set([
  'Function', 'Role', 'Concatenate', 'PDM Role', 'TLG Group',
]);

function cleanInfoKeyName(header) {
  return header
    .replace(/^Additional\s+Info\s+/i, '')
    .replace(/\s*\(yes\s*\/\s*no\)\s*$/i, '')
    .trim();
}

function splitByPlus(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw).split(' + ').map(s => s.trim()).filter(Boolean);
}

function parseRoleMatrixExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  let rawSheet = null;
  let headerIdx = -1;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const row = raw[i].map(c => String(c).trim());
      if (row.includes('Function') && row.includes('Role')) {
        rawSheet = raw;
        headerIdx = i;
        break;
      }
    }
    if (rawSheet) break;
  }

  if (!rawSheet || headerIdx === -1)
    throw new Error('No header row with Function and Role found.');

  const headers = rawSheet[headerIdx].map(c => String(c).trim());
  const fnIdx       = headers.indexOf('Function');
  const roleIdx     = headers.indexOf('Role');
  const pdmRoleIdx  = headers.findIndex(h => h === 'PDM Role');
  const tlgGroupIdx = headers.findIndex(h => h === 'TLG Group');

  const infoHeaders = headers
    .map((h, i) => ({ raw: h, clean: cleanInfoKeyName(h), i }))
    .filter(({ raw }) => raw && !SKIP_COLS.has(raw));

  const entries = [];

  for (let i = headerIdx + 1; i < rawSheet.length; i++) {
    const row  = rawSheet[i];
    const fn   = String(row[fnIdx]   || '').trim();
    const role = String(row[roleIdx] || '').trim();
    if (!fn || !role) continue;

    const additional_info = {};
    for (const { clean, i: ci } of infoHeaders) {
      const val = row[ci];
      additional_info[clean] =
        val === true ||
        val === 1 ||
        (typeof val === 'string' && val.trim().toLowerCase() === 'yes');
    }

    const tlgParts    = tlgGroupIdx >= 0 ? splitByPlus(row[tlgGroupIdx]) : [];
    const tlg_primary = tlgParts[0] || '';
    const tlg_addon   = tlgParts.slice(1);

    const pdmParts              = pdmRoleIdx >= 0 ? splitByPlus(row[pdmRoleIdx]) : [];
    const primary_training_name = pdmParts[0] || '';
    const complementary_names   = pdmParts.slice(1);

    entries.push({
      function: fn,
      role,
      additional_info,
      tlg_primary,
      tlg_addon,
      primary_training_name,
      complementary_names,
    });
  }

  if (entries.length === 0) throw new Error('No data rows found.');
  return entries;
}

function TlgGroupSelector({ tlgPrimary, tlgAddon, onChange }) {
  const isError = tlgPrimary === 'Error';
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Primary TLG Group</p>
        <div className="border rounded-lg overflow-hidden">
          {TLG_PRIMARY_OPTIONS.map(opt => (
            <label key={opt}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                tlgPrimary === opt ? (opt === 'Error' ? 'bg-red-50' : 'bg-indigo-50') : ''
              }`}>
              <input
                type="radio"
                name="tlg_primary"
                checked={tlgPrimary === opt}
                onChange={() => onChange({ tlgPrimary: tlgPrimary === opt ? '' : opt, tlgAddon })}
              />
              <span className={`text-xs ${opt === 'Error' ? 'text-red-500 font-medium' : 'text-slate-700'}`}>{opt}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Add-on TLG Groups</p>
        <div className="border rounded-lg overflow-hidden">
          {TLG_ADDON_OPTIONS.map(opt => {
            const checked = tlgAddon.includes(opt);
            return (
              <label key={opt}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${checked ? 'bg-teal-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isError}
                  onChange={() => onChange({
                    tlgPrimary,
                    tlgAddon: checked ? tlgAddon.filter(x => x !== opt) : [...tlgAddon, opt],
                  })}
                  className="rounded accent-teal-600"
                />
                <span className="text-xs text-slate-700">{opt}</span>
              </label>
            );
          })}
        </div>
        {isError && <p className="text-xs text-red-400 mt-1">Add-ons disabled when primary is Error.</p>}
      </div>
    </div>
  );
}

function EditModal({ entry, profiles, complementaryOptions, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
  ];

  const [tlgPrimary, setTlgPrimary] = useState(entry.tlg_primary || '');
  const [tlgAddon, setTlgAddon] = useState(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : []);
  const [recommendedId, setRecommendedId] = useState(
    entry.recommended_training_id ? String(entry.recommended_training_id) : ''
  );
  const [complementaryItems, setComplementaryItems] = useState(
    Array.isArray(entry.complementary_items) ? entry.complementary_items : []
  );
  const [primarySearch, setPrimarySearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const filteredProfiles = profiles.filter(p =>
    p.profile_name.toLowerCase().includes(primarySearch.toLowerCase())
  );
  const filteredItems = allItems.filter(i =>
    i.title.toLowerCase().includes(itemSearch.toLowerCase())
  );
  const selectedProfile = profiles.find(p => String(p.id) === recommendedId) || null;

  function toggleComp(item) {
    setComplementaryItems(prev => {
      const exists = prev.some(i => i.type === item.type && i.id === item.id);
      return exists
        ? prev.filter(i => !(i.type === item.type && i.id === item.id))
        : [...prev, { type: item.type, id: item.id, title: item.title }];
    });
  }

  function isCompSelected(item) {
    return complementaryItems.some(i => i.type === item.type && i.id === item.id);
  }

  const infoKeys = Object.keys(entry.additional_info || {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {entry.function} / {entry.role}
            </h2>
            {infoKeys.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {infoKeys.map(k => (
                  <span key={k}
                    className={`text-[10px] rounded px-1.5 py-0.5 font-medium border ${
                      entry.additional_info[k]
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                    }`}>
                    {k}: {entry.additional_info[k] ? 'Yes' : 'No'}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        <div className="border rounded-xl p-4 mb-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">TLG Group</p>
          <TlgGroupSelector
            tlgPrimary={tlgPrimary}
            tlgAddon={tlgAddon}
            onChange={({ tlgPrimary: p, tlgAddon: a }) => { setTlgPrimary(p); setTlgAddon(a); }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="flex flex-col">
            <label className="text-xs text-slate-500 block mb-1">Recommended Primary Training</label>
            {selectedProfile && (
              <div className="flex flex-wrap gap-1 mb-2">
                <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-xs">
                  <span className="text-indigo-400 uppercase text-[10px] font-semibold">PLY</span>
                  {selectedProfile.profile_name}
                  <button onClick={() => setRecommendedId('')}
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
                    String(p.id) === recommendedId ? 'bg-indigo-50' : ''
                  }`}>
                  <input
                    type="radio"
                    name="recommended_training_id"
                    checked={String(p.id) === recommendedId}
                    onChange={() => setRecommendedId(String(p.id))}
                  />
                  <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">PLY</span>
                  <span className="text-xs text-slate-700">{p.profile_name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500 block mb-1">Complementary Trainings</label>
            {complementaryItems.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {complementaryItems.map(i => (
                  <span key={`${i.type}-${i.id}`}
                    className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                    <span className="text-blue-400 uppercase text-[10px] font-semibold">
                      {i.type === 'curriculum' ? 'CUR' : 'MOD'}
                    </span>
                    {i.title}
                    <button onClick={() => toggleComp(i)}
                      className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
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
                    isCompSelected(item) ? 'bg-blue-50' : ''
                  }`}>
                  <input
                    type="checkbox"
                    checked={isCompSelected(item)}
                    onChange={() => toggleComp(item)}
                    className="rounded"
                  />
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
          <button onClick={onClose}
            className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave({
              tlg_primary: tlgPrimary,
              tlg_addon: tlgAddon,
              recommended_training_id: recommendedId ? parseInt(recommendedId) : null,
              complementary_items: complementaryItems,
            })}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function AddValueInline({ label, onAdd, disabled }) {
  const [value, setValue] = useState('');
  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onAdd(trimmed);
    setValue('');
  }
  return (
    <div className="flex gap-1 mt-1">
      <input
        className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-0 disabled:opacity-50"
        placeholder={`Add ${label}...`}
        value={value}
        disabled={disabled}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <button
        onClick={submit}
        disabled={disabled}
        className="bg-blue-600 text-white px-2 py-1 rounded-lg text-xs font-medium hover:bg-blue-700 shrink-0 disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pivot cell: shows the training assignment for one (function x role x infoCombo)
// ---------------------------------------------------------------------------
function PivotCell({ entry, profiles, onEdit }) {
  if (!entry) return <td className="border px-2 py-1 text-center text-slate-200 text-xs">-</td>;

  const isError  = entry.tlg_primary === 'Error';
  const rec      = profiles.find(p => p.id === entry.recommended_training_id);
  const compItems = Array.isArray(entry.complementary_items) ? entry.complementary_items : [];
  const isFilled = !!entry.tlg_primary;

  return (
    <td
      className={`border px-2 py-1 align-top min-w-[11rem] ${
        isError ? 'bg-red-50' : !isFilled ? 'bg-amber-50/30' : ''
      }`}
    >
      <div className="flex flex-col gap-0.5">
        {entry.tlg_primary ? (
          <span className={`text-[10px] font-semibold ${
            isError ? 'text-red-500' : 'text-slate-700'
          }`}>
            {entry.tlg_primary}
            {(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : []).map(a => (
              <span key={a} className="ml-1 text-teal-600">[{a}]</span>
            ))}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">no TLG</span>
        )}
        {rec ? (
          <span className="text-[10px] text-indigo-700 truncate max-w-[10rem]" title={rec.profile_name}>
            {rec.profile_name}
          </span>
        ) : entry.primary_training_name ? (
          <span className="text-[10px] text-amber-600 truncate max-w-[10rem]" title={entry.primary_training_name}>
            {entry.primary_training_name}
          </span>
        ) : null}
        {compItems.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {compItems.map((i, idx) => (
              <span key={idx}
                className={`text-[9px] rounded px-1 py-0.5 ${
                  i.type === 'unresolved'
                    ? 'bg-amber-50 text-amber-500 border border-amber-200'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                {i.title}
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => onEdit(entry)}
        className="mt-1 text-[9px] text-slate-400 hover:text-blue-600"
      >
        Fill
      </button>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Build all unique info-key combinations from existing entries
// ---------------------------------------------------------------------------
function buildInfoCombos(entries, info_keys) {
  if (info_keys.length === 0) return [{}];
  const seen = new Set();
  const combos = [];
  for (const e of entries) {
    const combo = {};
    for (const k of info_keys) combo[k] = !!(e.additional_info && e.additional_info[k]);
    const key = info_keys.map(k => (combo[k] ? 'Y' : 'N')).join('');
    if (!seen.has(key)) { seen.add(key); combos.push(combo); }
  }
  // Sort: all-true first, then by keys in order
  combos.sort((a, b) => {
    for (const k of info_keys) {
      if (a[k] === b[k]) continue;
      return a[k] ? -1 : 1;
    }
    return 0;
  });
  return combos.length > 0 ? combos : [{}];
}

export default function RoleMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [filterFn, setFilterFn] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [modalEntry, setModalEntry] = useState(null);
  const [importError, setImportError] = useState('');
  const [importStats, setImportStats] = useState(null);

  const dimKey    = ['role-matrix-dimensions', projectId];
  const matrixKey = ['role-matrix', projectId];

  const { data: dimensions = { functions: [], roles: [], info_keys: [] } } = useQuery({
    queryKey: dimKey,
    queryFn: () =>
      client.get(`/projects/${projectId}/role-matrix/dimensions`).then(r => r.data),
    staleTime: 0,
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: matrixKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data),
    staleTime: 0,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['role-matrix-profiles', projectId],
    queryFn: () =>
      client.get(`/projects/${projectId}/role-matrix/training-profiles`).then(r => r.data),
  });

  const { data: complementaryOptions = { modules: [], curricula: [] } } = useQuery({
    queryKey: ['role-matrix-complementary', projectId],
    queryFn: () =>
      client.get(`/projects/${projectId}/role-matrix/complementary-options`).then(r => r.data),
  });

  const addDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.post(`/projects/${projectId}/role-matrix/dimensions`, { type, value }).then(r => r.data),
    onSuccess: (data) => {
      qc.setQueryData(dimKey, data);
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
    },
    onError: (err) => { console.error('Failed to add dimension:', err); },
  });

  const delDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.delete(`/projects/${projectId}/role-matrix/dimensions`, { data: { type, value } }).then(r => r.data),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: dimKey, exact: true });
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      client.put(`/projects/${projectId}/role-matrix/${id}`, data).then(r => r.data),
    onSuccess: (updated) => {
      qc.setQueryData(matrixKey, (old = []) =>
        old.map(row => row.id === updated.id ? updated : row)
      );
      setModalEntry(null);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => client.delete(`/projects/${projectId}/role-matrix`).then(r => r.data),
    onSuccess: () => {
      qc.setQueryData(dimKey, { functions: [], roles: [], info_keys: [] });
      qc.setQueryData(matrixKey, []);
      setImportStats(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: payload =>
      client.post(`/projects/${projectId}/role-matrix/import`, payload).then(r => r.data),
    onSuccess: (data) => {
      setImportError('');
      setImportStats(data);
      qc.refetchQueries({ queryKey: dimKey, exact: true });
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
    },
    onError: (err) => {
      setImportError(err?.response?.data?.error || err.message || 'Import failed');
    },
  });

  function handleExport() {
    const data = entries.map(e => {
      const row = { Function: e.function, Role: e.role };
      for (const k of dimensions.info_keys) {
        row[`Additional Info ${k}`] = e.additional_info?.[k] ? 'Yes' : 'No';
      }
      row['Concatenate'] = '';
      const rec = profiles.find(p => p.id === e.recommended_training_id);
      const compTitles = Array.isArray(e.complementary_items)
        ? e.complementary_items.map(i => i.title) : [];
      row['PDM Role'] = [rec ? rec.profile_name : '', ...compTitles].filter(Boolean).join(' + ');
      const addonParts = Array.isArray(e.tlg_addon) ? e.tlg_addon : [];
      row['TLG Group'] = [e.tlg_primary || '', ...addonParts].filter(Boolean).join(' + ');
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Role Matrix');
    XLSX.writeFile(wb, 'role-matrix-export.xlsx');
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = parseRoleMatrixExcel(evt.target.result);
        setImportError('');
        importMutation.mutate({ entries: parsed });
      } catch (err) {
        setImportError(err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleClearAll() {
    if (clearAllMutation.isPending) return;
    if (window.confirm('Empty the entire role matrix including all dimensions? This cannot be undone.'))
      clearAllMutation.mutate();
  }

  const uniqueFunctions = useMemo(() => dimensions.functions, [dimensions]);
  const uniqueRoles     = useMemo(() => dimensions.roles,     [dimensions]);

  // Pivot data structures
  const { visibleFunctions, visibleRoles, infoCombos, entryMap } = useMemo(() => {
    const vFns   = filterFn   ? [filterFn]   : uniqueFunctions;
    const vRoles = filterRole ? [filterRole] : uniqueRoles;
    const combos = buildInfoCombos(entries, dimensions.info_keys);

    // Map: fn|role|comboKey -> entry
    const map = new Map();
    for (const e of entries) {
      const comboKey = dimensions.info_keys
        .map(k => (e.additional_info && e.additional_info[k] ? 'Y' : 'N'))
        .join('');
      map.set(`${e.function}||${e.role}||${comboKey}`, e);
    }
    return { visibleFunctions: vFns, visibleRoles: vRoles, infoCombos: combos, entryMap: map };
  }, [entries, dimensions, filterFn, filterRole, uniqueFunctions, uniqueRoles]);

  const isDimPending = addDimMutation.isPending || delDimMutation.isPending;

  function comboKey(combo) {
    return dimensions.info_keys.map(k => (combo[k] ? 'Y' : 'N')).join('');
  }

  function getEntry(fn, role, combo) {
    return entryMap.get(`${fn}||${role}||${comboKey(combo)}`) || null;
  }

  const thClass =
    'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';

  function DimTag({ value, type }) {
    return (
      <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5 text-xs">
        {value}
        <button
          onClick={() => delDimMutation.mutate({ type, value })}
          disabled={isDimPending}
          className="text-slate-400 hover:text-red-500 leading-none ml-0.5 disabled:opacity-40"
          title={`Remove ${value}`}
        >
          &times;
        </button>
      </span>
    );
  }

  const hasData = entries.length > 0;
  const hasMinDims = uniqueFunctions.length > 0 && uniqueRoles.length > 0;

  return (
    <div className="flex flex-col h-full">
      {modalEntry !== null && (
        <EditModal
          entry={modalEntry}
          profiles={profiles}
          complementaryOptions={complementaryOptions}
          onSave={data => updateMutation.mutate({ id: modalEntry.id, data })}
          onClose={() => setModalEntry(null)}
        />
      )}

      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">{entries.length} rules</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">
          <button onClick={() => fileRef.current.click()}
            disabled={importMutation.isPending}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importMutation.isPending ? 'Importing...' : 'Import Excel'}
          </button>
          <button onClick={handleExport} disabled={!hasData}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Export Excel</button>
          <button
            onClick={handleClearAll}
            disabled={clearAllMutation.isPending}
            className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40"
          >
            {clearAllMutation.isPending ? 'Emptying...' : 'Empty matrix'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importStats && !importMutation.isPending && (
        <p className="text-sm text-green-600 mb-2">
          Import complete: {importStats.imported} rows, {importStats.dimensions_added} new dimensions,
          {' '}{importStats.resolved} trainings resolved, {importStats.unresolved} unresolved.
        </p>
      )}

      {/* Dimensions panel */}
      <div className="grid grid-cols-3 gap-4 mb-4 shrink-0">
        <div className="border rounded-xl p-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Functions</p>
          <div className="flex flex-wrap gap-1 mb-2 min-h-[1.5rem]">
            {dimensions.functions.map(v => <DimTag key={v} value={v} type="function" />)}
            {dimensions.functions.length === 0 && (
              <span className="text-xs text-slate-400">No functions yet</span>
            )}
          </div>
          <AddValueInline
            label="function"
            disabled={isDimPending}
            onAdd={v => addDimMutation.mutate({ type: 'function', value: v })}
          />
        </div>

        <div className="border rounded-xl p-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Roles</p>
          <div className="flex flex-wrap gap-1 mb-2 min-h-[1.5rem]">
            {dimensions.roles.map(v => <DimTag key={v} value={v} type="role" />)}
            {dimensions.roles.length === 0 && (
              <span className="text-xs text-slate-400">No roles yet</span>
            )}
          </div>
          <AddValueInline
            label="role"
            disabled={isDimPending}
            onAdd={v => addDimMutation.mutate({ type: 'role', value: v })}
          />
        </div>

        <div className="border rounded-xl p-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Additional Info</p>
          <div className="flex flex-wrap gap-1 mb-2 min-h-[1.5rem]">
            {dimensions.info_keys.map(v => <DimTag key={v} value={v} type="info_key" />)}
            {dimensions.info_keys.length === 0 && (
              <span className="text-xs text-slate-400">No info keys yet</span>
            )}
          </div>
          <AddValueInline
            label="info key"
            disabled={isDimPending}
            onAdd={v => addDimMutation.mutate({ type: 'info_key', value: v })}
          />
        </div>
      </div>

      {isDimPending && (
        <p className="text-xs text-blue-500 mb-2">Updating matrix...</p>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <select value={filterFn} onChange={e => setFilterFn(e.target.value)}
          className="border rounded-lg px-2 py-1 text-xs text-slate-600">
          <option value="">All functions</option>
          {uniqueFunctions.map(fn => <option key={fn} value={fn}>{fn}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="border rounded-lg px-2 py-1 text-xs text-slate-600">
          <option value="">All roles</option>
          {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(filterFn || filterRole) && (
          <button onClick={() => { setFilterFn(''); setFilterRole(''); }}
            className="text-xs text-slate-400 hover:text-slate-600">Reset</button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {visibleFunctions.length} function(s) x {visibleRoles.length} role(s)
          {dimensions.info_keys.length > 0 && ` x ${infoCombos.length} combination(s)`}
        </span>
      </div>

      {/* Pivot table */}
      <div className="overflow-auto rounded-xl border bg-white flex-1">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading...</div>
        )}
        {!isLoading && !hasMinDims && (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
            Add at least one function and one role to generate matrix rows.
          </div>
        )}
        {!isLoading && hasMinDims && (
          <table className="text-xs border-collapse" style={{ minWidth: `${16 + visibleRoles.length * 11}rem` }}>
            <thead className="sticky top-0 z-10 bg-slate-50">
              {/* Role header row */}
              <tr>
                <th className={`${thClass} border bg-slate-100 w-32`}>Function</th>
                {dimensions.info_keys.length > 0 && (
                  <th className={`${thClass} border bg-slate-100`}>
                    {dimensions.info_keys.join(' / ')}
                  </th>
                )}
                {visibleRoles.map(role => (
                  <th key={role} className={`${thClass} border bg-slate-100 text-center`}>
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleFunctions.map(fn => (
                infoCombos.map((combo, ci) => (
                  <tr key={`${fn}-${ci}`} className={ci === 0 ? 'border-t-2 border-slate-300' : ''}>
                    {/* Function cell -- spans all info combos */}
                    {ci === 0 && (
                      <td
                        rowSpan={infoCombos.length}
                        className="border px-2 py-1 font-semibold text-slate-700 align-middle bg-slate-50 whitespace-nowrap"
                      >
                        {fn}
                      </td>
                    )}
                    {/* Info combo label */}
                    {dimensions.info_keys.length > 0 && (
                      <td className="border px-2 py-1 bg-slate-50 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          {dimensions.info_keys.map(k => (
                            <span key={k}
                              className={`text-[9px] font-medium ${
                                combo[k] ? 'text-blue-600' : 'text-slate-400'
                              }`}>
                              {k}: {combo[k] ? 'Yes' : 'No'}
                            </span>
                          ))}
                        </div>
                      </td>
                    )}
                    {/* One cell per role */}
                    {visibleRoles.map(role => (
                      <PivotCell
                        key={role}
                        entry={getEntry(fn, role, combo)}
                        profiles={profiles}
                        onEdit={setModalEntry}
                      />
                    ))}
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
