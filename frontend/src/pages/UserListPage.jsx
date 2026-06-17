import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const COLUMNS = [
  { key: 'sesa_id', label: 'SESA ID', width: 'w-28' },
  { key: 'first_name', label: 'First Name', width: 'w-28' },
  { key: 'last_name', label: 'Last Name', width: 'w-28' },
  { key: 'mail', label: 'Mail', width: 'w-48' },
  { key: 'pbom_champion', label: 'PBOM Champion', width: 'w-28', bool: true },
  { key: 'manager_mail', label: 'Manager/lead Mail', width: 'w-48' },
  { key: 'function', label: 'Function', width: 'w-32' },
  { key: 'role', label: 'Role', width: 'w-36' },
  { key: 'description', label: 'Description', width: 'w-48' },
  { key: 'recommended_training', label: 'PDM Training (Auto)', width: 'w-48' },
  { key: 'boc_admin', label: 'BOC Admin', width: 'w-24', bool: true },
  { key: 'boc_member', label: 'BOC Member', width: 'w-24', bool: true },
  { key: 'eto_user', label: 'ETO User', width: 'w-24', bool: true },
  { key: 'team_manager', label: 'Team Manager', width: 'w-28', bool: true },
  { key: 'windchill_access', label: 'Windchill Access', width: 'w-28', bool: true },
  { key: 'tlg_group', label: 'TLG Group', width: 'w-36' },
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
  const users = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const sesaId = String(row[headers.indexOf('SESA ID')] || '').trim();
    if (!sesaId) continue;

    users.push({
      sesa_id: sesaId,
      first_name: String(row[headers.indexOf('First Name')] || '').trim(),
      last_name: String(row[headers.indexOf('Last Name')] || '').trim(),
      mail: String(row[headers.indexOf('Mail')] || '').trim(),
      pbom_champion: normalizeYesNo(row[headers.findIndex(h => h.includes('PBOM Champion'))]),
      manager_mail: String(row[headers.findIndex(h => h.includes('Manager'))] >= 0 ? row[headers.findIndex(h => h.includes('Manager/lead Mail'))] : '') .trim(),
      function: String(row[headers.indexOf('Function')] || '').trim(),
      role: String(row[headers.indexOf('Role')] || '').trim(),
      description: String(row[headers.findIndex(h => h.includes('Description'))] >= 0 ? row[headers.findIndex(h => h.includes('Description'))] : '').trim(),
      recommended_training: String(row[headers.findIndex(h => h.includes('PDM Windchill'))] >= 0 ? row[headers.findIndex(h => h.includes('PDM Windchill'))] : '').trim(),
      boc_admin: normalizeYesNo(row[headers.findIndex(h => h.includes('BOC Admin'))]),
      boc_member: normalizeYesNo(row[headers.findIndex(h => h.includes('BOC Member'))]),
      eto_user: normalizeYesNo(row[headers.findIndex(h => h.includes('ETO User'))]),
      team_manager: normalizeYesNo(row[headers.findIndex(h => h.includes('Team Manager'))]),
      windchill_access: normalizeYesNo(row[headers.findIndex(h => h.includes('Windchill Access'))]),
      tlg_group: String(row[headers.findIndex(h => h.includes('TLG'))] >= 0 ? row[headers.findIndex(h => h.includes('TLG'))] : '').trim(),
      status: String(row[headers.indexOf('Status')] || 'pending').trim() || 'pending',
      comments: String(row[headers.indexOf('Comments')] || '').trim()
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

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, field, value }) => client.put(`/projects/${projectId}/users/${id}`, { [field]: value }),
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

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const users = parseExcelUsers(evt.target.result);
        importMutation.mutate(users);
      } catch (err) {
        setImportError(err.message);
      }
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

  function commitEdit(userId, field, col) {
    let value = editValue;
    if (col.bool) value = editValue === 'Yes' || editValue === true;
    updateMutation.mutate({ id: userId, field, value });
    setEditingCell(null);
  }

  const filtered = users.filter(u =>
    !filter || COLUMNS.some(col => String(u[col.key] ?? '').toLowerCase().includes(filter.toLowerCase()))
  );

  function renderCell(user, col) {
    const cellId = `${user.id}-${col.key}`;
    const isEditing = editingCell === cellId;
    const rawValue = user[col.key];
    const displayValue = col.bool ? (rawValue ? 'Yes' : 'No') : (rawValue ?? '');

    if (isEditing) {
      if (col.bool) {
        return (
          <select
            autoFocus
            className="border rounded px-1 py-0.5 text-xs w-full"
            value={editValue === true || editValue === 'Yes' ? 'Yes' : 'No'}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(user.id, col.key, col)}
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
          onBlur={() => commitEdit(user.id, col.key, col)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(user.id, col.key, col); if (e.key === 'Escape') setEditingCell(null); }}
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
          <p className="text-sm text-slate-500">{users.length} users</p>
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
      {importMutation.isSuccess && <p className="text-sm text-green-600 mb-2">Import successful - {users.length} users loaded</p>}

      <div className="overflow-auto rounded-xl border bg-white flex-1">
        <table className="min-w-max text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b">
              {COLUMNS.map(col => (
                <th key={col.key} className={`px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${col.width}`}>
                  {col.label}
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
              <tr key={user.id} className="border-b hover:bg-slate-50/50">
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
