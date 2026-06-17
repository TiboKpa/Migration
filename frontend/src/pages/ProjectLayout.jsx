import React from 'react';
import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

const navItems = [
  { to: '', label: 'Overview', end: true },
  { to: 'users', label: 'User List' },
  { to: 'matrix', label: 'Training Matrix' },
  { to: 'templates', label: 'Templates' },
  { to: 'generate', label: 'Mail Generation' },
  { to: 'campaigns', label: 'Campaign History' },
  { to: 'settings', label: 'Settings' }
];

export default function ProjectLayout() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.get(`/projects/${projectId}`).then(r => r.data)
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-slate-700 text-sm">Dashboard</button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-semibold text-slate-800">{project?.project_name || 'Loading...'}</span>
        </div>
        <span className="text-xs text-slate-400">{project?.plant_name} - {project?.application_name}</span>
      </header>
      <div className="flex flex-1">
        <aside className="w-52 bg-white border-r flex flex-col py-4 px-3 shrink-0">
          <nav className="space-y-1">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                relative="route"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-sm transition ${
                    isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
