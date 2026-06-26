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
//   complementaryOptions  { modules, curricula, playlists }
//   initialItems          ComplementaryItem[]  already-saved items (pre-selected)
//   autoMatchedNames      string[]             names auto-matched from Training Matrix
//   onSave(items)         fn
//   onClose               fn
// ---------------------------------------------------------------------------
function InfoKeyLinkModal({ infoKey, complementaryOptions, initialItems, autoMatchedNames, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
    ...(complementaryOptions.playlists ?? []).map(p => ({ ...p, type: 'playlist' })),
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
                <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : i.type === 'playlist' ? 'PLA' : 'MOD'}</span>
                {i.title}
                <button onClick={() => toggle(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
              </span>
            ))}
          </div>
        )}

        <input
          className="border rounded-lg px-3 py-1.5 text-xs w-full mb-1"
          placeholder="Search modules, curricula or playlists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        <div className="border rounded-lg overflow-y-auto mb-4" style={{ maxHeight: '12rem' }}>
          {filtered.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-3">No items found</p>
          )}
          {filtered.map(item => {
            const checked = selected.some(s => s.type === item.type && s.id === item.id);
            return (
              <label key={`${item.type}-${item.id}`}
                className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(item)} className="rounded" />
                <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">
                  {item.type === 'curriculum' ? 'CUR' : item.type === 'playlist' ? 'PLA' : 'MOD'}
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
  function handleClear() { onChange(multi ? [] : null); }
  const hasSelection = multi ? selected.length > 0 : selected !== null;

  return (
    <div className="bg-white border rounded-xl p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        <div className="flex items-center gap-2">
          {hasSelection && (
            <button onClick={handleClear} className="text-[11px] text-slate-400 hover:text-slate-600">Clear</button>
          )}
          {editMode && (
            <button onClick={onAddNew} className="text-[11px] text-blue-600 hover:underline">+ Add</button>
          )}
        </div>
      </div>
      {items.length === 0 && (
        <p className="text-[11px] text-slate-400 text-center py-3">No {title.toLowerCase()} yet</p>
      )}
      {items.map(item => {
        const isSelected = multi ? selected.includes(item) : selected === item;
        return (
          <div key={item} className="flex items-center gap-1.5 group">
            <button
              onClick={() => {
                if (multi) onChange(isSelected ? selected.filter(x => x !== item) : [...selected, item]);
                else onChange(isSelected ? null : item);
              }}
              className={`flex-1 text-left text-xs rounded-lg px-2 py-1 border transition-colors ${
                isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
              }`}
            >
              {item}
            </button>
            {editMode && (
              <button
                onClick={() => onRemove(item)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 text-xs px-0.5 transition-opacity"
                title={`Remove ${item}`}
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info key filter panel (Tags)
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
// Edit modal (fill a single matrix cell)
// ---------------------------------------------------------------------------
function EditModal({ entry, profiles, complementaryOptions, onSave, onClose }) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
    ...(complementaryOptions.playlists ?? []).map(p => ({ ...p, type: 'playlist' })),
  ];

  const [naTraining, setNaTraining]   = useState(entry.na_training ?? false);
  const [naTlg,      setNaTlg]        = useState(entry.na_tlg ?? false);
  const [tlgPrimary, setTlgPrimary]   = useState(entry.tlg_primary ?? '');
  const [tlgAddon,   setTlgAddon]     = useState(Array.isArray(entry.tlg_addon) ? entry.tlg_addon : []);
  const [search,     setSearch]       = useState('');
  const [selected,   setSelected]     = useState(
    Array.isArray(entry.complementary_items) ? entry.complementary_items : []
  );

  // Primary training: start from recommended_training_id if present, else search by name
  const [primarySearch,   setPrimarySearch]   = useState(entry.primary_training_name ?? '');
  const [primarySelected, setPrimarySelected] = useState(
    allItems.find(i => i.id === entry.recommended_training_id) ?? null
  );
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const primaryRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (primaryRef.current && !primaryRef.current.contains(e.target)) setPrimaryOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPrimary = allItems.filter(i =>
    i.title.toLowerCase().includes(primarySearch.toLowerCase())
  );
  const filteredComplementary = allItems
    .filter(i => !(primarySelected && i.type === primarySelected.type && i.id === primarySelected.id))
    .filter(i => i.title.toLowerCase().includes(search.toLowerCase()));

  function toggleComplementary(item) {
    setSelected(prev => {
      const exists = prev.some(s => s.type === item.type && s.id === item.id);
      return exists
        ? prev.filter(s => !(s.type === item.type && s.id === item.id))
        : [...prev, { type: item.type, id: item.id, title: item.title }];
    });
  }

  function handleSave() {
    const compItems = selected.map(i => ({ type: i.type, id: i.id, title: i.title }));
    onSave({
      na_training:             naTraining,
      na_tlg:                  naTlg,
      tlg_primary:             naTlg ? '' : tlgPrimary,
      tlg_addon:               naTlg ? [] : tlgAddon,
      recommended_training_id: naTraining ? null : (primarySelected?.id ?? null),
      primary_training_name:   naTraining ? '' : (primarySelected?.title ?? primarySearch),
      complementary_items:     naTraining ? [] : compItems,
      complementary_names:     naTraining ? [] : compItems.map(i => i.title),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Edit training assignment</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-medium">{entry.function}</span> · <span className="font-medium">{entry.role}</span>
              {entry.additional_info && Object.keys(entry.additional_info).length > 0 && (
                <span className="ml-1">
                  {Object.entries(entry.additional_info).map(([k,v]) => (
                    <span key={k} className={`inline-block ml-1 rounded px-1 text-[10px] ${
                      v ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                    }`}>{k}: {v ? 'Yes' : 'No'}</span>
                  ))}
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-4">&times;</button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 flex flex-col gap-4">
          {/* N/A toggle */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Training</p>
            <ToggleSwitch checked={naTraining} onChange={setNaTraining} label="N/A (not applicable)" />
          </div>

          {!naTraining && (
            <>
              {/* Primary training */}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Primary training</label>
                <div className="relative" ref={primaryRef}>
                  <input
                    className="border rounded-lg px-3 py-1.5 text-xs w-full"
                    placeholder="Search or type training name..."
                    value={primarySelected ? primarySelected.title : primarySearch}
                    onChange={e => {
                      setPrimarySearch(e.target.value);
                      setPrimarySelected(null);
                      setPrimaryOpen(true);
                    }}
                    onFocus={() => setPrimaryOpen(true)}
                  />
                  {primarySelected && (
                    <button
                      onClick={() => { setPrimarySelected(null); setPrimarySearch(''); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                    >&times;</button>
                  )}
                  {primaryOpen && filteredPrimary.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 bg-white border rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {filteredPrimary.map(item => (
                        <button key={`${item.type}-${item.id}`}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
                          onClick={() => { setPrimarySelected(item); setPrimaryOpen(false); setPrimarySearch(''); }}
                        >
                          <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">
                            {item.type === 'curriculum' ? 'CUR' : item.type === 'playlist' ? 'PLA' : 'MOD'}
                          </span>
                          {item.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Complementary trainings */}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Complementary trainings</label>
                {selected.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selected.map(i => (
                      <span key={`${i.type}-${i.id}`}
                        className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                        <span className="text-blue-400 uppercase text-[10px] font-semibold">{i.type === 'curriculum' ? 'CUR' : i.type === 'playlist' ? 'PLA' : 'MOD'}</span>
                        {i.title}
                        <button onClick={() => toggleComplementary(i)} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="border rounded-lg px-3 py-1.5 text-xs w-full mb-1"
                  placeholder="Search complementary trainings..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className="border rounded-lg overflow-y-auto" style={{ maxHeight: '8rem' }}>
                  {filteredComplementary.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">No items found</p>
                  )}
                  {filteredComplementary.map(item => {
                    const checked = selected.some(s => s.type === item.type && s.id === item.id);
                    return (
                      <label key={`${item.type}-${item.id}`}
                        className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleComplementary(item)} className="rounded" />
                        <span className="text-[10px] font-semibold uppercase text-slate-400 w-8 shrink-0">
                          {item.type === 'curriculum' ? 'CUR' : item.type === 'playlist' ? 'PLA' : 'MOD'}
                        </span>
                        <span className="text-xs text-slate-700">{item.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* TLG Group */}
              <TlgGroupSelector
                naTlg={naTlg}
                onNaTlgChange={setNaTlg}
                tlgPrimary={tlgPrimary}
                tlgAddon={tlgAddon}
                onChange={({ tlgPrimary: p, tlgAddon: a }) => { setTlgPrimary(p); setTlgAddon(a); }}
              />
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end px-5 pb-5 shrink-0">
          <button onClick={onClose} className="border px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
function getEntryStatus(entry) {
  if (entry.na_training) return 'na';
  if (entry.recommended_training_id) return 'complete';
  if (entry.primary_training_name) return 'unresolved';
  return 'empty';
}

const STATUS_LABELS = { complete: 'Complete', unresolved: 'Unresolved', empty: 'Empty', na: 'N/A' };
const STATUS_COLORS = {
  complete:   'bg-green-50  text-green-700  border-green-200',
  unresolved: 'bg-amber-50  text-amber-700  border-amber-200',
  empty:      'bg-slate-50  text-slate-500  border-slate-200',
  na:         'bg-slate-100 text-slate-400  border-slate-200',
};

// ---------------------------------------------------------------------------
// Export helper
// ---------------------------------------------------------------------------
function buildInfoKeyQueue(infoKeys, entries, complementaryOptions) {
  const allItems = [
    ...complementaryOptions.curricula.map(c => ({ ...c, type: 'curriculum' })),
    ...complementaryOptions.modules.map(m => ({ ...m, type: 'module' })),
    ...(complementaryOptions.playlists ?? []).map(p => ({ ...p, type: 'playlist' })),
  ];
  const queue = [];
  for (const key of infoKeys) {
    const yesEntries = entries.filter(e => e.additional_info?.[key] === true);
    if (yesEntries.length === 0) continue;
    const allCompNames = yesEntries.flatMap(e => e.complementary_names ?? []);
    const uniqueNames  = [...new Set(allCompNames)];
    const autoMatchedNames = uniqueNames.filter(n =>
      allItems.some(i => i.title.toLowerCase() === n.toLowerCase())
    );
    queue.push({ key, autoMatchedNames, initialItems: [] });
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function RoleMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();

  const dimKey    = ['role-matrix-dimensions', projectId];
  const matrixKey = ['role-matrix', projectId];
  const linksKey  = ['role-matrix-links', projectId];

  const { data: dimensions = { functions: [], roles: [], info_keys: [] } } = useQuery({
    queryKey: dimKey,
    queryFn:  () => client.get(`/projects/${projectId}/role-matrix/dimensions`).then(r => r.data),
  });

  const { data: matrixEntries = [], isLoading: matrixLoading } = useQuery({
    queryKey: matrixKey,
    queryFn:  () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data),
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['role-matrix-profiles', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/role-matrix/training-profiles`).then(r => r.data),
  });

  const { data: complementaryOptions = { modules: [], curricula: [], playlists: [] } } = useQuery({
    queryKey: ['role-matrix-complementary', projectId],
    queryFn:  () => client.get(`/projects/${projectId}/role-matrix/complementary-options`).then(r => r.data),
  });

  const { data: infoKeyLinks = {} } = useQuery({
    queryKey: linksKey,
    queryFn:  () => client.get(`/projects/${projectId}/role-matrix/info-key-links`).then(r => r.data),
  });

  const [editMode,      setEditMode]      = useState(false);
  const [selectedFn,    setSelectedFn]    = useState(null);
  const [selectedRole,  setSelectedRole]  = useState(null);
  const [selectedInfo,  setSelectedInfo]  = useState({});
  const [modalEntry,    setModalEntry]    = useState(null);
  const [addModalType,  setAddModalType]  = useState(null);
  const [statusFilter,  setStatusFilter]  = useState(null);
  const [sortState,     setSortState]     = useState({ col: null, dir: 'asc' });
  const [importError,   setImportError]   = useState(null);
  const [importStats,   setImportStats]   = useState(null);
  const fileInputRef = useRef(null);

  // linkModalQueue: array of { key, autoMatchedNames, initialItems }
  // linkModalIdx:   current index in the queue
  const [pendingImport,  setPendingImport]  = useState(null);
  const [linkModalQueue, setLinkModalQueue] = useState([]);
  const [linkModalIdx,   setLinkModalIdx]   = useState(0);

  // Sidebar edit link key
  const [linkEditKey, setLinkEditKey] = useState(null);

  const safeDimensions = {
    functions: Array.isArray(dimensions.functions) ? dimensions.functions : [],
    roles:     Array.isArray(dimensions.roles)     ? dimensions.roles     : [],
    info_keys: Array.isArray(dimensions.info_keys) ? dimensions.info_keys : [],
  };

  // Sync selectedInfo keys when info_keys change
  useEffect(() => {
    setSelectedInfo(prev => {
      const next = {};
      for (const k of safeDimensions.info_keys) next[k] = prev[k] ?? null;
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeDimensions.info_keys.join(',')]); // stable dep

  const addDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.post(`/projects/${projectId}/role-matrix/dimensions`, { type, value }).then(r => r.data),
    onSuccess: data => qc.setQueryData(dimKey, data),
  });

  const removeDimMutation = useMutation({
    mutationFn: ({ type, value }) =>
      client.delete(`/projects/${projectId}/role-matrix/dimensions`, { data: { type, value } }).then(r => r.data),
    onSuccess: data => qc.setQueryData(dimKey, data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      client.put(`/projects/${projectId}/role-matrix/${id}`, data).then(r => r.data),
    onSuccess: updated => {
      qc.setQueryData(matrixKey, prev =>
        Array.isArray(prev) ? prev.map(e => e.id === updated.id ? updated : e) : prev
      );
    },
  });

  const saveInfoKeyLinkMutation = useMutation({
    mutationFn: ({ infoKey, complementary_items }) =>
      client.put(`/projects/${projectId}/role-matrix/info-key-links/${encodeURIComponent(infoKey)}`, { complementary_items }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: linksKey });
      qc.invalidateQueries({ queryKey: matrixKey });
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
    onError: (err) => {
      alert(err?.response?.data?.error ?? 'Failed to clear the matrix. You may not have permission.');
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ entries }) =>
      client.post(`/projects/${projectId}/role-matrix/import`, { entries }).then(r => r.data),
    onSuccess: data => {
      setImportStats(data);
      qc.invalidateQueries({ queryKey: dimKey });
      qc.invalidateQueries({ queryKey: matrixKey });
      qc.invalidateQueries({ queryKey: linksKey });
      setPendingImport(null);
    },
  });

  const reResolveMutation = useMutation({
    mutationFn: () =>
      client.post(`/projects/${projectId}/role-matrix/re-resolve`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matrixKey });
    },
  });

  const runPendingImport = useCallback((links) => {
    if (!pendingImport) return;
    importMutation.mutate({ entries: pendingImport, links });
  }, [pendingImport, importMutation]);

  const advanceLinkQueue = useCallback((items) => {
    const current = linkModalQueue[linkModalIdx];
    if (current && items !== null) {
      saveInfoKeyLinkMutation.mutate({ infoKey: current.key, complementary_items: items });
    }
    const nextIdx = linkModalIdx + 1;
    if (nextIdx < linkModalQueue.length) {
      setLinkModalIdx(nextIdx);
    } else {
      setLinkModalQueue([]);
      setLinkModalIdx(0);
      runPendingImport(null);
    }
  }, [linkModalQueue, linkModalIdx, pendingImport, runPendingImport, saveInfoKeyLinkMutation]);

  function handleExport() {
    const infoKeys = safeDimensions.info_keys;
    const data = safeEntries.map(e => {
      const row = {
        Function:   e.function,
        Role:       e.role,
        Status:     STATUS_LABELS[getEntryStatus(e)],
        'Primary Training': e.primary_training_name || '',
        'Complementary Trainings': Array.isArray(e.complementary_items)
          ? e.complementary_items.map(i => i.title).join(', ')
          : '',
        'TLG Primary': e.tlg_primary || '',
        'TLG Add-ons': Array.isArray(e.tlg_addon) ? e.tlg_addon.join(', ') : '',
        'N/A Training': e.na_training ? 'Yes' : 'No',
        'N/A TLG':      e.na_tlg     ? 'Yes' : 'No',
      };
      for (const k of infoKeys) {
        row[`Tag: ${k}`] = e.additional_info?.[k] === true ? 'Yes' : e.additional_info?.[k] === false ? 'No' : '';
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Role Matrix');
    XLSX.writeFile(wb, 'role-matrix.xlsx');
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportStats(null);
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb    = XLSX.read(evt.target.result, { type: 'array' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(ws, { defval: '' });

        const infoKeys = safeDimensions.info_keys;

        const entries = rows.map(row => {
          const fn   = String(row['Function']   ?? row['function']   ?? '').trim();
          const role = String(row['Role']       ?? row['role']       ?? '').trim();
          if (!fn || !role) return null;

          const naTraining = String(row['N/A Training'] ?? row['na_training'] ?? '').toLowerCase() === 'yes';
          const naTlg      = String(row['N/A TLG']     ?? row['na_tlg']     ?? '').toLowerCase() === 'yes';
          const tlgParts   = String(row['TLG Group'] ?? row['tlg_group'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
          const pdmParts   = String(row['Training']  ?? row['Primary Training'] ?? row['primary_training_name'] ?? '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          const additional_info = {};
          for (const k of infoKeys) {
            const raw = row[`Tag: ${k}`] ?? row[k] ?? '';
            additional_info[k] = String(raw).toLowerCase() === 'yes';
          }

          return {
            function:         fn,
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
        // Only show the modal queue when edit mode is active
        const queue = buildInfoKeyQueue(infoKeys, entries, complementaryOptions);
        if (queue.length > 0 && editMode) {
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
          <h1 className="text-base font-semibold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">{safeEntries.length} rules</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode(e => !e)}
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
          {editMode && (
            <>
              <label className="text-xs px-3 py-1.5 rounded-lg border text-slate-600 hover:bg-slate-50 cursor-pointer">
                Import
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
              </label>
              <button
                onClick={() => reResolveMutation.mutate()}
                disabled={reResolveMutation.isPending}
                className="text-xs px-3 py-1.5 rounded-lg border text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Re-resolve
              </button>
            </>
          )}
        </div>
      </div>

      {importError && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{importError}</div>
      )}
      {importStats && (
        <div className="mb-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
          Import complete: {importStats.created} created, {importStats.updated} updated, {importStats.skipped} skipped.
          {importStats.resolved !== undefined && (
            <> Resolved: {importStats.resolved} / {importStats.total}.</>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatusFilter(prev => prev === k ? null : k)}
            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
              statusFilter === k
                ? STATUS_COLORS[k] + ' font-semibold'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}
          >
            {label} {statusCounts[k] ?? 0}
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="flex flex-col gap-3 w-48 shrink-0 overflow-y-auto">
          <SelectorPanel
            title="Functions"
            badge="FNC"
            items={safeDimensions.functions}
            selected={selectedFn}
            multi={false}
            onChange={setSelectedFn}
            onAddNew={() => setAddModalType('function')}
            onRemove={value => removeDimMutation.mutate({ type: 'function', value })}
            editMode={editMode} />
          <SelectorPanel
            title="Roles"
            badge="ROL"
            items={safeDimensions.roles}
            selected={selectedRole}
            multi={false}
            onChange={setSelectedRole}
            onAddNew={() => setAddModalType('role')}
            onRemove={value => removeDimMutation.mutate({ type: 'role', value })}
            editMode={editMode} />
          <InfoFilterPanel
            title="Tags"
            infoKeys={safeDimensions.info_keys}
            selectedInfo={selectedInfo}
            onChange={setSelectedInfo}
            onAddNew={() => setAddModalType('info_key')}
            onRemove={value => removeDimMutation.mutate({ type: 'info_key', value })}
            editMode={editMode}
            onEditLink={handleEditInfoKeyLink}
          />
        </div>

        {/* Matrix table */}
        <div className="flex-1 overflow-auto">
          {matrixLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-slate-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-slate-400">No entries match filters.</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b">
                  {[['function','Function'],['role','Role'],['status','Status'],['complementary','Complementary']].map(([col,label]) => (
                    <th key={col}
                      className="text-left px-3 py-2 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 select-none"
                      onClick={() => toggleSort(col)}
                    >
                      {label}{sortState.col === col ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                  {safeDimensions.info_keys.map(k => (
                    <th key={k} className="text-left px-3 py-2 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 select-none"
                      onClick={() => toggleSort(k)}
                    >
                      {k}{sortState.col === k ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => {
                  const status = getEntryStatus(entry);
                  return (
                    <tr key={entry.id} className="border-b hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-medium text-slate-700">{entry.function}</td>
                      <td className="px-3 py-2 text-slate-600">{entry.role}</td>
                      <td className="px-3 py-2">
                        <Badge color={status === 'complete' ? 'green' : status === 'unresolved' ? 'amber' : status === 'na' ? 'slate' : 'slate'}>
                          {STATUS_LABELS[status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {Array.isArray(entry.complementary_items) && entry.complementary_items.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {entry.complementary_items.map(i => (
                              <span key={`${i.type}-${i.id}`} className="inline-block bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[10px]">{i.title}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      {safeDimensions.info_keys.map(k => (
                        <td key={k} className="px-3 py-2 text-center">
                          {entry.additional_info?.[k] === true
                            ? <span className="text-blue-600 font-semibold">Yes</span>
                            : entry.additional_info?.[k] === false
                              ? <span className="text-slate-400">No</span>
                              : <span className="text-slate-300">—</span>
                          }
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setModalEntry(entry)}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Edit"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5z"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
