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

const EMPTY_FORM = {
  function: '', role: '',
  pbom_champion: false, boc_admin: false, boc_member: false,
  eto_user: false, team_manager: false,
  tlg_primary: '',
  tlg_addon: [],
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
      tlg_primary:   String(row[idx('TLG')] || '').trim(),
      tlg_addon:     [],
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

// ---- Single-select panel with fixed options + Add new ----
function SingleSelectPanel({ title, placeholder, options, value, onChange, fixedOptions }) {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newValue, setNewValue] = useState('');

  const allOptions = fixedOptions
    ? [...options]
    : [...options];

  const filtered = allOptions.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  function handleAddNew() {
    if (newValue.trim() && !allOptions.includes(newValue.trim())) {
      onChange(newValue.trim());
    }
    setShowAddModal(false);
    setNewValue('');
  }

  return (
    <>
      <div className="flex flex-col h-full">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{title}</p>
        <input
          className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1"
          placeholder={placeholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '10rem' }}>
          {filtered.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-3">No results</p>
          )}
          {filtered.map(opt => (
            <label key={opt}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                value === opt ? 'bg-indigo-50' : ''
              }`}>
              <input
                type="radio"
                name={`single-${title}`}
                checked={value === opt}
                onChange={() => onChange(value === opt ? '' : opt)}
                className="rounded"
              />
              <span className="text-xs text-slate-700">{opt}</span>
            </label>
          ))}
        </div>
        {!fixedOptions && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-1.5 w-full border border-dashed border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:border-slate-400"
          >
            + Add new
          </button>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Add new {title}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>
            <input
              className="border rounded-lg px-2 py-1.5 text-sm w-full mb-3"
              placeholder={`Enter ${title.toLowerCase()}...`}
              value={newValue}
              autoFocus
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNew()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddModal(false)} className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleAddNew} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Add</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Multi-select panel (checkbox) ----
function MultiSelectPanel({ title, placeholder, options, value, onChange }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [modalTemp, setModalTemp] = useState([...value]);

  const isSelected = (opt) => value.some(v => v === opt);
  const isModalSelected = (opt) => modalTemp.some(v => v === opt);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const modalFiltered = options.filter(o => o.toLowerCase().includes(modalSearch.toLowerCase()));

  function toggle(opt) {
    onChange(isSelected(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  }

  function toggleModal(opt) {
    setModalTemp(isModalSelected(opt) ? modalTemp.filter(v => v !== opt) : [...modalTemp, opt]);
  }

  function openModal() {
    setModalTemp([...value]);
    setModalSearch('');
    setShowModal(true);
  }

  function confirmModal() {
    onChange([...modalTemp]);
    setShowModal(false);
  }

  return (
    <>
      <div className="flex flex-col h-full">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{title}</p>
        <input
          className="border rounded-lg px-2 py-1.5 text-xs w-full mb-1"
          placeholder={placeholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="border rounded-lg overflow-y-auto flex-1" style={{ maxHeight: '10rem' }}>
          {filtered.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-3">No results</p>
          )}
          {filtered.map(opt => (
            <label key={opt}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                isSelected(opt) ? 'bg-blue-50' : ''
              }`}>
              <input
                type="checkbox"
                checked={isSelected(opt)}
                onChange={() => toggle(opt)}
                className="rounded accent-blue-600"
              />
              <span className="text-xs text-slate-700">{opt}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={openModal}
          className="mt-1.5 w-full border border-dashed border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:border-slate-400"
        >
          + Add new
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>
            <p className="text-xs text-slate-400 mb-2">Multiple selections allowed.</p>
            <input
              className="border rounded-lg px-2 py-1.5 text-sm w-full mb-2"
              placeholder={placeholder}
              value={modalSearch}
              autoFocus
              onChange={e => setModalSearch(e.target.value)}
            />
            <div className="border rounded-lg overflow-y-auto flex-1 mb-3">
              {modalFiltered.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">No results</p>
              )}
              {modalFiltered.map(opt => (
                <label key={opt}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                    isModalSelected(opt) ? 'bg-blue-50' : ''
                  }`}>
                  <input
                    type="checkbox"
                    checked={isModalSelected(opt)}
                    onChange={() => toggleModal(opt)}
                    className="rounded accent-blue-600"
                  />
                  <span className="text-sm text-slate-700">{opt}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowModal(false)} className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={confirmModal} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Add selected</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- TLG Group selector: primary (radio from fixed list) + add-on (checkboxes from fixed list) ----
function TlgGroupSelector({ tlgPrimary, tlgAddon, onChange }) {
  const isError = tlgPrimary === 'Error';

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Primary TLG */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Primary TLG Group</p>
        <div className="border rounded-lg overflow-hidden">
          {TLG_PRIMARY_OPTIONS.map(opt => (
            <label key={opt}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${
                tlgPrimary === opt
                  ? opt === 'Error' ? 'bg-red-50' : 'bg-indigo-50'
                  : ''
              }`}>
              <input
                type="radio"
                name="tlg_primary"
                checked={tlgPrimary === opt}
                onChange={() => onChange({ tlgPrimary: tlgPrimary === opt ? '' : opt, tlgAddon })}
                className="rounded"
              />
              <span className={`text-xs ${opt === 'Error' ? 'text-red-500 font-medium' : 'text-slate-700'}`}>{opt}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Add-on TLG */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Add-on TLG Groups</p>
        {tlgAddon.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tlgAddon.map(a => (
              <span key={a} className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 text-xs">
                {a}
                <button
                  onClick={() => onChange({ tlgPrimary, tlgAddon: tlgAddon.filter(x => x !== a) })}
                  className="ml-0.5 text-teal-400 hover:text-teal-700 leading-none">&times;</button>
              </span>
            ))}
          </div>
        )}
        <div className="border rounded-lg overflow-hidden">
          {TLG_ADDON_OPTIONS.map(opt => {
            const checked = tlgAddon.includes(opt);
            return (
              <label key={opt}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b last:border-0 ${checked ? 'bg-teal-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
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
        {isError && (
          <p className="text-xs text-red-400 mt-1">Add-ons are disabled when primary is Error.</p>
        )}
      </div>
    </div>
  );
}

// ---- Unified Create / Edit Modal ----
function RuleModal({ entry, profiles, complementaryOptions, uniqueFunctions, uniqueRoles, onSave, onClose }) {
  const isNew = !entry.id;

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
    tlg_primary: entry.tlg_primary || entry.tlg_group || '',
    tlg_addon: Array.isArray(entry.tlg_addon) ? entry.tlg_addon : [],
    recommended_training_id: entry.recommended_training_id ? String(entry.recommended_training_id) : '',
    complementary_items: Array.isArray(entry.complementary_items) ? entry.complementary_items : [],
  });

  const [primarySearch, setPrimarySearch] = useState('');
  const filteredProfiles = profiles.filter(p =>
    p.profile_name.toLowerCase().includes(primarySearch.toLowerCase())
  );
  const selectedProfile = profiles.find(p => String(p.id) === form.recommended_training_id) || null;

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

  function isCompSelected(item) {
    return form.complementary_items.some(i => i.type === item.type && i.id === item.id);
  }

  const [itemSearch, setItemSearch] = useState('');
  const filteredItems = allItems.filter(i =>
    i.title.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const flagOptions = BOOL_FLAGS.map(f => f.label);
  const selectedFlags = BOOL_FLAGS.filter(f => form[f.key]).map(f => f.label);

  function handleFlagsChange(labels) {
    const updates = {};
    BOOL_FLAGS.forEach(f => { updates[f.key] = labels.includes(f.label); });
    setForm(f => ({ ...f, ...updates }));
  }

  const canSave = form.function.trim() !== '' && form.role.trim() !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800">{isNew ? 'New rule' : 'Edit rule'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {/* Three-panel: Function / Role / Bool Flags */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <SingleSelectPanel
            title="Function"
            placeholder="Search functions..."
            options={uniqueFunctions}
            value={form.function}
            onChange={v => setForm(f => ({ ...f, function: v }))}
          />
          <SingleSelectPanel
            title="Role"
            placeholder="Search roles..."
            options={uniqueRoles}
            value={form.role}
            onChange={v => setForm(f => ({ ...f, role: v }))}
          />
          <MultiSelectPanel
            title="Complementary Info"
            placeholder="Search flags..."
            options={flagOptions}
            value={selectedFlags}
            onChange={handleFlagsChange}
          />
        </div>

        {/* TLG Group section */}
        <div className="border rounded-xl p-4 mb-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">TLG Group</p>
          <TlgGroupSelector
            tlgPrimary={form.tlg_primary}
            tlgAddon={form.tlg_addon}
            onChange={({ tlgPrimary, tlgAddon }) => setForm(f => ({ ...f, tlg_primary: tlgPrimary, tlg_addon: tlgAddon }))}
          />
        </div>

        {/* Primary Training + Complementary trainings */}
        <div className="grid grid-cols-2 gap-4 mb-5">
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
                    isCompSelected(item) ? 'bg-blue-50' : ''
                  }`}>
                  <input type="checkbox" checked={isCompSelected(item)} onChange={() => toggleComplementary(item)} className="rounded" />
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
            disabled={!canSave}
            onClick={() => onSave({
              ...form,
              recommended_training_id: form.recommended_training_id ? parseInt(form.recommended_training_id) : null,
            })}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {isNew ? 'Create rule' : 'Save'}
          </button>
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
  const [modalEntry, setModalEntry] = useState(null);
  const [importError, setImportError] = useState('');

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
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setModalEntry(null); }
  });
  const importMutation = useMutation({
    mutationFn: (e) => client.post(`/projects/${projectId}/role-matrix/import`, { entries: e }),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setImportError(''); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => client.put(`/projects/${projectId}/role-matrix/${id}`, data),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setModalEntry(null); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => client.delete(`/projects/${projectId}/role-matrix/${id}`),
    onSuccess: () => qc.invalidateQueries(['role-matrix', projectId])
  });

  function handleSave(data) {
    if (modalEntry.id) {
      updateMutation.mutate({ id: modalEntry.id, data });
    } else {
      addMutation.mutate(data);
    }
  }

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
      'TLG Primary': e.tlg_primary,
      'TLG Add-on': Array.isArray(e.tlg_addon) ? e.tlg_addon.join(', ') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Role Matrix');
    XLSX.writeFile(wb, 'role-matrix-export.xlsx');
  }

  const pivot = useMemo(() => buildPivot(entries), [entries]);
  const uniqueFunctions = useMemo(() => [...new Set(pivot.map(r => r.function))].sort(), [pivot]);
  const uniqueRoles = useMemo(() => [...new Set(entries.map(e => e.role))].sort(), [entries]);
  const filteredPivot = filterFn ? pivot.filter(r => r.function === filterFn) : pivot;

  const thClass = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';

  function resolveRecommended(entry) {
    if (!entry.recommended_training_id) return null;
    const p = profiles.find(p => p.id === entry.recommended_training_id);
    return p ? p.profile_name : null;
  }

  function TlgCell({ entry }) {
    if (!entry) return null;
    const primary = entry.tlg_primary || entry.tlg_group || '';
    const addon = Array.isArray(entry.tlg_addon) ? entry.tlg_addon : [];
    const isError = primary === 'Error';
    return (
      <div className="flex flex-col gap-0.5">
        {primary && (
          <span className={`text-xs font-medium ${isError ? 'text-red-500' : 'text-slate-800'}`}>{primary}</span>
        )}
        {addon.map(a => (
          <span key={a} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 rounded px-1.5 py-0.5 w-fit">{a}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {modalEntry !== null && (
        <RuleModal
          entry={modalEntry}
          profiles={profiles}
          complementaryOptions={complementaryOptions}
          uniqueFunctions={uniqueFunctions}
          uniqueRoles={uniqueRoles}
          onSave={handleSave}
          onClose={() => setModalEntry(null)}
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
          <button
            onClick={() => setModalEntry({ ...EMPTY_FORM })}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Add rule
          </button>
          <button onClick={() => fileRef.current.click()} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Import Excel</button>
          <button onClick={handleExport} disabled={entries.length === 0} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Export Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importMutation.isPending && <p className="text-sm text-blue-600 mb-2">Importing...</p>}
      {importMutation.isSuccess && <p className="text-sm text-green-600 mb-2">Import complete</p>}

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
                  <th className={`${thClass} w-48`}>TLG Group</th>
                  <th className={`${thClass} w-52`}>Recommended Training</th>
                  <th className={thClass}>Complementary</th>
                  <th className="px-2 py-2 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>}
                {!isLoading && filteredPivot.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No rules yet. Import the Excel template or add rules manually.</td></tr>
                )}
                {filteredPivot.map(row => {
                  const match = matchCombo(row.combos, profile);
                  const isError = (match?.tlg_primary || match?.tlg_group) === 'Error';
                  const recName = match ? resolveRecommended(match) : null;
                  const compItems = match && Array.isArray(match.complementary_items) ? match.complementary_items : [];
                  return (
                    <tr key={`${row.function}-${row.role}`} className={`border-b hover:bg-slate-50/50 ${ isError ? 'bg-red-50' : '' }`}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-700 whitespace-nowrap">{row.function}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{row.role}</td>
                      <td className="px-3 py-2">
                        {match
                          ? <TlgCell entry={match} />
                          : <span className="text-xs text-slate-300">No rule for this combination</span>}
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
                          <button onClick={() => setModalEntry(match)}
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
                <th className={`${thClass} w-48`}>TLG Group</th>
                <th className={`${thClass} w-48`}>Recommended Training</th>
                <th className={thClass}>Complementary</th>
                <th className="px-2 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>}
              {!isLoading && entries.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">No rules yet.</td></tr>}
              {entries.map(entry => {
                const recName = resolveRecommended(entry);
                const compItems = Array.isArray(entry.complementary_items) ? entry.complementary_items : [];
                return (
                  <tr key={entry.id} className={`border-b hover:bg-slate-50/50 ${(entry.tlg_primary || entry.tlg_group) === 'Error' ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-1.5 text-xs font-medium text-slate-700">{entry.function}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{entry.role}</td>
                    {BOOL_FLAGS.map(f => (
                      <td key={f.key} className="px-3 py-1.5 text-center">
                        <span className={`text-xs font-medium ${entry[f.key] ? 'text-green-600' : 'text-slate-300'}`}>{entry[f.key] ? 'Yes' : 'No'}</span>
                      </td>
                    ))}
                    <td className="px-3 py-1.5"><TlgCell entry={entry} /></td>
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
                        <button onClick={() => setModalEntry(entry)} className="text-slate-400 hover:text-blue-600 text-xs">Edit</button>
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
