import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { parseTrainingPathFlat } from '../utils/parseTrainingPathFlat';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

function durationLabel(minutes) {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export default function TrainingMatrixPage() {
  const { projectId } = useParams();
  const [primaryTrainings, setPrimaryTrainings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newPt, setNewPt] = useState({ title: '', description: '', link: '', content_id: '' });
  const [editMode, setEditMode] = useState(false);
  const [editPt, setEditPt] = useState({});
  const [showAddCur, setShowAddCur] = useState(false);
  const [newCur, setNewCur] = useState({ title: '', content_id: '', requirement: 'mandatory', sequence_order: 0 });
  const [showAddMod, setShowAddMod] = useState(false);
  const [newMod, setNewMod] = useState({ title: '', content_id: '', duration_min: 0, requirement: 'mandatory', sequence_order: 0, curriculum_id: '' });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importRef = useRef();

  useEffect(() => { fetchPrimaryTrainings(); }, [projectId]);

  const base = `${API}/api/projects/${projectId}`;

  async function fetchPrimaryTrainings() {
    const r = await fetch(`${base}/playlists`, { headers: authHeaders() });
    const data = await r.json();
    setPrimaryTrainings(Array.isArray(data) ? data : []);
  }

  async function fetchDetail(id) {
    setLoadingDetail(true);
    const r = await fetch(`${base}/playlists/${id}`, { headers: authHeaders() });
    const data = await r.json();
    setDetail(data);
    setLoadingDetail(false);
  }

  function selectPrimaryTraining(pt) {
    setSelected(pt.id);
    fetchDetail(pt.id);
    setEditMode(false);
    setShowAddCur(false);
    setShowAddMod(false);
    setImportResult(null);
  }

  async function createPrimaryTraining() {
    if (!newPt.title.trim()) return;
    await fetch(`${base}/playlists`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(newPt)
    });
    setNewPt({ title: '', description: '', link: '', content_id: '' });
    setShowNew(false);
    fetchPrimaryTrainings();
  }

  async function updatePrimaryTraining() {
    await fetch(`${base}/playlists/${selected}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(editPt)
    });
    setEditMode(false);
    fetchPrimaryTrainings();
    fetchDetail(selected);
  }

  async function deletePrimaryTraining() {
    if (!confirm('Delete this primary training and all its content?')) return;
    await fetch(`${base}/playlists/${selected}`, { method: 'DELETE', headers: authHeaders() });
    setSelected(null);
    setDetail(null);
    fetchPrimaryTrainings();
  }

  async function addCurriculum() {
    if (!newCur.title.trim()) return;
    await fetch(`${base}/playlists/${selected}/curricula`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(newCur)
    });
    setNewCur({ title: '', content_id: '', requirement: 'mandatory', sequence_order: 0 });
    setShowAddCur(false);
    fetchDetail(selected);
  }

  async function deleteCurriculum(curId) {
    if (!confirm('Delete curriculum and all its modules?')) return;
    await fetch(`${base}/playlists/${selected}/curricula/${curId}`, { method: 'DELETE', headers: authHeaders() });
    fetchDetail(selected);
  }

  async function addModule() {

    if (!newMod.title.trim()) return;
    const payload = { ...newMod, curriculum_id: newMod.curriculum_id || null };
    await fetch(`${base}/playlists/${selected}/modules`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
    });
    setNewMod({ title: '', content_id: '', duration_min: 0, requirement: 'mandatory', sequence_order: 0, curriculum_id: '' });
    setShowAddMod(false);
    fetchDetail(selected);
  }

  async function deleteModule(modId) {
    if (!confirm('Delete this module?')) return;
    await fetch(`${base}/playlists/${selected}/modules/${modId}`, { method: 'DELETE', headers: authHeaders() });
    fetchDetail(selected);
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseTrainingPathFlat(buf);
      const r = await fetch(`${base}/playlists/import`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(parsed),
      });
      const result = await r.json();
      setImportResult(r.ok ? { ok: true, count: result.imported } : { ok: false, message: result.error });
      fetchPrimaryTrainings();
      if (selected) fetchDetail(selected);
    } catch (err) {
      setImportResult({ ok: false, message: err.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Page header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">PDM Training</h1>
          <p className="text-sm text-slate-500">{primaryTrainings.length} primary training(s)</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => { setShowNew(v => !v); setNewPt({ title: '', description: '', link: '', content_id: '' }); }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Add primary training
          </button>
          <button
            onClick={() => importRef.current.click()}
            disabled={importing}
            className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {importing ? 'Importing...' : 'Import xlsx'}
          </button>
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {importResult && (
        <p className={`text-sm mb-3 ${importResult.ok ? 'text-green-600' : 'text-red-500'}`}>
          {importResult.ok ? `${importResult.count} primary training(s) imported.` : `Error: ${importResult.message}`}
        </p>
      )}

      {/* Add form */}
      {showNew && (
        <div className="bg-slate-50 border rounded-xl p-4 mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">New primary training</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Title *</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newPt.title}
                onChange={e => setNewPt(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Content ID</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newPt.content_id}
                onChange={e => setNewPt(p => ({ ...p, content_id: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Link</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newPt.link}
                onChange={e => setNewPt(p => ({ ...p, link: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newPt.description}
                onChange={e => setNewPt(p => ({ ...p, description: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createPrimaryTraining} disabled={!newPt.title.trim()}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
              Save
            </button>
            <button onClick={() => setShowNew(false)}
              className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main content: list + detail */}
      <div className="flex gap-6 flex-1 min-h-0">

        {/* Left list */}
        <div className="w-64 shrink-0 overflow-y-auto border rounded-xl bg-white">
          {primaryTrainings.length === 0 && (
            <p className="text-xs text-slate-400 p-4">No primary trainings yet. Import an xlsx or add one.</p>
          )}
          {primaryTrainings.map(pt => (
            <button key={pt.id} onClick={() => selectPrimaryTraining(pt)}
              className={`w-full text-left px-4 py-2.5 text-sm border-b last:border-b-0 transition-colors
                ${selected === pt.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
              {pt.title}
            </button>
          ))}
        </div>

        {/* Right detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected && (
            <p className="text-sm text-slate-400 mt-16 text-center">Select a primary training to view or edit it.</p>
          )}

          {selected && loadingDetail && (
            <p className="text-sm text-slate-400 mt-16 text-center">Loading...</p>
          )}

          {selected && !loadingDetail && detail && (
            <div className="flex flex-col gap-6">

              {editMode ? (
                <div className="bg-slate-50 border rounded-xl p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">Edit primary training</h2>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Title *</label>
                      <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={editPt.title || ''}
                        onChange={e => setEditPt(p => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Content ID</label>
                      <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={editPt.content_id || ''}
                        onChange={e => setEditPt(p => ({ ...p, content_id: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Link</label>
                      <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={editPt.link || ''}
                        onChange={e => setEditPt(p => ({ ...p, link: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Description</label>
                      <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={editPt.description || ''}
                        onChange={e => setEditPt(p => ({ ...p, description: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={updatePrimaryTraining}
                      className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
                    <button onClick={() => setEditMode(false)}
                      className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{detail.title}</h2>
                    <div className="flex gap-3 mt-1 flex-wrap items-center">
                      {detail.content_id && (
                        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">{detail.content_id}</span>
                      )}
                      <span className="text-xs text-slate-400">{durationLabel(detail.total_minutes)} mandatory</span>
                      {detail.link && (
                        <a href={detail.link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open training</a>
                      )}
                    </div>
                    {detail.description && <p className="text-sm text-slate-500 mt-1 max-w-xl">{detail.description}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => { setEditMode(true); setEditPt({ title: detail.title, description: detail.description, link: detail.link, content_id: detail.content_id }); }}
                      className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Edit</button>
                    <button onClick={deletePrimaryTraining}
                      className="border border-red-200 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50">Delete</button>
                  </div>
                </div>
              )}

              {/* Curricula */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">Curricula</h3>
                  <button onClick={() => setShowAddCur(v => !v)}
                    className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">+ Add curriculum</button>
                </div>

                {showAddCur && (
                  <div className="bg-slate-50 border rounded-xl p-4 mb-4">
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">Title *</label>
                        <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newCur.title}
                          onChange={e => setNewCur(p => ({ ...p, title: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Content ID</label>
                        <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newCur.content_id}
                          onChange={e => setNewCur(p => ({ ...p, content_id: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Requirement</label>
                        <select className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newCur.requirement}
                          onChange={e => setNewCur(p => ({ ...p, requirement: e.target.value }))}>
                          <option value="mandatory">Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Order</label>
                        <input type="number" className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newCur.sequence_order}
                          onChange={e => setNewCur(p => ({ ...p, sequence_order: parseInt(e.target.value) || 0 }))} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addCurriculum} disabled={!newCur.title.trim()}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">Add</button>
                      <button onClick={() => setShowAddCur(false)}
                        className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}

                {detail.curricula.length === 0 && <p className="text-xs text-slate-400">No curricula yet.</p>}
                {detail.curricula.map(cur => (
                  <details key={cur.id} className="mb-2 border rounded-xl overflow-hidden" open>
                    <summary className="flex justify-between items-center px-4 py-2.5 bg-slate-50 cursor-pointer list-none">
                      <span className="text-sm font-semibold text-slate-700">{cur.title}</span>
                      <div className="flex gap-2 items-center">
                        {cur.content_id && (
                          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">{cur.content_id}</span>
                        )}
                        <span className={`text-xs rounded-full px-2 py-0.5 ${cur.requirement === 'mandatory' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                          {cur.requirement}
                        </span>
                        <button onClick={e => { e.preventDefault(); deleteCurriculum(cur.id); }}
                          className="border border-red-200 px-2 py-0.5 rounded-lg text-xs text-red-500 hover:bg-red-50">Delete</button>
                      </div>
                    </summary>
                    <div className="px-4 py-2">
                      {cur.modules.length === 0 && <p className="text-xs text-slate-400">No modules in this curriculum.</p>}
                      {cur.modules.map(mod => <ModuleRow key={mod.id} mod={mod} onDelete={deleteModule} />)}
                    </div>
                  </details>
                ))}
              </div>

              {/* Standalone modules */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">Standalone modules</h3>
                  <button onClick={() => setShowAddMod(v => !v)}
                    className="border px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">+ Add module</button>
                </div>

                {showAddMod && (
                  <div className="bg-slate-50 border rounded-xl p-4 mb-4">
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">Title *</label>
                        <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.title}
                          onChange={e => setNewMod(p => ({ ...p, title: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Content ID</label>
                        <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.content_id}
                          onChange={e => setNewMod(p => ({ ...p, content_id: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Duration (min)</label>
                        <input type="number" className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.duration_min}
                          onChange={e => setNewMod(p => ({ ...p, duration_min: parseInt(e.target.value) || 0 }))} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Requirement</label>
                        <select className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.requirement}
                          onChange={e => setNewMod(p => ({ ...p, requirement: e.target.value }))}>
                          <option value="mandatory">Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Order</label>
                        <input type="number" className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.sequence_order}
                          onChange={e => setNewMod(p => ({ ...p, sequence_order: parseInt(e.target.value) || 0 }))} />
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">Attach to curriculum (optional)</label>
                        <select className="border rounded-lg px-2 py-1.5 text-sm w-full" value={newMod.curriculum_id}
                          onChange={e => setNewMod(p => ({ ...p, curriculum_id: e.target.value }))}>
                          <option value="">Standalone</option>
                          {detail.curricula.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addModule} disabled={!newMod.title.trim()}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">Add</button>
                      <button onClick={() => setShowAddMod(false)}
                        className="border px-4 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}

                {detail.standalone_modules.length === 0 && <p className="text-xs text-slate-400">No standalone modules.</p>}
                {detail.standalone_modules.map(mod => <ModuleRow key={mod.id} mod={mod} onDelete={deleteModule} />)}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModuleRow({ mod, onDelete }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b last:border-b-0">
      <div className="flex gap-2 items-center flex-1 min-w-0">
        <span className="text-sm text-slate-700 truncate">{mod.title}</span>
        {mod.content_id && (
          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 shrink-0">{mod.content_id}</span>
        )}
      </div>
      <div className="flex gap-2 items-center shrink-0">
        {mod.duration_min > 0 && <span className="text-xs text-slate-400">{durationLabel(mod.duration_min)}</span>}
        <span className={`text-xs rounded-full px-2 py-0.5 ${mod.requirement === 'mandatory' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {mod.requirement}
        </span>
        <button onClick={() => onDelete(mod.id)}
          className="text-red-300 hover:text-red-500 text-xs">Del</button>
      </div>
    </div>
  );
}
