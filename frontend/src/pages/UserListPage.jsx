import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_OPTIONS = ['active', 'inactive'];

const EMPTY_USER = {
  sesa_id: '', first_name: '', last_name: '', mail: '', manager_mail: '',
  function: '', role: '',
  description: '', recommended_training: '', tlg_group: '',
  status: 'active', last_contact: '', comments: '',
  pbom_champion: false, boc_admin: false, boc_member: false,
  eto_user: false, team_manager: false, windchill_access: false,
};

// Row colour by status (mirrors Role Matrix pattern)
const STATUS_BG = {
  inactive: 'bg-slate-100',
  active: '',
};
const STATUS_HOVER = {
  inactive: 'hover:bg-slate-200/60',
  active: 'hover:bg-slate-50/50',
};

// ---------------------------------------------------------------------------
// Excel helpers
// ---------------------------------------------------------------------------
function normalizeYesNo(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'yes';
  return false;
}

function parseExcelUsers(buffer) {
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
    const lcRaw = String(row[col('Last Contact')] || '').trim();
    users.push({
      sesa_id: sesaId,
      first_name: String(row[col('First Name')] || '').trim(),
      last_name: String(row[col('Last Name')] || '').trim(),
      mail: String(row[col('Mail')] || '').trim(),
      manager_mail: String(row[col('Manager')] || '').trim(),
      function: String(row[col('Function')] || '').trim(),
      role: String(row[col('Role')] || '').trim(),
      description: String(row[col('Description')] || '').trim(),
      pbom_champion: normalizeYesNo(row[col('PBOM')]),
      boc_admin: normalizeYesNo(row[col('BOC Admin')]),
      boc_member: normalizeYesNo(row[col('BOC Member')]),
      eto_user: normalizeYesNo(row[col('ETO User')]),
      team_manager: normalizeYesNo(row[col('Team Manager')]),
      windchill_access: normalizeYesNo(row[col('Windchill Access')]),
      recommended_training: String(row[col('PDM Windchill')] || '').trim(),
      tlg_group: String(row[col('TLG')] || '').trim(),
      status: String(row[col('Status')] || 'active').trim() || 'active',
      last_contact: lcRaw || null,
      comments: String(row[col('Comments')] || '').trim(),
    });
  }
  return users;
}

