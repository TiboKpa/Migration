import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

const REQUIREMENT_OPTIONS = ['mandatory', 'optional'];

const EMPTY_PLAYLIST = { title: '', description: '', link: '', content_id: '' };
const EMPTY_CURRICULUM = { title: '', content_id: '', requirement: 'mandatory' };
const EMPTY_MODULE = { title: '', content_id: '', duration_min: '', requirement: 'mandatory', curriculum_id: '' };

function durationLabel(minutes) {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function RequirementBadge({ value }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
      value === 'mandatory' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
    }`}>{value}</span>
  );
}

export default function TrainingMatrixPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState(null);
  const [showPlaylistForm, setShowPlaylistForm] = useState(false);
  const [playlistForm, setPlaylistForm] = useState(EMPTY_PLAYLIST);
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [editPlaylistForm, setEditPlaylistForm] = useState(EMPTY_PLAYLIST);

  const [showCurriculumForm, setShowCurriculumForm] = useState(false);
  const [curriculumForm, setCurriculumForm] = useState(EMPTY_CURRICULUM);

  const [showModuleForm, setShowModuleForm] = useState(false);
  const [moduleForm, setModuleForm] = useState(EMPTY_MODULE);

  const [expandedCurricula, setExpandedCurricula] = useState({});

  // List of playlists
  const { data: playlists = [], isLoading: loadingList } = useQuery({
    queryKey: ['playlists', projectId],
    queryFn: () => client.get(`/projects/${projectId}/playlists`).then(r => r.data)
  });

  // Selected playlist with nested data
  const { data: playlist, isLoading: loadingDetail } = useQuery({
    queryKey: ['playlist', projectId, selectedId],
    queryFn: () => client.get(`/projects/${projectId}/playlists/${selectedId}`).then(r => r.data),
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries(['playlists', projectId]);
    qc.invalidateQueries(['playlist', projectId, selectedId]);
  };

  const createPlaylist = useMutation({
    mutationFn: (d) => client.post(`/projects/${projectId}/playlists`, d),
    onSuccess: (res) => { invalidate(); setShowPlaylistForm(false); setPlaylistForm(EMPTY_PLAYLIST); setSelectedId(res.data.id); }
  });
  const updatePlaylist = useMutation({
    mutationFn: (d) => client.put(`/projects/${projectId}/playlists/${selectedId}`, d),
    onSuccess: () => { invalidate(); setEditingPlaylist(false); }
  });
  const deletePlaylist = useMutation({
    mutationFn: (id) => client.delete(`/projects/${projectId}/playlists/${id}`),
    onSuccess: () => { invalidate(); setSelectedId(null); }
  });

  const createCurriculum = useMutation({
    mutationFn: (d) => client.post(`/projects/${projectId}/playlists/${selectedId}/curricula`, d),
    onSuccess: (res) => {
      invalidate();
      setShowCurriculumForm(false);
      setCurriculumForm(EMPTY_CURRICULUM);
      setExpandedCurricula(e => ({ ...e, [res.data.id]: true }));
    }
  });
  const deleteCurriculum = useMutation({
    mutationFn: ({ curriculumId }) => client.delete(`/projects/${projectId}/playlists/${selectedId}/curricula/${curriculumId}`),
    onSuccess: () => invalidate()
  });

  const createModule = useMutation({
    mutationFn: (d) => client.post(`/projects/${projectId}/playlists/${selectedId}/modules`, d),
    onSuccess: () => { invalidate(); setShowModuleForm(false); setModuleForm(EMPTY_MODULE); }
  });
  const deleteModule = useMutation({
    mutationFn: ({ moduleId }) => client.delete(`/projects/${projectId}/playlists/${selectedId}/modules/${moduleId}`),
    onSuccess: () => invalidate()
  });

  function toggleCurriculum(id) {
    setExpandedCurricula(e => ({ ...e, [id]: !e[id] }));
  }

  const inputClass = 'border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-300';
  const labelClass = 'text-xs text-slate-500 block mb-1';

  return (
    <div className="flex h-full gap-4">

      {/* LEFT: playlist list */}
      <div className="w-64 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Playlists ({playlists.length})</h2>
          <button
            onClick={() => { setShowPlaylistForm(v => !v); setPlaylistForm(EMPTY_PLAYLIST); }}
            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700"
          >+ New</button>
        </div>

        {showPlaylistForm && (
          <div className="border rounded-xl bg-slate-50 p-3 mb-3">
            <div className="mb-2">
              <label className={labelClass}>Title</label>
              <input className={inputClass} value={playlistForm.title}
                onChange={e => setPlaylistForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. PDM PBOM for ETO Authors" />
            </div>
            <div className="mb-2">
              <label className={labelClass}>Content ID</label>
              <input className={inputClass} value={playlistForm.content_id}
                onChange={e => setPlaylistForm(f => ({ ...f, content_id: e.target.value }))} placeholder="e.g. LP-00123" />
            </div>
            <div className="mb-2">
              <label className={labelClass}>Link</label>
              <input className={inputClass} value={playlistForm.link}
                onChange={e => setPlaylistForm(f => ({ ...f, link: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="mb-3">
              <label className={labelClass}>Description</label>
              <textarea className={`${inputClass} resize-none h-16`} value={playlistForm.description}
                onChange={e => setPlaylistForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => createPlaylist.mutate(playlistForm)}
                disabled={!playlistForm.title || createPlaylist.isPending}
                className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-40">Save</button>
              <button onClick={() => setShowPlaylistForm(false)}
                className="text-xs border px-3 py-1 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 space-y-1">
          {loadingList && <p className="text-xs text-slate-400">Loading...</p>}
          {playlists.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedId(p.id); setEditingPlaylist(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedId === p.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="font-medium truncate">{p.title}</div>
              {p.content_id && <div className={`text-xs truncate ${ selectedId === p.id ? 'text-blue-200' : 'text-slate-400' }`}>{p.content_id}</div>}
            </button>
          ))}
          {!loadingList && playlists.length === 0 && (
            <p className="text-xs text-slate-400 px-2">No playlists yet. Create one to get started.</p>
          )}
        </div>
      </div>

      {/* RIGHT: playlist detail */}
      <div className="flex-1 overflow-y-auto">
        {!selectedId && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select a playlist to view its content</div>
        )}

        {selectedId && loadingDetail && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading...</div>
        )}

        {selectedId && playlist && !loadingDetail && (
          <div>
            {/* Playlist header */}
            {editingPlaylist ? (
              <div className="bg-slate-50 border rounded-xl p-4 mb-4">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={labelClass}>Title</label>
                    <input className={inputClass} value={editPlaylistForm.title}
                      onChange={e => setEditPlaylistForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Content ID</label>
                    <input className={inputClass} value={editPlaylistForm.content_id}
                      onChange={e => setEditPlaylistForm(f => ({ ...f, content_id: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Link</label>
                    <input className={inputClass} value={editPlaylistForm.link}
                      onChange={e => setEditPlaylistForm(f => ({ ...f, link: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Description</label>
                    <input className={inputClass} value={editPlaylistForm.description}
                      onChange={e => setEditPlaylistForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => updatePlaylist.mutate(editPlaylistForm)}
                    disabled={updatePlaylist.isPending}
                    className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-40">Save</button>
                  <button onClick={() => setEditingPlaylist(false)}
                    className="text-xs border px-3 py-1 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-800">{playlist.title}</h1>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {playlist.content_id && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{playlist.content_id}</span>}
                    <span className="text-xs text-slate-500">Duration: <strong className="text-slate-700">{playlist.duration_computed}</strong> ({playlist.total_minutes} min mandatory)</span>
                    {playlist.link && (
                      <a href={playlist.link} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">Open link</a>
                    )}
                  </div>
                  {playlist.description && <p className="text-sm text-slate-500 mt-1">{playlist.description}</p>}
                </div>
                <div className="flex gap-2 shrink-0 ml-4">
                  <button onClick={() => { setEditingPlaylist(true); setEditPlaylistForm({ title: playlist.title, description: playlist.description || '', link: playlist.link || '', content_id: playlist.content_id || '' }); }}
                    className="text-xs border px-3 py-1 rounded-lg text-slate-600 hover:bg-slate-50">Edit</button>
                  <button onClick={() => { if (window.confirm('Delete this playlist and all its content?')) deletePlaylist.mutate(playlist.id); }}
                    className="text-xs border border-red-200 px-3 py-1 rounded-lg text-red-400 hover:bg-red-50">Delete</button>
                </div>
              </div>
            )}

            {/* Curricula */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Curricula ({playlist.curricula?.length || 0})</h2>
                <button onClick={() => { setShowCurriculumForm(v => !v); setCurriculumForm(EMPTY_CURRICULUM); }}
                  className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-200">+ Add curriculum</button>
              </div>

              {showCurriculumForm && (
                <div className="border rounded-xl bg-slate-50 p-3 mb-3">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="col-span-2">
                      <label className={labelClass}>Title</label>
                      <input className={inputClass} value={curriculumForm.title}
                        onChange={e => setCurriculumForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Windchill Basics" />
                    </div>
                    <div>
                      <label className={labelClass}>Content ID</label>
                      <input className={inputClass} value={curriculumForm.content_id}
                        onChange={e => setCurriculumForm(f => ({ ...f, content_id: e.target.value }))} placeholder="CU-001" />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Requirement</label>
                    <div className="flex gap-3">
                      {REQUIREMENT_OPTIONS.map(o => (
                        <label key={o} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="radio" name="cur_req" value={o} checked={curriculumForm.requirement === o}
                            onChange={() => setCurriculumForm(f => ({ ...f, requirement: o }))} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => createCurriculum.mutate(curriculumForm)}
                      disabled={!curriculumForm.title || createCurriculum.isPending}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-40">Save</button>
                    <button onClick={() => setShowCurriculumForm(false)}
                      className="text-xs border px-3 py-1 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {playlist.curricula?.map(c => (
                  <div key={c.id} className="border rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleCurriculum(c.id)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-slate-50 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{c.title}</span>
                        {c.content_id && <span className="text-xs font-mono text-slate-400">{c.content_id}</span>}
                        <RequirementBadge value={c.requirement} />
                        <span className="text-xs text-slate-400">{c.modules?.length || 0} modules</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this curriculum and its modules?')) deleteCurriculum.mutate({ curriculumId: c.id }); }}
                          className="text-red-300 hover:text-red-500 text-xs">Delete</button>
                        <span className="text-slate-400 text-xs">{expandedCurricula[c.id] ? 'Hide' : 'Show'}</span>
                      </div>
                    </button>
                    {expandedCurricula[c.id] && (
                      <div className="border-t bg-slate-50 divide-y">
                        {c.modules?.length === 0 && (
                          <p className="text-xs text-slate-400 px-4 py-2">No modules yet. Add a module below and assign it to this curriculum.</p>
                        )}
                        {c.modules?.map(m => (
                          <div key={m.id} className="flex items-center justify-between px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-slate-700">{m.title}</span>
                              {m.content_id && <span className="text-xs font-mono text-slate-400">{m.content_id}</span>}
                              <RequirementBadge value={m.requirement} />
                              <span className="text-xs text-slate-400">{durationLabel(m.duration_min)}</span>
                            </div>
                            <button onClick={() => deleteModule.mutate({ moduleId: m.id })}
                              className="text-red-300 hover:text-red-500 text-xs">Delete</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {playlist.curricula?.length === 0 && !showCurriculumForm && (
                  <p className="text-xs text-slate-400">No curricula yet.</p>
                )}
              </div>
            </div>

            {/* Standalone modules */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Standalone modules ({playlist.standalone_modules?.length || 0})</h2>
                <button onClick={() => { setShowModuleForm(v => !v); setModuleForm(EMPTY_MODULE); }}
                  className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-200">+ Add module</button>
              </div>

              {showModuleForm && (
                <div className="border rounded-xl bg-slate-50 p-3 mb-3">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="col-span-2">
                      <label className={labelClass}>Title</label>
                      <input className={inputClass} value={moduleForm.title}
                        onChange={e => setModuleForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Introduction to Windchill" />
                    </div>
                    <div>
                      <label className={labelClass}>Content ID</label>
                      <input className={inputClass} value={moduleForm.content_id}
                        onChange={e => setModuleForm(f => ({ ...f, content_id: e.target.value }))} placeholder="MO-001" />
                    </div>
                    <div>
                      <label className={labelClass}>Duration (minutes)</label>
                      <input type="number" min="0" className={inputClass} value={moduleForm.duration_min}
                        onChange={e => setModuleForm(f => ({ ...f, duration_min: e.target.value }))} placeholder="30" />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Assign to curriculum (optional - leave empty for standalone)</label>
                    <select className={inputClass} value={moduleForm.curriculum_id}
                      onChange={e => setModuleForm(f => ({ ...f, curriculum_id: e.target.value }))}>
                      <option value="">Standalone (no curriculum)</option>
                      {playlist.curricula?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Requirement</label>
                    <div className="flex gap-3">
                      {REQUIREMENT_OPTIONS.map(o => (
                        <label key={o} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="radio" name="mod_req" value={o} checked={moduleForm.requirement === o}
                            onChange={() => setModuleForm(f => ({ ...f, requirement: o }))} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => createModule.mutate({ ...moduleForm, curriculum_id: moduleForm.curriculum_id || null, duration_min: parseInt(moduleForm.duration_min) || 0 })}
                      disabled={!moduleForm.title || createModule.isPending}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-40">Save</button>
                    <button onClick={() => setShowModuleForm(false)}
                      className="text-xs border px-3 py-1 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
                  </div>
                </div>
              )}

              <div className="border rounded-xl overflow-hidden">
                {playlist.standalone_modules?.length === 0 && !showModuleForm && (
                  <p className="text-xs text-slate-400 px-4 py-3">No standalone modules yet.</p>
                )}
                <div className="divide-y">
                  {playlist.standalone_modules?.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-4 py-2 bg-white hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-700">{m.title}</span>
                        {m.content_id && <span className="text-xs font-mono text-slate-400">{m.content_id}</span>}
                        <RequirementBadge value={m.requirement} />
                        <span className="text-xs text-slate-400">{durationLabel(m.duration_min)}</span>
                      </div>
                      <button onClick={() => deleteModule.mutate({ moduleId: m.id })}
                        className="text-red-300 hover:text-red-500 text-xs">Delete</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
