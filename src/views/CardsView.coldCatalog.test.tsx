// @vitest-environment jsdom
// Its own file, so no catalog has loaded yet when the screen opens: the catalog module keeps a loaded copy, and
// loadCatalog returns it without downloading again, so in a file where an earlier test loaded one it is always there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import CardsView from './CardsView';

function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Cards: Find images before the catalog has loaded', () => {
  // Generated on 2026-10-26 (/ship review, pr-ci run 18)
  // Value: protects=a tap on Find images before the catalog has loaded leaves a card the catalog lists without art
  // unchecked (it keeps its older wiki art and keeps waiting for the site's) and says so; fails_when=such a card is
  // marked as checked (it never gets the site's art) or its art is replaced with nothing; why_new=once a catalog has
  // loaded, the count leaves the card out, so only a tap before then reaches this; seam=fetch holds the catalog until
  // released; no_claim=a wiki that answers
  it('keeps a card the catalog lists without art waiting for the site', async () => {
    let release!: () => void;
    const catalog = { items: [{ kind: 'character', name: 'Shujinko, Unfinished', rarity: 'diamond', slug: 'shujinko-unfinished' }] };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('catalog.json')
        ? new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify(catalog)))))
        : Promise.reject(new Error('offline')),
    );
    const s = defaultState();
    s.cards = [{ id: 'shu', name: 'Shujinko, Unfinished', rarityId: 'diamond', fusion: 2, guest: false, imageUrl: 'old.png', wikiTitle: 'Some Page' }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let store!: ReturnType<typeof useStore>;
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(x) => (store = x)} />
          <CardsView sub="cards" onSub={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find images (1)' }));
    release();
    await screen.findByText(/^Updated 0 of 1\. 1 is on MK Mobile Base without art yet and gets it once the site adds it\.$/);
    expect(store.state.cards[0]).toMatchObject({ imageUrl: 'old.png', wikiTitle: 'Some Page' });
    expect(store.state.cards[0].imagePage).toBeUndefined();
  });
});
