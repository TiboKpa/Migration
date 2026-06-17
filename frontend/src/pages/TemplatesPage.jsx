import React, { useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

export default function TemplatesPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => client.get(`/projects/${projectId}/templates`).then(r => r.data)
  });

  const activateMutation = useMutation({
    mutationFn: id => client.put(`/projects/${projectId}/templates/${id}/activate`),
    onSuccess: () => qc.invalidateQueries(['templates', projectId])
  });

  const uploadMutation = useMutation({
    mutationFn: file => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('template_name', file.name.replace('.html', ''));
      return client.post(`/projects/${projectId}/templates/upload`, fd);
    },
    onSuccess: () => qc.invalidateQueries(['templates', projectId])
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/templates/${id}`),
    onSuccess: () => qc.invalidateQueries(['templates', projectId])
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Templates</h1>
          <p className="text-sm text-slate-500">Manage email templates for this project</p>
        </div>
        <div>
          <button onClick={() => fileRef.current.click()} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Upload HTML</button>
          <input ref={fileRef} type="file" accept=".html" className="hidden" onChange={e => { if (e.target.files[0]) uploadMutation.mutate(e.target.files[0]); }} />
        </div>
      </div>
      <div className="space-y-3">
        {templates.length === 0 && <p className="text-sm text-slate-400">No templates yet. Upload an HTML file.</p>}
        {templates.map(t => (
          <div key={t.id} className="bg-white border rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800">{t.template_name}</p>
              <p className="text-xs text-slate-400">{t.source_type} - updated {new Date(t.updated_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              {t.is_default && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>}
              {!t.is_default && <button onClick={() => activateMutation.mutate(t.id)} className="text-xs text-blue-600 hover:underline">Set as default</button>}
              {t.source_type === 'uploaded' && <button onClick={() => deleteMutation.mutate(t.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
