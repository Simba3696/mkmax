// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { defaultState } from '../defaults';
import { moveSeasonEnd, toLocalInput } from '../engine';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import PacksView from './PacksView';
import type { Pack } from '../types';

const pack = (id: string, extra: Partial<Pack>): Pack => ({
  id, name: id, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId: 'scorpion', chance: 50 }], ...extra,
});

/** What App's Undo bar would say. */
function UndoLabel() {
  const { lastUndo, state } = useStore();
  return (
    <output data-testid="undo" data-packs={state.packs.map((p) => p.id).join(',')}>
      {lastUndo?.label ?? ''}
    </output>
  );
}

/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

beforeEach(() => {
  // Only Date is faked, so React and Testing Library keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00'));
  // In the shop and the season bar ask for the event schedule; keep the test off the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const s = defaultState();
  s.cards = [
    { id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 3, guest: false },
    { id: 'sash', name: 'Shadow Sash', rarityId: 'epic', fusion: 3, guest: false },
  ];
  s.packs = [
    pack('Old Pack', { endsAt: '2026-10-01T12:00' }),
    pack('Older Pack', { endsAt: '2026-09-20T12:00' }),
    pack('Live Pack', { endsAt: '2026-10-20T12:00' }),
    pack('Shadow Sash item', { currencyId: 'blood-rubies', store: true, cost: 500, endsAt: '2026-10-05T12:00', drops: [{ cardId: 'sash', chance: 100 }] }),
  ];
  localStorage.setItem('mkmax:v1', JSON.stringify(s));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Packs: Clear expired', () => {
  // Value: protects=Clear expired removes expired packs but keeps a Realm Klash store item, says why, and the Undo label counts
  // what went; fails_when=the count, plural, or kept note is wrong, or the item is cleared; why_new=engine tests cover
  // keepWhenExpired, not the screen; seam=none; no_claim=the Undo bar itself (App) and Rerun
  it('clears expired packs after a second tap, keeps the Realm Klash item with its note, and offers Undo', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
          <UndoLabel />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '▸ Expired (3)' }));
    expect(screen.getByText(/Kept for next season:/).closest('[id]')?.id).toBe('pack-Shadow Sash item');
    expect(screen.getAllByText(/Kept for next season:/)).toHaveLength(1);

    // One tap only arms it.
    fireEvent.click(screen.getByRole('button', { name: 'Clear expired' }));
    expect(screen.getByTestId('undo').dataset.packs).toBe('Old Pack,Older Pack,Live Pack,Shadow Sash item');
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    expect(screen.getByTestId('undo').dataset.packs).toBe('Live Pack,Shadow Sash item');
    expect(screen.getByTestId('undo').textContent).toBe('Cleared 2 expired packs');
    // Only the kept item is left, so there's nothing more to clear.
    expect(screen.getByRole('button', { name: '▾ Expired (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear expired' })).toBeNull();
    expect(screen.getByText(/Kept for next season:/)).toBeTruthy();
  });
});

