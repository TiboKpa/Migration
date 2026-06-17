import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

export default function OverviewPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.get(`/projects/${projectId}`).then(r => r.data)
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => client.get(`/projects/${projectId}/templates`).then(r => r.data)
  });

  const activeTemplate = templates.find(t => t.is_default);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">{project?.project_name}</h1>
      <p className="text-sm text-slate-500 mb-6">Project overview and readiness status</p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: 'Plant', value: project?.plant_name },
          { label: 'Application', value: project?.application_name },
          { label: 'Go-live date', value: project?.go_live_date ? new Date(project.go_live_date).toLocaleDateString() : '-' },
          { label: 'Status', value: project?.status }
        ].map(item => (
          <div key={item.label} className="bg-white border rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{item.label}</p>
            <p className="font-medium text-slate-800">{item.value || '-'}</p>
          </div>
        ))}
      </div>
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Readiness</h2>
        <div className="space-y-2">
          {[
            { label: 'User list', ok: users.length > 0, action: () => navigate('users') },
            { label: 'Active template', ok: !!activeTemplate, action: () => navigate('templates') }
          ].map(item => (
            <div key={item.label} onClick={item.action} className="flex items-center justify-between cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5">
              <span className="text-sm text-slate-600">{item.label}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.ok ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {item.ok ? 'Done' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => navigate('generate')} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
          Generate campaign
        </button>
        <button onClick={() => navigate('users')} className="border px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Open user list</button>
      </div>
    </div>
  );
}
