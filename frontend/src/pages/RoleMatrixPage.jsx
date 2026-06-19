import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const TLG_PRIMARY_OPTIONS = [
  'Heavy Author L1',
  'Medium Author L2',
  'Light Author L3',
  'Viewer L5',
];

const TLG_ADDON_OPTIONS = [
  'SE_TLG_Supplier_Management',
  'SE_TLG_BOM_Transformation',
  'SE_TLG_MPM_Process_Plan',
];

const SKIP_COLS = new Set(['Function', 'Role', 'Concatenate', 'PDM Role', 'TLG Group']);

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
      if (row.includes('Function') && row.includes('Role')) { rawSheet = raw; headerIdx = i; break; }
    }
    if (rawSheet) break;
  }
  if (!rawSheet || headerIdx === -1) throw new Error('No header row with Function and Role found.');
  const headers = rawSheet[headerIdx].map(c => String(c).trim());
  const fnIdx       = headers.indexOf('Function');
  const roleIdx     = headers.indexOf('Role');
  const pdmRoleIdx  = headers.findIndex(h => h === 'PDM Role');
  const tlgGroupIdx = headers.findIndex(h => h === 'TLG Group');
  const infoHeaders = headers.map((h, i) => ({ raw: h, clean: cleanInfoKeyName(h), i })).filter(({ raw }) => raw && !SKIP_COLS.has(raw));
  const entries = [];
  for (let i = headerIdx + 1; i < rawSheet.length; i++) {
    const row  = rawSheet[i];
    const fn   = String(row[fnIdx]   || '').trim();
    const role = String(row[roleIdx] || '').trim();
    if (!fn || !role) continue;
    const additional_info = {};
    for (const { clean, i: ci } of infoHeaders) {
      const val = row[ci];
      additional_info[clean] = val === true || val === 1 || (typeof val === 'string' && val.trim().toLowerCase() === 'yes');
    }
    const tlgRaw   = tlgGroupIdx >= 0 ? String(row[tlgGroupIdx] || '').trim() : '';
    const isNaTlg  = tlgRaw === 'N/A';
    const tlgParts = isNaTlg ? [] : splitByPlus(tlgRaw);
    const pdmRaw   = pdmRoleIdx >= 0 ? String(row[pdmRoleIdx] || '').trim() : '';
    const isNaTrn  = pdmRaw === 'N/A';
    const pdmParts = isNaTrn ? [] : splitByPlus(pdmRaw);
    entries.push({
      function: fn, role,
      additional_info,
      tlg_primary: isNaTlg ? 'N/A' : (tlgParts[0] || ''),
      tlg_addon:   isNaTlg ? [] : tlgParts.slice(1),
      na_tlg: isNaTlg,
      primary_training_name: pdmParts[0] || '',
      complementary_names:   pdmParts.slice(1),
      na_training: isNaTrn,
    });
  }
  if (entries.length === 0) throw new Error('No data rows found.');
  return entries;
}

// ---------------------------------------------------------------------------
// Row status helpers
// ---------------------------------------------------------------------------
function rowStatus(entry) {
  if (entry.na_training && entry.na_tlg) return 'na';
  if (!entry.na_training) {
    const hasName = entry.primary_training_name && entry.primary_training_name.trim() !== '';
    const hasId   = !!entry.recommended_training_id;
    if (!hasName && !hasId) return 'empty';
    if (hasName && !hasId)  return 'unresolved';
    if (hasId) {
      const compItems = Array.isArray(entry.complementary_items) ? entry.complementary_items : [];
      if (compItems.some(i => i.type === 'unresolved')) return 'comp-unresolved';
    }
  }
  return 'ok';
}

const ROW_BG = {
  na:                'bg-slate-100',
  empty:             'bg-red-50',
  unresolved:        'bg-orange-50',
  'comp-unresolved': 'bg-yellow-50',
  ok:                '',
};

