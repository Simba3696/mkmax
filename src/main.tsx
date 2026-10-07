import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startServiceWorker } from './appUpdate';
import { StoreProvider } from './store';
import App from './App';
import './styles.css';

startServiceWorker();

// Without sync, localStorage is the only copy of the user's data, and browsers may clear a site's storage when space
// runs low or (Safari) after a week unused. Asking to keep it protects against that where the browser agrees.
void navigator.storage
  ?.persisted?.()
  .then((kept) => kept || navigator.storage.persist())
  .catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