// ---------------------------------------------------------------------------
// Reusable toggle switch (same as Role Matrix)
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
// Add-user slide-down form
// ---------------------------------------------------------------------------
function AddUserForm({ matrixFunctions, rolesForFn, infoKeys, onSave, onCancel }) {
  const [user, setUser] = useState(EMPTY_USER);
  const [lookupResult, setLookupResult] = useState(null);
  const { projectId } = useParams();

  async function runLookup(snapshot) {
    if (!snapshot.function || !snapshot.role) return;
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, {
        function: snapshot.function, role: snapshot.role,
        pbom_champion: snapshot.pbom_champion, boc_admin: snapshot.boc_admin,
        boc_member: snapshot.boc_member, eto_user: snapshot.eto_user,
        team_manager: snapshot.team_manager,
      });
      const data = res.data;
      setLookupResult(data);
      if (data && data.found && !data.is_error) {
        setUser(u => ({ ...u, recommended_training: data.pdm_role || '', tlg_group: data.tlg_group || '' }));
      } else {
        setUser(u => ({ ...u, recommended_training: '', tlg_group: '' }));
      }
    } catch { setLookupResult(null); }
  }

  async function change(field, value) {
    const updated = { ...user, [field]: value };
    if (field === 'function') { updated.role = ''; }
    setUser(updated);
    const isLookup = ['function','role','pbom_champion','boc_admin','boc_member','eto_user','team_manager'].includes(field);
    if (isLookup) await runLookup(updated);
  }

  return (
    <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">New user</h2>
      <div className="grid grid-cols-4 gap-3 mb-3">
        {['sesa_id','first_name','last_name','mail'].map(key => (
          <div key={key}>
            <label className="text-xs text-slate-500 block mb-1">{key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</label>
            <input className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user[key]}
              onChange={e => change(key, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Manager Mail</label>
          <input className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.manager_mail}
            onChange={e => change('manager_mail', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Function</label>
          <select className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.function}
            onChange={e => change('function', e.target.value)}>
            <option value="">Select...</option>
            {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Role</label>
          <select className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.role}
            onChange={e => change('role', e.target.value)} disabled={!user.function}>
            <option value="">Select...</option>
            {rolesForFn(user.function).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Status</label>
          <select className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.status}
            onChange={e => change('status', e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      {infoKeys.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-3 py-2 px-3 bg-white border rounded-lg">
          {infoKeys.map(k => (
            <label key={k} className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={!!user[k]} onChange={e => change(k, e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-600" />
              {k}
            </label>
          ))}
        </div>
      )}
      {(user.recommended_training || user.tlg_group) && (
        <div className={`flex gap-6 mb-3 px-3 py-2 rounded-lg text-xs ${
          lookupResult?.is_error ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
        }`}>
          <span><strong>Training:</strong> {user.recommended_training || '-'}</span>
          <span><strong>TLG:</strong> {user.tlg_group || '-'}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Description</label>
          <input className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.description}
            onChange={e => change('description', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Last Contact</label>
          <input type="date" className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.last_contact || ''}
            onChange={e => change('last_contact', e.target.value || null)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Comments</label>
          <input className="border rounded-lg px-2 py-1.5 text-xs w-full" value={user.comments}
            onChange={e => change('comments', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(user)} disabled={!user.sesa_id}
          className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40">Save user</button>
        <button onClick={onCancel}
          className="border px-4 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
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
  const [editingCell, setEditingCell] = useState(null); // `${userId}-${field}`
  const [editValue,   setEditValue]   = useState('');
  const [importError, setImportError] = useState('');
  const [importStats, setImportStats] = useState(null);

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
  const infoKeys = dimensions?.info_keys ?? [];

  const matrixFunctions = useMemo(() =>
    [...new Set(matrixEntries.map(e => e.function).filter(Boolean))].sort()
  , [matrixEntries]);

  const rolesForFn = useCallback((fn) =>
    [...new Set(
      matrixEntries.filter(e => e.function === fn).map(e => e.role).filter(Boolean)
    )].sort()
  , [matrixEntries]);

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: data => client.post(`/projects/${projectId}/users`, data),
    onSuccess: () => { qc.invalidateQueries(['users', projectId]); setShowAdd(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, fields }) => client.put(`/projects/${projectId}/users/${id}`, fields),
    onSuccess: (data) => {
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? old.map(u => u.id === data.data.id ? data.data : u) : old
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
  // Role matrix lookup (auto-fill training + TLG)
  // ------------------------------------------------------------------
  async function lookup(snapshot) {
    if (!snapshot.function || !snapshot.role) return null;
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, {
        function: snapshot.function, role: snapshot.role,
        pbom_champion: snapshot.pbom_champion, boc_admin: snapshot.boc_admin,
        boc_member: snapshot.boc_member, eto_user: snapshot.eto_user,
        team_manager: snapshot.team_manager,
      });
      return res.data;
    } catch { return null; }
  }

  // ------------------------------------------------------------------
  // Inline edit helpers
  // ------------------------------------------------------------------
  function startEdit(userId, field, currentValue) {
    if (!editMode) return;
    setEditingCell(`${userId}-${field}`);
    setEditValue(currentValue ?? '');
  }

  function cancelEdit() { setEditingCell(null); }

  async function commitEdit(user, field) {
    setEditingCell(null);
    const value = editValue;
    const fields = { [field]: value === '' ? null : value };
    if (field === 'function') fields.role = '';
    const needsLookup = ['function','role'].includes(field);
    if (needsLookup) {
      const merged = { ...user, ...fields };
      const result = await lookup(merged);
      if (result && result.found) {
        fields.recommended_training = result.pdm_role || '';
        fields.tlg_group = result.tlg_group || '';
      }
    }
    updateMutation.mutate({ id: user.id, fields });
  }

  async function toggleBool(user, field) {
    if (!editMode) return;
    const value = !user[field];
    const fields = { [field]: value };
    const needsLookup = ['pbom_champion','boc_admin','boc_member','eto_user','team_manager'].includes(field);
    if (needsLookup) {
      const merged = { ...user, [field]: value };
      const result = await lookup(merged);
      if (result && result.found) {
        fields.recommended_training = result.pdm_role || '';
        fields.tlg_group = result.tlg_group || '';
      }
    }
    updateMutation.mutate({ id: user.id, fields });
  }

  // ------------------------------------------------------------------
  // File handlers
  // ------------------------------------------------------------------
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try { importMutation.mutate(parseExcelUsers(evt.target.result)); }
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
      'PDM Windchill Training (auto)': u.recommended_training,
      'TLG Group (auto)': u.tlg_group,
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
  // Filtered list
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

    // Readonly (auto-filled)
    if (opts.readonly) {
      return (
        <span className="text-xs text-slate-400 italic truncate" title={raw || '-'}>
          {raw || <span className="text-slate-200">-</span>}
        </span>
      );
    }

    // Boolean (checkbox)
    if (opts.bool) {
      return (
        <div className="flex justify-center">
          <input type="checkbox" checked={!!raw}
            onChange={() => toggleBool(user, field)}
            disabled={!editMode}
            className={`w-3.5 h-3.5 rounded accent-blue-600 ${ editMode ? 'cursor-pointer' : 'cursor-default' }`} />
        </div>
      );
    }

    // Status select
    if (opts.select === 'status') {
      if (!editMode) {
        const isActive = raw === 'active';
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
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
        );
      }
      const isActive = raw === 'active';
      return (
        <span onClick={() => startEdit(user.id, field, raw)}
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 cursor-pointer ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
          }`}>{raw || '-'}</span>
      );
    }

    // Function dropdown
    if (opts.select === 'function') {
      if (!editMode) return <span className="text-xs text-slate-700 truncate">{raw || <span className="text-slate-300">-</span>}</span>;
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
        <span onClick={() => startEdit(user.id, field, raw)}
          className="text-xs text-slate-700 truncate cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 block">
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    // Role dropdown
    if (opts.select === 'role') {
      if (!editMode) return <span className="text-xs text-slate-700 truncate">{raw || <span className="text-slate-300">-</span>}</span>;
      if (isEditing) {
        return (
          <select autoFocus className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user, field)}>
            <option value="">-</option>
            {rolesForFn(user.function).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        );
      }
      return (
        <span onClick={() => startEdit(user.id, field, raw)}
          className="text-xs text-slate-700 truncate cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 block">
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    // Date
    if (opts.date) {
      if (!editMode) return <span className="text-xs text-slate-600">{raw || <span className="text-slate-300">-</span>}</span>;
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
          className="text-xs text-slate-600 cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 block">
          {raw || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    // Default: plain text input
    if (!editMode) return <span className="text-xs text-slate-700 truncate">{raw || <span className="text-slate-300">-</span>}</span>;
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
        className="text-xs text-slate-700 truncate cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 block"
        title={String(raw ?? '')}>
        {raw || <span className="text-slate-300">-</span>}
      </span>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const thBase = 'px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">{users.length} users -- Training and TLG auto-filled from Role Matrix</p>
        </div>
        <div className="flex gap-3 items-center flex-wrap justify-end">
          {editMode && (
            <button onClick={handleClearAll} disabled={clearAllMutation.isPending}
              className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40">
              {clearAllMutation.isPending ? 'Deleting...' : 'Empty list'}
            </button>
          )}
          <ToggleSwitch checked={editMode} onChange={v => { setEditMode(v); setEditingCell(null); }} label="Edit mode" />
          {editMode && (
            <button onClick={() => setShowAdd(v => !v)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Add user</button>
          )}
          <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="Search..."
            value={filter} onChange={e => setFilter(e.target.value)} />
          <button onClick={() => fileRef.current.click()} disabled={importMutation.isPending}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importMutation.isPending ? 'Importing...' : 'Import Excel'}
          </button>
          <button onClick={handleExport} disabled={users.length === 0}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Export Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importStats && !importMutation.isPending && (
        <p className="text-sm text-green-600 mb-2">Import complete: {importStats.imported} users.</p>
      )}

      {/* Add-user form */}
      {editMode && showAdd && (
        <AddUserForm
          matrixFunctions={matrixFunctions}
          rolesForFn={rolesForFn}
          infoKeys={infoKeys}
          onSave={u => createMutation.mutate(u)}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Table */}
      <div className="overflow-y-auto overflow-x-auto rounded-xl border bg-white flex-1">
        <table className="text-sm border-collapse" style={{ tableLayout: 'fixed', minWidth: 1600 + infoKeys.length * 80 }}>
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
            <col style={{ width: 200 }} />
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
                <th key={k} className={thBase} title={k}>
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
              {editMode && <th className="px-2 py-2 w-12" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={14 + infoKeys.length + (editMode ? 1 : 0)} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={14 + infoKeys.length + (editMode ? 1 : 0)} className="px-3 py-12 text-center text-slate-400">
                {users.length === 0 ? 'No users yet. Import an Excel file or add one manually.' : 'No users match the search.'}
              </td></tr>
            )}
            {filtered.map(user => {
              const rowStatus = user.status === 'inactive' ? 'inactive' : 'active';
              return (
                <tr key={user.id} className={`border-b ${ STATUS_BG[rowStatus] } ${ STATUS_HOVER[rowStatus] } transition-colors`}>
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
                        className={`w-3.5 h-3.5 rounded accent-blue-600 ${ editMode ? 'cursor-pointer' : 'cursor-default' }`} />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'recommended_training', { readonly: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'tlg_group', { readonly: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'status', { select: 'status' })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'last_contact', { date: true })}</td>
                  <td className="px-2 py-1.5 overflow-hidden">{renderCell(user, 'comments')}</td>
                  {editMode && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => deleteMutation.mutate(user.id)}
                        className="text-slate-300 hover:text-red-500 text-xs">Del</button>
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
