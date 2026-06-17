import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

const COLUMNS = ['sesa_id','first_name','last_name','mail','function','role','tlg_group','status'];

export default function UserListPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();
  const [filter, setFilter] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', projectId],
    queryFn: () => client.get(`/projects/${projectId}/users`).then(r => r.data)
  });

  const importMutation = useMutation({
    mutationFn: file => {
      const fd = new FormData();
      fd.append('file', file);
      return client.post(`/projects/${projectId}/users/import`, fd);
    },
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries(['users', projectId])
  });

  const filtered = users.filter(u =>
    !filter || Object.values(u).some(v => String(v).toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User List</h1>
          <p className="text-sm text-slate-500">{users.length} users</p>
        </div>
        <div className="flex gap-2">
          <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} />
          <button onClick={() => fileRef.current.click()} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            Import Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { if (e.target.files[0]) importMutation.mutate(e.target.files[0]); }} />
        </div>
      </div>
      {importMutation.isPending && <p className="text-sm text-blue-600 mb-2">Importing...</p>}
      {importMutation.isSuccess && <p className="text-sm text-green-600 mb-2">Import successful</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              {COLUMNS.map(col => (
                <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{col.replace(/_/g, ' ')}</th>
              ))}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-4 text-center text-slate-400">Loading...</td></tr>}
            {filtered.map(user => (
              <tr key={user.id} className="border-b hover:bg-slate-50">
                {COLUMNS.map(col => (
                  <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">{user[col] || '-'}</td>
                ))}
                <td className="px-3 py-2">
                  <button onClick={() => deleteMutation.mutate(user.id)} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
