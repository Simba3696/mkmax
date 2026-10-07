// Gold challenge characters. Their Kameos come from the Elder challenge whenever that challenge rotates in as an
// event, so a Gold Kameo of one of these is tagged as challenge-sourced. From the MK Mobile wiki's Challenge Mode
// page (2026-09-28), minus challenges that no longer run (see RETIRED_CHALLENGES). MK Mobile Base's event schedule
// shows when each challenge is on (events.ts).
import { nameKey } from './catalog';
import type { Card, RarityRule } from './types';

export const CHALLENGE_CHARACTERS = [
  "Baraka, Scourge", "Bo' Rai Cho, Dragon Breath", "D'Vorah, Venomous", 'Ermac, Pharaoh',
  'Erron Black, Gunslinger', 'Goro, Tigrar Fury', 'Jacqui Briggs, High Tech', 'Jacqui Briggs, Kosplay', 'Jade, Klassic',
  'Jason Voorhees, Unstoppable', 'Jax Briggs, Heavy Weapons', 'Johnny Cage, Kombat Cup', 'Kano, Klassic',
  'Kenshi, Elder God', 'Kintaro, Shokan Warrior', 'Kitana, Mournful', 'Kotal Kahn, Dark Lord', 'Kung Jin, Marksman',
  'Kung Lao, Shaolin Fist', 'Liu Kang, Flaming Fists', 'Mileena, Klassic', 'Mileena, Piercing', 'Mileena, Vampiress',
  'Raiden, Dark', 'Raiden, Thunder God', 'Reptile, Kraken', 'Scorpion, Hanzo Hasashi', 'Shinnok, Bone Shaper',
  'Shinnok, Vengeful', 'Smoke, Klassic', 'Sonya Blade, Klassic', 'Sonya Blade, Kombat Cup', 'Takeda, Shirai Ryu',
  'Tanya, Treacherous', 'Tremor, Aftershock', 'Triborg, Cyrax (LK-4D4)', 'Triborg, Sektor (LK-9T9)',
  'Triborg, Smoke (LK-7T2)', 'Triborg, Sub-Zero (LK-52O)',
];

/** Challenges taken out of rotation long ago (per the user), so their Kameos come from packs now. */
export const RETIRED_CHALLENGES = ['Ermac, Klassic'];

const KEYS = new Set(CHALLENGE_CHARACTERS.map(nameKey));
const RETIRED = new Set(RETIRED_CHALLENGES.map(nameKey));

/** Whether this card was tagged as a challenge Kameo but its challenge has been retired. */
export const isRetiredChallenge = (card: Pick<Card, 'name' | 'source'>) => card.source === 'challenge' && RETIRED.has(nameKey(card.name));

/** Whether this card is the Gold Kameo of a challenge character. */
export function isChallengeKameo(card: Pick<Card, 'name' | 'rarityId'>, rules: RarityRule[]) {
  const rule = rules.find((r) => r.id === card.rarityId);
  return rule?.kind === 'kameo' && card.rarityId === 'kameo-gold' && KEYS.has(nameKey(card.name));
}

/** The source a newly added card starts with: challenge for a challenge Kameo, otherwise none. */
export const initialSource = (card: Pick<Card, 'name' | 'rarityId'>, rules: RarityRule[]): Card['source'] =>
  isChallengeKameo(card, rules) ? 'challenge' : undefined;

/**
 * Moves a card to the rarity MK Mobile Base gives it. The Elder challenge tag goes with the Gold Kameo tier: a
 * challenge Kameo moved into it gets the tag unless it already has a source, and one moved out of it loses the tag.
 * A rarity kept earlier is dropped, since the card now has the site's.
 */
export function applyRarityFix(card: Card, to: string, rules: RarityRule[]) {
  const wasChallenge = isChallengeKameo(card, rules);
  card.rarityId = to;
  delete card.keptRarity;
  const isChallenge = isChallengeKameo(card, rules);
  if (isChallenge && !wasChallenge && !card.source) card.source = 'challenge';
  if (wasChallenge && !isChallenge && card.source === 'challenge') delete card.source;
}
