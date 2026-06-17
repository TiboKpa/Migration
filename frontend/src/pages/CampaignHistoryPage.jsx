import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

export default function CampaignHistoryPage() {
  const { projectId } = useParams();
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', projectId],
    queryFn: () => client.get(`/projects/${projectId}/campaigns`).then(r => r.data)
  });

  const statusColor = { drafted: 'bg-gray-100 text-gray-600', exported: 'bg-blue-100 text-blue-700', sent: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-600' };

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Campaign History</h1>
      <p className="text-sm text-slate-500 mb-6">All generated campaigns for this project</p>
      {isLoading && <p className="text-slate-400 text-sm">Loading...</p>}
      {!isLoading && campaigns.length === 0 && <p className="text-slate-400 text-sm">No campaigns generated yet.</p>}
      <div className="space-y-3">
        {campaigns.map(c => (
          <div key={c.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-slate-800">{c.campaign_name}</p>
                <p className="text-xs text-slate-400">{new Date(c.generation_date).toLocaleString()} - {c.user_count} users - {c.part_count} parts</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
