import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import { decideSync } from './sync';

const at = (updatedAt?: number) => ({ ...defaultState(), updatedAt });

describe('decideSync', () => {
  it('pushes when the gist is empty', () => {
    expect(decideSync(null, at(5), 0)).toBe('push');
  });

  it('pulls when only the other device changed', () => {
    expect(decideSync(at(20), at(10), 10)).toBe('pull');
  });

  it('pushes when only this device changed', () => {
    expect(decideSync(at(10), at(20), 10)).toBe('push');
  });

  it('asks the user when both changed', () => {
    expect(decideSync(at(30), at(20), 10)).toBe('conflict');
    // A device joining an existing gist (base 0) with its own data also asks.
    expect(decideSync(at(30), at(20), 0)).toBe('conflict');
  });

  it('does nothing when both are already the same version', () => {
    expect(decideSync(at(10), at(10), 10)).toBe('none');
    expect(decideSync(at(20), at(20), 10)).toBe('none');
  });
});
