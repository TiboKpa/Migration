import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg animate-fade-in">
      <span>{message}</span>
      <button onClick={onDismiss} className="text-white/70 hover:text-white text-base leading-none">&times;</button>
    </div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ project_name: '', plant_name: '', application_name: '', go_live_date: '' });
  const [toast, setToast] = useState(location.state?.flash || null);

  // Clear the flash from history state so a refresh does not replay it
  useEffect(() => {
    if (location.state?.flash) {
      window.history.replaceState({}, '');
    }
  }, []);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => client.get('/projects').then(r => r.data)
  });

  const createProject = useMutation({
    mutationFn: data => client.post('/projects', data),
    onSuccess: () => {
      qc.invalidateQueries(['projects']);
      setShowCreate(false);
      setForm({ project_name: '', plant_name: '', application_name: '', go_live_date: '' });
    },
  });

  const statusColor = {
    draft:             'bg-gray-100 text-gray-600',
    setup_in_progress: 'bg-yellow-100 text-yellow-700',
    ready:             'bg-green-100 text-green-700',
    archived:          'bg-red-100 text-red-600',
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold text-slate-800">Migration</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-slate-800">Projects</h2>
          <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            New project
          </button>
        </div>

        {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
        {!isLoading && projects.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-lg font-medium mb-2">No projects yet</p>
            <p className="text-sm">Create a project to get started.</p>
          </div>
        )}

        <div className="grid gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="bg-white border rounded-xl p-5 cursor-pointer hover:shadow-md transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{p.project_name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{p.plant_name} - {p.application_name}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                  {p.status}
                </span>
              </div>
              {p.go_live_date && (
                <p className="text-xs text-slate-400 mt-2">Go-live: {new Date(p.go_live_date).toLocaleDateString()}</p>
              )}
            </div>
          ))}
        </div>
      </main>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-slate-800 mb-4">New project</h3>
            <form onSubmit={e => { e.preventDefault(); createProject.mutate(form); }} className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Project name *" value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} required />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Plant name" value={form.plant_name} onChange={e => setForm(f => ({ ...f, plant_name: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Application name" value={form.application_name} onChange={e => setForm(f => ({ ...f, application_name: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" type="date" value={form.go_live_date} onChange={e => setForm(f => ({ ...f, go_live_date: e.target.value }))} />
              <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