describe('Packs: logging a purchase', () => {
  // Regression: review of clock-and-gear-taps — a tap with nothing to take back still saved and synced
  // Found by /review on 2026-10-13
  // Value: protects=a −1 with no purchase left to take back (the screen was drawn before the last one) saves nothing;
  // fails_when=the button drops recordPurchase's "nothing done" and stamps the save anyway; why_new=review (Red Team);
  // seam=SyncLoop.nextStamp spied to count saves; no_claim=the Plan's Bought one (PlanView.test.tsx)
  it('saves nothing for a −1 that has no purchase left to take back', () => {
    const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
    s.packs.find((p: Pack) => p.id === 'Live Pack').purchased = 1;
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const takeBack = screen.getByRole('button', { name: 'Remove one purchase' });
    // Both taps land before React draws again, so the second still sees the purchase the first took back.
    act(() => {
      takeBack.click();
      takeBack.click();
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect(saved.packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(0);
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=logging a buy of a random pack still opens "What did you pull?", and taking it back closes it;
  // fails_when=the pull step opens only for a buy the change didn't record (the flag is read wrong), or a logged −1 no
  // longer closes it; why_new=review (testing); seam=none; no_claim=store items
  it('opens "What did you pull?" after logging a random pack, and closes it when the purchase is taken back', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText('What did you pull?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I bought one' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(1);
    expect(screen.getByText('What did you pull?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove one purchase' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(0);
    expect(screen.queryByText('What did you pull?')).toBeNull();
  });
});

describe('Packs: taps on a screen a sync has changed', () => {
  let update!: ReturnType<typeof useStore>['update'];
  /** Packs with the store handed out, and saves counted from the moment it returns. */
  function renderPacks(tweak?: (s: ReturnType<typeof JSON.parse>) => void) {
    if (tweak) {
      const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
      tweak(s);
      localStorage.setItem('mkmax:v1', JSON.stringify(s));
    }
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    return vi.spyOn(SyncLoop.prototype, 'nextStamp');
  }
  const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);
  const live = () => within(document.getElementById('pack-Live Pack')!);

  // Regression: /ship review of clock-and-gear-taps — stale taps on Packs still saved and synced
  // Found by /ship on 2026-10-13
  // Value: protects=Clear expired with nothing left to clear (a sync cleared them) saves nothing and offers no Undo;
  // fails_when=the change stamps the save anyway; why_new=review (Red Team); seam=SyncLoop.nextStamp spied, a grabbed
  // update stands in for the sync; no_claim=a real sync
  it('saves nothing for Clear expired when a sync already cleared them', () => {
    const stamps = renderPacks();
    fireEvent.click(screen.getByRole('button', { name: '▸ Expired (3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear expired' }));
    stamps.mockClear();
    act(() => {
      update((d) => void (d.packs = d.packs.filter((x) => x.id === 'Live Pack' || x.id === 'Shadow Sash item')));
      screen.getByRole('button', { name: 'Tap again to confirm' }).click();
    });
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });

  // Value: protects=a pull-step − with the card already at nothing, and Delete on a pack a sync removed, save nothing;
  // fails_when=stepCard's clamp or the delete's filter still stamps the save; why_new=review (Red Team); seam=
  // SyncLoop.nextStamp spied, a grabbed update stands in for the sync; no_claim=a real sync
  it('saves nothing for a pull-step − at nothing or Delete on a pack that has gone', () => {
    const stamps = renderPacks();
    fireEvent.click(live().getByRole('button', { name: 'I bought one' }));
    stamps.mockClear();
    act(() => {
      update((d) => void (d.cards.find((c) => c.id === 'scorpion')!.fusion = 0));
      screen.getByRole('button', { name: 'Remove a copy' }).click();
    });
    expect(stamps).toHaveBeenCalledTimes(1);

    fireEvent.click(live().getByRole('button', { name: 'Delete' }));
    stamps.mockClear();
    const confirm = live().getByRole('button', { name: 'Tap again to confirm' });
    act(() => {
      update((d) => void (d.packs = d.packs.filter((x) => x.id !== 'Live Pack')));
      confirm.click();
    });
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Regression: /ship review of clock-and-gear-taps — a −1 a sync had undone left "What did you pull?" open
  // Found by /ship on 2026-10-13
  // Value: protects=a −1 closes the pull step even when a sync already took the purchase back; fails_when=the step
  // closes only when the −1 logged something; why_new=review (adversarial); seam=a grabbed update stands in for the
  // sync; no_claim=a real sync
  it('closes "What did you pull?" on a −1 that a sync already took back', () => {
    const stamps = renderPacks();
    fireEvent.click(live().getByRole('button', { name: 'I bought one' }));
    expect(screen.getByText('What did you pull?')).toBeTruthy();
    stamps.mockClear();
    const takeBack = live().getByRole('button', { name: 'Remove one purchase' });
    act(() => {
      update((d) => void (d.packs.find((x) => x.id === 'Live Pack')!.purchased = 0));
      takeBack.click();
    });
    expect(screen.queryByText('What did you pull?')).toBeNull();
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=a second buy on a pack at its purchase limit (the button still showed it open) logs nothing;
  // fails_when=only the button's disabled stops a buy past the limit; why_new=review (Red Team); seam=
  // SyncLoop.nextStamp spied; no_claim=a sync that raised the count
  it('logs no buy past the purchase limit from a screen drawn before it was reached', () => {
    const stamps = renderPacks((s) => (s.packs.find((x: Pack) => x.id === 'Live Pack').maxPurchases = 1));
    const buy = live().getByRole('button', { name: 'I bought one' });
    act(() => {
      buy.click();
      buy.click();
    });
    expect(saved().packs.find((x: Pack) => x.id === 'Live Pack').purchased).toBe(1);
    expect(stamps).toHaveBeenCalledTimes(1);
  });
});

describe('Packs: the season date on a screen a sync has changed', () => {
  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=leaving the season date box saves nothing when a sync already moved the season to the date typed;
  // fails_when=the box ignores moveSeasonEnd's "nothing moved", so it stamps, syncs and offers an Undo for no change;
  // why_new=engine.test.ts covers moveSeasonEnd returning false, not the box that acts on it; seam=a grabbed update
  // stands in for the sync, SyncLoop.nextStamp spied; no_claim=a real sync, the schedule-dated season (no box then)
  it('saves nothing when a sync already moved the season to the date typed', () => {
    let update!: ReturnType<typeof useStore>['update'];
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const date = screen.getByLabelText('Realm Klash season ends');
    fireEvent.change(date, { target: { value: '2026-10-26T12:00' } });
    act(() => {
      update((d) => void (d.realmKlashSeasonEnd = '2026-10-26T12:00'));
      fireEvent.blur(date);
    });
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).realmKlashSeasonEnd).toBe('2026-10-26T12:00');
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });
});

describe('Packs: the pull step', () => {
  // Regression: /review of stale-screens-and-schedule — a −1 on another pack closed "What did you pull?"
  // Found by /review on 2026-10-13
  // Value: protects=a −1 on one pack leaves another pack's pull step open; fails_when=any −1 closes whichever step is
  // open; why_new=review (adversarial); seam=none; no_claim=store items
  it("keeps one pack's pull step open when a purchase of another is taken back", () => {
    const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
    s.packs.push(pack('Other Pack', { endsAt: '2026-10-25T12:00', purchased: 1 }));
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(within(document.getElementById('pack-Live Pack')!).getByRole('button', { name: 'I bought one' }));
    expect(screen.getByText('What did you pull?')).toBeTruthy();
    fireEvent.click(within(document.getElementById('pack-Other Pack')!).getByRole('button', { name: 'Remove one purchase' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs.find((p: Pack) => p.id === 'Other Pack').purchased).toBe(0);
    expect(screen.getByText('What did you pull?')).toBeTruthy();
  });
});

describe('Packs: Ended early on a screen a sync has changed', () => {
  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=Ended early saves nothing once a sync already ended the season it showed, and next season's item
  // keeps its dates; fails_when=the tap ends whatever season is current when it runs, expiring the items entered for
  // the new one; why_new=the season date test covers the box, not Ended early; seam=a grabbed update stands in for the
  // sync, SyncLoop.nextStamp spied; no_claim=a real sync, the schedule-dated season (no button then)
  it('saves nothing when a sync already ended the season the button showed', () => {
    const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
    s.realmKlashSeasonEnd = '2026-10-15T12:00';
    // Next season's character, entered ahead: it starts when this season ends.
    s.packs.push(pack('Next item', { currencyId: 'blood-rubies', store: true, season: true, cost: 500, startsAt: '2026-10-15T12:00', endsAt: '2026-10-29T12:00' }));
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let update!: ReturnType<typeof useStore>['update'];
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const endedEarly = screen.getByRole('button', { name: 'Ended early' });
    fireEvent.click(endedEarly);
    expect(endedEarly.textContent).toBe('Tap again to confirm');
    act(() => {
      // Another device tapped Ended early an hour ago: next season started then and runs 2 weeks.
      update((d) => void moveSeasonEnd(d, '2026-10-12T11:00', new Date()));
      endedEarly.click();
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    const next = saved.packs.find((p: Pack) => p.id === 'Next item');
    expect([saved.realmKlashSeasonEnd, next.startsAt, next.endsAt]).toEqual(['2026-10-12T11:00', '2026-10-12T11:00', '2026-10-26T11:00']);
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=Ended early, confirmed with no sync in between, ends the season now and offers Undo; fails_when=the
  // stale-season check wrongly finds a change (or none), so the tap saves nothing, or saves twice, or loses its label;
  // why_new=only the stale tap had a test; seam=SyncLoop.nextStamp spied; no_claim=the schedule-dated season (no button
  // then), the packs that move with it (engine.test.ts)
  it('ends the season now when nothing changed it since the button was drawn', () => {
    const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
    s.realmKlashSeasonEnd = '2026-10-15T12:00';
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let store!: ReturnType<typeof useStore>;
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(x) => (store = x)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    fireEvent.click(screen.getByRole('button', { name: 'Ended early' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).realmKlashSeasonEnd).toBe(toLocalInput(new Date()));
    expect(stamps).toHaveBeenCalledTimes(1);
    expect(store.lastUndo?.label).toBe('Ended the Realm Klash season early');
  });
});

describe("Packs: the pack editor's Add card on a screen a sync has changed", () => {
  let update!: ReturnType<typeof useStore>['update'];
  /** The editor for a new pack, with its "Card not in your list yet?" row named and the rarity picked there. */
  function openEditor(name: string, rarityId: string) {
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add pack' }));
    const box = screen.getByPlaceholderText('Card name');
    fireEvent.change(box, { target: { value: name } });
    const [rarity, level] = box.parentElement!.querySelectorAll('select');
    fireEvent.change(rarity, { target: { value: rarityId } });
    return { rarity, level, add: within(box.parentElement!).getByRole('button', { name: 'Add card' }) };
  }
  const savedCards = () => JSON.parse(localStorage.getItem('mkmax:v1')!).cards.map((c: { name: string; rarityId: string; fusion: number }) => [c.name, c.rarityId, c.fusion]);

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=the pack editor's Add card saves nothing when a sync removed the rarity picked there; fails_when=the
  // card is saved under the removed rarity, hidden on every device with no way to delete it; why_new=Cards' Add card
  // has this test, the pack editor's own Add card had none; seam=a grabbed update stands in for the sync,
  // SyncLoop.nextStamp spied; no_claim=a real sync
  it('saves nothing for Add card when a sync removed the rarity picked', () => {
    const { add } = openEditor('Raiden, Dark', 'gold');
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    act(() => {
      update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'gold')));
      add.click();
    });
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3]]);
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
    expect((screen.getByPlaceholderText('Card name') as HTMLInputElement).value).toBe('Raiden, Dark');
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=once a sync removed the pack editor's picked rarity, its box shows the first rarity and Add card saves
  // the card there, not owned; fails_when=Add keeps the removed rarity or its level (a Gold A2 past Diamond's max);
  // why_new=no test covered the editor's fallback rarity; seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('adds under the rarity shown, not owned, once a sync removed the one picked', () => {
    const { rarity, level, add } = openEditor('Raiden, Dark', 'gold');
    fireEvent.change(level, { target: { value: '13' } });
    act(() => update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'gold'))));
    expect(rarity.value).toBe('diamond');
    act(() => add.click());
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3], ['Raiden, Dark', 'diamond', 0]]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=the pack editor's Add card says when a sync removed its picked rarity and names the one it uses;
  // fails_when=its box switches to the first rarity silently, so a card picked as Gold is saved as Diamond unnoticed;
  // why_new=the fallback tests here check the boxes and what's saved, not the notice; seam=a grabbed update stands in
  // for the sync; no_claim=a real sync, Cards' own Add card (CardsView.test.tsx)
  it('says the card goes in as the first rarity once a sync removed the one picked', () => {
    const { rarity } = openEditor('Raiden, Dark', 'gold');
    const row = within(rarity.closest('div')!.parentElement!);
    const notice = 'The rarity picked here has since been removed, so this card goes in as Diamond.';
    expect(row.queryByText(notice)).toBeNull();
    act(() => update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'gold'))));
    expect(row.queryByText(notice)).not.toBeNull();
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=once a sync removed the pack editor's picked rarity, its level box shows not owned, the level Add card
  // saves; fails_when=the box keeps the level picked under the removed rarity (F3 shown, not owned saved); why_new=the
  // test above picks a level past Diamond's max, which the box can't show anyway, and checks only what's saved;
  // seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('shows not owned in the level box once a sync removed the rarity picked', () => {
    const { rarity, level } = openEditor('Raiden, Dark', 'gold');
    fireEvent.change(level, { target: { value: '4' } }); // F3, a level Diamond has too
    expect(level.value).toBe('4');
    act(() => update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'gold'))));
    expect([rarity.value, level.value]).toEqual(['diamond', '0']);
  });

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=after a sync removed the pack editor's picked rarity, a level picked in its level box sticks and Add
  // card saves it; fails_when=the level box keeps the removed rarity, so every pick snaps back to not owned; why_new=the
  // tests above pick the level before the sync, never after; seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('takes a level picked after a sync removed the rarity picked, and saves it', () => {
    const { rarity, level, add } = openEditor('Raiden, Dark', 'gold');
    act(() => update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'gold'))));
    fireEvent.change(level, { target: { value: '4' } }); // F3 under Diamond, the rarity now shown
    expect([rarity.value, level.value]).toEqual(['diamond', '4']);
    act(() => add.click());
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3], ['Raiden, Dark', 'diamond', 4]]);
  });

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=the pack editor's Add card picked at a level a sync has since taken off the rarity saves the card
  // as not owned; fails_when=the level-past-max check in addNewCard goes, so the card is saved past max and deleted as
  // maxed; why_new=the tests above remove the rarity, not cut its steps; seam=a grabbed update stands in for the sync;
  // no_claim=a real sync
  it('adds a card as not owned when a sync cut the rarity below the level picked', () => {
    const { level, add } = openEditor('Raiden, Dark', 'diamond');
    fireEvent.change(level, { target: { value: '8' } }); // F7
    act(() => {
      // Diamond now goes up to F2 only: F7, picked on screen, isn't a level it has.
      update((d) => void (d.rarities.find((r) => r.id === 'diamond')!.dupesPerLevel = [1, 1]));
      add.click();
    });
    // Scorpion, past the cut rarity's new max, is deleted as maxed; the new card stays, not owned.
    expect(savedCards()).toEqual([['Shadow Sash', 'epic', 3], ['Raiden, Dark', 'diamond', 0]]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=once a sync cut the rarity below the level picked, Add card stays enabled with no goal note, as the
  // box shows (and Add saves) not owned; fails_when=the goal check uses the raw picked level, past the new max, and
  // greys Add card out; why_new=the test above taps Add in the same act as the sync, before the screen redraws;
  // seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('keeps Add card enabled when a sync cut the rarity below the level picked', () => {
    const { level, add } = openEditor('Raiden, Dark', 'diamond');
    const note = "That level is already the card's goal, so it would be done at once: pick a lower level to add it.";
    fireEvent.change(level, { target: { value: '8' } }); // F7
    act(() => update((d) => void (d.rarities.find((r) => r.id === 'diamond')!.dupesPerLevel = [1, 1])));
    expect([level.value, (add as HTMLButtonElement).disabled, screen.queryByText(note)]).toEqual(['0', false, null]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=the pack editor's Add card is greyed out with a note at a level that is already the card's goal, and
  // works below it; fails_when=Add card saves a card at its goal, deleted at once as done, leaving a 0% drop for nothing;
  // why_new=the tests above pick levels below the goal; seam=none, the editor as a user taps it; no_claim=an owned
  // Kameo, Epic's Track until set to Max
  it('greys out Add card at a level that is already the goal, with a note, and not below it', () => {
    // Epic Equip is tracked until F3, so a new Epic card at F3 would be done as soon as it's saved.
    const { level, add } = openEditor('Lin Kuei Gloves', 'epic');
    const note = "That level is already the card's goal, so it would be done at once: pick a lower level to add it.";
    fireEvent.change(level, { target: { value: '4' } }); // F3
    expect([(add as HTMLButtonElement).disabled, screen.queryByText(note) != null]).toEqual([true, true]);
    act(() => add.click());
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3]]);
    fireEvent.change(level, { target: { value: '3' } }); // F2
    expect([(add as HTMLButtonElement).disabled, screen.queryByText(note)]).toEqual([false, null]);
    act(() => add.click());
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3], ['Lin Kuei Gloves', 'epic', 3]]);
  });

  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=the pack editor's Add card stays enabled, with no goal note, for Realm Klash gear at F3 under Epic,
  // and saves it; fails_when=the goal check ignores the typed name and blocks gear always tracked to max; why_new=the
  // test above types ordinary gear; seam=none, the editor as a user taps it; no_claim=Cards' own Add card
  it('leaves Add card enabled for Realm Klash gear at F3, which is tracked to max, and saves it', () => {
    // Epic Equip is tracked until F3, but Realm Klash gear always goes on to F10.
    const { level, add } = openEditor('Devastator', 'epic');
    const note = "That level is already the card's goal, so it would be done at once: pick a lower level to add it.";
    fireEvent.change(level, { target: { value: '4' } }); // F3
    expect([(add as HTMLButtonElement).disabled, screen.queryByText(note)]).toEqual([false, null]);
    act(() => add.click());
    expect(savedCards()).toEqual([['Scorpion', 'diamond', 3], ['Shadow Sash', 'epic', 3], ['Devastator', 'epic', 4]]);
  });
});

