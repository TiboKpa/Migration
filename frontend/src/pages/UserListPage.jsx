import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

const STATUS_OPTIONS = ['active', 'inactive'];

function emptyNewRow(infoKeys) {
  const base = {
    sesa_id: '', first_name: '', last_name: '', mail: '', manager_mail: '',
    function: '', role: '', description: '',
    recommended_training: '', complementary_names: [], tlg_primary: '', tlg_addon: [],
    na_training: false, na_tlg: false,
    status: 'active', last_contact: '', comments: '',
  };
  for (const k of infoKeys) base[k] = false;
  return base;
}

const STATUS_BG    = { inactive: 'bg-slate-100', active: '' };
const STATUS_HOVER = { inactive: 'hover:bg-slate-200/60', active: 'hover:bg-slate-50/50' };

function sanitizePayload(row, infoKeys) {
  const EMAIL_FIELDS = ['mail', 'manager_mail'];
  const SKIP = ['complementary_names', 'tlg_addon', 'na_training', 'na_tlg', 'tlg_primary'];
  const payload = {};
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.includes(k)) continue;
    if (EMAIL_FIELDS.includes(k)) {
      payload[k] = v && /^[^@]+@[^@]+\.[^@]+$/.test(String(v).trim()) ? String(v).trim() : null;
    } else if (typeof v === 'string') {
      payload[k] = v.trim() || null;
    } else {
      payload[k] = v;
    }
  }
  payload.recommended_training = row.recommended_training || null;
  payload.tlg_group = row.tlg_primary || null;
  for (const k of infoKeys) payload[k] = !!row[k];
  return payload;
}

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
  const col = kw => headers.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
  const users = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const sesaId = String(row[col('SESA ID')] || '').trim();
    if (!sesaId) continue;
    const entry = {
      sesa_id: sesaId,
      first_name: String(row[col('First Name')] || '').trim(),
      last_name: String(row[col('Last Name')] || '').trim(),
      mail: String(row[col('Mail')] || '').trim() || null,
      manager_mail: String(row[col('Manager')] || '').trim() || null,
      function: String(row[col('Function')] || '').trim(),
      role: String(row[col('Role')] || '').trim(),
      description: String(row[col('Description')] || '').trim(),
      recommended_training: String(row[col('PDM Windchill')] || '').trim() || null,
      tlg_group: String(row[col('TLG')] || '').trim() || null,
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

function TrainingCell({ user }) {
  if (user.na_training)
    return <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">N/A</span>;
  const primary = user.recommended_training || user.primary_training_name || '';
  const comp = Array.isArray(user.complementary_names) ? user.complementary_names : [];
  if (!primary && comp.length === 0) return <span className="text-xs text-slate-300">-</span>;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {primary && <span className="text-xs text-indigo-700 font-medium">{primary}</span>}
      {comp.map((c, i) => (
        <span key={i} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{c}</span>
      ))}
    </div>
  );
}

function TlgCell({ user }) {
  if (user.na_tlg)
    return <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">N/A</span>;
  const primary = user.tlg_primary || user.tlg_group || '';
  const addon = Array.isArray(user.tlg_addon) ? user.tlg_addon : [];
  if (!primary && addon.length === 0) return <span className="text-xs text-slate-300">-</span>;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {primary && <span className="text-xs font-medium text-slate-800">{primary}</span>}
      {addon.map((a, i) => (
        <span key={i} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 rounded px-1.5 py-0.5 whitespace-nowrap">{a}</span>
      ))}
    </div>
  );
}

