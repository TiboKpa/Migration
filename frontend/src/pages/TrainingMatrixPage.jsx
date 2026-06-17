import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import client from '../api/client';
import { parseTrainingPathFlat } from '../utils/parseTrainingPathFlat';

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

// ── Reorder toast ─────────────────────────────────────────────────────────────
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

// ── Drag-to-reorder list ──────────────────────────────────────────────────────
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

// ── Modules tab ───────────────────────────────────────────────────────────────

function ModulesTab({ projectId }) {
  const [modules, setModules]     = useState([]);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState({ title: '', content_id: '', duration_min: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm]   = useState({});

  const load = useCallback(async () => {
    const r = await client.get(`/projects/${projectId}/modules`);
    setModules(Array.isArray(r.data) ? r.data : []);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/modules`, {
      title: form.title.trim(),
      content_id: form.content_id.trim() || null,
      duration_min: parseInt(form.duration_min) || 0,
    });
    setForm({ title: '', content_id: '', duration_min: '' });
    setShowAdd(false);
    load();
  }

  async function saveEdit(id) {
    await client.put(`/projects/${projectId}/modules/${id}`, {
      title: editForm.title.trim(),
      content_id: editForm.content_id.trim() || null,
      duration_min: parseInt(editForm.duration_min) || 0,
    });
    setEditingId(null);
    load();
  }

  async function del(id) {
    if (!confirm('Delete this module? It will be removed from all curricula.')) return;
    await client.delete(`/projects/${projectId}/modules/${id}`);
    load();
  }

  async function delAll() {
    if (!confirm('Delete ALL modules? This cannot be undone.')) return;
    await client.delete(`/projects/${projectId}/modules`);
    load();
  }

  function startEdit(mod) {
    setEditingId(mod.id);
    setEditForm({ title: mod.title, content_id: mod.content_id || '', duration_min: mod.duration_min || '' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{modules.length} module{modules.length !== 1 ? 's' : ''}</h3>
        <div className="flex gap-2">
          {modules.length > 0 && (
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
          </div>
        </FormBox>
      )}

      {modules.length === 0 && !showAdd && (
        <p className="text-xs text-slate-400 py-4 text-center">No modules yet.</p>
      )}

      <div className="border rounded-xl overflow-hidden bg-white">
        {modules.map((mod, i) => (
          <div key={mod.id} className={`px-4 py-3 ${i < modules.length - 1 ? 'border-b' : ''}`}>
            {editingId === mod.id ? (
              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2">
                  <InlineField label="Title *" value={editForm.title} onChange={v => setEditForm(f => ({ ...f, title: v }))} />
                </div>
                <InlineField label="Content ID" value={editForm.content_id} onChange={v => setEditForm(f => ({ ...f, content_id: v }))} />
                <InlineField label="Duration (min)" type="number" min="0" value={editForm.duration_min} onChange={v => setEditForm(f => ({ ...f, duration_min: v }))} />
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
                  <span className="text-sm text-slate-800 font-medium truncate">{mod.title}</span>
                  {mod.content_id && <Badge color="blue">{mod.content_id}</Badge>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {mod.duration_min > 0 && (
                    <>
                      <span className="text-xs text-slate-400">{durationLabel(mod.duration_min)}</span>
                      <Sep />
                    </>
                  )}
                  <button onClick={() => startEdit(mod)} className="text-xs text-slate-400 hover:text-slate-700">Edit</button>
                  <button onClick={() => del(mod.id)} className="text-xs text-red-300 hover:text-red-500">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Curricula tab ─────────────────────────────────────────────────────────────

function CurriculaTab({ projectId }) {
  const [curricula, setCurricula]     = useState([]);
  const [allModules, setAllModules]   = useState([]);
  const [showAdd, setShowAdd]         = useState(false);
  const [form, setForm]               = useState({ title: '', content_id: '' });
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

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveCurriculum() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/curricula`, { title: form.title.trim(), content_id: form.content_id.trim() || null });
    setForm({ title: '', content_id: '' });
    setShowAdd(false);
    loadAll();
  }

  async function saveEditCurriculum(id) {
    await client.put(`/projects/${projectId}/curricula/${id}`, {
      title: editForm.title.trim(),
      content_id: editForm.content_id.trim() || null,
    });
    setEditingId(null);
    loadAll();
  }

  async function delCurriculum(id) {
    if (!confirm('Delete this curriculum? Modules inside it will not be deleted.')) return;
    await client.delete(`/projects/${projectId}/curricula/${id}`);
    loadAll();
  }

  async function delAll() {
    if (!confirm('Delete ALL curricula? Modules will not be deleted.')) return;
    await client.delete(`/projects/${projectId}/curricula`);
    loadAll();
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

  return (
    <div>
      {ToastUI}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {curricula.length} {curricula.length === 1 ? 'curriculum' : 'curricula'}
        </h3>
        <div className="flex gap-2">
          {curricula.length > 0 && (
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
          </div>
        </FormBox>
      )}

      {curricula.length === 0 && !showAdd && (
        <p className="text-xs text-slate-400 py-4 text-center">No curricula yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {curricula.map(cur => {
          const isOpen     = openId === cur.id;
          const addState   = addModState[cur.id] || {};
          const usedIds    = new Set((cur.modules || []).map(m => m.module_id));
          const available  = allModules.filter(m => !usedIds.has(m.id));
          const maxOrder   = (cur.modules || []).reduce((mx, m) => Math.max(mx, m.sequence_order || 0), 0);
          const sortedMods = [...(cur.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);

          return (
            <div key={cur.id} className="border rounded-xl overflow-hidden bg-white">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                {editingId === cur.id ? (
                  <div className="flex items-center gap-2 flex-1">
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
                    <button onClick={() => saveEditCurriculum(cur.id)} disabled={!editForm.title.trim()}
                      className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40">Save</button>
                    <button onClick={() => setEditingId(null)}
                      className="border px-3 py-1 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setOpenId(isOpen ? null : cur.id)}
                      className="flex items-center gap-2 flex-1 text-left min-w-0 truncate">
                      <span className="text-sm font-semibold text-slate-800 truncate">{cur.title}</span>
                      {cur.content_id && <Badge color="blue">{cur.content_id}</Badge>}
                      <Badge color="slate">{sortedMods.length} module{sortedMods.length !== 1 ? 's' : ''}</Badge>
                    </button>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <DurationInline modules={sortedMods} />
                      {curriculumDurationParts(sortedMods).mandLabel && <Sep />}
                      <button onClick={() => { setEditingId(cur.id); setEditForm({ title: cur.title, content_id: cur.content_id || '' }); }}
                        className="text-xs text-slate-400 hover:text-slate-700">Edit</button>
                      <button onClick={() => delCurriculum(cur.id)}
                        className="text-xs text-red-300 hover:text-red-500">Delete</button>
                    </div>
                  </>
                )}
              </div>

              {isOpen && (
                <div className="px-4 py-3">
                  {sortedMods.length === 0 && (
                    <p className="text-xs text-slate-400 mb-3">No modules yet.</p>
                  )}

                  <DraggableList
                    items={sortedMods.map(m => ({ id: m.module_id, ...m }))}
                    onReorder={(fromIdx, toIdx) => handleCurriculumModuleReorder(cur, fromIdx, toIdx)}
                    renderItem={(item, idx) => (
                      <div className={`flex items-center justify-between py-1.5 ${
                        idx < sortedMods.length - 1 ? 'border-b' : ''
                      }`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                          <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                          <span className="text-sm text-slate-700 truncate">{item.module_title || item.title}</span>
                          {item.module_content_id && <Badge color="blue">{item.module_content_id}</Badge>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.duration_min > 0 && (
                            <>
                              <span className="text-xs text-slate-400">{durationLabel(item.duration_min)}</span>
                              <Sep />
                            </>
                          )}
                          <Badge color={item.requirement === 'mandatory' ? 'green' : 'amber'}>{item.requirement}</Badge>
                          <button onClick={() => removeModuleFromCurriculum(cur.id, item.module_id)}
                            className="text-xs text-red-300 hover:text-red-500">Remove</button>
                        </div>
                      </div>
                    )}
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

// ── Trainings tab ─────────────────────────────────────────────────────────────

function TrainingsTab({ projectId }) {
  const [playlists, setPlaylists]         = useState([]);
  const [selected, setSelected]           = useState(null);
  const [detail, setDetail]               = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState({ title: '', description: '', link: '', content_id: '' });
  const [editMode, setEditMode]           = useState(false);
  const [editForm, setEditForm]           = useState({});
  const [allModules, setAllModules]       = useState([]);
  const [allCurricula, setAllCurricula]   = useState([]);
  const [showAddItem, setShowAddItem]     = useState(false);
  const [newItem, setNewItem]             = useState({ type: 'curriculum', id: '', sequence_order: '' });
  const { requestReorder, ToastUI }       = useReorderToast();

  const loadList = useCallback(async () => {
    const r = await client.get(`/projects/${projectId}/playlists`);
    setPlaylists(Array.isArray(r.data) ? r.data : []);
  }, [projectId]);

  const loadDetail = useCallback(async (id) => {
    setLoadingDetail(true);
    const [dRes, mRes, cRes] = await Promise.all([
      client.get(`/projects/${projectId}/playlists/${id}`),
      client.get(`/projects/${projectId}/modules`),
      client.get(`/projects/${projectId}/curricula`),
    ]);
    setDetail(dRes.data);
    setAllModules(Array.isArray(mRes.data) ? mRes.data : []);
    setAllCurricula(Array.isArray(cRes.data) ? cRes.data : []);
    setLoadingDetail(false);
  }, [projectId]);

  useEffect(() => { loadList(); }, [loadList]);

  function select(pl) {
    setSelected(pl.id);
    loadDetail(pl.id);
    setEditMode(false);
    setShowAddItem(false);
  }

  async function create() {
    if (!form.title.trim()) return;
    await client.post(`/projects/${projectId}/playlists`, { ...form, is_complementary: !form.link.trim() });
    setForm({ title: '', description: '', link: '', content_id: '' });
    setShowAdd(false);
    loadList();
  }

  async function update() {
    await client.put(`/projects/${projectId}/playlists/${selected}`, { ...editForm, is_complementary: !editForm.link?.trim() });
    setEditMode(false);
    loadList();
    loadDetail(selected);
  }

  async function del() {
    if (!confirm('Delete this training and all its items?')) return;
    await client.delete(`/projects/${projectId}/playlists/${selected}`);
    setSelected(null);
    setDetail(null);
    loadList();
  }

  async function delAll() {
    if (!confirm('Delete ALL trainings? This cannot be undone.')) return;
    await client.delete(`/projects/${projectId}/playlists`);
    setSelected(null);
    setDetail(null);
    loadList();
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

  const primary       = playlists.filter(p => !p.is_complementary);
  const complementary = playlists.filter(p => p.is_complementary);
  const orderedItems  = detail?.ordered_items || [];

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
            {primary.length === 0 && <p className="text-xs text-slate-400 p-3">None yet.</p>}
            {primary.map(pl => (
              <button key={pl.id} onClick={() => select(pl)}
                className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors
                  ${selected === pl.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                {pl.title}
              </button>
            ))}
          </div>
        </div>

        {complementary.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Complementary</p>
            <div className="border rounded-xl overflow-hidden bg-white">
              {complementary.map(pl => (
                <button key={pl.id} onClick={() => select(pl)}
                  className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors
                    ${selected === pl.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                  {pl.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {playlists.length > 0 && (
          <button onClick={delAll}
            className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50 w-full">
            Delete all trainings
          </button>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {showAdd && (
          <FormBox title="New training" onSave={create} onCancel={() => setShowAdd(false)} saveDisabled={!form.title.trim()}>
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
          <p className="text-sm text-slate-400 mt-16 text-center">Select a training to view it.</p>
        )}
        {selected && loadingDetail && (
          <p className="text-sm text-slate-400 mt-16 text-center">Loading...</p>
        )}

        {selected && !loadingDetail && detail && (
          <div className="flex flex-col gap-6">
            {editMode ? (
              <FormBox title="Edit training" onSave={update} onCancel={() => setEditMode(false)} saveDisabled={!editForm.title?.trim()}>
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
                    <h2 className="text-lg font-bold text-slate-800">{detail.title}</h2>
                    {detail.is_complementary ? <Badge color="amber">Complementary</Badge> : <Badge color="green">Primary</Badge>}
                    {detail.content_id && <Badge color="blue">{detail.content_id}</Badge>}
                  </div>
                  {detail.description && <p className="text-sm text-slate-500 mt-1 max-w-xl">{detail.description}</p>}
                  <div className="flex gap-3 mt-1 items-center flex-wrap">
                    {detail.total_minutes > 0 && <span className="text-xs text-slate-400">{durationLabel(detail.total_minutes)} mandatory</span>}
                    {detail.link && <a href={detail.link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open link</a>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setEditMode(true); setEditForm({ title: detail.title, description: detail.description, link: detail.link, content_id: detail.content_id }); }}
                    className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Edit</button>
                  <button onClick={del}
                    className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50">Delete</button>
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
                      <span className="text-sm text-slate-700 flex-1 truncate">{ref.title}</span>
                      {ref.content_id && <Badge color="blue">{ref.content_id}</Badge>}
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
                    if (item.kind === 'curriculum') {
                      const sortedMods = [...(item.modules || [])].sort((a, b) => a.sequence_order - b.sequence_order);
                      const hasDuration = !!curriculumDurationParts(sortedMods).mandLabel;
                      return (
                        <details className="border rounded-xl overflow-hidden mb-1" open>
                          <summary className="flex items-center justify-between px-4 py-2.5 bg-slate-50 cursor-pointer list-none">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                              <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                              <span className="text-sm font-semibold text-slate-700 truncate">{item.title}</span>
                              {item.content_id && <Badge color="blue">{item.content_id}</Badge>}
                              <Badge color="slate">{sortedMods.length} module{sortedMods.length !== 1 ? 's' : ''}</Badge>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-3">
                              <DurationInline modules={sortedMods} />
                              {hasDuration && <Sep />}
                              <button onClick={e => { e.preventDefault(); removeItem(item.playlist_item_id); }}
                                className="text-xs text-red-300 hover:text-red-500">Remove</button>
                            </div>
                          </summary>
                          <div className="px-4 py-2">
                            {sortedMods.length === 0 && <p className="text-xs text-slate-400">No modules in this curriculum.</p>}
                            <DraggableList
                              items={sortedMods.map(m => ({ id: m.module_id, ...m }))}
                              onReorder={(fi, ti) => handleCurriculumModuleReorderInPlaylist(item, fi, ti)}
                              renderItem={(mod, idx) => (
                                <div className={`flex items-center justify-between py-1.5 ${
                                  idx < sortedMods.length - 1 ? 'border-b' : ''
                                }`}>
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                                    <span className="text-xs text-slate-400 w-5 text-right shrink-0">{mod.sequence_order}</span>
                                    <span className="text-sm text-slate-700 truncate">{mod.module_title || mod.title}</span>
                                    {mod.module_content_id && <Badge color="blue">{mod.module_content_id}</Badge>}
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
                              )}
                            />
                          </div>
                        </details>
                      );
                    }
                    // Standalone module row
                    return (
                      <div className="border rounded-xl bg-white flex items-center justify-between px-4 py-2.5 mb-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-slate-300 cursor-grab select-none px-1" title="Drag to reorder">&#8597;</span>
                          <span className="text-xs text-slate-400 w-5 text-right shrink-0">{item.sequence_order}</span>
                          <span className="text-sm text-slate-700 truncate">{item.title}</span>
                          {item.content_id && <Badge color="blue">{item.content_id}</Badge>}
                          <Badge color="slate">Module</Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {item.duration_min > 0 && (
                            <>
                              <span className="text-xs text-slate-400">{durationLabel(item.duration_min)}</span>
                              <Sep />
                            </>
                          )}
                          <button onClick={() => removeItem(item.playlist_item_id)}
                            className="text-xs text-red-300 hover:text-red-500">Remove</button>
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

// ── Page shell ────────────────────────────────────────────────────────────────

const TABS = ['Modules', 'Curricula', 'Trainings'];

export default function TrainingMatrixPage() {
  const { projectId } = useParams();
  const [tab, setTab]                   = useState('Modules');
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importRef = useRef();

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const buf    = await file.arrayBuffer();
      const parsed = parseTrainingPathFlat(buf);
      const r      = await client.post(`/projects/${projectId}/playlists/import`, parsed);
      setImportResult({
        ok:  true,
        msg: `${r.data.imported_modules} modules, ${r.data.imported_curricula} curricula, ${r.data.imported_playlists} trainings imported.`,
      });
    } catch (err) {
      setImportResult({ ok: false, msg: err.response?.data?.error || err.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h1 className="text-xl font-bold text-slate-800">Training Matrix</h1>
        <div className="flex gap-2 items-center">
          <button onClick={() => importRef.current.click()} disabled={importing}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {importing ? 'Importing...' : 'Import xlsx'}
          </button>
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {importResult && (
        <p className={`text-sm mb-3 shrink-0 ${importResult.ok ? 'text-green-600' : 'text-red-500'}`}>
          {importResult.ok ? importResult.msg : `Error: ${importResult.msg}`}
        </p>
      )}

      <div className="flex border-b mb-4 shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'Modules'   && <ModulesTab   projectId={projectId} />}
        {tab === 'Curricula' && <CurriculaTab projectId={projectId} />}
        {tab === 'Trainings' && <TrainingsTab projectId={projectId} />}
      </div>
    </div>
  );
}
