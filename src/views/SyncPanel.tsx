import { useState } from 'react';
import { useStore } from '../store';
import { ConfirmButton, FoldCard } from '../ui';
import { actions, btn, hint } from '../classes';

// Classic token pre-filled with only the gist scope; fine-grained tokens don't reliably offer Gists access.
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=MK%20Max%20sync';

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
    <FoldCard id="settings-sync" title="Sync between devices">
      {!sync.connected ? (
        <>
          <p className="text-muted text-small">
            Keeps your phone and laptop on the same data by saving it to a secret gist on your GitHub account. Do this once on each device:
          </p>
          <ol className="text-small list-decimal pl-[40px] my-[1em] [&>li]:my-[0.4rem]">
            <li>
              Open{' '}
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                this GitHub token page
              </a>
              . It's pre-filled with only the <b>gist</b> scope. Pick an expiration and click <b>Generate token</b>.
            </li>
            <li>Paste it below. The token stays on this device only; it is never put into the synced data or your backups.</li>
          </ol>
          <div className="flex flex-wrap gap-[0.4rem] items-center my-[0.35rem] md:max-w-[32rem]">
            <input className="flex-1 min-w-0" type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className={btn.primary} disabled={!token.trim() || status.kind === 'syncing'} onClick={() => sync.connect(token).then(() => setToken(''), () => {})}>
              {status.kind === 'syncing' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-small">
            <b>{syncLabel(status)}</b>
            <span className="text-muted">
              {' '}
              · changes upload a moment after you make them, and the latest data downloads whenever you open the app.
            </span>
          </p>
          {status.kind === 'conflict' && (
            <div className={hint}>
              <p>
                This device and another one both changed your data since they last synced. Which copy do you want to keep? The other copy will be replaced.
              </p>
              <p className="text-small text-muted">
                This device: {state.cards.length} cards, changed {when(state.updatedAt)}. Other device: {status.remote.cards?.length ?? 0} cards, changed {when(status.remote.updatedAt)}.
              </p>
              <div className={actions}>
                <button className={btn.primary} onClick={() => sync.resolve('theirs')}>
                  Use the other device's data
                </button>
                <button onClick={() => sync.resolve('mine')}>Keep this device's data</button>
              </div>
            </div>
          )}
          <div className={actions}>
            <button onClick={() => sync.syncNow()} disabled={status.kind === 'syncing' || status.kind === 'conflict'}>
              Sync now
            </button>
            <ConfirmButton label="Disconnect this device" className={btn.ghost} onConfirm={sync.disconnect} />
          </div>
        </>
      )}
      {status.kind === 'error' && <p className="text-small text-error">{status.message}</p>}
    </FoldCard>
  );
}

function when(ms: number | undefined) {
  return ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
}
