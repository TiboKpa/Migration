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
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPl, setNewPl] = useState({ title: '', description: '', link: '', content_id: '' });
  const [editMode, setEditMode] = useState(false);
  const [editPl, setEditPl] = useState({});
  const [showAddCur, setShowAddCur] = useState(false);
  const [newCur, setNewCur] = useState({ title: '', content_id: '', requirement: 'mandatory', sequence_order: 0 });
  const [showAddMod, setShowAddMod] = useState(false);
  const [newMod, setNewMod] = useState({ title: '', content_id: '', duration_min: 0, requirement: 'mandatory', sequence_order: 0, curriculum_id: '' });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importRef = useRef();

  useEffect(() => { fetchPlaylists(); }, [projectId]);

  async function fetchPlaylists() {
    const r = await fetch(`${API}/api/training/${projectId}/playlists`, { headers: authHeaders() });
    const data = await r.json();
    setPlaylists(Array.isArray(data) ? data : []);
  }

  async function fetchDetail(id) {
    setLoadingDetail(true);
    const r = await fetch(`${API}/api/training/${projectId}/playlists/${id}`, { headers: authHeaders() });
    const data = await r.json();
    setDetail(data);
    setLoadingDetail(false);
  }

  function selectPlaylist(pl) {
    setSelected(pl.id);
    fetchDetail(pl.id);
    setEditMode(false);
    setShowAddCur(false);
    setShowAddMod(false);
    setImportResult(null);
  }

  async function createPlaylist() {
    if (!newPl.title.trim()) return;
    await fetch(`${API}/api/training/${projectId}/playlists`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(newPl)
    });
    setNewPl({ title: '', description: '', link: '', content_id: '' });
    setShowNewPlaylist(false);
    fetchPlaylists();
  }

  async function updatePlaylist() {
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(editPl)
    });
    setEditMode(false);
    fetchPlaylists();
    fetchDetail(selected);
  }

  async function deletePlaylist() {
    if (!confirm('Delete this playlist and all its content?')) return;
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}`, { method: 'DELETE', headers: authHeaders() });
    setSelected(null);
    setDetail(null);
    fetchPlaylists();
  }

  async function addCurriculum() {
    if (!newCur.title.trim()) return;
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}/curricula`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(newCur)
    });
    setNewCur({ title: '', content_id: '', requirement: 'mandatory', sequence_order: 0 });
    setShowAddCur(false);
    fetchDetail(selected);
  }

  async function deleteCurriculum(curId) {
    if (!confirm('Delete curriculum and all its modules?')) return;
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}/curricula/${curId}`, { method: 'DELETE', headers: authHeaders() });
    fetchDetail(selected);
  }

  async function addModule() {
    if (!newMod.title.trim()) return;
    const payload = { ...newMod, curriculum_id: newMod.curriculum_id || null };
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}/modules`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
    });
    setNewMod({ title: '', content_id: '', duration_min: 0, requirement: 'mandatory', sequence_order: 0, curriculum_id: '' });
    setShowAddMod(false);
    fetchDetail(selected);
  }

  async function deleteModule(modId) {
    if (!confirm('Delete this module?')) return;
    await fetch(`${API}/api/training/${projectId}/playlists/${selected}/modules/${modId}`, { method: 'DELETE', headers: authHeaders() });
    fetchDetail(selected);
  }

  // ── Import from xlsx ──────────────────────────────────────────────────────
  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseTrainingPathFlat(buf);
      const r = await fetch(`${API}/api/training/${projectId}/playlists/import`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(parsed),
      });
      const result = await r.json();
      setImportResult(r.ok ? { ok: true, count: result.imported } : { ok: false, message: result.error });
      fetchPlaylists();
      if (selected) fetchDetail(selected);
    } catch (err) {
      setImportResult({ ok: false, message: err.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 80px)', fontFamily: 'inherit' }}>

      {/* Left panel */}
      <div style={{ width: 280, borderRight: '1px solid #e5e7eb', paddingRight: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Playlists</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => importRef.current.click()}
              disabled={importing}
              style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
            >
              {importing ? 'Importing...' : 'Import xlsx'}
            </button>
            <input ref={importRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportFile} />
            <button
              onClick={() => setShowNewPlaylist(!showNewPlaylist)}
              style={{ fontSize: 11, padding: '3px 8px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >+ New</button>
          </div>
        </div>

        {importResult && (
          <div style={{ fontSize: 11, padding: '6px 8px', borderRadius: 4, background: importResult.ok ? '#d1fae5' : '#fee2e2', color: importResult.ok ? '#065f46' : '#991b1b', marginBottom: 4 }}>
            {importResult.ok ? `${importResult.count} playlist(s) imported` : `Error: ${importResult.message}`}
          </div>
        )}

        {showNewPlaylist && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input placeholder="Title *" value={newPl.title} onChange={e => setNewPl(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
            <input placeholder="Content ID" value={newPl.content_id} onChange={e => setNewPl(p => ({ ...p, content_id: e.target.value }))} style={inputStyle} />
            <input placeholder="Link" value={newPl.link} onChange={e => setNewPl(p => ({ ...p, link: e.target.value }))} style={inputStyle} />
            <textarea placeholder="Description" value={newPl.description} onChange={e => setNewPl(p => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={createPlaylist} style={btnPrimary}>Create</button>
              <button onClick={() => setShowNewPlaylist(false)} style={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {playlists.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>No playlists yet. Import an xlsx or create one.</span>}
          {playlists.map(pl => (
            <button
              key={pl.id}
              onClick={() => selectPlaylist(pl)}
              style={{
                textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: selected === pl.id ? '#eff6ff' : 'transparent',
                color: selected === pl.id ? '#1d4ed8' : '#374151',
                fontWeight: selected === pl.id ? 600 : 400,
                fontSize: 13,
              }}
            >{pl.title}</button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: 'auto', paddingLeft: 8 }}>
        {!selected && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 40, textAlign: 'center' }}>Select a playlist to view or edit it.</div>
        )}

        {selected && loadingDetail && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 40, textAlign: 'center' }}>Loading...</div>
        )}

        {selected && !loadingDetail && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Playlist header */}
            {editMode ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input placeholder="Title *" value={editPl.title || ''} onChange={e => setEditPl(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
                <input placeholder="Content ID" value={editPl.content_id || ''} onChange={e => setEditPl(p => ({ ...p, content_id: e.target.value }))} style={inputStyle} />
                <input placeholder="Link" value={editPl.link || ''} onChange={e => setEditPl(p => ({ ...p, link: e.target.value }))} style={inputStyle} />
                <textarea placeholder="Description" value={editPl.description || ''} onChange={e => setEditPl(p => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={updatePlaylist} style={btnPrimary}>Save</button>
                  <button onClick={() => setEditMode(false)} style={btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{detail.title}</h2>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {detail.content_id && <span style={badgeStyle}>{detail.content_id}</span>}
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{durationLabel(detail.total_minutes)} mandatory</span>
                      {detail.link && <a href={detail.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>Open playlist</a>}
                    </div>
                    {detail.description && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280', maxWidth: 600 }}>{detail.description}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => { setEditMode(true); setEditPl({ title: detail.title, description: detail.description, link: detail.link, content_id: detail.content_id }); }} style={btnGhost}>Edit</button>
                    <button onClick={deletePlaylist} style={btnDanger}>Delete</button>
                  </div>
                </div>
              </div>
            )}

            {/* Curricula */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Curricula</span>
                <button onClick={() => setShowAddCur(!showAddCur)} style={btnGhost}>+ Add curriculum</button>
              </div>

              {showAddCur && (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input placeholder="Title *" value={newCur.title} onChange={e => setNewCur(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
                  <input placeholder="Content ID" value={newCur.content_id} onChange={e => setNewCur(p => ({ ...p, content_id: e.target.value }))} style={inputStyle} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={newCur.requirement} onChange={e => setNewCur(p => ({ ...p, requirement: e.target.value }))} style={inputStyle}>
                      <option value="mandatory">Mandatory</option>
                      <option value="optional">Optional</option>
                    </select>
                    <input type="number" placeholder="Order" value={newCur.sequence_order} onChange={e => setNewCur(p => ({ ...p, sequence_order: parseInt(e.target.value) || 0 }))} style={{ ...inputStyle, width: 80 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={addCurriculum} style={btnPrimary}>Add</button>
                    <button onClick={() => setShowAddCur(false)} style={btnGhost}>Cancel</button>
                  </div>
                </div>
              )}

              {detail.curricula.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>No curricula yet.</span>}
              {detail.curricula.map(cur => (
                <details key={cur.id} style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }} open>
                  <summary style={{ padding: '8px 12px', background: '#f9fafb', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', listStyle: 'none' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{cur.title}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {cur.content_id && <span style={badgeStyle}>{cur.content_id}</span>}
                      <span style={{ fontSize: 11, color: cur.requirement === 'mandatory' ? '#065f46' : '#92400e', background: cur.requirement === 'mandatory' ? '#d1fae5' : '#fef3c7', padding: '1px 6px', borderRadius: 10 }}>{cur.requirement}</span>
                      <button onClick={e => { e.preventDefault(); deleteCurriculum(cur.id); }} style={{ ...btnDanger, fontSize: 11, padding: '2px 7px' }}>Delete</button>
                    </div>
                  </summary>
                  <div style={{ padding: '8px 12px' }}>
                    {cur.modules.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>No modules in this curriculum.</span>}
                    {cur.modules.map(mod => (
                      <ModuleRow key={mod.id} mod={mod} onDelete={deleteModule} />
                    ))}
                  </div>
                </details>
              ))}
            </div>

            {/* Standalone modules */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Standalone modules</span>
                <button onClick={() => setShowAddMod(!showAddMod)} style={btnGhost}>+ Add module</button>
              </div>

              {showAddMod && (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input placeholder="Title *" value={newMod.title} onChange={e => setNewMod(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
                  <input placeholder="Content ID" value={newMod.content_id} onChange={e => setNewMod(p => ({ ...p, content_id: e.target.value }))} style={inputStyle} />
                  <input type="number" placeholder="Duration (min)" value={newMod.duration_min} onChange={e => setNewMod(p => ({ ...p, duration_min: parseInt(e.target.value) || 0 }))} style={inputStyle} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={newMod.requirement} onChange={e => setNewMod(p => ({ ...p, requirement: e.target.value }))} style={inputStyle}>
                      <option value="mandatory">Mandatory</option>
                      <option value="optional">Optional</option>
                    </select>
                    <input type="number" placeholder="Order" value={newMod.sequence_order} onChange={e => setNewMod(p => ({ ...p, sequence_order: parseInt(e.target.value) || 0 }))} style={{ ...inputStyle, width: 80 }} />
                  </div>
                  <select value={newMod.curriculum_id} onChange={e => setNewMod(p => ({ ...p, curriculum_id: e.target.value }))} style={inputStyle}>
                    <option value="">Standalone (no curriculum)</option>
                    {detail.curricula.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={addModule} style={btnPrimary}>Add</button>
                    <button onClick={() => setShowAddMod(false)} style={btnGhost}>Cancel</button>
                  </div>
                </div>
              )}

              {detail.standalone_modules.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>No standalone modules.</span>}
              {detail.standalone_modules.map(mod => (
                <ModuleRow key={mod.id} mod={mod} onDelete={deleteModule} />
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function ModuleRow({ mod, onDelete }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mod.title}</span>
        {mod.content_id && <span style={badgeStyle}>{mod.content_id}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {mod.duration_min > 0 && <span style={{ fontSize: 11, color: '#6b7280' }}>{durationLabel(mod.duration_min)}</span>}
        <span style={{ fontSize: 11, color: mod.requirement === 'mandatory' ? '#065f46' : '#92400e', background: mod.requirement === 'mandatory' ? '#d1fae5' : '#fef3c7', padding: '1px 6px', borderRadius: 10 }}>{mod.requirement}</span>
        <button onClick={() => onDelete(mod.id)} style={{ ...btnDanger, fontSize: 11, padding: '2px 7px' }}>Delete</button>
      </div>
    </div>
  );
}

const inputStyle = { padding: '5px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const btnPrimary = { padding: '5px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const btnGhost = { padding: '5px 12px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnDanger = { padding: '5px 12px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const badgeStyle = { fontSize: 10, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' };
