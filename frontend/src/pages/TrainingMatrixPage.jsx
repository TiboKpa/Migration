import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import client from '../api/client';
import { parseTrainingPathFlat } from '../utils/parseTrainingPathFlat';
import { reResolveRoleMatrix } from '../utils/reResolveRoleMatrix';

const REORDER_SKIP_KEY = 'reorder_confirm_skip';
function getSkipReorderConfirm() { return localStorage.getItem(REORDER_SKIP_KEY) === 'true'; }
function setSkipReorderConfirm() { localStorage.setItem(REORDER_SKIP_KEY, 'true'); }

function durationLabel(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function curriculumDurationParts(modules) {
  const mandatory = modules
    .filter(m => (m.requirement || 'mandatory') === 'mandatory')
    .reduce((s, m) => s + (m.duration_min || 0), 0);
  const total = modules.reduce((s, m) => s + (m.duration_min || 0), 0);
  return {
    mandLabel:  durationLabel(mandatory),
    totalLabel: total !== mandatory ? durationLabel(total) : null,
  };
}

function minutesToHHMM(minutes) {
  if (!minutes) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// -- Toggle switch (mirrors RoleMatrixPage) ------------------------------------
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

// -- Highlight matching text ---------------------------------------------------
function Highlight({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-slate-900 rounded-sm px-0">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// -- Search helpers ------------------------------------------------------------
function matchesQuery(fields, q) {
  if (!q) return true;
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

function detailMatchesQuery(d, q) {
  if (!q || !d) return true;
  if (matchesQuery([d.title, d.description, d.content_id], q)) return true;
  return (d.ordered_items || []).some(item => {
    if (matchesQuery([item.title, item.content_id, item.description], q)) return true;
    if (item.kind === 'curriculum') {
      return (item.modules || []).some(m =>
        matchesQuery([m.module_title || m.title, m.module_content_id || m.content_id], q)
      );
    }
    return false;
  });
}

function Badge({ children, color = 'slate' }) {
  const colors = {
    blue:  'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return <span className={`text-xs border rounded-full px-2 py-0.5 ${colors[color]}`}>{children}</span>;
}

function Sep() {
  return <span className="w-px h-3 bg-slate-300 inline-block" />;
}

function LinkButton({ href }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={e => e.stopPropagation()}
      className="text-xs text-blue-600 hover:underline shrink-0"
    >
      Link
    </a>
  );
}

function DurationInline({ modules }) {
  const { mandLabel, totalLabel } = curriculumDurationParts(modules);
  if (!mandLabel && !totalLabel) return null;
  return (
    <span className="flex items-center gap-2">
      {mandLabel  && <span className="text-xs text-green-600">{mandLabel} mandatory</span>}
      {totalLabel && <span className="text-xs text-slate-400">{totalLabel} total</span>}
    </span>
  );
}

function InlineField({ label, value, onChange, type = 'text', min }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      <input
        type={type}
        min={min}
        className="border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function FormBox({ title, children, onSave, onCancel, saveDisabled }) {
  return (
    <div className="bg-slate-50 border rounded-xl p-4 mb-4">
      {title && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</p>}
      {children}
      <div className="flex gap-2 mt-3">
        <button onClick={onSave} disabled={saveDisabled}
          className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
          Save
        </button>
        <button onClick={onCancel}
          className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// -- Reorder toast -------------------------------------------------------------
function useReorderToast() {
  const [toast, setToast] = useState(null);

  function requestReorder(label, onConfirm) {
    if (getSkipReorderConfirm()) { onConfirm(); return; }
    setToast({ label, onConfirm, skipChecked: false });
  }

  function confirm() {
    if (toast?.skipChecked) setSkipReorderConfirm();
    toast?.onConfirm();
    setToast(null);
  }

  function dismiss() { setToast(null); }

  const ToastUI = toast ? (
    <div className="fixed bottom-6 right-6 z-50 bg-white border shadow-lg rounded-xl p-4 w-80 flex flex-col gap-3">
      <p className="text-sm font-semibold text-slate-800">Confirm reorder</p>
      <p className="text-sm text-slate-600">{toast.label}</p>
      <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
        <input type="checkbox" checked={toast.skipChecked}
          onChange={e => setToast(t => ({ ...t, skipChecked: e.target.checked }))}
          className="rounded" />
        Do not ask again
      </label>
      <div className="flex gap-2">
        <button onClick={confirm}
          className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 flex-1">
          Confirm
        </button>
        <button onClick={dismiss}
          className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  return { requestReorder, ToastUI };
}

// -- Drag-to-reorder list ------------------------------------------------------
function DraggableList({ items, onReorder, renderItem }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  function handleDragStart(e, idx) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(e.currentTarget, 12, 12);
  }

  function handleDrop(e, idx) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { reset(); return; }
    onReorder(dragIdx, idx);
    reset();
  }

  function reset() { setDragIdx(null); setOverIdx(null); }

  return (
    <div onDragOver={e => e.preventDefault()}>
      {items.map((item, idx) => (
        <div
          key={item.id}
          draggable
          onDragStart={e => handleDragStart(e, idx)}
          onDragEnter={() => { if (idx !== dragIdx) setOverIdx(idx); }}
          onDrop={e => handleDrop(e, idx)}
          onDragEnd={reset}
          className={`transition-all ${
            overIdx === idx && dragIdx !== idx ? 'border-t-2 border-blue-400' : ''
          } ${dragIdx === idx ? 'opacity-40' : ''}`}
        >
          {renderItem(item, idx)}
        </div>
      ))}
    </div>
  );
}

// -- Modules tab ---------------------------------------------------------------

function ModulesTab({ projectId, search, editMode, reloadKey }) {
  const [modules, setModules]     = useState([]);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState({ title: '', content_id: '', duration_min: '', link: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm]   = useState({});

  const load = useCallback(async () => {
    const r = await client.get(`/projects/${projectId}/modules`);
    setModules(Array.isArray(r.data) ? r.data : []);
  }, [projectId]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function save() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/modules`, {
      title:        form.title.trim(),
      content_id:   form.content_id.trim() || null,
      duration_min: parseInt(form.duration_min) || 0,
      link:         form.link.trim() || null,
    });
    setForm({ title: '', content_id: '', duration_min: '', link: '' });
    setShowAdd(false);
    load();
    reResolveRoleMatrix(projectId);
  }

  async function saveEdit(id) {
    await client.put(`/projects/${projectId}/modules/${id}`, {
      title:        editForm.title.trim(),
      content_id:   editForm.content_id.trim() || null,
      duration_min: parseInt(editForm.duration_min) || 0,
      link:         editForm.link.trim() || null,
    });
    setEditingId(null);
    load();
    reResolveRoleMatrix(projectId);
  }

  async function del(id) {
    if (!confirm('Delete this module? It will be removed from all curricula.')) return;
    await client.delete(`/projects/${projectId}/modules/${id}`);
    load();
    reResolveRoleMatrix(projectId);
  }

  async function delAll() {
    if (!confirm('Delete ALL modules? This cannot be undone.')) return;
    await client.delete(`/projects/${projectId}/modules`);
    load();
    reResolveRoleMatrix(projectId);
  }

  function startEdit(mod) {
    setEditingId(mod.id);
    setEditForm({
      title:        mod.title,
      content_id:   mod.content_id || '',
      duration_min: mod.duration_min || '',
      link:         mod.link || '',
    });
  }

  const q = search.trim().toLowerCase();
  const filtered = modules.filter(m =>
    matchesQuery([m.title, m.content_id, m.link], q)
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {filtered.length}{filtered.length !== modules.length ? ` / ${modules.length}` : ''} module{modules.length !== 1 ? 's' : ''}
        </h3>
        <div className="flex gap-2">
          {editMode && modules.length > 0 && (
            <button onClick={delAll}
              className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50">
              Delete all
            </button>
          )}
          <button onClick={() => setShowAdd(v => !v)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            + New module
          </button>
        </div>
      </div>

      {showAdd && (
        <FormBox title="New module" onSave={save} onCancel={() => setShowAdd(false)} saveDisabled={!form.title.trim()}>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <InlineField label="Title *" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} />
            </div>
            <InlineField label="Content ID" value={form.content_id} onChange={v => setForm(f => ({ ...f, content_id: v }))} />
            <InlineField label="Duration (min)" type="number" min="0" value={form.duration_min} onChange={v => setForm(f => ({ ...f, duration_min: v }))} />
            <div className="col-span-2">
              <InlineField label="Link" value={form.link} onChange={v => setForm(f => ({ ...f, link: v }))} />
            </div>
          </div>
        </FormBox>
      )}

      {filtered.length === 0 && !showAdd && (
        <p className="text-xs text-slate-400 py-4 text-center">
          {modules.length === 0 ? 'No modules yet.' : 'No modules match your search.'}
        </p>
      )}

      <div className="border rounded-xl overflow-hidden bg-white">
        {filtered.map((mod, i) => (
          <div key={mod.id} className={`px-4 py-3 ${i < filtered.length - 1 ? 'border-b' : ''}`}>
            {editingId === mod.id ? (
              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2">
                  <InlineField label="Title *" value={editForm.title} onChange={v => setEditForm(f => ({ ...f, title: v }))} />
                </div>
                <InlineField label="Content ID" value={editForm.content_id} onChange={v => setEditForm(f => ({ ...f, content_id: v }))} />
                <InlineField label="Duration (min)" type="number" min="0" value={editForm.duration_min} onChange={v => setEditForm(f => ({ ...f, duration_min: v }))} />
                <div className="col-span-2">
                  <InlineField label="Link" value={editForm.link} onChange={v => setEditForm(f => ({ ...f, link: v }))} />
                </div>
                <div className="col-span-3 flex gap-2">
                  <button onClick={() => saveEdit(mod.id)} disabled={!editForm.title.trim()}
                    className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40">Save</button>
                  <button onClick={() => setEditingId(null)}
                    className="border px-3 py-1 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm text-slate-800 font-medium truncate">
                    <Highlight text={mod.title} query={q} />
                  </span>
                  {mod.content_id && (
                    <Badge color="blue"><Highlight text={mod.content_id} query={q} /></Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {mod.duration_min > 0 && (
                    <>
                      <span className="text-xs text-slate-400">{durationLabel(mod.duration_min)}</span>
                      <Sep />
                    </>
                  )}
                  <LinkButton href={mod.link} />
                  {mod.link && <Sep />}
                  <button onClick={() => startEdit(mod)} className="text-xs text-slate-400 hover:text-slate-700">Edit</button>
                  {editMode && (
                    <button onClick={() => del(mod.id)} className="text-xs text-red-300 hover:text-red-500">Delete</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Curricula tab -------------------------------------------------------------

function CurriculaTab({ projectId, search, editMode, reloadKey }) {
  const [curricula, setCurricula]     = useState([]);
  const [allModules, setAllModules]   = useState([]);
  const [showAdd, setShowAdd]         = useState(false);
  const [form, setForm]               = useState({ title: '', content_id: '', link: '' });
  const [editingId, setEditingId]     = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [openId, setOpenId]           = useState(null);
  const [addModState, setAddModState] = useState({});
  const { requestReorder, ToastUI }   = useReorderToast();

  const loadAll = useCallback(async () => {
    const [cRes, mRes] = await Promise.all([
      client.get(`/projects/${projectId}/curricula`),
      client.get(`/projects/${projectId}/modules`),
    ]);
    setCurricula(Array.isArray(cRes.data) ? cRes.data : []);
    setAllModules(Array.isArray(mRes.data) ? mRes.data : []);
  }, [projectId]);

  useEffect(() => { loadAll(); }, [loadAll, reloadKey]);

  async function saveCurriculum() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/curricula`, {
      title:      form.title.trim(),
      content_id: form.content_id.trim() || null,
      link:       form.link.trim() || null,
    });
    setForm({ title: '', content_id: '', link: '' });
    setShowAdd(false);
    loadAll();
    reResolveRoleMatrix(projectId);
  }

  async function saveEditCurriculum(id) {
    await client.put(`/projects/${projectId}/curricula/${id}`, {
      title:      editForm.title.trim(),
      content_id: editForm.content_id.trim() || null,
      link:       editForm.link.trim() || null,
    });
    setEditingId(null);
    loadAll();
    reResolveRoleMatrix(projectId);
  }

  async function delCurriculum(id) {
    if (!confirm('Delete this curriculum? Modules inside it will not be deleted.')) return;
    await client.delete(`/projects/${projectId}/curricula/${id}`);
    loadAll();
    reResolveRoleMatrix(projectId);
  }

  async function delAll() {
    if (!confirm('Delete ALL curricula? Modules will not be deleted.')) return;
    await client.delete(`/projects/${projectId}/curricula`);
    loadAll();
    reResolveRoleMatrix(projectId);
  }

  async function addModuleToCurriculum(curId) {
    const state = addModState[curId];
    if (!state?.module_id) return;
    const cur = curricula.find(c => c.id === curId);
    const existingOrders = (cur?.modules || []).map(m => m.sequence_order);
    let pos = parseInt(state.sequence_order);
    if (!pos || pos < 1) {
      pos = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1;
    }
    await client.post(`/projects/${projectId}/curricula/${curId}/modules`, {
      module_id:      parseInt(state.module_id),
      requirement:    state.requirement || 'mandatory',
      sequence_order: pos,
    });
    setAddModState(s => ({ ...s, [curId]: undefined }));
    loadAll();
  }

  async function removeModuleFromCurriculum(curId, modId) {
    await client.delete(`/projects/${projectId}/curricula/${curId}/modules/${modId}`);
    loadAll();
  }

  function handleCurriculumModuleReorder(cur, fromIdx, toIdx) {
    const modules  = [...(cur.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
    const item     = modules[fromIdx];
    const target   = modules[toIdx];
    const oldOrder = item.sequence_order;
    const newOrder = target.sequence_order;
    const title    = item.module_title || item.title || 'module';
    requestReorder(
      `Move "${title}" from position ${oldOrder} to ${newOrder}.`,
      async () => {
        await client.patch(
          `/projects/${projectId}/curricula/${cur.id}/modules/${item.module_id}/reorder`,
          { new_order: newOrder }
        );
        loadAll();
      }
    );
  }

  const q = search.trim().toLowerCase();

  const filtered = curricula.filter(cur => {
    if (matchesQuery([cur.title, cur.content_id, cur.link], q)) return true;
    return (cur.modules || []).some(m =>
      matchesQuery([m.module_title || m.title, m.module_content_id || m.content_id], q)
    );
  });

  return (
    <div>
      {ToastUI}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {filtered.length}{filtered.length !== curricula.length ? ` / ${curricula.length}` : ''} {curricula.length === 1 ? 'curriculum' : 'curricula'}
        </h3>
        <div className="flex gap-2">
          {editMode && curricula.length > 0 && (
            <button onClick={delAll}
              className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50">
              Delete all
            </button>
          )}
          <button onClick={() => setShowAdd(v => !v)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            + New curriculum
          </button>
        </div>
      </div>

      {showAdd && (
        <FormBox title="New curriculum" onSave={saveCurriculum} onCancel={() => setShowAdd(false)} saveDisabled={!form.title.trim()}>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <InlineField label="Title *" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} />
            </div>
            <InlineField label="Content ID" value={form.content_id} onChange={v => setForm(f => ({ ...f, content_id: v }))} />
            <div className="col-span-3">
              <InlineField label="Link" value={form.link} onChange={v => setForm(f => ({ ...f, link: v }))} />
            </div>
          </div>
        </FormBox>
      )}

      {filtered.length === 0 && !showAdd && (
        <p className="text-xs text-slate-400 py-4 text-center">
          {curricula.length === 0 ? 'No curricula yet.' : 'No curricula match your search.'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map(cur => {
          const sortedMods      = [...(cur.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
          const curHeaderMatch  = matchesQuery([cur.title, cur.content_id, cur.link], q);
          const matchingModIds  = new Set(
            sortedMods
              .filter(m => matchesQuery([m.module_title || m.title, m.module_content_id || m.content_id], q))
              .map(m => m.module_id)
          );
          const shouldBeOpen    = openId === cur.id || (q && matchingModIds.size > 0);

          const addState   = addModState[cur.id] || {};
          const usedIds    = new Set((cur.modules || []).map(m => m.module_id));
          const available  = allModules.filter(m => !usedIds.has(m.id));
          const maxOrder   = (cur.modules || []).reduce((mx, m) => Math.max(mx, m.sequence_order || 0), 0);

          return (
            <div key={cur.id} className={`border rounded-xl overflow-hidden bg-white ${
              q && (curHeaderMatch || matchingModIds.size > 0) ? 'ring-1 ring-yellow-300' : ''
            }`}>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                {editingId === cur.id ? (
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <input autoFocus
                        className="border rounded-lg px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        value={editForm.title}
                        onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                      />
                      <input
                        className="border rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        placeholder="Content ID"
                        value={editForm.content_id}
                        onChange={e => setEditForm(f => ({ ...f, content_id: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="border rounded-lg px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        placeholder="Link (https://...)"
                        value={editForm.link}
                        onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))}
                      />
                      <button onClick={() => saveEditCurriculum(cur.id)} disabled={!editForm.title.trim()}
                        className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40">Save</button>
                      <button onClick={() => setEditingId(null)}
                        className="border px-3 py-1 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setOpenId(shouldBeOpen && openId === cur.id ? null : cur.id)}
                      className="flex items-center gap-2 flex-1 text-left min-w-0 truncate">
                      <span className="text-sm font-semibold text-slate-800 truncate">
                        <Highlight text={cur.title} query={q} />
                      </span>
                      {cur.content_id && (
                        <Badge color="blue"><Highlight text={cur.content_id} query={q} /></Badge>
                      )}
                      <Badge color="slate">{sortedMods.length} module{sortedMods.length !== 1 ? 's' : ''}</Badge>
                      {q && matchingModIds.size > 0 && !curHeaderMatch && (
                        <span className="text-xs text-yellow-600 font-medium">{matchingModIds.size} match{matchingModIds.size > 1 ? 'es' : ''} inside</span>
                      )}
                    </button>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <DurationInline modules={sortedMods} />
                      {curriculumDurationParts(sortedMods).mandLabel && <Sep />}
                      <LinkButton href={cur.link} />
                      {cur.link && <Sep />}
                      <button onClick={() => { setEditingId(cur.id); setEditForm({ title: cur.title, content_id: cur.content_id || '', link: cur.link || '' }); }}
                        className="text-xs text-slate-400 hover:text-slate-700">Edit</button>
                      {editMode && (
                        <button onClick={() => delCurriculum(cur.id)}
                          className="text-xs text-red-300 hover:text-red-500">Delete</button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {shouldBeOpen && (
                <div className="px-4 py-3">
                  {sortedMods.length === 0 && (
                    <p className="text-xs text-slate-400 mb-3">No modules yet.</p>
                  )}

                  <DraggableList
                    items={sortedMods.map(m => ({ id: m.module_id, ...m }))}
                    onReorder={(fromIdx, toIdx) => handleCurriculumModuleReorder(cur, fromIdx, toIdx)}
                    renderItem={(item, idx) => {
                      const modMatch = q && matchingModIds.has(item.module_id);
                      return (
                        <div className={`flex items-center justify-between py-1.5 ${
                          idx < sortedMods.length - 1 ? 'border-b' : ''
                        } ${modMatch ? 'bg-yellow-50 -mx-4 px-4' : ''}`}>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                            <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                            <span className="text-sm text-slate-700 truncate">
                              <Highlight text={item.module_title || item.title} query={q} />
                            </span>
                            {item.module_content_id && (
                              <Badge color="blue"><Highlight text={item.module_content_id} query={q} /></Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {item.duration_min > 0 && (
                              <>
                                <span className="text-xs text-slate-400">{durationLabel(item.duration_min)}</span>
                                <Sep />
                              </>
                            )}
                            <Badge color={item.requirement === 'mandatory' ? 'green' : 'amber'}>{item.requirement}</Badge>
                            {editMode && (
                              <button onClick={() => removeModuleFromCurriculum(cur.id, item.module_id)}
                                className="text-xs text-red-300 hover:text-red-500">Remove</button>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />

                  <div className="mt-3 pt-3 border-t flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500 block mb-1">Add module</label>
                      <select className="border rounded-lg px-2 py-1.5 text-sm w-full"
                        value={addState.module_id || ''}
                        onChange={e => setAddModState(s => ({ ...s, [cur.id]: { ...addState, module_id: e.target.value } }))}>
                        <option value="">Select a module...</option>
                        {available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="text-xs text-slate-500 block mb-1">Requirement</label>
                      <select className="border rounded-lg px-2 py-1.5 text-sm w-full"
                        value={addState.requirement || 'mandatory'}
                        onChange={e => setAddModState(s => ({ ...s, [cur.id]: { ...addState, requirement: e.target.value } }))}>
                        <option value="mandatory">Mandatory</option>
                        <option value="optional">Optional</option>
                      </select>
                    </div>
                    <div className="w-20">
                      <label className="text-xs text-slate-500 block mb-1">Position</label>
                      <input type="number" min="1" className="border rounded-lg px-2 py-1.5 text-sm w-full"
                        placeholder={String(maxOrder + 1)}
                        value={addState.sequence_order || ''}
                        onChange={e => setAddModState(s => ({ ...s, [cur.id]: { ...addState, sequence_order: e.target.value } }))}
                      />
                    </div>
                    <button onClick={() => addModuleToCurriculum(cur.id)} disabled={!addState.module_id}
                      className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0">
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- Playlists tab -------------------------------------------------------------

function PlaylistsTab({ projectId, search, editMode, reloadKey }) {
  const [playlists, setPlaylists]         = useState([]);
  const [selected, setSelected]           = useState(null);
  const [detail, setDetail]               = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState({ title: '', description: '', link: '', content_id: '' });
  const [editingMode, setEditingMode]     = useState(false);
  const [editForm, setEditForm]           = useState({});
  const [allModules, setAllModules]       = useState([]);
  const [allCurricula, setAllCurricula]   = useState([]);
  const [showAddItem, setShowAddItem]     = useState(false);
  const [newItem, setNewItem]             = useState({ type: 'curriculum', id: '', sequence_order: '' });
  const { requestReorder, ToastUI }       = useReorderToast();

  const detailCache = useRef({});
  const [cacheVersion, setCacheVersion] = useState(0);

  const loadList = useCallback(async () => {
    const r = await client.get(`/projects/${projectId}/playlists`);
    const list = Array.isArray(r.data) ? r.data : [];
    setPlaylists(list);
    const results = await Promise.allSettled(
      list.map(pl => client.get(`/projects/${projectId}/playlists/${pl.id}`))
    );
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        detailCache.current[list[i].id] = res.value.data;
      }
    });
    setCacheVersion(v => v + 1);
  }, [projectId]);

  const loadDetail = useCallback(async (id) => {
    setLoadingDetail(true);
    const [dRes, mRes, cRes] = await Promise.all([
      client.get(`/projects/${projectId}/playlists/${id}`),
      client.get(`/projects/${projectId}/modules`),
      client.get(`/projects/${projectId}/curricula`),
    ]);
    detailCache.current[id] = dRes.data;
    setCacheVersion(v => v + 1);
    setDetail(dRes.data);
    setAllModules(Array.isArray(mRes.data) ? mRes.data : []);
    setAllCurricula(Array.isArray(cRes.data) ? cRes.data : []);
    setLoadingDetail(false);
  }, [projectId]);

  useEffect(() => {
    detailCache.current = {};
    setSelected(null);
    setDetail(null);
    loadList();
  }, [loadList, reloadKey]);

  function select(pl) {
    setSelected(pl.id);
    loadDetail(pl.id);
    setEditingMode(false);
    setShowAddItem(false);
  }

  async function create() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/playlists`, { ...form, is_complementary: !form.link.trim() });
    setForm({ title: '', description: '', link: '', content_id: '' });
    setShowAdd(false);
    loadList();
    reResolveRoleMatrix(projectId);
  }

  async function update() {
    await client.put(`/projects/${projectId}/playlists/${selected}`, { ...editForm, is_complementary: !editForm.link?.trim() });
    setEditingMode(false);
    loadList();
    loadDetail(selected);
    reResolveRoleMatrix(projectId);
  }

  async function del() {
    if (!confirm('Delete this playlist and all its items?')) return;
    await client.delete(`/projects/${projectId}/playlists/${selected}`);
    delete detailCache.current[selected];
    setSelected(null);
    setDetail(null);
    loadList();
    reResolveRoleMatrix(projectId);
  }

  async function delAll() {
    if (!confirm('Delete ALL playlists? This cannot be undone.')) return;
    await client.delete(`/projects/${projectId}/playlists`);
    detailCache.current = {};
    setSelected(null);
    setDetail(null);
    loadList();
    reResolveRoleMatrix(projectId);
  }

  async function addItem() {
    if (!newItem.id) return;
    const orderedItems = detail?.ordered_items || [];
    const maxOrder = orderedItems.reduce((mx, i) => Math.max(mx, i.sequence_order || 0), 0);
    let pos = parseInt(newItem.sequence_order);
    if (!pos || pos < 1) pos = maxOrder + 1;
    await client.post(`/projects/${projectId}/playlists/${selected}/items`, {
      curriculum_id:  newItem.type === 'curriculum' ? parseInt(newItem.id) : null,
      module_id:      newItem.type === 'module'     ? parseInt(newItem.id) : null,
      sequence_order: pos,
    });
    setNewItem({ type: 'curriculum', id: '', sequence_order: '' });
    setShowAddItem(false);
    loadDetail(selected);
  }

  async function removeItem(itemId) {
    await client.delete(`/projects/${projectId}/playlists/${selected}/items/${itemId}`);
    loadDetail(selected);
  }

  function handlePlaylistItemReorder(fromIdx, toIdx) {
    const items    = detail?.ordered_items || [];
    const item     = items[fromIdx];
    const target   = items[toIdx];
    const oldOrder = item.sequence_order;
    const newOrder = target.sequence_order;
    const label    = item.title || (item.kind === 'module' ? 'module' : 'curriculum');
    requestReorder(
      `Move "${label}" from position ${oldOrder} to ${newOrder}.`,
      async () => {
        await client.patch(
          `/projects/${projectId}/playlists/${selected}/items/${item.playlist_item_id}/reorder`,
          { new_order: newOrder }
        );
        loadDetail(selected);
      }
    );
  }

  function handleCurriculumModuleReorderInPlaylist(cur, fromIdx, toIdx) {
    const mods     = [...(cur.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
    const item     = mods[fromIdx];
    const target   = mods[toIdx];
    const oldOrder = item.sequence_order;
    const newOrder = target.sequence_order;
    const title    = item.module_title || item.title || 'module';
    requestReorder(
      `Move "${title}" from position ${oldOrder} to ${newOrder} inside "${cur.title}".`,
      async () => {
        await client.patch(
          `/projects/${projectId}/curricula/${cur.curriculum_id}/modules/${item.module_id}/reorder`,
          { new_order: newOrder }
        );
        loadDetail(selected);
      }
    );
  }

  const q = search.trim().toLowerCase();

  function playlistMatches(pl) {
    if (!q) return true;
    const cached = detailCache.current[pl.id];
    if (cached) return detailMatchesQuery(cached, q);
    return matchesQuery([pl.title, pl.description, pl.content_id], q);
  }

  const primary       = playlists.filter(p => !p.is_complementary && playlistMatches(p));
  const complementary = playlists.filter(p =>  p.is_complementary && playlistMatches(p));
  const orderedItems  = detail?.ordered_items || [];

  function itemMatchesQuery(item) {
    if (!q) return false;
    if (matchesQuery([item.title, item.content_id, item.description], q)) return true;
    if (item.kind === 'curriculum') {
      return (item.modules || []).some(m =>
        matchesQuery([m.module_title || m.title, m.module_content_id || m.content_id], q)
      );
    }
    return false;
  }

  function moduleInItemMatchesQuery(mod) {
    if (!q) return false;
    return matchesQuery([mod.module_title || mod.title, mod.module_content_id || mod.content_id], q);
  }

  const standaloneModuleIds = new Set(
    orderedItems.filter(i => i.kind === 'module').map(i => i.module_id)
  );
  const inCurriculumModuleIds = new Set(
    orderedItems
      .filter(i => i.kind === 'curriculum')
      .flatMap(i => (i.modules || []).map(m => m.module_id))
  );
  const usedCurriculumIds = new Set(
    orderedItems.filter(i => i.kind === 'curriculum').map(i => i.curriculum_id)
  );

  const availableModules   = allModules.filter(m => !standaloneModuleIds.has(m.id));
  const availableCurricula = allCurricula.filter(c => !usedCurriculumIds.has(c.id));
  const availableForAdd    = newItem.type === 'curriculum' ? availableCurricula : availableModules;

  return (
    <div className="flex gap-6 flex-1 min-h-0">
      {ToastUI}
      {/* Sidebar */}
      <div className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Primary</p>
            <button onClick={() => setShowAdd(v => !v)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ New</button>
          </div>
          <div className="border rounded-xl overflow-hidden bg-white">
            {primary.length === 0 && <p className="text-xs text-slate-400 p-3">{search ? 'No match.' : 'None yet.'}</p>}
            {primary.map(pl => (
              <button key={pl.id} onClick={() => select(pl)}
                className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors
                  ${selected === pl.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                <Highlight text={pl.title} query={q} />
              </button>
            ))}
          </div>
        </div>

        {(complementary.length > 0 || (search && playlists.some(p => p.is_complementary))) && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Complementary</p>
            <div className="border rounded-xl overflow-hidden bg-white">
              {complementary.length === 0 && <p className="text-xs text-slate-400 p-3">No match.</p>}
              {complementary.map(pl => (
                <button key={pl.id} onClick={() => select(pl)}
                  className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors
                    ${selected === pl.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <Highlight text={pl.title} query={q} />
                </button>
              ))}
            </div>
          </div>
        )}

        {editMode && playlists.length > 0 && (
          <button onClick={delAll}
            className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50 w-full">
            Delete all playlists
          </button>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {showAdd && (
          <FormBox title="New playlist" onSave={create} onCancel={() => setShowAdd(false)} saveDisabled={!form.title.trim()}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <InlineField label="Title *" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} />
              </div>
              <InlineField label="Link (leave empty for complementary)" value={form.link} onChange={v => setForm(f => ({ ...f, link: v }))} />
              <InlineField label="Content ID" value={form.content_id} onChange={v => setForm(f => ({ ...f, content_id: v }))} />
              <div className="col-span-2">
                <InlineField label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
              </div>
            </div>
          </FormBox>
        )}

        {!selected && !showAdd && (
          <p className="text-sm text-slate-400 mt-16 text-center">Select a playlist to view it.</p>
        )}
        {selected && loadingDetail && (
          <p className="text-sm text-slate-400 mt-16 text-center">Loading...</p>
        )}

        {selected && !loadingDetail && detail && (
          <div className="flex flex-col gap-6">
            {editingMode ? (
              <FormBox title="Edit playlist" onSave={update} onCancel={() => setEditingMode(false)} saveDisabled={!editForm.title?.trim()}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <InlineField label="Title *" value={editForm.title || ''} onChange={v => setEditForm(f => ({ ...f, title: v }))} />
                  </div>
                  <InlineField label="Link" value={editForm.link || ''} onChange={v => setEditForm(f => ({ ...f, link: v }))} />
                  <InlineField label="Content ID" value={editForm.content_id || ''} onChange={v => setEditForm(f => ({ ...f, content_id: v }))} />
                  <div className="col-span-2">
                    <InlineField label="Description" value={editForm.description || ''} onChange={v => setEditForm(f => ({ ...f, description: v }))} />
                  </div>
                </div>
              </FormBox>
            ) : (
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-800">
                      <Highlight text={detail.title} query={q} />
                    </h2>
                    {detail.is_complementary ? <Badge color="amber">Complementary</Badge> : <Badge color="green">Primary</Badge>}
                    {detail.content_id && (
                      <Badge color="blue"><Highlight text={detail.content_id} query={q} /></Badge>
                    )}
                  </div>
                  {detail.description && (
                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                      <Highlight text={detail.description} query={q} />
                    </p>
                  )}
                  <div className="flex gap-3 mt-1 items-center flex-wrap">
                    {detail.total_minutes > 0 && <span className="text-xs text-slate-400">{durationLabel(detail.total_minutes)} mandatory</span>}
                    {detail.link && <a href={detail.link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open link</a>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setEditingMode(true); setEditForm({ title: detail.title, description: detail.description, link: detail.link, content_id: detail.content_id }); }}
                    className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Edit</button>
                  {editMode && (
                    <button onClick={del}
                      className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50">Delete</button>
                  )}
                </div>
              </div>
            )}

            {detail.is_complementary ? (
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-3">References</p>
                {(detail.complementary_refs || []).length === 0 && (
                  <p className="text-xs text-slate-400">No references.</p>
                )}
                <div className="border rounded-xl overflow-hidden bg-white">
                  {(detail.complementary_refs || []).map((ref, idx) => (
                    <div key={ref.id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${idx < detail.complementary_refs.length - 1 ? 'border-b' : ''}`}>
                      <span className="text-xs text-slate-400 w-5 text-right shrink-0">{ref.sequence_order}</span>
                      <span className="text-sm text-slate-700 flex-1 truncate">
                        <Highlight text={ref.title} query={q} />
                      </span>
                      {ref.content_id && <Badge color="blue"><Highlight text={ref.content_id} query={q} /></Badge>}
                      {ref.link && <a href={ref.link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Link</a>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">Content</p>
                  <button onClick={() => setShowAddItem(v => !v)}
                    className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">+ Add item</button>
                </div>

                {showAddItem && (
                  <FormBox onSave={addItem} onCancel={() => setShowAddItem(false)} saveDisabled={!newItem.id}>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Type</label>
                        <select className="border rounded-lg px-2 py-1.5 text-sm w-full"
                          value={newItem.type}
                          onChange={e => setNewItem(n => ({ ...n, type: e.target.value, id: '' }))}>
                          <option value="curriculum">Curriculum</option>
                          <option value="module">Module</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">{newItem.type === 'curriculum' ? 'Curriculum' : 'Module'}</label>
                        <select className="border rounded-lg px-2 py-1.5 text-sm w-full"
                          value={newItem.id}
                          onChange={e => setNewItem(n => ({ ...n, id: e.target.value }))}>
                          <option value="">Select...</option>
                          {availableForAdd.map(x => (
                            <option key={x.id} value={x.id}>
                              {x.title}{newItem.type === 'module' && inCurriculumModuleIds.has(x.id) ? ' (in curriculum)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <InlineField label="Position (blank = end)" type="number" min="1"
                        value={newItem.sequence_order}
                        onChange={v => setNewItem(n => ({ ...n, sequence_order: v }))} />
                    </div>
                  </FormBox>
                )}

                {orderedItems.length === 0 && (
                  <p className="text-xs text-slate-400">No items yet.</p>
                )}

                <DraggableList
                  items={orderedItems.map(i => ({ id: i.playlist_item_id, ...i }))}
                  onReorder={handlePlaylistItemReorder}
                  renderItem={(item) => {
                    const itemMatch = itemMatchesQuery(item);
                    if (item.kind === 'curriculum') {
                      const sortedMods = [...(item.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
                      const hasDuration = !!curriculumDurationParts(sortedMods).mandLabel;
                      return (
                        <details className={`border rounded-xl overflow-hidden mb-1 ${
                          itemMatch ? 'ring-1 ring-yellow-300' : ''
                        }`} open>
                          <summary className="flex items-center justify-between px-4 py-2.5 bg-slate-50 cursor-pointer list-none">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                              <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                              <span className="text-sm font-semibold text-slate-700 truncate">
                                <Highlight text={item.title} query={q} />
                              </span>
                              {item.content_id && (
                                <Badge color="blue"><Highlight text={item.content_id} query={q} /></Badge>
                              )}
                              <Badge color="slate">{sortedMods.length} module{sortedMods.length !== 1 ? 's' : ''}</Badge>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-3">
                              <DurationInline modules={sortedMods} />
                              {hasDuration && <Sep />}
                              <LinkButton href={item.link} />
                              {item.link && <Sep />}
                              {editMode && (
                                <button onClick={e => { e.preventDefault(); removeItem(item.playlist_item_id); }}
                                  className="text-xs text-red-300 hover:text-red-500">Remove</button>
                              )}
                            </div>
                          </summary>
                          <div className="px-4 py-2">
                            {sortedMods.length === 0 && <p className="text-xs text-slate-400">No modules in this curriculum.</p>}
                            <DraggableList
                              items={sortedMods.map(m => ({ id: m.module_id, ...m }))}
                              onReorder={(fi, ti) => handleCurriculumModuleReorderInPlaylist(item, fi, ti)}
                              renderItem={(mod, idx) => {
                                const modMatch = moduleInItemMatchesQuery(mod);
                                return (
                                  <div className={`flex items-center justify-between py-1.5 ${
                                    idx < sortedMods.length - 1 ? 'border-b' : ''
                                  } ${modMatch ? 'bg-yellow-50 -mx-4 px-4' : ''}`}>
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                                      <span className="text-xs text-slate-400 w-5 text-right shrink-0">{mod.sequence_order}</span>
                                      <span className="text-sm text-slate-700 truncate">
                                        <Highlight text={mod.module_title || mod.title} query={q} />
                                      </span>
                                      {mod.module_content_id && (
                                        <Badge color="blue"><Highlight text={mod.module_content_id} query={q} /></Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {mod.duration_min > 0 && (
                                        <>
                                          <span className="text-xs text-slate-400">{durationLabel(mod.duration_min)}</span>
                                          <Sep />
                                        </>
                                      )}
                                      <Badge color={mod.requirement === 'mandatory' ? 'green' : 'amber'}>{mod.requirement}</Badge>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          </div>
                        </details>
                      );
                    }
                    return (
                      <div className={`border rounded-xl bg-white flex items-center justify-between px-4 py-2.5 mb-1 ${
                        itemMatch ? 'ring-1 ring-yellow-300 bg-yellow-50' : ''
                      }`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                          <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                          <span className="text-sm text-slate-700 truncate">
                            <Highlight text={item.title} query={q} />
                          </span>
                          {item.content_id && (
                            <Badge color="blue"><Highlight text={item.content_id} query={q} /></Badge>
                          )}
                          <Badge color="slate">Module</Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {item.duration_min > 0 && (
                            <>
                              <span className="text-xs text-slate-400">{durationLabel(item.duration_min)}</span>
                              <Sep />
                            </>
                          )}
                          <LinkButton href={item.link} />
                          {item.link && <Sep />}
                          {editMode && (
                            <button onClick={() => removeItem(item.playlist_item_id)}
                              className="text-xs text-red-300 hover:text-red-500">Remove</button>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Export helper -------------------------------------------------------------

async function buildExportWorkbook(projectId) {
  const [mRes, cRes, pRes] = await Promise.all([
    client.get(`/projects/${projectId}/modules`),
    client.get(`/projects/${projectId}/curricula`),
    client.get(`/projects/${projectId}/playlists`),
  ]);

  const modules   = Array.isArray(mRes.data) ? mRes.data : [];
  const curricula = Array.isArray(cRes.data) ? cRes.data : [];
  const playlists = Array.isArray(pRes.data) ? pRes.data.filter(p => !p.is_complementary) : [];

  // Fetch all playlist details
  const detailResults = await Promise.allSettled(
    playlists.map(pl => client.get(`/projects/${projectId}/playlists/${pl.id}`))
  );
  const detailedPlaylists = playlists.map((pl, i) => ({
    ...pl,
    ordered_items: detailResults[i].status === 'fulfilled' ? (detailResults[i].value.data.ordered_items || []) : [],
  }));

  const wb = XLSX.utils.book_new();

  // ---- Sheet: Training Path Flat ----
  const COL_PLAYLIST_START = 11;

  const playlistSeqMaps = detailedPlaylists.map(pl => {
    const m = new Map();
    for (const item of pl.ordered_items) {
      m.set((item.title || '').toLowerCase(), item.sequence_order);
    }
    return m;
  });

  const moduleInCurriculumIds = new Set(
    curricula.flatMap(c => (c.modules || []).map(m => m.module_id))
  );
  const standaloneModules = modules.filter(m => !moduleInCurriculumIds.has(m.id));

  const dataRows = [];

  curricula.forEach((cur, cIdx) => {
    const chapterNum = cIdx + 1;
    const sortedMods = [...(cur.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
    const curSeqs = detailedPlaylists.map((_, pi) => playlistSeqMaps[pi].get((cur.title || '').toLowerCase()) ?? '');
    dataRows.push({
      group: '',
      rowNum: '',
      chapter: 0,
      brick: 0,
      title: cur.title || '',
      family: '',
      mandDur: '',
      optDur: '',
      totalDur: '',
      content_id: cur.content_id || '',
      contentType: 'Curriculum',
      plSeqs: curSeqs,
    });
    sortedMods.forEach((mod) => {
      const modData = modules.find(m => m.id === mod.module_id) || {};
      const durationMin = modData.duration_min || 0;
      const isMandatory = (mod.requirement || 'mandatory') === 'mandatory';
      const modSeqs = detailedPlaylists.map((_, pi) => playlistSeqMaps[pi].get((modData.title || '').toLowerCase()) ?? '');
      dataRows.push({
        group: '',
        rowNum: '',
        chapter: chapterNum,
        brick: mod.sequence_order,
        title: modData.title || '',
        family: '',
        mandDur: isMandatory ? minutesToHHMM(durationMin) : '',
        optDur: !isMandatory ? minutesToHHMM(durationMin) : '',
        totalDur: minutesToHHMM(durationMin),
        content_id: modData.content_id || '',
        contentType: 'Module',
        plSeqs: modSeqs,
      });
    });
  });

  standaloneModules.forEach((mod, idx) => {
    const modSeqs = detailedPlaylists.map((_, pi) => playlistSeqMaps[pi].get((mod.title || '').toLowerCase()) ?? '');
    dataRows.push({
      group: '',
      rowNum: '',
      chapter: 0,
      brick: idx + 1,
      title: mod.title || '',
      family: '',
      mandDur: minutesToHHMM(mod.duration_min || 0),
      optDur: '',
      totalDur: minutesToHHMM(mod.duration_min || 0),
      content_id: mod.content_id || '',
      contentType: 'Module',
      plSeqs: modSeqs,
    });
  });

  const numPlaylists = detailedPlaylists.length;
  const totalCols = COL_PLAYLIST_START + numPlaylists;

  const makeEmptyRow = () => Array(totalCols).fill('');

  const aoa = [];
  aoa.push(makeEmptyRow());
  const titleRow = makeEmptyRow();
  detailedPlaylists.forEach((pl, i) => { titleRow[COL_PLAYLIST_START + i] = pl.title || ''; });
  aoa.push(titleRow);
  const descRow = makeEmptyRow();
  detailedPlaylists.forEach((pl, i) => { descRow[COL_PLAYLIST_START + i] = pl.description || ''; });
  aoa.push(descRow);
  const linkRow = makeEmptyRow();
  detailedPlaylists.forEach((pl, i) => { linkRow[COL_PLAYLIST_START + i] = pl.link || ''; });
  aoa.push(linkRow);
  for (let i = 0; i < 7; i++) aoa.push(makeEmptyRow());
  const headerRow = makeEmptyRow();
  ['Group', 'Row', 'Chapter', 'Brick', 'Title', 'Family', 'Mandatory Duration', 'Optional Duration', 'Total Duration', 'Content ID', 'Content Type'].forEach((h, i) => { headerRow[i] = h; });
  detailedPlaylists.forEach((pl, i) => { headerRow[COL_PLAYLIST_START + i] = pl.title || ''; });
  aoa.push(headerRow);
  for (const dr of dataRows) {
    const row = makeEmptyRow();
    row[0]  = dr.group;
    row[1]  = dr.rowNum;
    row[2]  = dr.chapter;
    row[3]  = dr.brick;
    row[4]  = dr.title;
    row[5]  = dr.family;
    row[6]  = dr.mandDur;
    row[7]  = dr.optDur;
    row[8]  = dr.totalDur;
    row[9]  = dr.content_id;
    row[10] = dr.contentType;
    dr.plSeqs.forEach((seq, i) => { row[COL_PLAYLIST_START + i] = seq; });
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Training Path Flat');

  return wb;
}

// -- Page shell ----------------------------------------------------------------

const TABS = ['Modules', 'Curricula', 'Playlists'];

export default function TrainingMatrixPage() {
  const { projectId } = useParams();
  const [tab, setTab]           = useState('Modules');
  const [search, setSearch]     = useState('');
  const [editMode, setEditMode] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf);
      const data = parseTrainingPathFlat(wb);
      await client.post(`/projects/${projectId}/training-matrix/import`, data);
      setReloadKey(k => k + 1);
    } catch (err) {
      alert('Import failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handleExport() {
    try {
      const wb = await buildExportWorkbook(projectId);
      XLSX.writeFile(wb, 'training-matrix-export.xlsx');
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-bold text-slate-800">Module / Curricula / Playlists</h1>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {TABS.map(t => (
              <button key={t} onClick={() => { setTab(t); setSearch(''); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={`Search ${tab.toLowerCase()}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <ToggleSwitch checked={editMode} onChange={setEditMode} label="Edit mode" />
          <button onClick={handleExport}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            Export
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {importing ? 'Importing...' : 'Import'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col">
        {tab === 'Modules'   && <ModulesTab   projectId={projectId} search={search} editMode={editMode} reloadKey={reloadKey} />}
        {tab === 'Curricula' && <CurriculaTab projectId={projectId} search={search} editMode={editMode} reloadKey={reloadKey} />}
        {tab === 'Playlists' && <PlaylistsTab projectId={projectId} search={search} editMode={editMode} reloadKey={reloadKey} />}
      </div>
    </div>
  );
}
