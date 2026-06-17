import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

export default function TrainingMatrixPage() {
  const { projectId } = useParams();
  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles', projectId],
    queryFn: () => client.get(`/projects/${projectId}/profiles`).then(r => r.data)
  });
  const { data: trainings = [] } = useQuery({
    queryKey: ['trainings', projectId],
    queryFn: () => client.get(`/projects/${projectId}/trainings`).then(r => r.data)
  });

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Training Matrix</h1>
      <p className="text-sm text-slate-500 mb-6">Manage profiles and training mappings</p>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Profiles ({profiles.length})</h2>
          {profiles.length === 0 && <p className="text-sm text-slate-400">No profiles yet</p>}
          <ul className="space-y-1">
            {profiles.map(p => (
              <li key={p.id} className="text-sm text-slate-600 px-2 py-1.5 rounded hover:bg-slate-50">{p.profile_name}</li>
            ))}
          </ul>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Training references ({trainings.length})</h2>
          {trainings.length === 0 && <p className="text-sm text-slate-400">No trainings yet</p>}
          <ul className="space-y-1">
            {trainings.map(t => (
              <li key={t.id} className="text-sm text-slate-600 px-2 py-1.5 rounded hover:bg-slate-50">
                {t.training_title} <span className="text-slate-400 text-xs">({t.duration_hhmm})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
