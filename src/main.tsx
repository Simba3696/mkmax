import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startServiceWorker } from './appUpdate';
import { StoreProvider } from './store';
import App from './App';
import './styles.css';

startServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
