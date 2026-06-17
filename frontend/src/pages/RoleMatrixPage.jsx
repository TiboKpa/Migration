import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const FUNCTIONS = ['Engineering', 'Marketing', 'Procurement', 'Industrial_Manufacturing', 'Quality', 'Industrialization', 'Non ETO'];
const ROLES_BY_FUNCTION = {
  Engineering: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  Marketing: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  Procurement: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  Industrial_Manufacturing: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  Quality: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  Industrialization: ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
  'Non ETO': ['Viewer', 'Author', 'Approver', 'Auditor', 'MCAD Author', 'ECAD EE Author', 'ECAD PCB Author', 'ECAD Author', 'ECAD Simulation'],
};

const BOOL_FLAGS = [
  { key: 'pbom_champion', label: 'PBOM Champion' },
  { key: 'boc_admin', label: 'BOC Admin' },
  { key: 'boc_member', label: 'BOC Member' },
  { key: 'eto_user', label: 'ETO User' },
  { key: 'team_manager', label: 'Team Manager' },
];

const EMPTY_FORM = {
  function: 'Engineering',
  role: 'Viewer',
  pbom_champion: false,
  boc_admin: false,
  boc_member: false,
  eto_user: false,
  team_manager: false,
  pdm_role: '',
  tlg_group: '',
};

const EMPTY_FILTERS = {
  function: '',
  role: '',
  pbom_champion: '',
  boc_admin: '',
  boc_member: '',
  eto_user: '',
  team_manager: '',
  pdm_role: '',
  tlg_group: '',
};

function normalizeYesNo(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'yes';
  return false;
}

function parseMatrixExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  let targetSheet = null;
  let headerIdx = -1;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const row = raw[i].map(c => String(c).trim());
      if (row.includes('Function') && row.includes('Role') && row.includes('Concatenate')) {
        targetSheet = raw;
        headerIdx = i;
        break;
      }
    }
    if (targetSheet) break;
  }
  if (!targetSheet || headerIdx === -1) throw new Error('Could not find a header row with Function / Role / Concatenate in any sheet.');
  const headers = targetSheet[headerIdx].map(c => String(c).trim());
  const fnIdx       = headers.indexOf('Function');
  const roleIdx     = headers.indexOf('Role');
  const pbomIdx     = headers.findIndex(h => h.includes('PBOM'));
  const bocAdminIdx = headers.findIndex(h => h.includes('BOC Admin'));
  const bocMemberIdx= headers.findIndex(h => h.includes('BOC Member'));
  const etoIdx      = headers.findIndex(h => h.includes('ETO'));
  const tmIdx       = headers.findIndex(h => h.includes('Team Manager'));
  const pdmIdx      = headers.findIndex(h => h.includes('PDM Role'));
  const tlgIdx      = headers.findIndex(h => h.includes('TLG'));
  const entries = [];
  for (let i = headerIdx + 1; i < targetSheet.length; i++) {
    const row = targetSheet[i];
    const fn   = String(row[fnIdx]   || '').trim();
    const role = String(row[roleIdx] || '').trim();
    if (!fn || !role) continue;
    entries.push({
      function:      fn,
      role,
      pbom_champion: normalizeYesNo(row[pbomIdx]),
      boc_admin:     normalizeYesNo(row[bocAdminIdx]),
      boc_member:    normalizeYesNo(row[bocMemberIdx]),
      eto_user:      normalizeYesNo(row[etoIdx]),
      team_manager:  normalizeYesNo(row[tmIdx]),
      pdm_role:      String(row[pdmIdx]  || '').trim(),
      tlg_group:     String(row[tlgIdx]  || '').trim(),
    });
  }
  if (entries.length === 0) throw new Error('No data rows found after the header row.');
  return entries;
}