const ROW_HOVER = {
  na:                'hover:bg-slate-200/60',
  empty:             'hover:bg-red-100/60',
  unresolved:        'hover:bg-orange-100/60',
  'comp-unresolved': 'hover:bg-yellow-100/60',
  ok:                'hover:bg-slate-50/50',
};

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <span className="text-xs text-slate-500">{label}</span>
      <span
        onClick={() => onChange(!checked)}
        className={`relative inline-block w-9 h-5 rounded-full transition-colors duration-200 ${
          checked ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Add-dimension modal
// ---------------------------------------------------------------------------
function AddDimModal({ label, badge, existing, onAdd, onClose }) {
  const [search, setSearch] = useState('');
  const [value, setValue] = useState('');
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = existing.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  const trimmed  = value.trim();
  const isNew    = trimmed && !existing.some(v => v.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Add {label}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>
        <input
          ref={inputRef}
          className="border rounded-lg px-3 py-2 text-xs w-full mb-2"
          placeholder={`Type a new ${label}...`}
          value={value}
          onChange={e => { setValue(e.target.value); setSearch(e.target.value); }}
        />
        {filtered.length > 0 && (
          <div className="border rounded-lg overflow-y-auto mb-3" style={{ maxHeight: '10rem' }}>
            {filtered.map(v => (
              <button key={v} onClick={() => setValue(v)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-slate-50 border-b last:border-0 ${
                  value === v ? 'bg-slate-100' : ''
                }`}>
                <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">{badge}</span>
                <span className="text-xs text-slate-700">{v}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="border px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            disabled={!trimmed}
            onClick={() => { if (trimmed) { onAdd(trimmed); onClose(); } }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {isNew ? `Add "${trimmed}"` : `Select "${trimmed}"`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selector panel
// ---------------------------------------------------------------------------
function SelectorPanel({ title, badge, items, selected, multi, onChange, onAddNew, onRemove, editMode }) {
  const [search,  setSearch]  = useState('');
  const [sortAZ,  setSortAZ]  = useState(false);

  const displayed = useMemo(() => {
    let list = items.filter(v => v.toLowerCase().includes(search.toLowerCase()));
    if (sortAZ) list = [...list].sort((a, b) => a.localeCompare(b));
    return list;
  }, [items, search, sortAZ]);

  const hasSelection = multi ? selected.length > 0 : selected !== null;

  function toggle(v) {
    if (multi) {
      onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
    } else {
      onChange(selected === v ? null : v);
    }
  }

  function handleReset() {
    setSearch('');
    onChange(multi ? [] : null);
  }

  const isSelected = v => multi ? selected.includes(v) : selected === v;

  return (
    <div className="flex flex-col border rounded-xl bg-white overflow-hidden" style={{ minHeight: 0 }}>
      <div className="px-3 pt-3 pb-2 border-b bg-slate-50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">{title}</p>
          <input
            className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-0"
            placeholder={`Search...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            {hasSelection && (
              <button
                onClick={handleReset}
                className="text-[10px] text-slate-400 hover:text-red-500 underline leading-none"
                title="Clear selection"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setSortAZ(s => !s)}
              title={sortAZ ? 'Back to original order' : 'Sort A to Z'}
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
                sortAZ
                  ? 'bg-blue-50 border-blue-200 text-blue-600'
                  : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
              }`}
            >
              A-Z
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {displayed.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">No {title.toLowerCase()} yet</p>
        )}
        {displayed.map(v => (
          <div key={v}
            className={`flex items-center border-b last:border-0 ${
              isSelected(v) ? 'bg-indigo-50' : 'hover:bg-slate-50'
            }`}>
            <label className="flex items-center gap-2 px-3 py-2 cursor-pointer flex-1 min-w-0">
              <input
                type={multi ? 'checkbox' : 'radio'}
                checked={isSelected(v)}
                onChange={() => toggle(v)}
                onClick={!multi ? () => { if (isSelected(v)) onChange(null); } : undefined}
                className={multi ? 'rounded accent-teal-600' : ''}
              />
              <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">{badge}</span>
              <span className="text-xs text-slate-700 truncate">{v}</span>
            </label>
            {editMode && (
              <button
                onClick={e => { e.stopPropagation(); onRemove(v); }}
                className="pr-3 pl-1 py-2 text-slate-300 hover:text-red-400 shrink-0 leading-none"
                title={`Remove ${v}`}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      {editMode && (
        <div className="px-3 py-2 border-t bg-slate-50 shrink-0">
          <button
            onClick={onAddNew}
            className="w-full border border-dashed border-slate-300 rounded-lg py-1.5 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600"
          >
            + Add new
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TLG selector
// ---------------------------------------------------------------------------
function TlgGroupSelector({ naTlg, onNaTlgChange, tlgPrimary, tlgAddon, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">TLG Group</p>
        <ToggleSwitch checked={naTlg} onChange={onNaTlgChange} label="N/A (not applicable)" />
      </div>

      <div className={`grid grid-cols-2 gap-3 transition-opacity ${
        naTlg ? 'opacity-40 pointer-events-none select-none' : ''
      }`}>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Primary TLG Group</p>
          <div className="border rounded-lg overflow-hidden">
            {TLG_PRIMARY_OPTIONS.map(opt => (
              <label key={opt}
                className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${
                  tlgPrimary === opt ? 'bg-indigo-50' : ''
                }`}>
                <input
                  type="radio"
                  name="tlg_primary"
                  checked={tlgPrimary === opt}
                  onChange={() => onChange({ tlgPrimary: tlgPrimary === opt ? '' : opt, tlgAddon })}
                />
                <span className="text-xs text-slate-700">{opt}</span>
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
                  className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${
                    checked ? 'bg-teal-50' : ''
                  }`}>
                  <input type="checkbox" checked={checked}
                    onChange={() => onChange({ tlgPrimary, tlgAddon: checked ? tlgAddon.filter(x => x !== opt) : [...tlgAddon, opt] })}
                    className="rounded accent-teal-600" />
                  <span className="text-xs text-slate-700">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------
function EditModal({ entry, profiles, complementaryOptions, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
  ];

  const [naTlg,              setNaTlg]              = useState(entry.na_tlg === true);
  const [tlgPrimary,         setTlgPrimary]         = useState(entry.tlg_primary || '');
  const [tlgAddon,           setTlgAddon]           = useState(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : []);
  const [naTraining,         setNaTraining]         = useState(entry.na_training === true);
  const [recommendedId,      setRecommendedId]      = useState(entry.recommended_training_id ? String(entry.recommended_training_id) : '');
  const [complementaryItems, setComplementaryItems] = useState(Array.isArray(entry.complementary_items) ? entry.complementary_items : []);
  const [primarySearch,      setPrimarySearch]      = useState('');
  const [itemSearch,         setItemSearch]         = useState('');

  function handleNaTlg(val) {
    setNaTlg(val);
    if (val) { setTlgPrimary(''); setTlgAddon([]); }
  }

  function handleNaTraining(val) {
    setNaTraining(val);
    if (val) { setRecommendedId(''); setComplementaryItems([]); }
  }

  const filteredProfiles = profiles.filter(p => p.profile_name.toLowerCase().includes(primarySearch.toLowerCase()));
  const filteredItems    = allItems.filter(i => i.title.toLowerCase().includes(itemSearch.toLowerCase()));
  const selectedProfile  = profiles.find(p => String(p.id) === recommendedId) || null;

  function toggleComp(item) {
    setComplementaryItems(prev => {
      const exists = prev.some(i => i.type === item.type && i.id === item.id);
      return exists
        ? prev.filter(i => !(i.type === item.type && i.id === item.id))
        : [...prev, { type: item.type, id: item.id, title: item.title }];
    });
  }

  const infoKeys = Object.keys(entry.additional_info || {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{entry.function} / {entry.role}</h2>
            {infoKeys.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {infoKeys.map(k => (
                  <span key={k} className={`text-[10px] rounded px-1.5 py-0.5 font-medium border ${
                    entry.additional_info[k] ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}>{k}: {entry.additional_info[k] ? 'Yes' : 'No'}</span>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        <div className="border rounded-xl p-4 mb-4 bg-slate-50">
          <TlgGroupSelector
            naTlg={naTlg}
            onNaTlgChange={handleNaTlg}
            tlgPrimary={tlgPrimary}
            tlgAddon={tlgAddon}
            onChange={({ tlgPrimary: p, tlgAddon: a }) => { setTlgPrimary(p); setTlgAddon(a); }}
          />
          {naTlg && (
            <p className="text-xs text-slate-400 mt-2">TLG is marked as not applicable. No TLG will be saved.</p>
          )}
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Trainings</p>
            <ToggleSwitch checked={naTraining} onChange={handleNaTraining} label="N/A (not applicable)" />
          </div>

          <div className={`grid grid-cols-2 gap-4 transition-opacity ${
            naTraining ? 'opacity-40 pointer-events-none select-none' : ''
          }`}>
            <div className="flex flex-col">
              <label className="text-xs text-slate-500 block mb-1">Recommended Primary Training</label>
              {selectedProfile && !naTraining && (
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-xs">
                    <span className="text-indigo-400 uppercase text-[10px] font-semibold">PLY</span>
                    {selectedProfile.profile_name}
                    <button onClick={() => setRecommendedId('')} className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none">&times;</button>
                  </span>
                </div>
              )}
              <input className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1" placeholder="Search primary trainings..."
                value={primarySearch} onChange={e => setPrimarySearch(e.target.value)} disabled={naTraining} />
              <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '11rem' }}>
                {filteredProfiles.length === 0 && <p className="text-xs text-slate-400 text-center py-3">No primary trainings found</p>}
                {filteredProfiles.map(p => (
                  <label key={p.id} className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 ${
                    naTraining ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'
                  } ${String(p.id) === recommendedId ? 'bg-indigo-50' : ''}`}>
                    <input type="radio" name="recommended_training_id" checked={String(p.id) === recommendedId}
                      disabled={naTraining} onChange={() => setRecommendedId(String(p.id))} />
                    <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">PLY</span>
                    <span className="text-xs text-slate-700">{p.profile_name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-xs text-slate-500 block mb-1">Complementary Trainings</label>
              {complementaryItems.length > 0 && !naTraining && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {complementaryItems.map(i => (
                    <span key={`${i.type}-${i.id}`} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                      <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : 'MOD'}</span>
                      {i.title}
                      <button onClick={() => toggleComp(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <input className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1" placeholder="Search modules or curricula..."
                value={itemSearch} onChange={e => setItemSearch(e.target.value)} disabled={naTraining} />
              <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '11rem' }}>
                {filteredItems.length === 0 && <p className="text-xs text-slate-400 text-center py-3">No modules or curricula found</p>}
                {filteredItems.map(item => (
                  <label key={`${item.type}-${item.id}`} className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 ${
                    naTraining ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'
                  } ${complementaryItems.some(i => i.type === item.type && i.id === item.id) ? 'bg-blue-50' : ''}`}>
                    <input type="checkbox"
                      checked={complementaryItems.some(i => i.type === item.type && i.id === item.id)}
                      disabled={naTraining} onChange={() => toggleComp(item)} className="rounded" />
                    <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">{item.type === 'curriculum' ? 'CUR' : 'MOD'}</span>
                    <span className="text-xs text-slate-700">{item.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {naTraining && (
            <p className="text-xs text-slate-400 mt-2">Training is marked as not applicable. No primary or complementary training will be saved.</p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave({
              na_tlg: naTlg,
              tlg_primary: naTlg ? '' : tlgPrimary,
              tlg_addon: naTlg ? [] : tlgAddon,
              na_training: naTraining,
              recommended_training_id: naTraining ? null : (recommendedId ? parseInt(recommendedId) : null),
              complementary_items: naTraining ? [] : complementaryItems,
            })}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar: row count + clickable chips
// ---------------------------------------------------------------------------
const STATUS_CHIPS = [
  {
    status:   'empty',
    bg:       'bg-red-50',
    border:   'border-red-200',
    text:     'text-red-600',
    activeBg: 'bg-red-100',
    label:    'No primary training set',
  },
  {
    status:   'unresolved',
    bg:       'bg-orange-50',
    border:   'border-orange-200',
    text:     'text-orange-600',
    activeBg: 'bg-orange-100',
    label:    'Primary training not matched',
  },
  {
    status:   'comp-unresolved',
    bg:       'bg-yellow-50',
    border:   'border-yellow-200',
    text:     'text-yellow-700',
    activeBg: 'bg-yellow-100',
    label:    'Complementary not matched',
  },
  {
    status:   'na',
    bg:       'bg-slate-100',
    border:   'border-slate-300',
    text:     'text-slate-500',
    activeBg: 'bg-slate-200',
    label:    'N/A',
  },
];

function StatusBar({ counts, activeStatus, onToggle, totalShown, totalAll }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3 shrink-0">
      <span className="text-xs text-slate-400 shrink-0">{totalShown} rows</span>
      <span className="text-slate-200 text-xs select-none">|</span>
      {STATUS_CHIPS.map(({ status, bg, border, text, activeBg, label }) => {
        const count  = counts[status] || 0;
        const active = activeStatus === status;
        if (count === 0) return null;
        return (
          <button
            key={status}
            onClick={() => onToggle(status)}
            title={active ? 'Clear filter' : `Show only: ${label}`}
            className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${border} ${text} ${
              active ? activeBg : bg
            } cursor-pointer`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${ active ? '' : 'opacity-50'}`} />
            {label}
            <span className="font-semibold">{count}</span>
            {active && <span className="ml-0.5 opacity-60">&times;</span>}
          </button>
        );
      })}
      {activeStatus !== null && (
        <button
          onClick={() => onToggle(null)}
          className="text-xs text-slate-400 hover:text-slate-600 underline"
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function RoleMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [editMode,      setEditMode]      = useState(false);
  const [selectedFn,    setSelectedFn]    = useState(null);
  const [selectedRole,  setSelectedRole]  = useState(null);
  const [selectedInfo,  setSelectedInfo]  = useState([]);
  const [statusFilter,  setStatusFilter]  = useState(null);
  const [modalEntry,    setModalEntry]    = useState(null);
  const [importError,   setImportError]   = useState('');
  const [importStats,   setImportStats]   = useState(null);
  const [addModalType,  setAddModalType]  = useState(null);

  const dimKey    = ['role-matrix-dimensions', projectId];
  const matrixKey = ['role-matrix', projectId];

  const { data: dimensions = { functions: [], roles: [], info_keys: [] } } = useQuery({
    queryKey: dimKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/dimensions`).then(r => r.data),
    staleTime: 0,
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: matrixKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data),
    staleTime: 0,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['role-matrix-profiles', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/training-profiles`).then(r => r.data),
  });

  const { data: complementaryOptions = { modules: [], curricula: [] } } = useQuery({
    queryKey: ['role-matrix-complementary', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/complementary-options`).then(r => r.data),
  });

  const addDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.post(`/projects/${projectId}/role-matrix/dimensions`, { type, value }).then(r => r.data),
    onSuccess: (data, variables) => {
      qc.setQueryData(dimKey, data);
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
      if (variables.type === 'function') setSelectedFn(variables.value);
      if (variables.type === 'role')     setSelectedRole(variables.value);
      if (variables.type === 'info_key') setSelectedInfo(prev => [...prev, variables.value]);
    },
    onError: err => console.error('Failed to add dimension:', err),
  });

  const removeDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.delete(`/projects/${projectId}/role-matrix/dimensions`, { data: { type, value } }).then(r => r.data),
    onSuccess: (data, variables) => {
      qc.setQueryData(dimKey, data);
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
      if (variables.type === 'function' && selectedFn === variables.value)   setSelectedFn(null);
      if (variables.type === 'role'     && selectedRole === variables.value) setSelectedRole(null);
      if (variables.type === 'info_key') setSelectedInfo(prev => prev.filter(v => v !== variables.value));
    },
    onError: err => console.error('Failed to remove dimension:', err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      client.put(`/projects/${projectId}/role-matrix/${id}`, data).then(r => r.data),
    onSuccess: updated => {
      qc.setQueryData(matrixKey, (old = []) => old.map(row => row.id === updated.id ? updated : row));
      setModalEntry(null);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => client.delete(`/projects/${projectId}/role-matrix`).then(r => r.data),
    onSuccess: () => {
      qc.setQueryData(dimKey, { functions: [], roles: [], info_keys: [] });
      qc.setQueryData(matrixKey, []);
      setImportStats(null);
      setSelectedFn(null);
      setSelectedRole(null);
      setSelectedInfo([]);
      setStatusFilter(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: payload =>
      client.post(`/projects/${projectId}/role-matrix/import`, payload).then(r => r.data),
    onSuccess: data => {
      setImportError('');
      setImportStats(data);
      qc.refetchQueries({ queryKey: dimKey, exact: true });
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
    },
    onError: err => setImportError(err?.response?.data?.error || err.message || 'Import failed'),
  });

  function handleExport() {
    const data = entries.map(e => {
      const row = { Function: e.function, Role: e.role };
      for (const k of dimensions.info_keys) row[`Additional Info ${k}`] = e.additional_info?.[k] ? 'Yes' : 'No';
      row['Concatenate'] = '';
      const rec = profiles.find(p => p.id === e.recommended_training_id);
      const compTitles = Array.isArray(e.complementary_items) ? e.complementary_items.map(i => i.title) : [];
      row['PDM Role']  = e.na_training ? 'N/A' : [rec ? rec.profile_name : '', ...compTitles].filter(Boolean).join(' + ');
      row['TLG Group'] = e.na_tlg ? 'N/A' : [e.tlg_primary || '', ...(Array.isArray(e.tlg_addon) ? e.tlg_addon : [])].filter(Boolean).join(' + ');
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
      } catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleClearAll() {
    if (clearAllMutation.isPending) return;
    if (window.confirm('Empty the entire role matrix including all dimensions? This cannot be undone.'))
      clearAllMutation.mutate();
  }

  const dimFilteredEntries = useMemo(() => {
    let rows = entries;
    if (selectedFn)           rows = rows.filter(r => r.function === selectedFn);
    if (selectedRole)         rows = rows.filter(r => r.role === selectedRole);
    if (selectedInfo.length > 0)
      rows = rows.filter(r => selectedInfo.every(k => r.additional_info && r.additional_info[k]));
    return rows;
  }, [entries, selectedFn, selectedRole, selectedInfo]);

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const e of dimFilteredEntries) {
      const s = rowStatus(e);
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [dimFilteredEntries]);

  const filteredEntries = useMemo(() => {
    if (!statusFilter) return dimFilteredEntries;
    return dimFilteredEntries.filter(e => rowStatus(e) === statusFilter);
  }, [dimFilteredEntries, statusFilter]);

  function handleStatusToggle(status) {
    setStatusFilter(prev => (prev === status ? null : status));
  }

  const isDimPending = addDimMutation.isPending || removeDimMutation.isPending;

  // Shared th style: shrink-to-content, no wrap
  const thFit  = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';
  // Complementary th: grows to fill remaining space
  const thComp = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap w-full';

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

      {addModalType && (
        <AddDimModal
          label={addModalType === 'function' ? 'Function' : addModalType === 'role' ? 'Role' : 'Info Key'}
          badge={addModalType === 'function' ? 'FNC' : addModalType === 'role' ? 'ROL' : 'INF'}
          existing={
            addModalType === 'function' ? dimensions.functions
            : addModalType === 'role'   ? dimensions.roles
            : dimensions.info_keys
          }
          onAdd={value => addDimMutation.mutate({ type: addModalType, value })}
          onClose={() => setAddModalType(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">{entries.length} rules</p>
        </div>
        <div className="flex gap-3 items-center flex-wrap justify-end">
          {editMode && (
            <button onClick={handleClearAll} disabled={clearAllMutation.isPending}
              className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40">
              {clearAllMutation.isPending ? 'Emptying...' : 'Empty matrix'}
            </button>
          )}
          <ToggleSwitch checked={editMode} onChange={setEditMode} label="Edit mode" />
          <button onClick={() => fileRef.current.click()} disabled={importMutation.isPending}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importMutation.isPending ? 'Importing...' : 'Import Excel'}
          </button>
          <button onClick={handleExport} disabled={entries.length === 0}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Export Excel</button>
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
      {isDimPending && <p className="text-xs text-blue-500 mb-2">Updating matrix...</p>}

      {/* 3-panel selector */}
      <div className="grid grid-cols-3 gap-4 mb-4 shrink-0" style={{ height: '16rem' }}>
        <SelectorPanel title="Function" badge="FNC" items={dimensions.functions}
          selected={selectedFn} multi={false} onChange={v => { setSelectedFn(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('function')}
          onRemove={v => removeDimMutation.mutate({ type: 'function', value: v })}
          editMode={editMode} />
        <SelectorPanel title="Role" badge="ROL" items={dimensions.roles}
          selected={selectedRole} multi={false} onChange={v => { setSelectedRole(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('role')}
          onRemove={v => removeDimMutation.mutate({ type: 'role', value: v })}
          editMode={editMode} />
        <SelectorPanel title="Additional Info" badge="INF" items={dimensions.info_keys}
          selected={selectedInfo} multi={true} onChange={v => { setSelectedInfo(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('info_key')}
          onRemove={v => removeDimMutation.mutate({ type: 'info_key', value: v })}
          editMode={editMode} />
      </div>

      {/* Status bar */}
      <StatusBar
        counts={statusCounts}
        activeStatus={statusFilter}
        onToggle={handleStatusToggle}
        totalShown={filteredEntries.length}
        totalAll={dimFilteredEntries.length}
      />

      {/* Table
          - table-auto: columns size to content by default
          - Function / Role / info / Primary / TLG cols: whitespace-nowrap = shrink-to-content
          - Complementary: w-full so it absorbs the remaining space; internal overflow-x with nowrap chips
      */}
      <div className="overflow-auto rounded-xl border bg-white flex-1">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'auto' }}>
          <thead className="sticky top-0 z-10 bg-slate-50 border-b">
            <tr>
              <th className={thFit}>Function</th>
              <th className={thFit}>Role</th>
              {dimensions.info_keys.map(k => (
                <th
                  key={k}
                  title={k}
                  style={{ width: 32, minWidth: 32, maxWidth: 32 }}
                  className="px-0 pb-2 pt-3 text-center align-bottom"
                >
                  <span
                    style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      display: 'inline-block',
                      maxHeight: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#94a3b8',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {k}
                  </span>
                </th>
              ))}
              <th className={thFit}>Primary Training</th>
              {/* Complementary: w-full makes it absorb all leftover space */}
              <th className={thComp}>Complementary</th>
              <th className={thFit}>TLG Group</th>
              <th className={thFit}>TLG Add-on</th>
              <th className="px-2 py-2 whitespace-nowrap" style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6 + dimensions.info_keys.length} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
            )}
            {!isLoading && filteredEntries.length === 0 && (
              <tr><td colSpan={6 + dimensions.info_keys.length} className="px-3 py-8 text-center text-slate-400">
                {entries.length === 0
                  ? dimensions.functions.length === 0 || dimensions.roles.length === 0
                    ? 'Add at least one function and one role to generate matrix rows.'
                    : 'Import an Excel file or add dimensions above to get started.'
                  : 'No rows match the current selection.'}
              </td></tr>
            )}
            {filteredEntries.map(entry => {
              const status    = rowStatus(entry);
              const rec       = profiles.find(p => p.id === entry.recommended_training_id);
              const compItems = Array.isArray(entry.complementary_items) ? entry.complementary_items : [];
              return (
                <tr
                  key={entry.id}
                  className={`border-b ${ROW_BG[status]} ${ROW_HOVER[status]}`}
                >
                  {/* Shrink-to-content cells */}
                  <td className="px-3 py-2 text-xs font-medium text-slate-700 whitespace-nowrap">{entry.function}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{entry.role}</td>
                  {dimensions.info_keys.map(k => (
                    <td key={k} className="py-2 text-center" style={{ width: 32, minWidth: 32, maxWidth: 32 }}>
                      <span className={`text-xs font-medium ${
                        entry.additional_info?.[k] ? 'text-blue-600' : 'text-slate-300'
                      }`}>
                        {entry.additional_info?.[k] ? 'Y' : 'N'}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.na_training
                      ? <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">N/A</span>
                      : rec
                        ? <span className="text-xs text-indigo-700 font-medium">{rec.profile_name}</span>
                        : entry.primary_training_name
                          ? <span className="text-xs text-amber-600 font-medium" title="Not yet matched">{entry.primary_training_name}</span>
                          : <span className="text-xs text-slate-300">-</span>}
                  </td>
                  {/* Complementary: fills remaining space, chips scroll horizontally when overflow */}
                  <td className="px-2 py-2" style={{ minWidth: 180 }}>
                    {entry.na_training || compItems.length === 0
                      ? <span className="text-xs text-slate-300">-</span>
                      : (
                        <div className="flex gap-1 items-center overflow-x-auto" style={{ whiteSpace: 'nowrap' }}>
                          {compItems.filter(i => i.type !== 'unresolved').map(i => (
                            <span key={`${i.type}-${i.id}`} className="inline-flex shrink-0 items-center text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                              {i.title}
                            </span>
                          ))}
                          {compItems.filter(i => i.type === 'unresolved').map((i, idx) => (
                            <span key={`unresolved-${idx}`} title="Not matched"
                              className="inline-flex shrink-0 items-center text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5">
                              {i.title}
                            </span>
                          ))}
                        </div>
                      )
                    }
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.na_tlg
                      ? <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">N/A</span>
                      : entry.tlg_primary
                        ? <span className="text-xs font-medium text-slate-800">{entry.tlg_primary}</span>
                        : <span className="text-xs text-slate-300">-</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.na_tlg
                      ? <span className="text-xs text-slate-300">-</span>
                      : <div className="flex gap-1">
                          {(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : []).map(a => (
                            <span key={a} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 rounded px-1.5 py-0.5 whitespace-nowrap">{a}</span>
                          ))}
                        </div>}
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => setModalEntry(entry)} className="text-xs text-slate-400 hover:text-blue-600">Fill</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
