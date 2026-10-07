import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import { UNREADABLE_KEY, discardUnreadable, load, loadUnreadable } from './storage';

/** A stand-in for the browser's localStorage, which Vitest's Node environment doesn't have. */
class MemoryStorage {
  items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

let storage: MemoryStorage;
const g = globalThis as unknown as { localStorage?: unknown };
const syncConfig = (baseUpdatedAt: number) => JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt });

beforeEach(() => {
  storage = new MemoryStorage();
  g.localStorage = storage;
});
afterEach(() => {
  delete g.localStorage;
});

describe('loading the saved data', () => {
  it('keeps a save that can’t be read and starts fresh', () => {
    storage.setItem('mkmax:v1', '{"cards": [');
    expect(load()).toEqual(defaultState());
    expect(storage.getItem(UNREADABLE_KEY)).toBe('{"cards": [');
    expect(loadUnreadable()).toBe('{"cards": [');
  });

  it('keeps a save that loads as JSON but isn’t one MK Max can read', () => {
    storage.setItem('mkmax:v1', '{"cards": 3}');
    expect(load()).toEqual(defaultState());
    expect(loadUnreadable()).toBe('{"cards": 3}');
  });

  it('with sync on, forgets what was agreed so the first sync downloads the gist’s copy', () => {
    storage.setItem('mkmax:v1', 'not json');
    storage.setItem('mkmax:sync', syncConfig(5000));
    load();
    expect(JSON.parse(storage.getItem('mkmax:sync')!).baseUpdatedAt).toBe(0);
  });

  it('with sync off, saves no sync settings', () => {
    storage.setItem('mkmax:v1', 'not json');
    load();
    expect(storage.getItem('mkmax:sync')).toBeNull();
  });

  it('leaves a good save and the sync settings alone', () => {
    const saved = { ...defaultState(), updatedAt: 4000 };
    storage.setItem('mkmax:v1', JSON.stringify(saved));
    storage.setItem('mkmax:sync', syncConfig(4000));
    expect(load().updatedAt).toBe(4000);
    expect(loadUnreadable()).toBeNull();
    expect(JSON.parse(storage.getItem('mkmax:sync')!).baseUpdatedAt).toBe(4000);
  });

  it('starts fresh without touching anything when storage can’t be read at all', () => {
    storage.setItem('mkmax:sync', syncConfig(5000));
    storage.getItem = (k: string) => {
      if (k === 'mkmax:v1') throw new Error('blocked');
      return MemoryStorage.prototype.getItem.call(storage, k);
    };
    expect(load()).toEqual(defaultState());
    expect(storage.items.has(UNREADABLE_KEY)).toBe(false);
    expect(JSON.parse(storage.items.get('mkmax:sync')!).baseUpdatedAt).toBe(5000);
  });

  it('discarding removes the kept copy', () => {
    storage.setItem(UNREADABLE_KEY, 'old');
    discardUnreadable();
    expect(loadUnreadable()).toBeNull();
  });
});
