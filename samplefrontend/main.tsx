import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.tsx';
import { PlayLayout } from './play/PlayLayout';
import PresentPage from './play/present-page';
import BumperExportPage from './play/bumper-export-page';
import PlayPage from './play/page';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  {
    path: '/play/:projectId',
    element: <PlayLayout />,
    children: [
      { index: true, element: <PresentPage /> },
      { path: 'present', element: <PresentPage /> },
      { path: 'bumper/:kind', element: <BumperExportPage /> },
      { path: 'debug', element: <PlayPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
