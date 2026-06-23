import React, { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';

function PreviewModal({ template, onClose }) {
  if (!template) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <p className="text-sm font-semibold text-slate-800">{template.template_name}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&#x2715;</button>
        </div>
        <div
          className="flex-1 overflow-auto p-4 bg-slate-50"
          dangerouslySetInnerHTML={{ __html: template.html_content }}
        />
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef();
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, value }

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => client.get(`/projects/${projectId}/templates`).then(r => r.data),
  });

  const uploadMutation = useMutation({
    mutationFn: file => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('template_name', file.name.replace(/\.html$/i, ''));
      return client.post(`/projects/${projectId}/templates/upload`, fd);
    },
    onSuccess: () => qc.invalidateQueries(['templates', projectId]),
  });

  const activateMutation = useMutation({
    mutationFn: id => client.put(`/projects/${projectId}/templates/${id}/activate`),
    onSuccess: () => qc.invalidateQueries(['templates', projectId]),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }) => client.patch(`/projects/${projectId}/templates/${id}`, { template_name: name }),
    onSuccess: () => { qc.invalidateQueries(['templates', projectId]); setRenaming(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: id => client.delete(`/projects/${projectId}/templates/${id}`),
    onSuccess: () => qc.invalidateQueries(['templates', projectId]),
  });

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = '';
  }

  function startRename(t) {
    setRenaming({ id: t.id, value: t.template_name });
  }

  function submitRename() {
    if (!renaming || !renaming.value.trim()) return;
    renameMutation.mutate({ id: renaming.id, name: renaming.value.trim() });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Email Templates</h1>
          <p className="text-sm text-slate-500">Upload and manage HTML email templates for this project</p>
        </div>
        <button
          onClick={() => fileRef.current.click()}
          disabled={uploadMutation.isPending}
          className="bg-[#3DCD58] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#35b84e] disabled:opacity-40"
        >
          {uploadMutation.isPending ? 'Uploading...' : 'Upload HTML'}
        </button>
        <input ref={fileRef} type="file" accept=".html" className="hidden" onChange={handleFileChange} />
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading templates...</p>}

      {!isLoading && templates.length === 0 && (
        <div className="bg-white border rounded-xl p-8 text-center">
          <p className="text-slate-400 text-sm">No templates yet. Upload an HTML file to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {templates.map(t => (
          <div key={t.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {renaming?.id === t.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className="border rounded-lg px-2 py-1 text-sm w-56"
                      value={renaming.value}
                      onChange={e => setRenaming(r => ({ ...r, value: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null); }}
                    />
                    <button onClick={submitRename} className="text-xs text-[#3DCD58] font-medium hover:underline">Save</button>
                    <button onClick={() => setRenaming(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-800 text-sm">{t.template_name}</p>
                    {t.is_default && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Default</span>
                    )}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.source_type} - updated {new Date(t.updated_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setPreviewTemplate(t)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Preview
                </button>
                {!t.is_default && (
                  <button
                    onClick={() => activateMutation.mutate(t.id)}
                    disabled={activateMutation.isPending}
                    className="text-xs text-slate-600 hover:underline disabled:opacity-40"
                  >
                    Set as default
                  </button>
                )}
                {t.source_type === 'uploaded' && (
                  <button
                    onClick={() => startRename(t)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Rename
                  </button>
                )}
                {t.source_type === 'uploaded' && (
                  <button
                    onClick={() => { if (window.confirm('Delete this template?')) deleteMutation.mutate(t.id); }}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <PreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />
    </div>
  );
}
