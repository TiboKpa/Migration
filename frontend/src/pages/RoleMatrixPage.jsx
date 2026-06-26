import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams }          from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

// ---------------------------------------------------------------------------
// Helpers / tiny shared components
// ---------------------------------------------------------------------------

function Badge({ color = 'slate', children }) {
  const map = {
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
    blue:   'bg-blue-50  text-blue-700  border-blue-200',
    green:  'bg-green-50 text-green-700 border-green-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    red:    'bg-red-50   text-red-700   border-red-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[color] ?? map.slate}`}>
      {children}
    </span>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${checked ? 'bg-blue-600' : 'bg-slate-200'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${checked ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
      </button>
      {label && <span className="text-xs text-slate-500">{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// TLG Group selector (reused in EditModal)
// ---------------------------------------------------------------------------

const TLG_OPTIONS = ['EMEA', 'NA', 'APAC', 'LATAM', 'MEA', 'Global'];

function TlgGroupSelector({ naTlg, onNaTlgChange, tlgPrimary, tlgAddon, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">TLG Group</p>
        <ToggleSwitch checked={naTlg} onChange={onNaTlgChange} label="N/A (not applicable)" />
      </div>
      {!naTlg && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Primary</label>
            <select
              value={tlgPrimary}
              onChange={e => onChange({ tlgPrimary: e.target.value, tlgAddon })}
              className="border rounded-lg px-2 py-1.5 text-xs w-full"
            >
              <option value="">— None —</option>
              {TLG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Add-ons</label>
            <div className="border rounded-lg p-1.5 flex flex-wrap gap-1">
              {TLG_OPTIONS.filter(o => o !== tlgPrimary).map(o => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    const next = tlgAddon.includes(o) ? tlgAddon.filter(x => x !== o) : [...tlgAddon, o];
                    onChange({ tlgPrimary, tlgAddon: next });
                  }}
                  className={`text-[11px] rounded px-1.5 py-0.5 border transition-colors ${
                    tlgAddon.includes(o) ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {o}
                </button>
              ))}
              {TLG_OPTIONS.filter(o => o !== tlgPrimary).length === 0 && (
                <p className="text-[11px] text-slate-400">No options available</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Three-state info key button
// ---------------------------------------------------------------------------

function InfoStateButton({ label, value, onChange }) {
  // value: null = unset, true = yes, false = no
  const states = [null, true, false];
  const idx = states.indexOf(value);
  const next = states[(idx + 1) % 3];

  const style = value === true
    ? 'bg-blue-600 text-white border-blue-600'
    : value === false
      ? 'bg-slate-100 text-slate-400 border-slate-200 line-through'
      : 'bg-white text-slate-600 border-slate-300';

  return (
    <button
      onClick={() => onChange(next)}
      title={`Link ${label} to complementary trainings`}
      className={`text-xs rounded-full px-2.5 py-1 border font-medium transition-colors ${style}`}
    >
      {label}
      {value === true && <span className="ml-1 opacity-70">Yes</span>}
      {value === false && <span className="ml-1 opacity-70">No</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// InfoKeyLinkModal
//
// Used at import time (one per info key) AND for editing existing links from
// the sidebar.
//
// Props:
//   infoKey               string   name of the info key (e.g. "PDM Champion")
//   complementaryOptions  { modules, curricula }
//   initialItems          ComplementaryItem[]  already-saved items (pre-selected)
//   autoMatchedNames      string[]             names auto-matched from Training Matrix
//   onSave(items)         fn
//   onClose               fn
// ---------------------------------------------------------------------------
function InfoKeyLinkModal({ infoKey, complementaryOptions, initialItems, autoMatchedNames, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
  ];

  const [selected, setSelected] = useState(() => {
    if (initialItems && initialItems.length > 0) return initialItems;
    if (autoMatchedNames && autoMatchedNames.length > 0) {
      return allItems.filter(i => autoMatchedNames.some(n => n.toLowerCase() === i.title.toLowerCase()))
        .map(i => ({ type: i.type, id: i.id, title: i.title }));
    }
    return [];
  });
  const [search, setSearch]     = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = allItems.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));

  function toggle(item) {
    setSelected(prev => {
      const exists = prev.some(s => s.type === item.type && s.id === item.id);
      return exists
        ? prev.filter(s => !(s.type === item.type && s.id === item.id))
        : [...prev, { type: item.type, id: item.id, title: item.title }];
    });
  }

  const hasAutoMatch = autoMatchedNames && autoMatchedNames.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-800">
            Link tag to complementary trainings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        <div className="mb-3">
          <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7.5 3.5"/>
              <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/>
            </svg>
            {infoKey}
          </span>
        </div>

        {hasAutoMatch && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs font-semibold text-green-700 mb-1">Auto-matched from Training Matrix</p>
            <div className="flex flex-wrap gap-1">
              {autoMatchedNames.map(n => (
                <span key={n} className="text-[11px] bg-green-100 text-green-700 border border-green-200 rounded px-1.5 py-0.5">{n}</span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500 mb-2">
          Select trainings to link when this tag is <strong>Yes</strong>.
        </p>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selected.map(i => (
              <span key={`${i.type}-${i.id}`}
                className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : 'MOD'}</span>
                {i.title}
                <button onClick={() => toggle(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
              </span>
            ))}
          </div>
        )}

        <input
          className="border rounded-lg px-3 py-1.5 text-xs w-full mb-1"
          placeholder="Search modules or curricula..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        <div className="border rounded-lg overflow-y-auto mb-4" style={{ maxHeight: '12rem' }}>
          {filtered.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-3">No modules or curricula found</p>
          )}
          {filtered.map(item => {
            const checked = selected.some(s => s.type === item.type && s.id === item.id);
            return (
              <label key={`${item.type}-${item.id}`}
                className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(item)} className="rounded" />
                <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">
                  {item.type === 'curriculum' ? 'CUR' : 'MOD'}
                </span>
                <span className="text-xs text-slate-700">{item.title}</span>
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="border px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">
            Skip
          </button>
          <button
            onClick={() => onSave(selected)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-dimension modal
// ---------------------------------------------------------------------------
function AddDimModal({ label, badge, existing, onAdd, onClose }) {
  const [search, setSearch] = useState('');
  const trimmed = search.trim();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Add {label}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>
        <input
          className="border rounded-lg px-3 py-1.5 text-xs w-full mb-3"
          placeholder={`${label} name...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && trimmed) { onAdd(trimmed); onClose(); } }}
          autoFocus
        />
        {trimmed && existing.some(x => x.toLowerCase() === trimmed.toLowerCase()) && (
          <p className="text-xs text-red-500 mb-2">Already exists.</p>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="border px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            disabled={!trimmed || existing.some(x => x.toLowerCase() === trimmed.toLowerCase())}
            onClick={() => { if (trimmed) { onAdd(trimmed); onClose(); } }}
            className="bg-blue-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selector panel (Function / Role)
// ---------------------------------------------------------------------------

function SelectorPanel({ title, badge, items, selected, multi, onChange, onAddNew, onRemove, editMode }) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(i => i.toLowerCase().includes(search.toLowerCase()));

  function handleClick(item) {
    if (multi) {
      if (Array.isArray(selected)) {
        onChange(selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item]);
      } else {
        onChange([item]);
      }
    } else {
      onChange(selected === item ? null : item);
    }
  }

  const isSelected = item => multi
    ? (Array.isArray(selected) && selected.includes(item))
    : selected === item;

  return (
    <div className="bg-white border rounded-xl p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {editMode && (
          <button onClick={onAddNew} className="text-[11px] text-blue-600 hover:underline">+ Add</button>
        )}
      </div>
      {items.length > 6 && (
        <input
          className="border rounded px-2 py-1 text-xs"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}
      <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '10rem' }}>
        {filtered.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center py-2">Nothing here yet</p>
        )}
        {filtered.map(item => (
          <div key={item} className="flex items-center gap-1 group">
            <button
              onClick={() => handleClick(item)}
              className={`flex-1 text-left text-xs px-2 py-1 rounded-lg transition-colors ${
                isSelected(item) ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <span className={`inline-block mr-1.5 text-[9px] font-bold uppercase ${isSelected(item) ? 'text-blue-300' : 'text-slate-400'}`}>{badge}</span>
              {item}
            </button>
            {editMode && (
              <button
                onClick={() => onRemove(item)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 text-xs px-1 transition-opacity"
                title={`Remove ${item}`}
              >×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tags filter panel (three-state per key)
// ---------------------------------------------------------------------------

function InfoFilterPanel({ title, infoKeys, selectedInfo, onChange, onAddNew, onRemove, editMode, onEditLink }) {
  function clearAll() {
    const cleared = {};
    for (const k of infoKeys) cleared[k] = null;
    onChange(cleared);
  }

  const hasAnySelection = Object.values(selectedInfo).some(v => v !== null);

  return (
    <div className="bg-white border rounded-xl p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        <div className="flex items-center gap-2">
          {hasAnySelection && (
            <button onClick={clearAll} className="text-[11px] text-slate-400 hover:text-slate-600">Clear</button>
          )}
          {editMode && (
            <button onClick={onAddNew} className="text-[11px] text-blue-600 hover:underline">+ Add</button>
          )}
        </div>
      </div>
      {infoKeys.length === 0 && (
        <p className="text-[11px] text-slate-400 text-center py-3">No tags yet</p>
      )}
      {infoKeys.map(k => (
        <div key={k} className="flex items-center gap-1.5 group">
          <InfoStateButton
            label={k}
            value={selectedInfo[k] ?? null}
            onChange={v => onChange({ ...selectedInfo, [k]: v })}
          />
          {editMode && (
            <>
              <button
                onClick={() => onEditLink(k)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-blue-500 text-xs transition-opacity"
                title="Edit linked trainings"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7.5 3.5"/>
                  <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/>
                </svg>
              </button>
              <button
                onClick={() => onRemove(k)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 text-xs px-0.5 transition-opacity"
                title={`Remove ${k}`}
              >×</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit-entry modal
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
            {/* Primary training */}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Primary Training</label>
              {selectedProfile && (
                <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mb-1.5">
                  <span className="text-xs text-blue-700 flex-1">{selectedProfile.profile_name}</span>
                  <button onClick={() => setRecommendedId('')} className="text-blue-400 hover:text-blue-700 text-sm leading-none">&times;</button>
                </div>
              )}
              <input
                className="border rounded-lg px-2 py-1 text-xs w-full mb-1"
                placeholder="Search profiles..."
                value={primarySearch}
                onChange={e => setPrimarySearch(e.target.value)}
              />
              <div className="border rounded-lg overflow-y-auto" style={{ maxHeight: '9rem' }}>
                {filteredProfiles.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No profiles</p>}
                {filteredProfiles.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setRecommendedId(String(p.id))}
                    className={`w-full text-left text-xs px-3 py-1.5 border-b last:border-0 transition-colors ${
                      String(p.id) === recommendedId ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {p.profile_name}
                  </button>
                ))}
              </div>
            </div>

            {/* Complementary trainings */}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Complementary Trainings</label>
              {complementaryItems.length > 0 && !naTraining && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {complementaryItems.map(i => (
                    <span key={`${i.type}-${i.id}`}
                      className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                      <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : 'MOD'}</span>
                      {i.title}
                      <button onClick={() => toggleComp(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                className="border rounded-lg px-2 py-1 text-xs w-full mb-1"
                placeholder="Search items..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
              />
              <div className="border rounded-lg overflow-y-auto" style={{ maxHeight: '9rem' }}>
                {filteredItems.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No items</p>}
                {filteredItems.map(item => (
                  <label key={`${item.type}-${item.id}`}
                    className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${ complementaryItems.some(i => i.type === item.type && i.id === item.id) ? 'bg-blue-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={complementaryItems.some(i => i.type === item.type && i.id === item.id)}
                      onChange={() => toggleComp(item)}
                      className="rounded"
                    />
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

        <div className="flex justify-end gap-2 pt-2 border-t">
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
// Status legend
// ---------------------------------------------------------------------------

const STATUS_CONFIGS = [
  { status: 'complete',        bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  activeBg: 'bg-green-100',  label: 'Complete' },
  { status: 'primary-only',    bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   activeBg: 'bg-blue-100',   label: 'Primary only' },
  { status: 'comp-unresolved', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', activeBg: 'bg-yellow-100', label: 'Complementary training not matched' },
  { status: 'partial',         bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  activeBg: 'bg-amber-100',  label: 'Partially filled' },
  { status: 'empty',           bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-500',  activeBg: 'bg-slate-100',  label: 'Empty' },
  { status: 'na',              bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-400',  activeBg: 'bg-slate-100',  label: 'N/A' },
];

function getEntryStatus(entry) {
  if (entry.na_training) return 'na';
  const hasRec  = !!entry.recommended_training_id;
  const hasComp = Array.isArray(entry.complementary_items) && entry.complementary_items.length > 0;
  const hasUnresolved = Array.isArray(entry.complementary_items) && entry.complementary_items.some(i => !i.id);
  if (hasUnresolved) return 'comp-unresolved';
  if (hasRec && hasComp) return 'complete';
  if (hasRec) return 'primary-only';
  if (hasComp) return 'partial';
  return 'empty';
}

function StatusBar({ counts, active, onFilter }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {STATUS_CONFIGS.map(cfg => {
        const count = counts[cfg.status] ?? 0;
        if (count === 0) return null;
        const isActive = active === cfg.status;
        return (
          <button
            key={cfg.status}
            onClick={() => onFilter(isActive ? null : cfg.status)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors
              ${isActive ? `${cfg.activeBg} ${cfg.border} ${cfg.text}` : `${cfg.bg} ${cfg.border} ${cfg.text} opacity-70 hover:opacity-100`}`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.bg.replace('bg-', 'bg-').replace('-50', '-400')}`} />
            {cfg.label}
            <span className="font-bold">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers for normalizing API data
// ---------------------------------------------------------------------------

function normalizeDimensions(data) {
  if (!data || typeof data !== 'object') return { functions: [], roles: [], info_keys: [] };
  return {
    functions: Array.isArray(data.functions) ? data.functions : [],
    roles:     Array.isArray(data.roles)     ? data.roles     : [],
    info_keys: Array.isArray(data.info_keys) ? data.info_keys : [],
  };
}

// ---------------------------------------------------------------------------
// Build the list of info keys that need a link modal during import.
//
// Matching logic:
//   The column header "Additional Info PDM Champion" produces the info key
//   "PDM Champion". The modal is shown for every info key where at least one
//   row has that key = true with a non-N/A primary column.
//
//   The name used for auto-matching in the Training Matrix is the info key
//   name itself (e.g. "PDM Champion"). If a module, curriculum, or training
//   exists in the Training Matrix with that exact name (case-insensitive), it
//   is pre-selected in the modal and shown in the green auto-matched banner.
//
//   The user can keep the pre-selection, deselect it, or add more items.
// ---------------------------------------------------------------------------
function buildInfoKeyQueue(infoKeys, entries, complementaryOptions) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
  ];

  const titleMap = new Map();
  for (const item of allItems) {
    titleMap.set(item.title.trim().toLowerCase(), item);
  }

  const queue = [];

  for (const key of infoKeys) {
    // Only show modal when at least one row has this key = true with non-N/A primary
    const hasRelevantRow = entries.some(e =>
      e.additional_info?.[key] === true && !e.na_training
    );
    if (!hasRelevantRow) continue;

    // Auto-match: search the Training Matrix for an item whose title matches
    // the info key name exactly (case-insensitive).
    const matchedItem = titleMap.get(key.trim().toLowerCase()) || null;
    const autoMatchedNames = matchedItem ? [matchedItem.title] : [];
    const initialItems     = matchedItem
      ? [{ type: matchedItem.type, id: matchedItem.id, title: matchedItem.title }]
      : [];

    queue.push({ key, autoMatchedNames, initialItems });
  }

  return queue;
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
  const [selectedInfo,  setSelectedInfo]  = useState({});
  const [statusFilter,  setStatusFilter]  = useState(null);
  const [modalEntry,    setModalEntry]    = useState(null);
  const [importError,   setImportError]   = useState('');
  const [importStats,   setImportStats]   = useState(null);
  const [addModalType,  setAddModalType]  = useState(null);
  const [sortState,     setSortState]     = useState({ col: null, dir: 'asc' });

  // Info-key link modal state
  // linkModalQueue: array of { key, autoMatchedNames, initialItems }
  // linkModalIdx:   current index in the queue
  // linkEditKey:    non-null when editing an existing link from the sidebar
  const [linkModalQueue, setLinkModalQueue] = useState([]);
  const [linkModalIdx,   setLinkModalIdx]   = useState(0);
  const [linkEditKey,    setLinkEditKey]    = useState(null);
  // Pending entries to import after the queue is done
  const [pendingImport,  setPendingImport]  = useState(null);

  const dimKey    = ['role-matrix-dimensions', projectId];
  const matrixKey = ['role-matrix', projectId];
  const linksKey  = ['role-matrix-info-key-links', projectId];

  const { data: dimensions } = useQuery({
    queryKey: dimKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/dimensions`).then(r => normalizeDimensions(r.data)),
  });

  const safeDimensions = dimensions ?? { functions: [], roles: [], info_keys: [] };

  // Keep selectedInfo keys in sync with info_keys dimension
  useEffect(() => {
    setSelectedInfo(prev => {
      const next = {};
      for (const k of safeDimensions.info_keys) next[k] = prev[k] ?? null;
      return next;
    });
  }, [JSON.stringify(safeDimensions.info_keys)]);

  const { data: matrixEntries = [] } = useQuery({
    queryKey: matrixKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data),
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['role-matrix-profiles', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/profiles`).then(r => r.data),
  });

  const { data: complementaryOptions = { modules: [], curricula: [] } } = useQuery({
    queryKey: ['role-matrix-complementary', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/complementary-options`).then(r => r.data),
  });

  // Saved info-key links: Record<infoKey, ComplementaryItem[]>
  const { data: infoKeyLinks = {} } = useQuery({
    queryKey: linksKey,
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/info-key-links`).then(r => r.data),
  });

  const saveInfoKeyLinkMutation = useMutation({
    mutationFn: ({ infoKey, complementary_items }) =>
      client.put(`/projects/${projectId}/role-matrix/info-key-links/${encodeURIComponent(infoKey)}`, { complementary_items }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: linksKey });
      qc.invalidateQueries({ queryKey: matrixKey });
    },
  });

  const addDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.post(`/projects/${projectId}/role-matrix/dimensions`, { type, value }).then(r => r.data),
    onSuccess: (data, variables) => {
      qc.setQueryData(dimKey, normalizeDimensions(data));
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
      if (variables.type === 'function') setSelectedFn(variables.value);
      if (variables.type === 'role')     setSelectedRole(variables.value);
      if (variables.type === 'info_key') setSelectedInfo(prev => ({ ...prev, [variables.value]: null }));
    },
    onError: err => console.error('Failed to add dimension:', err),
  });

  const removeDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.delete(`/projects/${projectId}/role-matrix/dimensions`, { data: { type, value } }).then(r => r.data),
    onSuccess: (data, variables) => {
      qc.setQueryData(dimKey, normalizeDimensions(data));
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
      if (variables.type === 'function') setSelectedFn(null);
      if (variables.type === 'role')     setSelectedRole(null);
      if (variables.type === 'info_key') setSelectedInfo(prev => { const next = { ...prev }; delete next[variables.value]; return next; });
    },
    onError: err => console.error('Failed to remove dimension:', err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      client.put(`/projects/${projectId}/role-matrix/${id}`, data).then(r => r.data),
    onSuccess: updated => {
      qc.setQueryData(matrixKey, old => {
        if (!Array.isArray(old)) return [updated];
        return old.map(row => row.id === updated.id ? updated : row);
      });
      setModalEntry(null);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => client.delete(`/projects/${projectId}/role-matrix`).then(r => r.data),
    onSuccess: () => {
      qc.setQueryData(dimKey, { functions: [], roles: [], info_keys: [] });
      qc.setQueryData(matrixKey, []);
      qc.setQueryData(linksKey, {});
      setImportStats(null);
      setSelectedFn(null);
      setSelectedRole(null);
      setSelectedInfo({});
      setStatusFilter(null);
      setSortState({ col: null, dir: 'asc' });
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ entries }) =>
      client.post(`/projects/${projectId}/role-matrix/import`, { entries }).then(r => r.data),
    onSuccess: data => {
      setImportStats(data);
      setImportError('');
      qc.refetchQueries({ queryKey: dimKey, exact: true });
      qc.refetchQueries({ queryKey: matrixKey, exact: true });
    },
    onError: err => setImportError(err?.response?.data?.error || err.message || 'Import failed'),
  });

  // After the link modal queue is resolved, run the actual import
  const runPendingImport = useCallback((entries) => {
    importMutation.mutate({ entries });
    setPendingImport(null);
  }, [importMutation]);

  // Advance through the link modal queue.
  // Called on each "Confirm" or "Skip" click.
  const advanceLinkQueue = useCallback((savedItems) => {
    const current = linkModalQueue[linkModalIdx];
    if (current && savedItems !== null) {
      saveInfoKeyLinkMutation.mutate({ infoKey: current.key, complementary_items: savedItems });
    }
    const nextIdx = linkModalIdx + 1;
    if (nextIdx < linkModalQueue.length) {
      setLinkModalIdx(nextIdx);
    } else {
      // Queue exhausted -- now run the import
      setLinkModalQueue([]);
      setLinkModalIdx(0);
      if (pendingImport) runPendingImport(pendingImport);
    }
  }, [linkModalQueue, linkModalIdx, pendingImport, runPendingImport, saveInfoKeyLinkMutation]);

  function handleExport() {
    const data = safeEntries.map(e => {
      const row = { Function: e.function, Role: e.role };
      for (const k of safeDimensions.info_keys) row[`Tag: ${k}`] = e.additional_info?.[k] ? 'Yes' : 'No';
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
    XLSX.writeFile(wb, 'role-matrix.xlsx');
  }

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError('');
    setImportStats(null);

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb   = XLSX.read(evt.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rows.length) { setImportError('No rows found in spreadsheet.'); return; }

        const headers = Object.keys(rows[0]);

        // Collect info keys directly from the parsed header structure.
        // A header like "Additional Info PDM Champion" -> info key "PDM Champion"
        const infoKeySet = new Set();
        for (const h of headers) {
          const m = h.match(/^(?:Additional Info|Tag:|Tags?:?)\s+(.+)$/i);
          if (m) infoKeySet.add(m[1].trim());
        }
        const infoKeys = [...infoKeySet];

        const entries = rows.map(row => {
          const additional_info = {};
          for (const h of headers) {
            const m = h.match(/^(?:Additional Info|Tag:|Tags?:?)\s+(.+)$/i);
            if (m) {
              const key = m[1].trim();
              const val = row[h];
              additional_info[key] = val === true || val === 1 || (typeof val === 'string' && val.trim().toLowerCase() === 'yes');
            }
          }
          const fn   = String(row['Function'] || '').trim();
          const role = String(row['Role']     || '').trim();
          if (!fn || !role) return null;

          const rawPdm   = String(row['PDM Role']  || '').trim();
          const rawTlg   = String(row['TLG Group'] || '').trim();
          const naTraining = rawPdm.toUpperCase() === 'N/A';
          const naTlg      = rawTlg.toUpperCase() === 'N/A';

          const pdmParts = naTraining ? [] : rawPdm.split('+').map(s => s.trim()).filter(Boolean);
          const tlgParts = naTlg      ? [] : rawTlg.split('+').map(s => s.trim()).filter(Boolean);

          return {
            function: fn,
            role,
            additional_info,
            na_training:      naTraining,
            recommended_name: pdmParts[0] || '',
            complementary_names: pdmParts.slice(1),
            na_tlg:           naTlg,
            tlg_primary:      tlgParts[0] || '',
            tlg_addon:        tlgParts.slice(1),
          };
        }).filter(Boolean);

        if (!entries.length) { setImportError('No valid rows found.'); return; }

        // Build the link modal queue for info keys that have at least one "Yes" row
        const queue = buildInfoKeyQueue(infoKeys, entries, complementaryOptions);
        if (queue.length > 0) {
          setPendingImport(entries);
          setLinkModalQueue(queue);
          setLinkModalIdx(0);
        } else {
          importMutation.mutate({ entries });
        }
      } catch (err) {
        setImportError(err.message || 'Failed to parse file');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleEditInfoKeyLink(key) {
    setLinkEditKey(key);
  }

  const safeEntries = Array.isArray(matrixEntries) ? matrixEntries : [];

  // Apply filters
  let filtered = safeEntries;
  if (selectedFn)   filtered = filtered.filter(e => e.function === selectedFn);
  if (selectedRole) filtered = filtered.filter(e => e.role === selectedRole);
  for (const [k, v] of Object.entries(selectedInfo)) {
    if (v !== null) filtered = filtered.filter(e => (e.additional_info?.[k] === true) === v);
  }
  if (statusFilter) filtered = filtered.filter(e => getEntryStatus(e) === statusFilter);

  // Sort
  if (sortState.col) {
    filtered = [...filtered].sort((a, b) => {
      let va, vb;
      if (sortState.col === 'function') { va = a.function; vb = b.function; }
      else if (sortState.col === 'role') { va = a.role; vb = b.role; }
      else if (sortState.col === 'status') { va = getEntryStatus(a); vb = getEntryStatus(b); }
      else if (sortState.col === 'complementary') {
        const ca = Array.isArray(a.complementary_items) ? a.complementary_items.map(i => i.title).join(' ') : '';
        const cb = Array.isArray(b.complementary_items) ? b.complementary_items.map(i => i.title).join(' ') : '';
        va = ca; vb = cb;
      } else {
        va = a.additional_info?.[sortState.col] ? '1' : '0';
        vb = b.additional_info?.[sortState.col] ? '1' : '0';
      }
      const cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      return sortState.dir === 'asc' ? cmp : -cmp;
    });
  }

  function toggleSort(col) {
    setSortState(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    );
  }

  const statusCounts = {};
  for (const e of safeEntries) {
    const s = getEntryStatus(e);
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  const currentLinkItem = linkModalQueue[linkModalIdx] ?? null;

  // Current item for the sidebar edit link modal
  const editLinkItem = linkEditKey
    ? { key: linkEditKey, initialItems: infoKeyLinks[linkEditKey] || [], autoMatchedNames: [] }
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Fill (edit) modal */}
      {modalEntry !== null && (
        <EditModal
          entry={modalEntry}
          profiles={profiles}
          complementaryOptions={complementaryOptions}
          onSave={data => updateMutation.mutate({ id: modalEntry.id, data })}
          onClose={() => setModalEntry(null)}
        />
      )}

      {/* Add dimension modal */}
      {addModalType && (
        <AddDimModal
          label={addModalType === 'function' ? 'Function' : addModalType === 'role' ? 'Role' : 'Tag'}
          badge={addModalType === 'function' ? 'FNC' : addModalType === 'role' ? 'ROL' : 'TAG'}
          existing={
            addModalType === 'function' ? safeDimensions.functions
            : addModalType === 'role'   ? safeDimensions.roles
            : safeDimensions.info_keys
          }
          onAdd={value => addDimMutation.mutate({ type: addModalType, value })}
          onClose={() => setAddModalType(null)}
        />
      )}

      {/* Import-time info-key link modal queue */}
      {currentLinkItem && (
        <InfoKeyLinkModal
          infoKey={currentLinkItem.key}
          complementaryOptions={complementaryOptions}
          initialItems={currentLinkItem.initialItems}
          autoMatchedNames={currentLinkItem.autoMatchedNames}
          onSave={items => advanceLinkQueue(items)}
          onClose={() => advanceLinkQueue(null)}
        />
      )}

      {/* Sidebar edit info-key link modal */}
      {editLinkItem && !currentLinkItem && (
        <InfoKeyLinkModal
          infoKey={editLinkItem.key}
          complementaryOptions={complementaryOptions}
          initialItems={editLinkItem.initialItems}
          autoMatchedNames={editLinkItem.autoMatchedNames}
          onSave={items => {
            saveInfoKeyLinkMutation.mutate({ infoKey: editLinkItem.key, complementary_items: items });
            setLinkEditKey(null);
          }}
          onClose={() => setLinkEditKey(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">{safeEntries.length} rules</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${editMode ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            {editMode ? 'Done editing' : 'Edit'}
          </button>
          {editMode && safeEntries.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Empty the entire role matrix including all dimensions? This cannot be undone.'))
                  clearAllMutation.mutate();
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
            >
              Clear all
            </button>
          )}
          <button onClick={handleExport} className="text-xs px-3 py-1.5 rounded-lg border text-slate-600 hover:bg-slate-50">
            Export
          </button>
          <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Import
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {importError && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 shrink-0">
          {importError}
        </div>
      )}

      {importStats && (
        <div className="mb-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-3 py-2 shrink-0">
          Imported {importStats.created} new + updated {importStats.updated} rows.
          {importStats.unresolved > 0 && ` ${importStats.unresolved} complementary trainings unresolved.`}
        </div>
      )}

      <div className="flex gap-3 mb-4 shrink-0 overflow-x-auto">
        <SelectorPanel title="Function" badge="FNC" items={safeDimensions.functions}
          selected={selectedFn} multi={false} onChange={v => { setSelectedFn(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('function')}
          onRemove={v => removeDimMutation.mutate({ type: 'function', value: v })}
          editMode={editMode} />
        <SelectorPanel title="Role" badge="ROL" items={safeDimensions.roles}
          selected={selectedRole} multi={false} onChange={v => { setSelectedRole(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('role')}
          onRemove={v => removeDimMutation.mutate({ type: 'role', value: v })}
          editMode={editMode} />
        <InfoFilterPanel
          title="Tags"
          infoKeys={safeDimensions.info_keys}
          selectedInfo={selectedInfo}
          onChange={v => { setSelectedInfo(v); setStatusFilter(null); }}
          onAddNew={() => setAddModalType('info_key')}
          onRemove={v => removeDimMutation.mutate({ type: 'info_key', value: v })}
          editMode={editMode}
          onEditLink={handleEditInfoKeyLink}
        />
      </div>

      {/* Status bar */}
      <StatusBar
        counts={statusCounts}
        active={statusFilter}
        onFilter={v => { setStatusFilter(v); }}
      />

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border bg-white min-h-0">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-slate-400">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/>
            </svg>
            <p className="text-sm font-medium">No entries</p>
            <p className="text-xs mt-1">Import a spreadsheet or adjust your filters</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b">
              <tr>
                {['function', 'role'].map(col => (
                  <th key={col}
                    onClick={() => toggleSort(col)}
                    className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap">
                    {col === 'function' ? 'Function' : 'Role'}
                    {sortState.col === col && <span className="ml-1">{sortState.dir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
                {safeDimensions.info_keys.map(k => (
                  <th key={k}
                    onClick={() => toggleSort(k)}
                    className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap">
                    {k}
                    {sortState.col === k && <span className="ml-1">{sortState.dir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
                <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">TLG</th>
                <th onClick={() => toggleSort('status')}
                  className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap">
                  Status
                  {sortState.col === 'status' && <span className="ml-1">{sortState.dir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Primary</th>
                <th onClick={() => toggleSort('complementary')}
                  className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none">
                  Complementary
                  {sortState.col === 'complementary' && <span className="ml-1">{sortState.dir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(entry => {
                const status = getEntryStatus(entry);
                const cfg = STATUS_CONFIGS.find(c => c.status === status);
                const rec = profiles.find(p => p.id === entry.recommended_training_id);
                return (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{entry.function}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{entry.role}</td>
                    {safeDimensions.info_keys.map(k => (
                      <td key={k} className="px-3 py-2 text-center">
                        {entry.additional_info?.[k]
                          ? <span className="inline-block w-2 h-2 rounded-full bg-blue-500" title="Yes" />
                          : <span className="inline-block w-2 h-2 rounded-full bg-slate-200" title="No" />
                        }
                      </td>
                    ))}
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {entry.na_tlg ? (
                        <Badge color="slate">N/A</Badge>
                      ) : (
                        <span>{[entry.tlg_primary, ...(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : [])].filter(Boolean).join(' + ') || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg?.bg} ${cfg?.border} ${cfg?.text}`}>
                        {cfg?.label ?? status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {entry.na_training ? <Badge color="slate">N/A</Badge> : (rec ? rec.profile_name : <span className="text-slate-300">—</span>)}
                    </td>
                    <td className="px-3 py-2">
                      {entry.na_training ? null : (
                        Array.isArray(entry.complementary_items) && entry.complementary_items.length > 0
                          ? <div className="flex flex-wrap gap-1">
                              {entry.complementary_items.map(i => (
                                <span key={`${i.type}-${i.id}`}
                                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${i.id ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
                                  {i.type === 'curriculum' ? 'CUR' : 'MOD'} {i.title}
                                  {!i.id && <span className="ml-1 text-red-400" title="Unresolved">!</span>}
                                </span>
                              ))}
                            </div>
                          : <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setModalEntry(entry)} className="text-xs text-slate-400 hover:text-blue-600">Fill</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
