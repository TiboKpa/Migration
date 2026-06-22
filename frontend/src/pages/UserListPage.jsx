import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import client from '../api/client';

// ---------------------------------------------------------------------------
// Column definitions -- single source of truth for table layout + Excel I/O
// ---------------------------------------------------------------------------
const COLUMNS = [
  { key: 'sesa_id',      label: 'SESA ID',          width: 90,  excelHeader: 'SESA ID' },
  { key: 'first_name',   label: 'First Name',        width: 100, excelHeader: 'First Name' },
  { key: 'last_name',    label: 'Last Name',         width: 100, excelHeader: 'Last Name' },
  { key: 'mail',         label: 'Mail',              width: 160, excelHeader: 'Mail' },
  { key: 'manager_mail', label: 'Manager Mail',      width: 160, excelHeader: 'Manager Mail' },
  { key: 'function',     label: 'Function',          width: 160, excelHeader: 'Function' },
  { key: 'role',         label: 'Role',              width: 160, excelHeader: 'Role' },
  { key: 'description',  label: 'Description',       width: 180, excelHeader: 'Description' },
  // infoKey columns injected dynamically here (32px each, matching RoleMatrixPage)
  { key: '_training',    label: 'Primary Training',  width: 220, excelHeader: 'PDM Windchill' },
  { key: '_tlg',         label: 'TLG',               width: 140, excelHeader: 'TLG' },
  { key: 'status',       label: 'Status',            width: 90,  excelHeader: 'Status' },
  { key: 'last_contact', label: 'Last Contact',      width: 100, excelHeader: 'Last Contact' },
  { key: 'comments',     label: 'Comments',          width: 180, excelHeader: 'Comments' },
  { key: '_actions',     label: '',                  width: 32,  excelHeader: null },
];

const FIXED_BEFORE = 8;
const COLS_BEFORE = COLUMNS.slice(0, FIXED_BEFORE);
const COLS_AFTER  = COLUMNS.slice(FIXED_BEFORE);

const FIXED_PAYLOAD_KEYS = new Set([
  'sesa_id', 'first_name', 'last_name', 'mail', 'manager_mail',
  'function', 'role', 'description',
  'recommended_training', 'complementary_names',
  'tlg_group', 'tlg_addon',
  'status', 'last_contact', 'comments',
  'additional_info',
]);

const INFO_COL_W = 32;

const STATUS_OPTIONS = ['active', 'inactive'];

const STATUS_BG    = { inactive: 'bg-slate-100', active: '' };
const STATUS_HOVER = { inactive: 'hover:bg-slate-200/60', active: 'hover:bg-slate-50/50' };

// Strip any time/timezone component so <input type="date"> gets a clean YYYY-MM-DD value.
function toDateOnly(val) {
  if (!val) return '';
  const s = String(val);
  // Already plain date string
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO timestamp -- take the date part only
  return s.split('T')[0];
}

function emptyNewRow(infoKeys) {
  const base = {
    sesa_id: '', first_name: '', last_name: '', mail: '', manager_mail: '',
    function: '', role: '', description: '',
    recommended_training: '', complementary_names: [],
    tlg_primary: '', tlg_addon: [],
    na_training: false, na_tlg: false,
    status: 'active', last_contact: '', comments: '',
  };
  for (const k of infoKeys) base[k] = false;
  return base;
}

function sanitizePayload(row, infoKeys) {
  const EMAIL_FIELDS = new Set(['mail', 'manager_mail']);
  const payload = {};

  for (const k of FIXED_PAYLOAD_KEYS) {
    if (k === 'additional_info') continue;
    if (k === 'tlg_group') continue;
    if (k === 'recommended_training') continue;
    const v = row[k];
    if (k === 'last_contact') {
      payload[k] = v ? toDateOnly(v) : null;
    } else if (EMAIL_FIELDS.has(k)) {
      payload[k] = (v && /^[^@]+@[^@]+\.[^@]+$/.test(String(v).trim())) ? String(v).trim() : null;
    } else if (Array.isArray(v)) {
      payload[k] = v;
    } else if (typeof v === 'string') {
      payload[k] = v.trim() || null;
    } else {
      payload[k] = v ?? null;
    }
  }

  payload.recommended_training = row.na_training ? 'N/A' : (row.recommended_training || null);
  payload.tlg_group = row.na_tlg ? 'N/A' : (row.tlg_primary || null);

  const additional_info = {};
  for (const k of infoKeys) additional_info[k] = !!row[k];
  payload.additional_info = additional_info;

  return payload;
}

