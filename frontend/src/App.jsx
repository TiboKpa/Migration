import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ProjectLayout from './pages/ProjectLayout';
import OverviewPage from './pages/OverviewPage';
import UserListPage from './pages/UserListPage';
import TrainingMatrixPage from './pages/TrainingMatrixPage';
import TemplatesPage from './pages/TemplatesPage';
import MailGenerationPage from './pages/MailGenerationPage';
import CampaignHistoryPage from './pages/CampaignHistoryPage';
import SettingsPage from './pages/SettingsPage';

function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/projects/:projectId" element={<PrivateRoute><ProjectLayout /></PrivateRoute>}>
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UserListPage />} />
          <Route path="matrix" element={<TrainingMatrixPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="generate" element={<MailGenerationPage />} />
          <Route path="campaigns" element={<CampaignHistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