// Last in the file: the event schedule stays loaded once a test has downloaded it.
describe('Packs: In the shop on a screen a sync has changed', () => {
  // Regression: /ship review of stale-screens-and-schedule — Not needed had no test for a pack a sync already hid
  // Found by /ship on 2026-10-13
  // Value: protects=Not needed on a shop pack a sync already hid saves nothing and doesn't add its name again; fails_when=
  // the already-hidden check goes, so the tap stamps, syncs and lists the name twice; why_new=review (testing);
  // seam=fetch serves a one-pack events.json, a grabbed update stands in for the sync; no_claim=a real sync
  it('saves nothing for Not needed on a shop pack a sync already hid', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('events.json')
        ? Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                fetchedAt: '2026-10-12T00:00:00Z',
                capturedAt: null,
                packs: [{ name: 'QA SHOP PACK', start: null, end: null, cost: 100, currency: 'Soul', limit: null, image: null }],
                challenges: [],
                seasons: [],
              }),
          })
        : Promise.reject(new Error('offline')),
    );
    let update!: ReturnType<typeof useStore>['update'];
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const notNeeded = await screen.findByRole('button', { name: 'Not needed' });
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    act(() => {
      update((d) => void (d.dismissedShopPacks = ['QA SHOP PACK']));
      notNeeded.click();
    });
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).dismissedShopPacks).toEqual(['QA SHOP PACK']);
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });
});