function rowIsInMatrix(entry) {
  return !!(entry.function && entry.role);
}

function normalizeYesNo(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'yes';
  return false;
}

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim().toLowerCase()] = i; });
  return map;
}

function colIdx(headerMap, excelHeader) {
  return headerMap[excelHeader.toLowerCase()] ?? -1;
}

function parseExcelUsers(buffer, infoKeys) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const sesaColDef = COLUMNS.find(c => c.key === 'sesa_id');
  let headerRowIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].map(c => String(c).trim().toLowerCase()).includes(sesaColDef.excelHeader.toLowerCase())) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error(`Header row with "${sesaColDef.excelHeader}" not found`);

  const headerMap = buildHeaderMap(raw[headerRowIdx]);

  function cell(row, excelHeader) {
    const idx = colIdx(headerMap, excelHeader);
    return idx >= 0 ? String(row[idx] ?? '').trim() : '';
  }

  const users = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const sesaId = cell(row, sesaColDef.excelHeader);
    if (!sesaId) continue;

    const entry = {
      sesa_id:              sesaId,
      first_name:           cell(row, COLUMNS.find(c => c.key === 'first_name').excelHeader) || null,
      last_name:            cell(row, COLUMNS.find(c => c.key === 'last_name').excelHeader) || null,
      mail:                 cell(row, COLUMNS.find(c => c.key === 'mail').excelHeader) || null,
      manager_mail:         cell(row, COLUMNS.find(c => c.key === 'manager_mail').excelHeader) || null,
      function:             cell(row, COLUMNS.find(c => c.key === 'function').excelHeader) || null,
      role:                 cell(row, COLUMNS.find(c => c.key === 'role').excelHeader) || null,
      description:          cell(row, COLUMNS.find(c => c.key === 'description').excelHeader) || null,
      recommended_training: cell(row, COLUMNS.find(c => c.key === '_training').excelHeader) || null,
      complementary_names:  [],
      tlg_group:            cell(row, COLUMNS.find(c => c.key === '_tlg').excelHeader) || null,
      tlg_addon:            [],
      status:               cell(row, COLUMNS.find(c => c.key === 'status').excelHeader) || 'active',
      last_contact:         toDateOnly(cell(row, COLUMNS.find(c => c.key === 'last_contact').excelHeader)) || null,
      comments:             cell(row, COLUMNS.find(c => c.key === 'comments').excelHeader) || null,
      additional_info:      {},
    };

    for (const k of infoKeys) {
      const idx = headerMap[k.toLowerCase()] ?? -1;
      entry.additional_info[k] = idx >= 0 ? normalizeYesNo(row[idx]) : false;
      entry[k] = entry.additional_info[k];
    }
    users.push(entry);
  }
  return users;
}

