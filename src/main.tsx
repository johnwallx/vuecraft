import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './app/App';

// Test builds only (VITE_E2E_WDIO=1): WebdriverIO's frontend plugin. Production builds drop this branch.
if (import.meta.env.VITE_E2E_WDIO === '1') void import('@wdio/tauri-plugin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
