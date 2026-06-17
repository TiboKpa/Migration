import React, { useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const COLUMNS = [
  { key: 'sesa_id', label: 'SESA ID', width: 'w-28' },
  { key: 'first_name', label: 'First Name', width: 'w-28' },
  { key: 'last_name', label: 'Last Name', width: 'w-28' },
  { key: 'mail', label: 'Mail', width: 'w-48' },
  { key: 'pbom_champion', label: 'PBOM Champion', width: 'w-28', bool: true, lookupTrigger: true },
  { key: 'manager_mail', label: 'Manager/lead Mail', width: 'w-48' },
  { key: 'function', label: 'Function', width: 'w-32', lookupTrigger: true },
  { key: 'role', label: 'Role', width: 'w-36', lookupTrigger: true },
  { key: 'description', label: 'Description', width: 'w-48' },
  { key: 'recommended_training', label: 'PDM Training (Auto)', width: 'w-64', readonly: true },
  { key: 'boc_admin', label: 'BOC Admin', width: 'w-24', bool: true, lookupTrigger: true },
  { key: 'boc_member', label: 'BOC Member', width: 'w-24', bool: true, lookupTrigger: true },
  { key: 'eto_user', label: 'ETO User', width: 'w-24', bool: true, lookupTrigger: true },
  { key: 'team_manager', label: 'Team Manager', width: 'w-28', bool: true, lookupTrigger: true },
  { key: 'windchill_access', label: 'Windchill Access', width: 'w-28', bool: true },
  { key: 'tlg_group', label: 'TLG Group', width: 'w-36', readonly: true },
  { key: 'status', label: 'Status', width: 'w-24' },
  { key: 'comments', label: 'Comments', width: 'w-48' }
];

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
    const row = raw[i].map(c => String(c).trim());
    if (row.includes('SESA ID')) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) throw new Error('Header row with "SESA ID" not found');

  const headers = raw[headerRowIdx].map(c => String(c).trim());
  const col = (keyword) => headers.findIndex(h => h.toLowerCase().includes(keyword.toLowerCase()));

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
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [importError, setImportError] = useState('');
  const [lookupStatus, setLookupStatus] = useState({});

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, fields }) => client.put(`/projects/${projectId}/users/${id}`, fields),
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  const importMutation = useMutation({
    mutationFn: (users) => client.post(`/projects/${projectId}/users/import-json`, { users }),
    onSuccess: () => { qc.invalidateQueries(['users', projectId]); setImportError(''); }
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  async function triggerLookup(user, updatedField, updatedValue) {
    const merged = { ...user, [updatedField]: updatedValue };
    const isLookupField = COLUMNS.find(c => c.key === updatedField)?.lookupTrigger;
    if (!isLookupField) return null;
    const payload = {
      function: merged.function,
      role: merged.role,
      pbom_champion: merged.pbom_champion,
      boc_admin: merged.boc_admin,
      boc_member: merged.boc_member,
      eto_user: merged.eto_user,
      team_manager: merged.team_manager,
    };
    if (!payload.function || !payload.role) return null;
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, payload);
      return res.data;
    } catch { return null; }
  }

  async function commitEdit(userId, field, col, user) {
    let value = editValue;
    if (col.bool) value = editValue === 'Yes' || editValue === true;
    setEditingCell(null);

    const fields = { [field]: value };
    const lookup = await triggerLookup(user, field, value);
    if (lookup && lookup.found) {
      fields.recommended_training = lookup.pdm_role;
      fields.tlg_group = lookup.tlg_group;
      if (lookup.is_error) {
        setLookupStatus(s => ({ ...s, [userId]: 'error' }));
      } else {
        setLookupStatus(s => ({ ...s, [userId]: 'ok' }));
      }
    }
    updateMutation.mutate({ id: userId, fields });
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = parseExcelUsers(evt.target.result);
        importMutation.mutate(parsed);
      } catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleExport() {
    const exportData = users.map(u => ({
      'SESA ID': u.sesa_id,
      'First Name': u.first_name,
      'Last Name': u.last_name,
      'Mail': u.mail,
      'PBOM Champion (Yes/No)': u.pbom_champion ? 'Yes' : 'No',
      'Manager/lead Mail': u.manager_mail,
      'Function': u.function,
      'Role': u.role,
      'Description of day to day activities': u.description,
      'PDM Windchill recommended training (Auto filled)': u.recommended_training,
      'BOC Admin (Yes/No)': u.boc_admin ? 'Yes' : 'No',
      'BOC Member - MC - MCO (Yes/No)': u.boc_member ? 'Yes' : 'No',
      'ETO User (Yes/No)': u.eto_user ? 'Yes' : 'No',
      'Team Manager - Container Management (Yes/No)': u.team_manager ? 'Yes' : 'No',
      'Windchill Access (Yes/No)': u.windchill_access ? 'Yes' : 'No',
      'TLG Group': u.tlg_group,
      'Status': u.status,
      'Comments': u.comments
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx');
  }

  function startEdit(userId, field, currentValue) {
    setEditingCell(`${userId}-${field}`);
    setEditValue(currentValue ?? '');
  }

  const filtered = users.filter(u =>
    !filter || COLUMNS.some(col => String(u[col.key] ?? '').toLowerCase().includes(filter.toLowerCase()))
  );

  function renderCell(user, col) {
    const cellId = `${user.id}-${col.key}`;
    const isEditing = editingCell === cellId;
    const rawValue = user[col.key];
    const displayValue = col.bool ? (rawValue ? 'Yes' : 'No') : (rawValue ?? '');

    if (col.readonly) {
      const isError = String(rawValue || '').startsWith('Error');
      return (
        <span className={`text-xs px-1 ${isError ? 'text-red-500 font-medium' : 'text-slate-500 italic'}`} title={String(rawValue || '-')}>
          {rawValue || <span className="text-slate-300">-</span>}
        </span>
      );
    }

    if (isEditing) {
      if (col.bool) {
        return (
          <select
            autoFocus
            className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue === true || editValue === 'Yes' ? 'Yes' : 'No'}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user.id, col.key, col, user)}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        );
      }
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
        onClick={() => startEdit(user.id, col.key, col.bool ? (rawValue ? 'Yes' : 'No') : rawValue)}
        className="block cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 truncate"
        title={String(displayValue)}
      >
        {col.bool
          ? <span className={`text-xs font-medium ${rawValue ? 'text-green-600' : 'text-slate-400'}`}>{rawValue ? 'Yes' : 'No'}</span>
          : <span className="text-xs text-slate-700">{displayValue || <span className="text-slate-300">-</span>}</span>
        }
      </span>
    );
  }

  return (
    <div className="flex flex-col h-full">
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
            onClick={() => fileRef.current.click()}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
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
      {importMutation.isPending && <p className="text-sm text-blue-600 mb-2">Importing...</p>}

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
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">No users. Import an Excel file to get started.</td></tr>
            )}
            {filtered.map(user => (
              <tr
                key={user.id}
                className={`border-b hover:bg-slate-50/50 ${
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