function normalizeUser(u) {
  const naTraining = u.recommended_training === 'N/A';
  const naTlg = u.tlg_group === 'N/A' || u.tlg_primary === 'N/A';
  const info = (u.additional_info && typeof u.additional_info === 'object') ? u.additional_info : {};

  const fixed = {};
  for (const k of FIXED_PAYLOAD_KEYS) {
    if (k === 'additional_info') continue;
    fixed[k] = u[k];
  }

  return {
    id:         u.id,
    project_id: u.project_id,
    created_at: u.created_at,
    updated_at: u.updated_at,
    ...fixed,
    ...info,
    additional_info: info,
    complementary_names: Array.isArray(u.complementary_names) ? u.complementary_names : [],
    tlg_addon: Array.isArray(u.tlg_addon) ? u.tlg_addon : [],
    tlg_primary: u.tlg_primary || (u.tlg_group !== 'N/A' ? u.tlg_group : '') || '',
    na_training: naTraining,
    na_tlg: naTlg,
    // Always normalise last_contact to plain date so <input type="date"> renders correctly.
    last_contact: toDateOnly(u.last_contact),
  };
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
  const primary = (user.recommended_training && user.recommended_training !== 'N/A')
    ? user.recommended_training : '';
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
  const primary = (user.tlg_primary && user.tlg_primary !== 'N/A')
    ? user.tlg_primary
    : (user.tlg_group && user.tlg_group !== 'N/A' ? user.tlg_group : '');
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
  const [saveError, setSaveError] = useState('');

  const [newRow, setNewRow] = useState(null);
  const newRowRef = useRef(null);
  const newRowElRef = useRef(null);
  const newRowPending = useRef(false);
  const newRowId = useRef(null);
  const newRowSaved = useRef(false);
  const [newRowSaving, setNewRowSaving] = useState(false);

  const [editingRowId, setEditingRowId] = useState(null);
  const editingRowIdRef = useRef(null);
  const [editRowDraft, setEditRowDraft] = useState({});
  const editRowDraftRef = useRef({});
  const editRowElRef = useRef(null);
  const [editRowSaving, setEditRowSaving] = useState(false);

  const blurTimerEdit = useRef(null);
  const blurTimerNew  = useRef(null);
  const newRowHasFocus = useRef(false);
  const editRowHasFocus = useRef(false);

  const { data: rawUsers = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data),
    staleTime: 0,
  });

  const users = useMemo(() => rawUsers.map(normalizeUser), [rawUsers]);

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
      if (rowIsInMatrix(e)) set.add(`${e.function}||${e.role}`);
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

  useEffect(() => {
    function onPointerDown(e) {
      const target = e.target;

      if (newRowRef.current && newRowElRef.current && !newRowElRef.current.contains(target)) {
        if (hasNewRowData(newRowRef.current) && !newRowPending.current) {
          commitAndCloseNewRow();
        } else {
          discardNewRow();
        }
      }

      if (
        editingRowIdRef.current !== null &&
        editRowElRef.current &&
        !editRowElRef.current.contains(target)
      ) {
        saveEditRow(editingRowIdRef.current, editRowDraftRef.current);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoKeys, users]);

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
      complementary_names:  result.na_training ? [] : (Array.isArray(result.complementary_names) ? result.complementary_names : []),
      tlg_primary:          result.na_tlg ? 'N/A' : (result.tlg_primary || ''),
      tlg_addon:            result.na_tlg ? [] : (Array.isArray(result.tlg_addon) ? result.tlg_addon : []),
      na_training:          !!result.na_training,
      na_tlg:               !!result.na_tlg,
    };
  }

  function reportSaveError(err) {
    const msg = err?.response?.data?.error || err?.message || 'Save failed';
    setSaveError(msg);
    setTimeout(() => setSaveError(''), 5000);
  }

  const createMutation = useMutation({
    mutationFn: payload => client.post(`/projects/${projectId}/users`, payload),
    onSuccess: res => {
      newRowId.current = res.data.id;
      newRowSaved.current = true;
      newRowPending.current = false;
      setNewRowSaving(false);
      setSaveError('');
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? [...old, normalizeUser(res.data)] : [normalizeUser(res.data)]
      );
    },
    onError: err => {
      newRowPending.current = false;
      setNewRowSaving(false);
      reportSaveError(err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => client.put(`/projects/${projectId}/users/${id}`, payload),
    onSuccess: res => {
      setNewRowSaving(false);
      setEditRowSaving(false);
      setSaveError('');
      qc.setQueryData(['users', projectId], old =>
        Array.isArray(old) ? old.map(u => u.id === res.data.id ? normalizeUser(res.data) : u) : old
      );
    },
    onError: err => {
      setNewRowSaving(false);
      setEditRowSaving(false);
      reportSaveError(err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries(['users', projectId]),
    onError: err => reportSaveError(err),
  });

  const clearAllMutation = useMutation({
    mutationFn: () => client.delete(`/projects/${projectId}/users`),
    onSuccess: () => { qc.setQueryData(['users', projectId], []); setImportStats(null); },
    onError: err => reportSaveError(err),
  });

  const importMutation = useMutation({
    mutationFn: data => client.post(`/projects/${projectId}/users/import-json`, { users: data }),
    onSuccess: res => { qc.invalidateQueries(['users', projectId]); setImportError(''); setImportStats(res.data); },
    onError: err => setImportError(err?.response?.data?.error || err.message || 'Import failed'),
  });

  function openNewRow() {
    setSaveError('');
    const fresh = emptyNewRow(infoKeys);
    setNewRow(fresh);
    newRowRef.current = fresh;
    newRowSaved.current = false;
    newRowPending.current = false;
    newRowId.current = null;
    setNewRowSaving(false);
  }

  function discardNewRow() {
    clearTimeout(blurTimerNew.current);
    newRowHasFocus.current = false;
    setNewRow(null);
    newRowRef.current = null;
    newRowSaved.current = false;
    newRowPending.current = false;
    newRowId.current = null;
    setNewRowSaving(false);
  }

  function hasNewRowData(snap) {
    return ['sesa_id', 'first_name', 'last_name', 'mail', 'manager_mail', 'function', 'role', 'description', 'comments']
      .some(k => snap[k] && String(snap[k]).trim());
  }

  function commitAndCloseNewRow() {
    clearTimeout(blurTimerNew.current);
    const snap = newRowRef.current;
    if (!snap) return;
    if (hasNewRowData(snap) && !newRowPending.current) {
      newRowPending.current = true;
      setNewRowSaving(true);
      const payload = sanitizePayload(snap, infoKeys);
      if (!newRowSaved.current) {
        createMutation.mutate(payload);
      } else if (newRowId.current) {
        updateMutation.mutate({ id: newRowId.current, payload });
      }
    }
    setNewRow(null);
    newRowRef.current = null;
  }

  function handleNewRowBlur(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    clearTimeout(blurTimerNew.current);
    newRowHasFocus.current = false;
  }

  function handleNewRowFocus() {
    clearTimeout(blurTimerNew.current);
    newRowHasFocus.current = true;
  }

  function handleNewRowKeyDown(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      commitAndCloseNewRow();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardNewRow();
    }
  }

  function setNewField(field, value) {
    const next = { ...newRowRef.current, [field]: value };
    if (field === 'function') next.role = '';
    newRowRef.current = next;
    setNewRow({ ...next });
    return next;
  }

  async function handleNewSelect(field, value) {
    const snap = setNewField(field, value);
    if ((field === 'function' || field === 'role') && snap.function && snap.role) {
      const lookupData = applyLookup(await lookup(snap));
      const merged = { ...newRowRef.current, ...lookupData };
      newRowRef.current = merged;
      setNewRow({ ...merged });
    }
  }

  async function handleNewBool(field, value) {
    const snap = { ...newRowRef.current, [field]: value };
    newRowRef.current = snap;
    setNewRow({ ...snap });
    if (snap.function && snap.role) {
      const lookupData = applyLookup(await lookup(snap));
      const merged = { ...newRowRef.current, ...lookupData };
      newRowRef.current = merged;
      setNewRow({ ...merged });
    }
  }

  function startEditRow(user) {
    if (!editModeRef.current) return;
    if (editingRowIdRef.current === user.id) return;
    if (editingRowIdRef.current !== null) {
      const prevId = editingRowIdRef.current;
      const prevDraft = { ...editRowDraftRef.current };
      editingRowIdRef.current = null;
      doSaveEditRow(prevId, prevDraft);
    }
    const draft = { ...user };
    editingRowIdRef.current = user.id;
    setEditingRowId(user.id);
    setEditRowDraft(draft);
    editRowDraftRef.current = draft;
    editRowHasFocus.current = true;
  }

  async function doSaveEditRow(userId, draft) {
    if (!userId || !draft) return;
    setEditRowSaving(true);
    const original = users.find(u => u.id === userId) || {};
    let finalDraft = { ...draft };
    const fnOrRoleChanged = draft.function !== original.function || draft.role !== original.role;
    const infoKeyChanged = infoKeys.some(k => !!draft[k] !== !!original[k]);
    if (fnOrRoleChanged || infoKeyChanged) {
      const lookupData = applyLookup(await lookup(draft));
      finalDraft = { ...finalDraft, ...lookupData };
    }
    updateMutation.mutate({ id: userId, payload: sanitizePayload(finalDraft, infoKeys) });
  }

  function saveEditRow(userId, draft) {
    clearTimeout(blurTimerEdit.current);
    editingRowIdRef.current = null;
    editRowHasFocus.current = false;
    setEditingRowId(null);
    doSaveEditRow(userId, draft);
  }

  function cancelEditRow() {
    clearTimeout(blurTimerEdit.current);
    editingRowIdRef.current = null;
    editRowHasFocus.current = false;
    setEditingRowId(null);
    setEditRowDraft({});
    editRowDraftRef.current = {};
    setEditRowSaving(false);
  }

  function handleEditRowBlur(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    clearTimeout(blurTimerEdit.current);
    editRowHasFocus.current = false;
  }

  function handleEditRowFocus() {
    clearTimeout(blurTimerEdit.current);
    editRowHasFocus.current = true;
  }

  function handleEditRowKeyDown(e, userId) {
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      saveEditRow(userId, editRowDraftRef.current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditRow();
    }
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
    if ((field === 'function' || field === 'role') && snap.function && snap.role) {
      const lookupData = applyLookup(await lookup(snap));
      const merged = { ...editRowDraftRef.current, ...lookupData };
      editRowDraftRef.current = merged;
      setEditRowDraft({ ...merged });
    }
  }

  async function handleDraftBool(field, value) {
    const snap = { ...editRowDraftRef.current, [field]: value };
    editRowDraftRef.current = snap;
    setEditRowDraft({ ...snap });
    if (snap.function && snap.role) {
      const lookupData = applyLookup(await lookup(snap));
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
    const data = users.map(u => {
      const row = {};
      for (const col of COLUMNS) {
        if (!col.excelHeader) continue;
        if (col.key === '_training') {
          row[col.excelHeader] = (u.na_training ? 'N/A' : u.recommended_training) || '';
        } else if (col.key === '_tlg') {
          row[col.excelHeader] = u.na_tlg ? 'N/A' : (u.tlg_primary || u.tlg_group || '');
        } else {
          row[col.excelHeader] = u[col.key] ?? '';
        }
      }
      for (const k of infoKeys) row[k] = u[k] ? 'Yes' : 'No';
      row['Training Complementary'] = Array.isArray(u.complementary_names) ? u.complementary_names.join(', ') : '';
      row['TLG Addon'] = Array.isArray(u.tlg_addon) ? u.tlg_addon.join(', ') : '';
      return row;
    });
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
      COLUMNS
        .filter(c => c.key !== '_training' && c.key !== '_tlg' && c.key !== '_actions')
        .some(c => String(u[c.key] ?? '').toLowerCase().includes(q))
    );
  }, [users, filter]);

  const minW = COLUMNS.reduce((acc, c) => acc + c.width, 0) + infoKeys.length * INFO_COL_W;
  const colCount = COLUMNS.length - 1 + infoKeys.length;

  const thBase    = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide overflow-hidden text-ellipsis whitespace-nowrap';
  const inputCls  = 'border rounded px-1 py-0.5 text-xs w-full bg-white focus:ring-1 focus:ring-blue-400 outline-none';
  const selectCls = 'border rounded px-1 py-0.5 text-xs w-full bg-white focus:ring-1 focus:ring-blue-400 outline-none';

  function renderNewRow() {
    if (!newRow) return null;
    const roles = rolesForFn(newRow.function);
    return (
      <tr
        ref={newRowElRef}
        className="border-b bg-blue-50/40"
        onBlur={handleNewRowBlur}
        onFocus={handleNewRowFocus}
        onKeyDown={handleNewRowKeyDown}
      >
        <td className="px-3 py-2">
          <div className="relative">
            <input
              className={`${inputCls} border-blue-300`}
              value={newRow.sesa_id}
              placeholder="SESA ID"
              onChange={e => setNewField('sesa_id', e.target.value)}
              autoFocus
            />
            {newRowSaving && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-blue-400">saving...</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.first_name} placeholder="First name" onChange={e => setNewField('first_name', e.target.value)} /></td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.last_name} placeholder="Last name" onChange={e => setNewField('last_name', e.target.value)} /></td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.mail} placeholder="mail@..." onChange={e => setNewField('mail', e.target.value)} /></td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.manager_mail} placeholder="manager@..." onChange={e => setNewField('manager_mail', e.target.value)} /></td>
        <td className="px-3 py-2">
          <select className={selectCls} value={newRow.function} onChange={e => handleNewSelect('function', e.target.value)}>
            <option value="">Select...</option>
            {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <select className={selectCls} value={newRow.role} onChange={e => handleNewSelect('role', e.target.value)} disabled={!newRow.function}>
            <option value="">Select...</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.description} placeholder="Description" onChange={e => setNewField('description', e.target.value)} /></td>
        {infoKeys.map(k => (
          <td key={k} className="text-center py-2" style={{ width: INFO_COL_W, minWidth: INFO_COL_W, maxWidth: INFO_COL_W }}>
            <input
              type="checkbox"
              checked={!!newRow[k]}
              onChange={e => handleNewBool(k, e.target.checked)}
              className="w-3 h-3 rounded accent-blue-600 cursor-pointer block mx-auto"
            />
          </td>
        ))}
        <td className="px-3 py-2"><TrainingCell user={newRow} /></td>
        <td className="px-3 py-2"><TlgCell user={newRow} /></td>
        <td className="px-3 py-2">
          <select className={selectCls} value={newRow.status} onChange={e => setNewField('status', e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <input
            type="date"
            className={inputCls}
            value={newRow.last_contact || ''}
            onChange={e => setNewField('last_contact', e.target.value || '')}
          />
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={newRow.comments} placeholder="Comments" onChange={e => setNewField('comments', e.target.value)} /></td>
        <td className="px-3 py-2">
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
        onClick={() => !isEditing && editMode && startEditRow(user)}
        title={String(draft[field] ?? '')}
      />
    );

    return (
      <tr
        key={user.id}
        ref={isEditing ? editRowElRef : null}
        className={`border-b transition-colors ${isEditing
          ? 'bg-amber-50/50 ring-1 ring-inset ring-amber-300'
          : `${STATUS_BG[rowStatus]} ${editMode ? STATUS_HOVER[rowStatus] + ' cursor-pointer' : ''}`}`}
        onBlur={isEditing ? handleEditRowBlur : undefined}
        onFocus={isEditing ? handleEditRowFocus : undefined}
        onKeyDown={isEditing ? e => handleEditRowKeyDown(e, user.id) : undefined}
        onClick={!isEditing && editMode ? () => startEditRow(user) : undefined}
      >
        <td className="px-3 py-2 overflow-hidden">{cellInput('sesa_id', 'SESA ID')}</td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('first_name', 'First name')}</td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('last_name', 'Last name')}</td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('mail', 'mail@...')}</td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('manager_mail', 'manager@...')}</td>
        <td className="px-3 py-2 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.function || ''} onChange={e => handleDraftSelect('function', e.target.value)}>
              <option value="">-</option>
              {matrixFunctions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <span className="text-xs text-slate-700 truncate block" title={user.function || ''}>
              {user.function || <span className="text-slate-300">-</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.role || ''} onChange={e => handleDraftSelect('role', e.target.value)} disabled={!draft.function}>
              <option value="">-</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <span className="text-xs text-slate-700 truncate block" title={user.role || ''}>
              {user.role || <span className="text-slate-300">-</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('description', 'Description')}</td>
        {infoKeys.map(k => (
          <td key={k} className="text-center py-2" style={{ width: INFO_COL_W, minWidth: INFO_COL_W, maxWidth: INFO_COL_W }}>
            {isEditing ? (
              <input
                type="checkbox"
                checked={!!draft[k]}
                onChange={e => handleDraftBool(k, e.target.checked)}
                className="w-3 h-3 rounded accent-blue-600 cursor-pointer block mx-auto"
              />
            ) : (
              <span className={`text-xs font-medium ${draft[k] ? 'text-blue-600' : 'text-slate-300'}`}>
                {draft[k] ? 'Y' : 'N'}
              </span>
            )}
          </td>
        ))}
        <td className="px-3 py-2"><TrainingCell user={draft} /></td>
        <td className="px-3 py-2"><TlgCell user={draft} /></td>
        <td className="px-3 py-2 overflow-hidden">
          {isEditing ? (
            <select className={selectCls} value={draft.status || 'active'} onChange={e => setDraftField('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          ) : (
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
              user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
            }`}>{user.status || '-'}</span>
          )}
        </td>
        <td className="px-3 py-2 overflow-hidden">
          {isEditing ? (
            <input
              type="date"
              className={inputCls}
              value={toDateOnly(draft.last_contact)}
              onChange={e => setDraftField('last_contact', e.target.value || '')}
            />
          ) : (
            <span className="text-xs text-slate-600">
              {toDateOnly(user.last_contact) || <span className="text-slate-300">-</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2 overflow-hidden">{cellInput('comments', 'Comments')}</td>
        <td className="py-2 text-center" style={{ width: 32, minWidth: 32 }}>
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">
            {users.length} user{users.length !== 1 ? 's' : ''}
            {!editMode && <span className="ml-2 text-slate-400 font-normal">- Enable Edit mode to add or modify users</span>}
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap justify-end">
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
          <ToggleSwitch
            checked={editMode}
            onChange={async v => {
              if (!v) {
                discardNewRow();
                if (editingRowIdRef.current !== null) {
                  await doSaveEditRow(editingRowIdRef.current, editRowDraftRef.current);
                  editingRowIdRef.current = null;
                  editRowHasFocus.current = false;
                  setEditingRowId(null);
                }
              }
              setEditMode(v);
              editModeRef.current = v;
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

      {saveError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2 shrink-0">
          Save failed: {saveError}
        </p>
      )}
      {importError && <p className="text-sm text-red-500 mb-2 shrink-0">{importError}</p>}
      {importStats && !importMutation.isPending && (
        <p className="text-sm text-green-600 mb-2 shrink-0">Import complete: {importStats.imported} users.</p>
      )}
      {(editRowSaving || newRowSaving) && <p className="text-xs text-blue-500 mb-1 shrink-0">Saving...</p>}

      <div className="overflow-y-auto overflow-x-auto rounded-xl border bg-white flex-1">
        <table className="text-sm border-collapse" style={{ tableLayout: 'fixed', minWidth: minW }}>
          <colgroup>
            {COLS_BEFORE.map(c => <col key={c.key} style={{ width: c.width }} />)}
            {infoKeys.map(k => <col key={k} style={{ width: INFO_COL_W, minWidth: INFO_COL_W, maxWidth: INFO_COL_W }} />)}
            {COLS_AFTER.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 border-b">
            <tr>
              {COLS_BEFORE.map(c => <th key={c.key} className={thBase}>{c.label}</th>)}
              {infoKeys.map(k => (
                <th
                  key={k}
                  title={k}
                  className="px-0 pb-2 pt-3 text-center align-bottom overflow-hidden bg-slate-50"
                  style={{ width: INFO_COL_W, minWidth: INFO_COL_W, maxWidth: INFO_COL_W }}
                >
                  <span style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    display: 'inline-block',
                    maxHeight: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>{k}</span>
                </th>
              ))}
              <th className={thBase}>
                {COLS_AFTER.find(c => c.key === '_training').label}
                <span className="text-blue-400 normal-case font-normal ml-1">(auto)</span>
              </th>
              <th className={thBase}>
                {COLS_AFTER.find(c => c.key === '_tlg').label}
                <span className="text-blue-400 normal-case font-normal ml-1">(auto)</span>
              </th>
              {COLS_AFTER.filter(c => c.key !== '_training' && c.key !== '_tlg').map(c => (
                <th key={c.key} className={thBase} style={c.key === '_actions' ? { width: 32 } : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editMode && renderNewRow()}
            {isLoading && (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400 text-sm">Loading...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && !newRow && (
              <tr><td colSpan={colCount} className="px-3 py-12 text-center text-slate-400 text-sm">
                {users.length === 0
                  ? 'No users yet. Enable Edit mode then click Add user, or import an Excel file.'
                  : 'No users match the search.'}
              </td></tr>
            )}
            {filtered.map(user => renderRow(user))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
