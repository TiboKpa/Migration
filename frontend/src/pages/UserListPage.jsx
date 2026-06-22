import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_OPTIONS = ['active', 'inactive'];

function emptyUser(infoKeys) {
  const base = {
    sesa_id: '', first_name: '', last_name: '', mail: '', manager_mail: '',
    function: '', role: '',
    description: '',
    recommended_training: '', complementary_names: [], tlg_primary: '', tlg_addon: [],
    na_training: false, na_tlg: false,
    status: 'active', last_contact: '', comments: '',
  };
  for (const k of infoKeys) base[k] = false;
  return base;
}

const STATUS_BG    = { inactive: 'bg-slate-100', active: '' };
const STATUS_HOVER = { inactive: 'hover:bg-slate-200/60', active: 'hover:bg-slate-50/50' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTraining(user) {
  if (user.na_training) return 'N/A';
  const primary = user.recommended_training || user.primary_training_name || '';
  const comp = Array.isArray(user.complementary_names) ? user.complementary_names : [];
  if (!primary && comp.length === 0) return '';
  if (comp.length === 0) return primary;
  return `${primary} + ${comp.join(', ')}`;
}

function formatTlg(user) {
  if (user.na_tlg) return 'N/A';
  const primary = user.tlg_primary || user.tlg_group || '';
  const addon = Array.isArray(user.tlg_addon) ? user.tlg_addon : [];
  if (!primary && addon.length === 0) return '';
  if (addon.length === 0) return primary;
  return `${primary} + ${addon.join(', ')}`;
}

// A matrix row is "valid" when it can produce a real training (not N/A and not empty)
function rowHasTraining(entry) {
  return !entry.na_training && !!entry.primary_training_name;
}

function normalizeYesNo(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'yes';
  return false;
}

function parseExcelUsers(buffer, infoKeys) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let headerRowIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].map(c => String(c).trim()).includes('SESA ID')) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) throw new Error('Header row with "SESA ID" not found');
  const headers = raw[headerRowIdx].map(c => String(c).trim());
  const col = (kw) => headers.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
  const users = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const sesaId = String(row[col('SESA ID')] || '').trim();
    if (!sesaId) continue;
    const entry = {
      sesa_id: sesaId,
      first_name: String(row[col('First Name')] || '').trim(),
      last_name: String(row[col('Last Name')] || '').trim(),
      mail: String(row[col('Mail')] || '').trim(),
      manager_mail: String(row[col('Manager')] || '').trim(),
      function: String(row[col('Function')] || '').trim(),
      role: String(row[col('Role')] || '').trim(),
      description: String(row[col('Description')] || '').trim(),
      recommended_training: String(row[col('PDM Windchill')] || '').trim(),
      tlg_primary: String(row[col('TLG')] || '').trim(),
      status: String(row[col('Status')] || 'active').trim() || 'active',
      last_contact: String(row[col('Last Contact')] || '').trim() || null,
      comments: String(row[col('Comments')] || '').trim(),
    };
    for (const k of infoKeys) {
      const idx = headers.findIndex(h => h === k);
      entry[k] = idx >= 0 ? normalizeYesNo(row[idx]) : false;
    }
    users.push(entry);
  }
  return users;
}

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
// Main page
// ---------------------------------------------------------------------------
export default function UserListPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [editMode,    setEditMode]    = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);
  const [filter,      setFilter]      = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const [editValue,   setEditValue]   = useState('');
  const [importError, setImportError] = useState('');
  const [importStats, setImportStats] = useState(null);
  const [newUser,     setNewUser]     = useState(null);
  const [addLookup,   setAddLookup]   = useState(null);

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data),
    staleTime: 0,
  });

  const { data: matrixEntries = [] } = useQuery({
    queryKey: ['role-matrix', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data),
  });

  const { data: dimensions } = useQuery({
    queryKey: ['role-matrix-dimensions', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix/dimensions`).then(r => r.data),
  });
  const infoKeys = useMemo(() => dimensions?.info_keys ?? [], [dimensions]);

  // ------------------------------------------------------------------
  // Valid function / role sets
  // A function is valid if it has at least one fn+role pair where
  // ANY matrix row (across all additional_info combos) has real training.
  // A role is valid for a given function by the same rule.
  // ------------------------------------------------------------------
  const validFnRolePairs = useMemo(() => {
    // Set of "fn||role" strings that have at least one non-N/A training row
    const set = new Set();
    for (const e of matrixEntries) {
      if (rowHasTraining(e)) set.add(`${e.function}||${e.role}`);
    }
    return set;
  }, [matrixEntries]);

  const matrixFunctions = useMemo(() => {
    // Only functions that have at least one valid fn+role pair
    const fns = new Set();
    for (const key of validFnRolePairs) fns.add(key.split('||')[0]);
    return [...fns].sort();
  }, [validFnRolePairs]);

  const rolesForFn = useCallback((fn) => {
    // Only roles where the fn+role pair has at least one non-N/A training row
    const roles = new Set();
    for (const key of validFnRolePairs) {
      const [f, r] = key.split('||');
      if (f === fn) roles.add(r);
    }
    return [...roles].sort();
  }, [validFnRolePairs]);

  // ------------------------------------------------------------------
  // Lookup
  // ------------------------------------------------------------------
  async function lookup(snapshot) {
    if (!snapshot.function || !snapshot.role) return null;
    const additional_info = {};
    for (const k of infoKeys) additional_info[k] = !!snapshot[k];
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, {
        function: snapshot.function,
        role: snapshot.role,
        additional_info,
      });
      return res.data;
    } catch { return null; }
  }

  function applyLookup(result) {
    if (!result || !result.found) {
      return { recommended_training: '', complementary_names: [], tlg_primary: '', tlg_addon: [], na_training: false, na_tlg: false };
    }
    return {
      recommended_training: result.na_training ? 'N/A' : (result.primary_training_name || ''),
      complementary_names:  result.na_training ? [] : (Array.isArray(result.complementary_names) ? result.complementary_names : []),
      tlg_primary: result.na_tlg ? 'N/A' : (result.tlg_primary || ''),
      tlg_addon:   result.na_tlg ? [] : (Array.isArray(result.tlg_addon) ? result.tlg_addon : []),
      na_training: !!result.na_training,
      na_tlg:      !!result.na_tlg,
    };
  }

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: data => client.post(`/projects/${projectId}/users`, data),
    onSuccess: () => {
      qc.invalidateQueries(['users', projectId]);
      setShowAdd(false);
      setNewUser(null);
      setAddLookup(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, fields }) => client.put(`/projects/${projectId}/users/${id}`, fields),
    onSuccess: (res) => {
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? old.map(u => u.id === res.data.id ? res.data : u) : old
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries(['users', projectId]),
  });

  const clearAllMutation = useMutation({
    mutationFn: () => client.delete(`/projects/${projectId}/users`),
    onSuccess: () => {
      qc.setQueryData(['users', projectId], []);
      setImportStats(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: data => client.post(`/projects/${projectId}/users/import-json`, { users: data }),
    onSuccess: (res) => {
      qc.invalidateQueries(['users', projectId]);
      setImportError('');
      setImportStats(res.data);
    },
    onError: err => setImportError(err?.response?.data?.error || err.message || 'Import failed'),
  });

  // ------------------------------------------------------------------
  // Add-user form
  // ------------------------------------------------------------------
  function openAddForm() {
    setNewUser(emptyUser(infoKeys));
    setAddLookup(null);
    setShowAdd(true);
  }

  async function handleNewUserChange(field, value) {
    const snap = { ...newUser, [field]: value };
    if (field === 'function') snap.role = '';
    setNewUser(snap);
    if (snap.function && snap.role) {
      const result = await lookup(snap);
      setAddLookup(result);
      setNewUser(u => ({ ...u, ...applyLookup(result) }));
    } else {
      setNewUser(u => ({ ...u, recommended_training: '', complementary_names: [], tlg_primary: '', tlg_addon: [], na_training: false, na_tlg: false }));
    }
  }

  async function handleNewUserBoolChange(field, value) {
    const snap = { ...newUser, [field]: value };
    setNewUser(snap);
    if (snap.function && snap.role) {
      const result = await lookup(snap);
      setAddLookup(result);
      setNewUser(u => ({ ...u, ...applyLookup(result) }));
    }
  }

  async function saveNewUser() {
    if (!newUser || !newUser.sesa_id) return;
    createMutation.mutate(newUser);
  }

  // ------------------------------------------------------------------
  // Inline edit
  // ------------------------------------------------------------------
  function startEdit(userId, field, currentValue) {
    if (!editMode) return;
    setEditingCell(`${userId}-${field}`);
    setEditValue(currentValue ?? '');
  }

  function cancelEdit() { setEditingCell(null); }

  async function commitEdit(user, field) {
    setEditingCell(null);
    const value = editValue === '' ? null : editValue;
    const fields = { [field]: value };
    if (field === 'function') fields.role = null;
    if (['function', 'role'].includes(field)) {
      const merged = { ...user, ...fields };
      const result = await lookup(merged);
      Object.assign(fields, applyLookup(result));
    }
    updateMutation.mutate({ id: user.id, fields });
  }

  async function toggleBool(user, field) {
    if (!editMode) return;
    const value = !user[field];
    const merged = { ...user, [field]: value };
    const result = await lookup(merged);
    const fields = { [field]: value, ...applyLookup(result) };
    updateMutation.mutate({ id: user.id, fields });
  }

  // ------------------------------------------------------------------
  // Import / export
  // ------------------------------------------------------------------
  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try { importMutation.mutate(parseExcelUsers(evt.target.result, infoKeys)); }
      catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleExport() {
    const data = users.map(u => ({
      'SESA ID': u.sesa_id,
      'First Name': u.first_name,
      'Last Name': u.last_name,
      'Mail': u.mail,
      'Manager Mail': u.manager_mail,
      'Function': u.function,
      'Role': u.role,
      'Description': u.description,
      ...Object.fromEntries(infoKeys.map(k => [k, u[k] ? 'Yes' : 'No'])),
      'Training Primary': u.recommended_training || '',
      'Training Complementary': Array.isArray(u.complementary_names) ? u.complementary_names.join(', ') : '',
      'TLG Primary': u.tlg_primary || '',
      'TLG Addon': Array.isArray(u.tlg_addon) ? u.tlg_addon.join(', ') : '',
      'Status': u.status,
      'Last Contact': u.last_contact || '',
      'Comments': u.comments,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx');
  }

  function handleClearAll() {
    if (clearAllMutation.isPending) return;
    if (window.confirm('Delete all users in this project? This cannot be undone.'))
      clearAllMutation.mutate();
  }

  // ------------------------------------------------------------------
  // Filter
  // ------------------------------------------------------------------
  const filtered = useMemo(() => {
    if (!filter) return users;
    const q = filter.toLowerCase();
    return users.filter(u =>
      ['sesa_id','first_name','last_name','mail','manager_mail','function','role','description','status','comments']
        .some(k => String(u[k] ?? '').toLowerCase().includes(q))
    );
  }, [users, filter]);

  // ------------------------------------------------------------------
  // Cell renderer
  // ------------------------------------------------------------------
  function renderCell(user, field, opts = {}) {
    const cellId = `${user.id}-${field}`;
    const isEditing = editMode && editingCell === cellId;
    const raw = user[field];

    if (opts.readonly) {
      const display = field === 'training_display'
        ? formatTraining(user)
        : field === 'tlg_display'
          ? formatTlg(user)
          : String(raw ?? '');
      return (
        <span className="text-xs text-slate-400 italic truncate block" title={display}>
          {display || <span className="text-slate-200">-</span>}
        </span>
      );
    }

    if (opts.select === 'status') {
      const isActive = raw === 'active';
      if (!editMode) {
        return (
          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
          }`}>{raw || '-'}</span>
        );
      }
      if (isEditing) {
        return (
          <select autoFocus className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user, field)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        );
      }
      return (
        <span onClick={() => startEdit(user.id, field, raw)}
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 cursor-pointer ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
          }`}>{raw || '-'}</span>
      );
    }

    if (opts.select === 'function') {
      if (!editMode) return <span className="text-xs text-slate-700 truncate block" title={raw || ''}>{raw || <span className="text-slate-300">-</span>}</span>;
      if (isEditing) {
        return (
          <select autoFocus className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user, field)}>
            <option value="">-</option>
            {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        );
      }
      return (
        <span onClick={() => startEdit(user.id, field, raw ?? '')}
          className="text-xs text-slate-700 truncate block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5"
          title={raw || ''}>
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    if (opts.select === 'role') {
      if (!editMode) return <span className="text-xs text-slate-700 truncate block" title={raw || ''}>{raw || <span className="text-slate-300">-</span>}</span>;
      if (isEditing) {
        // Only show roles that have at least one non-N/A training row for this function
        const validRoles = rolesForFn(user.function);
        return (
          <select autoFocus className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user, field)}>
            <option value="">-</option>
            {validRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        );
      }
      return (
        <span onClick={() => startEdit(user.id, field, raw ?? '')}
          className="text-xs text-slate-700 truncate block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5"
          title={raw || ''}>
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    if (opts.date) {
      if (!editMode) return <span className="text-xs text-slate-600 block">{raw || <span className="text-slate-300">-</span>}</span>;
      if (isEditing) {
        return (
          <input type="date" autoFocus className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user, field)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(user, field); if (e.key === 'Escape') cancelEdit(); }} />
        );
      }
      return (
        <span onClick={() => startEdit(user.id, field, raw || '')}
          className="text-xs text-slate-600 block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5">
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    // Default plain text
    if (!editMode) return <span className="text-xs text-slate-700 truncate block" title={String(raw ?? '')}>{raw || <span className="text-slate-300">-</span>}</span>;
    if (isEditing) {
      return (
        <input autoFocus className="border rounded px-1 py-0.5 text-xs w-full min-w-0"
          value={editValue} onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(user, field)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(user, field); if (e.key === 'Escape') cancelEdit(); }} />
      );
    }
    return (
      <span onClick={() => startEdit(user.id, field, raw ?? '')}
        className="text-xs text-slate-700 truncate block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5"
        title={String(raw ?? '')}>
        {raw || <span className="text-slate-300">-</span>}
      </span>
    );
  }

  // ------------------------------------------------------------------
  // Add user form
  // ------------------------------------------------------------------
  function renderAddForm() {
    if (!newUser) return null;
    const roles = rolesForFn(newUser.function);
    const trainingDisplay = formatTraining({
      recommended_training: newUser.recommended_training,
      complementary_names: newUser.complementary_names,
      na_training: newUser.na_training,
    });
    const tlgDisplay = formatTlg({
      tlg_primary: newUser.tlg_primary,
      tlg_addon: newUser.tlg_addon,
      na_tlg: newUser.na_tlg,
    });
    return (
      <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">New user</h2>
        <div className="grid grid-cols-4 gap-3 mb-3">
          {['sesa_id','first_name','last_name','mail'].map(key => (
            <div key={key}>
              <label className="text-xs text-slate-500 block mb-1">{key.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
              <input className="border rounded-lg px-2 py-1.5 text-xs w-full"
                value={newUser[key] || ''}
                onChange={e => setNewUser(u => ({ ...u, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Manager Mail</label>
            <input className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.manager_mail || ''}
              onChange={e => setNewUser(u => ({ ...u, manager_mail: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Function</label>
            <select className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.function}
              onChange={e => handleNewUserChange('function', e.target.value)}>
              <option value="">Select...</option>
              {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Role</label>
            <select className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.role}
              onChange={e => handleNewUserChange('role', e.target.value)}
              disabled={!newUser.function}>
              <option value="">Select...</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Status</label>
            <select className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.status}
              onChange={e => setNewUser(u => ({ ...u, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>
        {infoKeys.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-3 py-2 px-3 bg-white border rounded-lg">
            <span className="text-xs text-slate-400 self-center">Additional Info:</span>
            {infoKeys.map(k => (
              <label key={k} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={!!newUser[k]}
                  onChange={e => handleNewUserBoolChange(k, e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-blue-600" />
                {k}
              </label>
            ))}
          </div>
        )}
        {(trainingDisplay || tlgDisplay) && (
          <div className={`flex gap-8 mb-3 px-3 py-2 rounded-lg text-xs ${
            addLookup?.na_training ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
          }`}>
            <span><strong>Training:</strong> {trainingDisplay || '-'}</span>
            <span><strong>TLG:</strong> {tlgDisplay || '-'}</span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Description</label>
            <input className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.description || ''}
              onChange={e => setNewUser(u => ({ ...u, description: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Last Contact</label>
            <input type="date" className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.last_contact || ''}
              onChange={e => setNewUser(u => ({ ...u, last_contact: e.target.value || null }))} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Comments</label>
            <input className="border rounded-lg px-2 py-1.5 text-xs w-full"
              value={newUser.comments || ''}
              onChange={e => setNewUser(u => ({ ...u, comments: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveNewUser}
            disabled={!newUser.sesa_id || createMutation.isPending}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40">
            {createMutation.isPending ? 'Saving...' : 'Save user'}
          </button>
          <button
            onClick={() => { setShowAdd(false); setNewUser(null); setAddLookup(null); }}
            className="border px-4 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const thBase = 'px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';
  const colCount = 14 + infoKeys.length + (editMode ? 1 : 0);
  const minW = 1600 + infoKeys.length * 80;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">
            {users.length} user{users.length !== 1 ? 's' : ''} -- Training and TLG auto-filled from Role Matrix
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap justify-end">
          {editMode && (
            <button
              onClick={handleClearAll}
              disabled={clearAllMutation.isPending || users.length === 0}
              className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40">
              {clearAllMutation.isPending ? 'Deleting...' : 'Empty list'}
            </button>
          )}
          <ToggleSwitch
            checked={editMode}
            onChange={v => { setEditMode(v); setEditingCell(null); if (!v) { setShowAdd(false); setNewUser(null); } }}
            label="Edit mode"
          />
          {editMode && (
            <button
              onClick={openAddForm}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              Add user
            </button>
          )}
          <input
            className="border rounded-lg px-3 py-1.5 text-sm"
            placeholder="Search..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            onClick={() => fileRef.current.click()}
            disabled={importMutation.isPending}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importMutation.isPending ? 'Importing...' : 'Import Excel'}
          </button>
          <button
            onClick={handleExport}
            disabled={users.length === 0}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Export Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2 shrink-0">{importError}</p>}
      {importStats && !importMutation.isPending && (
        <p className="text-sm text-green-600 mb-2 shrink-0">Import complete: {importStats.imported} users.</p>
      )}

      {editMode && showAdd && renderAddForm()}

      <div className="overflow-y-auto overflow-x-auto rounded-xl border bg-white flex-1">
        <table className="text-sm border-collapse" style={{ tableLayout: 'fixed', minWidth: minW }}>
          <colgroup>
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 180 }} />
            {infoKeys.map(k => <col key={k} style={{ width: 80 }} />)}
            <col style={{ width: 220 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 180 }} />
            {editMode && <col style={{ width: 48 }} />}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 border-b">
            <tr>
              <th className={thBase}>SESA ID</th>
              <th className={thBase}>First Name</th>
              <th className={thBase}>Last Name</th>
              <th className={thBase}>Mail</th>
              <th className={thBase}>Manager Mail</th>
              <th className={thBase}>Function</th>
              <th className={thBase}>Role</th>
              <th className={thBase}>Description</th>
              {infoKeys.map(k => (
                <th key={k} className={`${thBase} align-bottom`} title={k}>
                  <span style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    display: 'inline-block',
                    maxHeight: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 9,
                  }}>{k}</span>
                </th>
              ))}
              <th className={thBase}>Training <span className="text-blue-400 normal-case font-normal">(auto)</span></th>
              <th className={thBase}>TLG <span className="text-blue-400 normal-case font-normal">(auto)</span></th>
              <th className={thBase}>Status</th>
              <th className={thBase}>Last Contact</th>
              <th className={thBase}>Comments</th>
              {editMode && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-slate-400 text-sm">Loading...</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-12 text-center text-slate-400 text-sm">
                  {users.length === 0
                    ? 'No users yet. Import an Excel file or add one manually in Edit mode.'
                    : 'No users match the search.'}
                </td>
              </tr>
            )}
            {filtered.map(user => {
              const rowStatus = user.status === 'inactive' ? 'inactive' : 'active';
              return (
                <tr key={user.id} className={`border-b ${STATUS_BG[rowStatus]} ${STATUS_HOVER[rowStatus]} transition-colors`}>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'sesa_id')}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'first_name')}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'last_name')}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'mail')}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'manager_mail')}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'function', { select: 'function' })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'role', { select: 'role' })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'description')}</td>
                  {infoKeys.map(k => (
                    <td key={k} className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={!!user[k]}
                        onChange={() => toggleBool(user, k)}
                        disabled={!editMode}
                        className={`w-3.5 h-3.5 rounded accent-blue-600 ${editMode ? 'cursor-pointer' : 'cursor-default'}`} />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'training_display', { readonly: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'tlg_display', { readonly: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'status', { select: 'status' })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'last_contact', { date: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'comments')}</td>
                  {editMode && (
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => deleteMutation.mutate(user.id)}
                        disabled={deleteMutation.isPending}
                        className="text-slate-300 hover:text-red-500 text-xs disabled:opacity-40">
                        Del
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
