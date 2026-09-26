import { useState } from 'react';
import { useStore } from '../store';
import { ConfirmButton } from '../ui';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function syncLabel(status: ReturnType<typeof useStore>['sync']['status']) {
  switch (status.kind) {
    case 'off':
      return 'Sync off';
    case 'syncing':
      return 'Syncing…';
    case 'error':
      return 'Sync error';
    case 'conflict':
      return 'Sync needs you';
    case 'idle':
      return status.at ? `Synced ${new Date(status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sync on';
  }
}

export default function SyncPanel() {
  const { state, sync } = useStore();
  const [token, setToken] = useState('');
  const { status } = sync;

  return (
    <section className="card">
      <h2>Sync between devices</h2>
      {!sync.connected ? (
        <>
          <p className="muted small">
            Keeps your phone and laptop on the same data by saving it to a secret gist on your GitHub account. Do this once on each device:
          </p>
          <ol className="small steps">
            <li>
              Create a fine-grained token at{' '}
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                github.com/settings/personal-access-tokens
              </a>
              . Under <b>Account permissions</b>, set <b>Gists</b> to <b>Read and write</b>. Nothing else is needed.
            </li>
            <li>Paste it below. The token stays on this device only; it is never put into the synced data or your backups.</li>
          </ol>
          <div className="drop-row wrap">
            <input className="grow" type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="primary" disabled={!token.trim() || status.kind === 'syncing'} onClick={() => sync.connect(token).then(() => setToken(''), () => {})}>
              {status.kind === 'syncing' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">
            <b>{syncLabel(status)}</b>
            <span className="muted">
              {' '}
              · changes upload a moment after you make them, and the latest data downloads whenever you open the app.
            </span>
          </p>
          {status.kind === 'conflict' && (
            <div className="hint">
              <p>
                This device and another one both changed your data since they last synced. Which copy do you want to keep? The other copy will be replaced.
              </p>
              <p className="small muted">
                This device: {state.cards.length} cards, changed {when(state.updatedAt)}. Other device: {status.remote.cards?.length ?? 0} cards, changed {when(status.remote.updatedAt)}.
              </p>
              <div className="actions">
                <button className="primary" onClick={() => sync.resolve('theirs')}>
                  Use the other device's data
                </button>
                <button onClick={() => sync.resolve('mine')}>Keep this device's data</button>
              </div>
            </div>
          )}
          <div className="actions">
            <button onClick={() => sync.syncNow()} disabled={status.kind === 'syncing' || status.kind === 'conflict'}>
              Sync now
            </button>
            <ConfirmButton label="Disconnect this device" className="ghost" onConfirm={sync.disconnect} />
          </div>
        </>
      )}
      {status.kind === 'error' && <p className="small error">{status.message}</p>}
    </section>
  );
}

function when(ms: number | undefined) {
  return ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
}
