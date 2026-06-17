import React, { useEffect } from 'react';
import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import client from '../api/client';

const navItems = [
  { to: '', label: 'Overview', end: true },
  { to: 'users', label: 'User List' },
  { to: 'role-matrix', label: 'Role Matrix' },
  { to: 'matrix', label: 'Training Matrix' },
  { to: 'templates', label: 'Templates' },
  { to: 'generate', label: 'Mail Generation' },
  { to: 'campaigns', label: 'Campaign History' },
  { to: 'settings', label: 'Settings' },
];

export default function ProjectLayout() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = React.useState(null);
  const [checking, setChecking] = React.useState(true);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    client
      .get(`/projects/${projectId}`)
      .then(r => { if (!cancelled) { setProject(r.data); setChecking(false); } })
      .catch(err => {
        if (cancelled) return;
        const status = err.response?.status;
        if (status === 404 || status === 403 || status === 400) {
          navigate('/', { replace: true, state: { flash: 'This project does not exist.' } });
        } else {
          navigate('/', { replace: true, state: { flash: 'This project does not exist.' } });
        }
      });
    return () => { cancelled = true; };
  }, [projectId, navigate]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="text-sm text-slate-400">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-slate-700 text-sm">Dashboard</button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-semibold text-slate-800">{project?.project_name}</span>
        </div>
        <span className="text-xs text-slate-400">{project?.plant_name} - {project?.application_name}</span>
      </header>
      <div className="flex flex-1 min-h-0">
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
        <main className="flex-1 p-6 overflow-auto bg-slate-50">
          <React.Suspense fallback={<div className="bg-slate-50 min-h-full" />}>
            <Outlet />
          </React.Suspense>
        </main>
      </div>
    </div>
  );
}