export default function UserListPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  const [filter, setFilter] = useState('');
  const [importError, setImportError] = useState('');
  const [importStats, setImportStats] = useState(null);

  const [newRow, setNewRow] = useState(null);
  const newRowRef = useRef(null);
  const newRowSaved = useRef(false);
  const newRowId = useRef(null);
  const [newRowSaving, setNewRowSaving] = useState(false);

  const [editingRowId, setEditingRowId] = useState(null);
  const editingRowIdRef = useRef(null);
  const [editRowDraft, setEditRowDraft] = useState({});
  const editRowDraftRef = useRef({});
  const [editRowSaving, setEditRowSaving] = useState(false);

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

  const validFnRolePairs = useMemo(() => {
    const set = new Set();
    for (const e of matrixEntries) {
      if (rowHasTraining(e)) set.add(`${e.function}||${e.role}`);
    }
    return set;
  }, [matrixEntries]);

  const matrixFunctions = useMemo(() => {
    const fns = new Set();
    for (const key of validFnRolePairs) fns.add(key.split('||')[0]);
    return [...fns].sort();
  }, [validFnRolePairs]);

  const rolesForFn = useCallback(fn => {
    const roles = new Set();
    for (const key of validFnRolePairs) {
      const [f, r] = key.split('||');
      if (f === fn) roles.add(r);
    }
    return [...roles].sort();
  }, [validFnRolePairs]);

  async function lookup(snap) {
    if (!snap.function || !snap.role) return null;
    const additional_info = {};
    for (const k of infoKeys) additional_info[k] = !!snap[k];
    try {
      const res = await client.post(`/projects/${projectId}/role-matrix/lookup`, {
        function: snap.function, role: snap.role, additional_info,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  function applyLookup(result) {
    if (!result || !result.found) {
      return { recommended_training: '', complementary_names: [], tlg_primary: '', tlg_addon: [], na_training: false, na_tlg: false };
    }
    return {
      recommended_training: result.na_training ? 'N/A' : (result.primary_training_name || ''),
      complementary_names: result.na_training ? [] : (Array.isArray(result.complementary_names) ? result.complementary_names : []),
      tlg_primary: result.na_tlg ? 'N/A' : (result.tlg_primary || ''),
      tlg_addon: result.na_tlg ? [] : (Array.isArray(result.tlg_addon) ? result.tlg_addon : []),
      na_training: !!result.na_training,
      na_tlg: !!result.na_tlg,
    };
  }

  const createMutation = useMutation({
    mutationFn: payload => client.post(`/projects/${projectId}/users`, payload),
    onSuccess: res => {
      newRowId.current = res.data.id;
      newRowSaved.current = true;
      setNewRowSaving(false);
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? [...old, res.data] : [res.data]
      );
    },
    onError: err => {
      setNewRowSaving(false);
      console.error('[create user]', err?.response?.data || err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => client.put(`/projects/${projectId}/users/${id}`, payload),
    onSuccess: res => {
      setNewRowSaving(false);
      setEditRowSaving(false);
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? old.map(u => u.id === res.data.id ? res.data : u) : old
      );
    },
    onError: err => {
      setNewRowSaving(false);
      setEditRowSaving(false);
      console.error('[update user]', err?.response?.data || err.message);
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
    onSuccess: res => {
      qc.invalidateQueries(['users', projectId]);
      setImportError('');
      setImportStats(res.data);
    },
    onError: err => setImportError(err?.response?.data?.error || err.message || 'Import failed'),
  });

  function openNewRow() {
    const fresh = emptyNewRow(infoKeys);
    setNewRow(fresh);
    newRowRef.current = fresh;
    newRowSaved.current = false;
    newRowId.current = null;
    setNewRowSaving(false);
  }

  function discardNewRow() {
    setNewRow(null);
    newRowRef.current = null;
    newRowSaved.current = false;
    newRowId.current = null;
    setNewRowSaving(false);
  }

  async function commitNewRow(e) {
    if (e && e.currentTarget && e.currentTarget.contains(e.relatedTarget)) return;
    const snap = newRowRef.current;
    if (!snap) return;
    const hasAnyData = [
      snap.sesa_id, snap.first_name, snap.last_name,
      snap.mail, snap.manager_mail, snap.function,
      snap.role, snap.description, snap.comments,
    ].some(v => v && String(v).trim());
    if (!hasAnyData) return;
    setNewRowSaving(true);
    const payload = sanitizePayload(snap, infoKeys);
    if (!newRowSaved.current) {
      createMutation.mutate(payload);
      setTimeout(() => {
        const fresh = emptyNewRow(infoKeys);
        setNewRow(fresh);
        newRowRef.current = fresh;
        newRowSaved.current = false;
        newRowId.current = null;
      }, 50);
    } else if (newRowId.current) {
      updateMutation.mutate({ id: newRowId.current, payload });
    }
  }

  async function commitAndCloseNewRow() {
    const snap = newRowRef.current;
    if (!snap) return;
    const hasAnyData = [
      snap.sesa_id, snap.first_name, snap.last_name,
      snap.mail, snap.manager_mail, snap.function,
      snap.role, snap.description, snap.comments,
    ].some(v => v && String(v).trim());
    if (hasAnyData) {
      setNewRowSaving(true);
      const payload = sanitizePayload(snap, infoKeys);
      if (!newRowSaved.current) {
        createMutation.mutate(payload);
      } else if (newRowId.current) {
        updateMutation.mutate({ id: newRowId.current, payload });
      }
    }
    discardNewRow();
  }

  function handleNewRowKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitAndCloseNewRow(); }
    else if (e.key === 'Escape') { e.preventDefault(); discardNewRow(); }
  }

  async function handleNewRowLookup(snap) {
    if (!snap.function || !snap.role) return snap;
    const result = await lookup(snap);
    const lookupData = applyLookup(result);
    // only overwrite training/TLG fields, never infoKeys
    const merged = { ...snap, ...lookupData };
    newRowRef.current = merged;
    setNewRow({ ...merged });
    return merged;
  }

  function setNewField(field, value) {
    const next = { ...newRowRef.current, [field]: value };
    if (field === 'function') next.role = '';
    newRowRef.current = next;
    setNewRow({ ...next });
    return next;
  }

  async function handleNewSelect(field, value) {
    let snap = setNewField(field, value);
    if (field === 'function' || field === 'role') {
      snap = await handleNewRowLookup(snap);
    }
  }

  async function handleNewBool(field, value) {
    // update the field first, then re-run lookup (training/TLG only)
    const snap = { ...newRowRef.current, [field]: value };
    newRowRef.current = snap;
    setNewRow({ ...snap });
    if (snap.function && snap.role) {
      const result = await lookup(snap);
      const lookupData = applyLookup(result);
      const merged = { ...newRowRef.current, ...lookupData };
      newRowRef.current = merged;
      setNewRow({ ...merged });
    }
  }

  function startEditRow(user) {
    if (!editModeRef.current) return;
    if (editingRowIdRef.current === user.id) return;
    if (editingRowIdRef.current !== null) {
      saveEditRow(editingRowIdRef.current, editRowDraftRef.current);
    }
    const draft = { ...user };
    editingRowIdRef.current = user.id;
    setEditingRowId(user.id);
    setEditRowDraft(draft);
    editRowDraftRef.current = draft;
  }

  async function saveEditRow(userId, draft) {
    if (!userId || !draft) return;
    setEditRowSaving(true);
    editingRowIdRef.current = null;
    setEditingRowId(null);
    const original = users.find(u => u.id === userId) || {};
    let finalDraft = { ...draft };
    if (draft.function !== original.function || draft.role !== original.role) {
      const result = await lookup(draft);
      // only merge training/TLG fields from lookup, preserve infoKeys
      const lookupData = applyLookup(result);
      finalDraft = { ...finalDraft, ...lookupData };
    }
    const payload = sanitizePayload(finalDraft, infoKeys);
    updateMutation.mutate({ id: userId, payload });
  }

  function cancelEditRow() {
    editingRowIdRef.current = null;
    setEditingRowId(null);
    setEditRowDraft({});
    editRowDraftRef.current = {};
    setEditRowSaving(false);
  }

  function handleEditRowBlur(e, userId) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (editingRowIdRef.current !== userId) return;
    saveEditRow(userId, editRowDraftRef.current);
  }

  function handleEditRowKeyDown(e, userId) {
    if (e.key === 'Enter') { e.preventDefault(); saveEditRow(userId, editRowDraftRef.current); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditRow(); }
  }

  function setDraftField(field, value) {
    const next = { ...editRowDraftRef.current, [field]: value };
    if (field === 'function') next.role = '';
    editRowDraftRef.current = next;
    setEditRowDraft({ ...next });
  }

  async function handleDraftSelect(field, value) {
    const snap = { ...editRowDraftRef.current, [field]: value };
    if (field === 'function') snap.role = '';
    editRowDraftRef.current = snap;
    setEditRowDraft({ ...snap });
    if (field === 'function' || field === 'role') {
      const result = await lookup(snap);
      const lookupData = applyLookup(result);
      const merged = { ...snap, ...lookupData };
      editRowDraftRef.current = merged;
      setEditRowDraft({ ...merged });
    }
  }

  async function handleDraftBool(field, value) {
    // update the infoKey field immediately in the ref and state
    const snap = { ...editRowDraftRef.current, [field]: value };
    editRowDraftRef.current = snap;
    setEditRowDraft({ ...snap });
    // re-run lookup only if function+role are set; merge training/TLG only
    if (snap.function && snap.role) {
      const result = await lookup(snap);
      const lookupData = applyLookup(result);
      const merged = { ...editRowDraftRef.current, ...lookupData };
      editRowDraftRef.current = merged;
      setEditRowDraft({ ...merged });
    }
  }

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
      'TLG Primary': u.tlg_primary || u.tlg_group || '',
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
    if (window.confirm('Delete all users in this project? This cannot be undone.')) {
      clearAllMutation.mutate();
    }
  }

  const filtered = useMemo(() => {
    if (!filter) return users;
    const q = filter.toLowerCase();
    return users.filter(u =>
      ['sesa_id', 'first_name', 'last_name', 'mail', 'manager_mail', 'function', 'role', 'description', 'status', 'comments']
        .some(k => String(u[k] ?? '').toLowerCase().includes(q))
    );
  }, [users, filter]);

  const inputCls = 'border rounded px-1 py-0.5 text-xs w-full bg-white focus:ring-1 focus:ring-blue-400 outline-none';
  const selectCls = 'border rounded px-1 py-0.5 text-xs w-full bg-white focus:ring-1 focus:ring-blue-400 outline-none';

  function renderNewRow() {
    if (!newRow) return null;
    const roles = rolesForFn(newRow.function);
    return (
      <tr className="border-b bg-blue-50/40" onBlur={commitNewRow} onKeyDown={handleNewRowKeyDown}>
        <td className="px-2 py-1">
          <div className="relative">
            <input
              className={`${inputCls} border-blue-300`}
              value={newRow.sesa_id}
              placeholder="SESA ID"
              onChange={e => setNewField('sesa_id', e.target.value)}
            />
            {newRowSaving && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-blue-400">saving...</span>
            )}
          </div>
        </td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.first_name} placeholder="First name" onChange={e => setNewField('first_name', e.target.value)} /></td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.last_name} placeholder="Last name" onChange={e => setNewField('last_name', e.target.value)} /></td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.mail} placeholder="mail@..." onChange={e => setNewField('mail', e.target.value)} /></td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.manager_mail} placeholder="manager@..." onChange={e => setNewField('manager_mail', e.target.value)} /></td>
        <td className="px-2 py-1">
          <select className={selectCls} value={newRow.function} onChange={e => handleNewSelect('function', e.target.value)}>
            <option value="">Select...</option>
            {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </td>
        <td className="px-2 py-1">
          <select className={selectCls} value={newRow.role} onChange={e => handleNewSelect('role', e.target.value)} disabled={!newRow.function}>
            <option value="">Select...</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.description} placeholder="Description" onChange={e => setNewField('description', e.target.value)} /></td>
        {infoKeys.map(k => (
          <td key={k} className="py-1 text-center" style={{ width: 44, minWidth: 44, padding: '4px 0' }}>
            <input
              type="checkbox"
              checked={!!newRow[k]}
              onChange={e => handleNewBool(k, e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer block mx-auto"
            />
          </td>
        ))}
        <td className="px-2 py-1"><TrainingCell user={newRow} /></td>
        <td className="px-2 py-1"><TlgCell user={newRow} /></td>
        <td className="px-2 py-1">
          <select className={selectCls} value={newRow.status} onChange={e => setNewField('status', e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </td>
        <td className="px-2 py-1"><input type="date" className={inputCls} value={newRow.last_contact || ''} onChange={e => setNewField('last_contact', e.target.value || '')} /></td>
        <td className="px-2 py-1"><input className={inputCls} value={newRow.comments} placeholder="Comments" onChange={e => setNewField('comments', e.target.value)} /></td>
        <td className="px-2 py-1">
          <button onMouseDown={e => { e.preventDefault(); discardNewRow(); }} className="text-[10px] text-slate-400 hover:text-red-500" title="Discard">&times;</button>
        </td>
      </tr>
    );
  }

  function renderRow(user) {
    const isEditing = editMode && editingRowId === user.id;
    const draft = isEditing ? editRowDraft : user;
    const rowStatus = user.status === 'inactive' ? 'inactive' : 'active';
    const roles = rolesForFn(draft.function || '');

    const cellInput = (field, placeholder = '') => (
      <input
        className={isEditing ? inputCls : 'text-xs text-slate-700 truncate block w-full bg-transparent outline-none cursor-pointer'}
        value={draft[field] ?? ''}
        placeholder={isEditing ? placeholder : undefined}
        readOnly={!isEditing}
        onChange={e => isEditing && setDraftField(field, e.target.value)}
        onClick={() => !isEditing && startEditRow(user)}
        title={String(draft[field] ?? '')}
      />
    );

    return (
      <tr
        key={user.id}
        className={`border-b transition-colors ${isEditing ? 'bg-amber-50/50 ring-1 ring-inset ring-amber-300' : `${STATUS_BG[rowStatus]} ${STATUS_HOVER[rowStatus]}`}`}
        onBlur={isEditing ? e => handleEditRowBlur(e, user.id) : undefined}
        onKeyDown={isEditing ? e => handleEditRowKeyDown(e, user.id) : undefined}
        onClick={!isEditing ? () => startEditRow(user) : undefined}
      >
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('sesa_id', 'SESA ID')}</td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('first_name', 'First name')}</td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('last_name', 'Last name')}</td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('mail', 'mail@...')}</td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('manager_mail', 'manager@...')}</td>
        <td className="px-2 py-1.5 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.function || ''} onChange={e => handleDraftSelect('function', e.target.value)}>
              <option value="">-</option>
              {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <span className="text-xs text-slate-700 truncate block" title={user.function || ''}>{user.function || <span className="text-slate-300">-</span>}</span>
          )}
        </td>
        <td className="px-2 py-1.5 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.role || ''} onChange={e => handleDraftSelect('role', e.target.value)} disabled={!draft.function}>
              <option value="">-</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <span className="text-xs text-slate-700 truncate block" title={user.role || ''}>{user.role || <span className="text-slate-300">-</span>}</span>
          )}
        </td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('description', 'Description')}</td>
        {infoKeys.map(k => (
          <td key={k} className="py-1.5 text-center" style={{ width: 44, minWidth: 44, padding: '6px 0' }}>
            <input
              type="checkbox"
              checked={!!draft[k]}
              disabled={!isEditing}
              onChange={e => isEditing && handleDraftBool(k, e.target.checked)}
              className={`w-3.5 h-3.5 rounded accent-blue-600 block mx-auto ${isEditing ? 'cursor-pointer' : 'cursor-default'}`}
            />
          </td>
        ))}
        <td className="px-2 py-1.5"><TrainingCell user={draft} /></td>
        <td className="px-2 py-1.5"><TlgCell user={draft} /></td>
        <td className="px-2 py-1.5 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.status || 'active'} onChange={e => setDraftField('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          ) : (
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>{user.status || '-'}</span>
          )}
        </td>
        <td className="px-2 py-1.5 overflow-hidden">
          {isEditing ? (
            <input type="date" className={inputCls} value={draft.last_contact || ''} onChange={e => setDraftField('last_contact', e.target.value || '')} />
          ) : (
            <span className="text-xs text-slate-600">{user.last_contact || <span className="text-slate-300">-</span>}</span>
          )}
        </td>
        <td className="px-2 py-1.5 overflow-hidden">{cellInput('comments', 'Comments')}</td>
        <td className="py-1.5 text-center" style={{ width: 32, minWidth: 32 }}>
          {editMode && (
            <button
              onMouseDown={e => { e.preventDefault(); deleteMutation.mutate(user.id); }}
              disabled={deleteMutation.isPending}
              className="text-slate-300 hover:text-red-500 text-xs disabled:opacity-40 block mx-auto"
            >&times;</button>
          )}
        </td>
      </tr>
    );
  }

  const thBase = 'px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap';
  const colCount = 15 + infoKeys.length;
  const minW = 1632 + infoKeys.length * 44;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">
            {users.length} user{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap justify-end">
          {/* Edit-mode actions -- rendered left of the toggle so toggle stays anchored */}
          {editMode && (
            <button onClick={openNewRow} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              Add user
            </button>
          )}
          {editMode && (
            <button
              onClick={handleClearAll}
              disabled={clearAllMutation.isPending || users.length === 0}
              className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40"
            >
              {clearAllMutation.isPending ? 'Deleting...' : 'Empty list'}
            </button>
          )}
          {/* Toggle always stays at the right edge of the action group */}
          <ToggleSwitch
            checked={editMode}
            onChange={v => {
              setEditMode(v);
              editModeRef.current = v;
              if (!v) {
                discardNewRow();
                if (editingRowIdRef.current !== null) {
                  saveEditRow(editingRowIdRef.current, editRowDraftRef.current);
                }
              }
            }}
            label="Edit mode"
          />
          <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} />
          <button onClick={() => fileRef.current.click()} disabled={importMutation.isPending} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importMutation.isPending ? 'Importing...' : 'Import Excel'}
          </button>
          <button onClick={handleExport} disabled={users.length === 0} className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Export Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importError && <p className="text-sm text-red-500 mb-2 shrink-0">{importError}</p>}
      {importStats && !importMutation.isPending && (
        <p className="text-sm text-green-600 mb-2 shrink-0">Import complete: {importStats.imported} users.</p>
      )}
      {editRowSaving && <p className="text-xs text-blue-500 mb-1 shrink-0">Saving...</p>}

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
            {infoKeys.map(k => <col key={k} style={{ width: 44 }} />)}
            <col style={{ width: 220 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 32 }} />
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
                <th
                  key={k}
                  title={k}
                  style={{ width: 44, minWidth: 44, padding: '4px 0', textAlign: 'center', verticalAlign: 'bottom' }}
                  className="bg-slate-50"
                >
                  <span style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    display: 'inline-block',
                    maxHeight: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>{k}</span>
                </th>
              ))}
              <th className={thBase}>Primary Training <span className="text-blue-400 normal-case font-normal">(auto)</span></th>
              <th className={thBase}>TLG <span className="text-blue-400 normal-case font-normal">(auto)</span></th>
              <th className={thBase}>Status</th>
              <th className={thBase}>Last Contact</th>
              <th className={thBase}>Comments</th>
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {editMode && renderNewRow()}
            {isLoading && (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400 text-sm">Loading...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && !newRow && (
              <tr><td colSpan={colCount} className="px-3 py-12 text-center text-slate-400 text-sm">
                {users.length === 0 ? 'No users yet. Import an Excel file or click Add user in Edit mode.' : 'No users match the search.'}
              </td></tr>
            )}
            {filtered.map(user => renderRow(user))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
