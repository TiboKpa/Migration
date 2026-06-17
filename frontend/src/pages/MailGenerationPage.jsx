import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import client from '../api/client';

export default function MailGenerationPage() {
  const { projectId } = useParams();
  const [selectedUser, setSelectedUser] = useState('');
  const [preview, setPreview] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });

  const generateMutation = useMutation({
    mutationFn: () => client.post(`/projects/${projectId}/generate/preview`, { user_id: selectedUser }),
    onSuccess: res => setPreview(res.data)
  });

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-1">Mail Generation</h1>
      <p className="text-sm text-slate-500 mb-6">Preview and generate training communications</p>
      <div className="bg-white border rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Setup</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1">Select user for preview</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="">Select a user</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} - {u.role}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={!selectedUser}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            Preview
          </button>
        </div>
        {generateMutation.isError && <p className="text-sm text-red-500 mt-2">{generateMutation.error?.response?.data?.error}</p>}
      </div>
      {preview && (
        <div className="bg-white border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Rendered email preview</h2>
            <span className="text-xs text-slate-400">Total: {preview.total_hours}h</span>
          </div>
          <div className="border rounded-lg overflow-auto bg-slate-50 p-4" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}
    </div>
  );
}
