import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

// Column order: identity -> function/role -> booleans -> auto-filled -> meta
const COLUMNS = [
  { key: 'sesa_id',             label: 'SESA ID',           width: 'w-28' },
  { key: 'first_name',          label: 'First Name',        width: 'w-28' },
  { key: 'last_name',           label: 'Last Name',         width: 'w-28' },
  { key: 'mail',                label: 'Mail',              width: 'w-44' },
  { key: 'manager_mail',        label: 'Manager Mail',      width: 'w-44' },
  { key: 'function',            label: 'Function',          width: 'w-36', lookupTrigger: true },
  { key: 'role',                label: 'Role',              width: 'w-36', lookupTrigger: true, roleSelect: true },
  { key: 'pbom_champion',       label: 'PBOM Champion',     width: 'w-24', bool: true, lookupTrigger: true },
  { key: 'boc_admin',           label: 'BOC Admin',         width: 'w-20', bool: true, lookupTrigger: true },
  { key: 'boc_member',          label: 'BOC Member',        width: 'w-20', bool: true, lookupTrigger: true },
  { key: 'eto_user',            label: 'ETO User',          width: 'w-20', bool: true, lookupTrigger: true },
  { key: 'team_manager',        label: 'Team Manager',      width: 'w-24', bool: true, lookupTrigger: true },
  { key: 'windchill_access',    label: 'Windchill Access',  width: 'w-24', bool: true },
  { key: 'recommended_training',label: 'PDM Training',      width: 'w-64', readonly: true },
  { key: 'tlg_group',           label: 'TLG Group',         width: 'w-36', readonly: true },
  { key: 'description',         label: 'Description',       width: 'w-48' },
  { key: 'status',              label: 'Status',            width: 'w-24' },
  { key: 'comments',            label: 'Comments',          width: 'w-44' },
];

const BOOL_KEYS = COLUMNS.filter(c => c.bool).map(c => c.key);

const EMPTY_USER = {
  sesa_id: '', first_name: '', last_name: '', mail: '', manager_mail: '',
  function: '', role: '',
  pbom_champion: false, boc_admin: false, boc_member: false,
  eto_user: false, team_manager: false, windchill_access: false,
  recommended_training: '', tlg_group: '',
  description: '', status: 'pending', comments: ''
};

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
    users.push({
      sesa_id: sesaId,
      first_name: String(row[col('First Name')] || '').trim(),
      last_name: String(row[col('Last Name')] || '').trim(),
      mail: String(row[col('Mail')] || '').trim(),
      pbom_champion: normalizeYesNo(row[col('PBOM')]),
      manager_mail: String(row[col('Manager')] || '').trim(),
      function: String(row[col('Function')] || '').trim(),
      role: String(row[col('Role')] || '').trim(),
      description: String(row[col('Description')] || '').trim(),
      recommended_training: String(row[col('PDM Windchill')] || '').trim(),
      boc_admin: normalizeYesNo(row[col('BOC Admin')]),
      boc_member: normalizeYesNo(row[col('BOC Member')]),
      eto_user: normalizeYesNo(row[col('ETO User')]),
      team_manager: normalizeYesNo(row[col('Team Manager')]),
      windchill_access: normalizeYesNo(row[col('Windchill Access')]),
      tlg_group: String(row[col('TLG')] || '').trim(),
      status: String(row[col('Status')] || 'pending').trim() || 'pending',
      comments: String(row[col('Comments')] || '').trim()
    });
  }
  return users;
}

