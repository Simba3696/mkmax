// Matching card names written different ways. Kept apart from catalog.ts, which downloads the catalog and uses React,
// so the engine and the built-in game data can match names without loading either.

/**
 * Words MK Mobile Base misspells, mapped to the game's spelling ("Weather Warface" is the game's Weather Warfare; the
 * site fixed it by October 2026, but the committed fallback catalog still has it). A word the site splits in two is
 * joined in nameKey instead ("Sub-Zero, Grand Master" is the game's Grandmaster).
 */
const SITE_TYPOS: Record<string, string> = { warface: 'warfare' };

/** Order-free word key: "Scorpion, MKII Movie" and "Scorpion MK2 Movie" match; "the"/"of" and possessive 's are ignored. */
export function nameKey(name: string) {
  const s = name.toLowerCase().replace(/’/g, "'").replace(/'s\b/g, '').replace(/\bmkii\b/g, 'mk2').replace(/\bgrand[^a-z0-9]*master\b/g, 'grandmaster');
  const words = s.split(/[^a-z0-9]+/).filter((w) => w && w !== 'the' && w !== 'of').map((w) => SITE_TYPOS[w] ?? w);
  // The app says "Kold" where MK Mobile Base says "Kold War": one card, so one key (the list, the Maxed record and art).
  const kold = words.includes('kold');
  return [...new Set(words.filter((w) => !(kold && w === 'war')))].sort().join(' ');
}
