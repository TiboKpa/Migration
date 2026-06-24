import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 60 s -- no refetch if you navigate away and back
      staleTime: 60_000,
      // Keep unused cache for 5 min so returning to a page is instant
      gcTime: 5 * 60_000,
      // Do not refetch just because the browser tab regains focus
      refetchOnWindowFocus: false,
      // Only retry once on error (default is 3) to avoid hammering a rate-limited API
      retry: 1,
      // Wait 2 s before the single retry
      retryDelay: 2000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