export default function UserListPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [filter, setFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_USER);
  const [addLookupResult, setAddLookupResult] = useState(null);

  // Per-cell editing
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [lookupStatus, setLookupStatus] = useState({});

  const [importError, setImportError] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });

  // Fetch distinct functions and roles from the role matrix
  const { data: matrixEntries = [] } = useQuery({
    queryKey: ['role-matrix', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data)
  });

  const matrixFunctions = [...new Set(matrixEntries.map(e => e.function))].sort();
  function rolesForFunction(fn) {
    return [...new Set(matrixEntries.filter(e => e.function === fn).map(e => e.role))].sort();
  }

  const createMutation = useMutation({
    mutationFn: (data) => client.post(`/projects/${projectId}/users`, data),
    onSuccess: () => { qc.invalidateQueries(['users', projectId]); setNewUser(EMPTY_USER); setShowAddForm(false); setAddLookupResult(null); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, fields }) => client.put(`/projects/${projectId}/users/${id}`, fields),
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  const importMutation = useMutation({
    mutationFn: (data) => client.post(`/projects/${projectId}/users/import-json`, { users: data }),
    onSuccess: () => { qc.invalidateQueries(['users', projectId]); setImportError(''); }
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  async function lookup(userSnapshot) {
    if (!userSnapshot.function || !userSnapshot.role) return null;
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, {
        function: userSnapshot.function,
        role: userSnapshot.role,
        pbom_champion: userSnapshot.pbom_champion,
        boc_admin: userSnapshot.boc_admin,
        boc_member: userSnapshot.boc_member,
        eto_user: userSnapshot.eto_user,
        team_manager: userSnapshot.team_manager,
      });
      return res.data;
    } catch { return null; }
  }

  // New user form field change - trigger lookup when any boolean or function/role changes
  async function handleNewUserChange(field, value) {
    const updated = { ...newUser, [field]: value };
    setNewUser(updated);
    const isLookupField = COLUMNS.find(c => c.key === field)?.lookupTrigger;
    if (isLookupField) {
      const result = await lookup(updated);
      if (result && result.found) {
        setAddLookupResult(result);
        setNewUser(u => ({ ...u, recommended_training: result.pdm_role, tlg_group: result.tlg_group }));
      } else {
        setAddLookupResult(null);
        setNewUser(u => ({ ...u, recommended_training: '', tlg_group: '' }));
      }
    }
  }

  // Inline cell edit commit with auto-lookup
  async function commitEdit(userId, field, col, user) {
    let value = col.bool ? editValue : editValue;
    setEditingCell(null);
    const fields = { [field]: value };
    const isLookupField = col.lookupTrigger;
    if (isLookupField) {
      const merged = { ...user, [field]: value };
      const result = await lookup(merged);
      if (result && result.found) {
        fields.recommended_training = result.pdm_role;
        fields.tlg_group = result.tlg_group;
        setLookupStatus(s => ({ ...s, [userId]: result.is_error ? 'error' : 'ok' }));
      }
    }
    updateMutation.mutate({ id: userId, fields });
  }

  // Inline boolean toggle (immediate save + lookup)
  async function toggleBool(user, field) {
    const value = !user[field];
    const fields = { [field]: value };
    const col = COLUMNS.find(c => c.key === field);
    if (col?.lookupTrigger) {
      const merged = { ...user, [field]: value };
      const result = await lookup(merged);
      if (result && result.found) {
        fields.recommended_training = result.pdm_role;
        fields.tlg_group = result.tlg_group;
        setLookupStatus(s => ({ ...s, [user.id]: result.is_error ? 'error' : 'ok' }));
      }
    }
    updateMutation.mutate({ id: user.id, fields });
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try { importMutation.mutate(parseExcelUsers(evt.target.result)); }
      catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleExport() {
    const data = users.map(u => ({
      'SESA ID': u.sesa_id, 'First Name': u.first_name, 'Last Name': u.last_name,
      'Mail': u.mail, 'PBOM Champion (Yes/No)': u.pbom_champion ? 'Yes' : 'No',
      'Manager/lead Mail': u.manager_mail, 'Function': u.function, 'Role': u.role,
      'Description of day to day activities': u.description,
      'PDM Windchill recommended training (Auto filled)': u.recommended_training,
      'BOC Admin (Yes/No)': u.boc_admin ? 'Yes' : 'No',
      'BOC Member - MC - MCO (Yes/No)': u.boc_member ? 'Yes' : 'No',
      'ETO User (Yes/No)': u.eto_user ? 'Yes' : 'No',
      'Team Manager - Container Management (Yes/No)': u.team_manager ? 'Yes' : 'No',
      'Windchill Access (Yes/No)': u.windchill_access ? 'Yes' : 'No',
      'TLG Group': u.tlg_group, 'Status': u.status, 'Comments': u.comments
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx');
  }

  const filtered = users.filter(u =>
    !filter || COLUMNS.some(c => String(u[c.key] ?? '').toLowerCase().includes(filter.toLowerCase()))
  );

  function renderCell(user, col) {
    const cellId = `${user.id}-${col.key}`;
    const isEditing = editingCell === cellId;
    const rawValue = user[col.key];

    // Read-only auto-filled
    if (col.readonly) {
      const isError = String(rawValue || '').startsWith('Error');
      return (
        <span className={`text-xs px-1 ${isError ? 'text-red-500 font-medium' : 'text-slate-400 italic'}`} title={rawValue || '-'}>
          {rawValue || <span className="text-slate-200">-</span>}
        </span>
      );
    }

    // Boolean - native checkbox, immediate save on click
    if (col.bool) {
      return (
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={!!rawValue}
            onChange={() => toggleBool(user, col.key)}
            className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
          />
        </div>
      );
    }

    // Role - dropdown populated from matrix
    if (col.roleSelect && isEditing) {
      const roles = rolesForFunction(user.function);
      return (
        <select
          autoFocus
          className="border rounded px-1 py-0.5 text-xs w-full"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(user.id, col.key, col, user)}
        >
          {roles.length === 0 && <option value="">(no roles in matrix)</option>}
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      );
    }

    // Function - dropdown
    if (col.key === 'function' && isEditing) {
      return (
        <select
          autoFocus
          className="border rounded px-1 py-0.5 text-xs w-full"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(user.id, col.key, col, user)}
        >
          {matrixFunctions.length === 0 && <option value="">(no functions in matrix)</option>}
          {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      );
    }

    // Text - edit on click
    if (isEditing) {
      return (
        <input
          autoFocus
          className="border rounded px-1 py-0.5 text-xs w-full min-w-0"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(user.id, col.key, col, user)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(user.id, col.key, col, user); if (e.key === 'Escape') setEditingCell(null); }}
        />
      );
    }

    return (
      <span
        onClick={() => { setEditingCell(cellId); setEditValue(rawValue ?? ''); }}
        className="block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 truncate text-xs text-slate-700"
        title={String(rawValue ?? '')}
      >
        {rawValue || <span className="text-slate-300">-</span>}
      </span>
    );
  }

  const newUserRoles = rolesForFunction(newUser.function);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">{users.length} users - PDM Training and TLG Group auto-fill from the Role Matrix</p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            className="border rounded-lg px-3 py-1.5 text-sm"
            placeholder="Search..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            onClick={() => { setShowAddForm(v => !v); setNewUser(EMPTY_USER); setAddLookupResult(null); }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Add user
          </button>
          <button
            onClick={() => fileRef.current.click()}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >
            Import Excel
          </button>
          <button
            onClick={handleExport}
            disabled={users.length === 0}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Export Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importMutation.isPending && <p className="text-sm text-blue-500 mb-2">Importing...</p>}

      {/* Add user form */}
      {showAddForm && (
        <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">New user</h2>

          {/* Identity row */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            {['sesa_id','first_name','last_name','mail'].map(key => (
              <div key={key}>
                <label className="text-xs text-slate-500 block mb-1">{COLUMNS.find(c => c.key === key).label}</label>
                <input
                  className="border rounded-lg px-2 py-1.5 text-sm w-full"
                  value={newUser[key]}
                  onChange={e => setNewUser(u => ({ ...u, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {/* Function / Role / Manager row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Function</label>
              <select
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={newUser.function}
                onChange={e => handleNewUserChange('function', e.target.value)}
              >
                <option value="">Select function...</option>
                {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Role</label>
              <select
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={newUser.role}
                onChange={e => handleNewUserChange('role', e.target.value)}
                disabled={!newUser.function}
              >
                <option value="">Select role...</option>
                {newUserRoles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Manager Mail</label>
              <input
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={newUser.manager_mail}
                onChange={e => setNewUser(u => ({ ...u, manager_mail: e.target.value }))}
              />
            </div>
          </div>

          {/* Boolean flags */}
          <div className="flex flex-wrap gap-5 mb-3 py-2 px-3 bg-white border rounded-lg">
            {COLUMNS.filter(c => c.bool).map(col => (
              <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!newUser[col.key]}
                  onChange={e => handleNewUserChange(col.key, e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                {col.label}
              </label>
            ))}
          </div>

          {/* Auto-filled preview */}
          {(newUser.recommended_training || newUser.tlg_group) && (
            <div className={`flex gap-6 mb-3 px-3 py-2 rounded-lg text-xs ${
              addLookupResult?.is_error ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
            }`}>
              <span><strong>PDM Training:</strong> {newUser.recommended_training}</span>
              <span><strong>TLG Group:</strong> {newUser.tlg_group}</span>
            </div>
          )}

          {/* Description / Status / Comments */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newUser.description} onChange={e => setNewUser(u => ({ ...u, description: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Status</label>
              <select className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newUser.status} onChange={e => setNewUser(u => ({ ...u, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Comments</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newUser.comments} onChange={e => setNewUser(u => ({ ...u, comments: e.target.value }))} />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate(newUser)}
              disabled={!newUser.sesa_id || createMutation.isPending}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Save user
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewUser(EMPTY_USER); setAddLookupResult(null); }}
              className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto rounded-xl border bg-white flex-1">
        <table className="min-w-max text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b">
              {COLUMNS.map(col => (
                <th key={col.key} className={`px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${col.width}`}>
                  {col.label}
                  {col.readonly && <span className="ml-1 text-blue-400 normal-case font-normal">(auto)</span>}
                </th>
              ))}
              <th className="px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-12 text-center text-slate-400">No users yet. Add one manually or import an Excel file.</td></tr>
            )}
            {filtered.map(user => (
              <tr
                key={user.id}
                className={`border-b hover:bg-slate-50/50 transition-colors ${
                  lookupStatus[user.id] === 'error' ? 'bg-red-50' : ''
                }`}
              >
                {COLUMNS.map(col => (
                  <td key={col.key} className={`px-2 py-1.5 ${col.width} max-w-0`}>
                    {renderCell(user, col)}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => deleteMutation.mutate(user.id)}
                    className="text-red-300 hover:text-red-500 text-xs"
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
