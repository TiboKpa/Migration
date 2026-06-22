import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

// Strip time component so date inputs always show YYYY-MM-DD.
function toDateOnly(val) {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.split('T')[0];
}

export default function SettingsPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.get(`/projects/${projectId}`).then(r => r.data)
  });

  useEffect(() => {
    if (project) setForm({
      project_name: project.project_name || '',
      plant_name: project.plant_name || '',
      application_name: project.application_name || '',
      go_live_date: toDateOnly(project.go_live_date),
      status: project.status || 'draft',
      notes: project.notes || ''
    });
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: data => client.put(`/projects/${projectId}`, data),
    onSuccess: () => { qc.invalidateQueries(['project', projectId]); setSaved(true); setTimeout(() => setSaved(false), 2000); }
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">Project configuration</p>
      <form onSubmit={e => { e.preventDefault(); updateMutation.mutate(form); }} className="bg-white border rounded-xl p-5 space-y-4">
        {[
          { key: 'project_name', label: 'Project name' },
          { key: 'plant_name', label: 'Plant name' },
          { key: 'application_name', label: 'Application name' },
          { key: 'notes', label: 'Notes' }
        ].map(field => (
          <div key={field.key}>
            <label className="text-xs text-slate-500 block mb-1">{field.label}</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form[field.key] || ''} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
          </div>
        ))}
        <div>
          <label className="text-xs text-slate-500 block mb-1">Go-live date</label>
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={form.go_live_date || ''}
            onChange={e => setForm(f => ({ ...f, go_live_date: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Status</label>
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.status || 'draft'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="draft">Draft</option>
            <option value="setup_in_progress">Setup in progress</option>
            <option value="ready">Ready</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Save changes</button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </form>
    </div>
  );
}