export default function RoleMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({ pdm_role: '', tlg_group: '' });
  const [importError, setImportError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['role-matrix', projectId],
    queryFn: () => client.get(`/projects/${projectId}/role-matrix`).then(r => r.data)
  });

  const addMutation = useMutation({
    mutationFn: (data) => client.post(`/projects/${projectId}/role-matrix`, data),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setForm(EMPTY_FORM); setShowAddForm(false); }
  });

  const importMutation = useMutation({
    mutationFn: (entries) => client.post(`/projects/${projectId}/role-matrix/import`, { entries }),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setImportError(''); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => client.put(`/projects/${projectId}/role-matrix/${id}`, data),
    onSuccess: () => { qc.invalidateQueries(['role-matrix', projectId]); setEditingId(null); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => client.delete(`/projects/${projectId}/role-matrix/${id}`),
    onSuccess: () => qc.invalidateQueries(['role-matrix', projectId])
  });

  function setFilter(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = parseMatrixExcel(evt.target.result);
        importMutation.mutate(parsed);
      } catch (err) { setImportError(err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function handleExport() {
    const data = entries.map(e => ({
      Function: e.function,
      Role: e.role,
      'PBOM Champion': e.pbom_champion ? 'Yes' : 'No',
      'BOC Admin': e.boc_admin ? 'Yes' : 'No',
      'BOC Member': e.boc_member ? 'Yes' : 'No',
      'ETO User': e.eto_user ? 'Yes' : 'No',
      'Team Manager': e.team_manager ? 'Yes' : 'No',
      Concatenate: e.concatenate,
      'PDM Role': e.pdm_role,
      'TLG Group': e.tlg_group,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Role Matrix');
    XLSX.writeFile(wb, 'role-matrix-export.xlsx');
  }

  const uniqueFunctions = [...new Set(entries.map(e => e.function))].sort();

  const filtered = entries.filter(e => {
    if (filters.function && e.function !== filters.function) return false;
    if (filters.role && !e.role.toLowerCase().includes(filters.role.toLowerCase())) return false;
    if (filters.pbom_champion !== '' && e.pbom_champion !== (filters.pbom_champion === 'yes')) return false;
    if (filters.boc_admin !== '' && e.boc_admin !== (filters.boc_admin === 'yes')) return false;
    if (filters.boc_member !== '' && e.boc_member !== (filters.boc_member === 'yes')) return false;
    if (filters.eto_user !== '' && e.eto_user !== (filters.eto_user === 'yes')) return false;
    if (filters.team_manager !== '' && e.team_manager !== (filters.team_manager === 'yes')) return false;
    if (filters.pdm_role && !e.pdm_role?.toLowerCase().includes(filters.pdm_role.toLowerCase())) return false;
    if (filters.tlg_group && !e.tlg_group?.toLowerCase().includes(filters.tlg_group.toLowerCase())) return false;
    return true;
  });

  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  const thClass = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';
  const filterInputClass = 'w-full border rounded px-1.5 py-1 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Matrix</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} / {entries.length} rules
            {hasActiveFilters && <button onClick={() => setFilters(EMPTY_FILTERS)} className="ml-2 text-blue-500 hover:underline">clear filters</button>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Add rule
          </button>
          <button
            onClick={() => fileRef.current.click()}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >
            Import Excel
          </button>
          <button
            onClick={handleExport}
            disabled={entries.length === 0}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Export Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2">{importError}</p>}
      {importMutation.isPending && <p className="text-sm text-blue-600 mb-2">Importing...</p>}
      {importMutation.isSuccess && <p className="text-sm text-green-600 mb-2">Import complete</p>}

      {showAddForm && (
        <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">New rule</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Function</label>
              <select
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={form.function}
                onChange={e => setForm(f => ({ ...f, function: e.target.value, role: ROLES_BY_FUNCTION[e.target.value]?.[0] || '' }))}
              >
                {FUNCTIONS.map(fn => <option key={fn}>{fn}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Role</label>
              <select
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {(ROLES_BY_FUNCTION[form.function] || []).map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mb-3">
            {BOOL_FLAGS.map(flag => (
              <label key={flag.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[flag.key]}
                  onChange={e => setForm(f => ({ ...f, [flag.key]: e.target.checked }))}
                  className="rounded"
                />
                {flag.label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">PDM Recommended Training</label>
              <input
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={form.pdm_role}
                onChange={e => setForm(f => ({ ...f, pdm_role: e.target.value }))}
                placeholder="e.g. PDM PBOM MCAD for ETO Authors"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">TLG Group</label>
              <input
                className="border rounded-lg px-2 py-1.5 text-sm w-full"
                value={form.tlg_group}
                onChange={e => setForm(f => ({ ...f, tlg_group: e.target.value }))}
                placeholder="e.g. Heavy Author L1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addMutation.mutate(form)}
              disabled={!form.pdm_role || !form.tlg_group || addMutation.isPending}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Save rule
            </button>
            <button
              onClick={() => { setShowAddForm(false); setForm(EMPTY_FORM); }}
              className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-auto rounded-xl border bg-white flex-1">
        <table className="min-w-max text-sm border-collapse w-full">
          <thead className="sticky top-0 z-10 bg-slate-50">
            {/* Label row */}
            <tr className="border-b">
              <th className={thClass}>Function</th>
              <th className={thClass}>Role</th>
              {BOOL_FLAGS.map(f => (
                <th key={f.key} className={`${thClass} text-center w-24`}>{f.label}</th>
              ))}
              <th className={`${thClass} w-72`}>PDM Training (auto-filled)</th>
              <th className={`${thClass} w-40`}>TLG Group</th>
              <th className="px-2 py-2 w-16"></th>
            </tr>
            {/* Filter row */}
            <tr className="border-b bg-white">
              {/* Function */}
              <th className="px-2 py-1.5">
                <select
                  value={filters.function}
                  onChange={e => setFilter('function', e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {uniqueFunctions.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                </select>
              </th>
              {/* Role */}
              <th className="px-2 py-1.5">
                <input
                  value={filters.role}
                  onChange={e => setFilter('role', e.target.value)}
                  placeholder="Filter..."
                  className={filterInputClass}
                />
              </th>
              {/* Bool flags */}
              {BOOL_FLAGS.map(f => (
                <th key={f.key} className="px-2 py-1.5">
                  <select
                    value={filters[f.key]}
                    onChange={e => setFilter(f.key, e.target.value)}
                    className={`${filterInputClass} text-center`}
                  >
                    <option value="">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </th>
              ))}
              {/* PDM Training */}
              <th className="px-2 py-1.5">
                <input
                  value={filters.pdm_role}
                  onChange={e => setFilter('pdm_role', e.target.value)}
                  placeholder="Filter..."
                  className={filterInputClass}
                />
              </th>
              {/* TLG Group */}
              <th className="px-2 py-1.5">
                <input
                  value={filters.tlg_group}
                  onChange={e => setFilter('tlg_group', e.target.value)}
                  placeholder="Filter..."
                  className={filterInputClass}
                />
              </th>
              {/* Reset */}
              <th className="px-2 py-1.5 text-center">
                {hasActiveFilters && (
                  <button
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    title="Clear all filters"
                    className="text-slate-400 hover:text-slate-700 text-xs"
                  >
                    Reset
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No rules match the current filters.</td></tr>
            )}
            {filtered.map(entry => (
              <tr key={entry.id} className={`border-b hover:bg-slate-50/50 ${entry.pdm_role?.startsWith('Error') ? 'bg-red-50' : ''}`}>
                <td className="px-3 py-1.5 text-xs font-medium text-slate-700">{entry.function}</td>
                <td className="px-3 py-1.5 text-xs text-slate-600">{entry.role}</td>
                {BOOL_FLAGS.map(f => (
                  <td key={f.key} className="px-3 py-1.5 text-center">
                    <span className={`text-xs font-medium ${entry[f.key] ? 'text-green-600' : 'text-slate-300'}`}>
                      {entry[f.key] ? 'Yes' : 'No'}
                    </span>
                  </td>
                ))}
                <td className="px-3 py-1.5 max-w-xs">
                  {editingId === entry.id ? (
                    <input
                      autoFocus
                      className="border rounded px-1 py-0.5 text-xs w-full"
                      value={editValues.pdm_role}
                      onChange={e => setEditValues(v => ({ ...v, pdm_role: e.target.value }))}
                    />
                  ) : (
                    <span className={`text-xs ${entry.pdm_role?.startsWith('Error') ? 'text-red-500 font-medium' : 'text-slate-700'}`}>
                      {entry.pdm_role}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {editingId === entry.id ? (
                    <input
                      className="border rounded px-1 py-0.5 text-xs w-full"
                      value={editValues.tlg_group}
                      onChange={e => setEditValues(v => ({ ...v, tlg_group: e.target.value }))}
                    />
                  ) : (
                    <span className={`text-xs ${entry.tlg_group === 'Error' ? 'text-red-500 font-medium' : 'text-slate-700'}`}>
                      {entry.tlg_group}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    {editingId === entry.id ? (
                      <>
                        <button
                          onClick={() => updateMutation.mutate({ id: entry.id, data: editValues })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >Save</button>
                        <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditingId(entry.id); setEditValues({ pdm_role: entry.pdm_role, tlg_group: entry.tlg_group }); }}
                          className="text-slate-400 hover:text-slate-600 text-xs"
                        >Edit</button>
                        <button
                          onClick={() => deleteMutation.mutate(entry.id)}
                          className="text-red-300 hover:text-red-500 text-xs"
                        >Del</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
