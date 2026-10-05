// Tailwind class sets used across views. Each one owns its properties: don't add a utility that sets the same
// property (another padding, background or border color) next to one of these, since which one wins then depends on
// Tailwind's output order, not on the order in className. Add spacing and layout utilities around them instead.

/** Button looks, on top of the base control style in styles.css. */
export const btn = {
  primary: 'bg-red border-red text-white font-semibold md:hover:brightness-110',
  danger: 'bg-red-dim border-red',
  ghost: 'bg-transparent border-transparent md:hover:bg-panel-2',
};

/** A panel on the page background (Plan and Settings sections, card and pack rows). No padding or margin. */
export const surface = 'bg-panel border border-line rounded-card';
/** The standard page section: a surface with the usual padding and gap below. */
export const card = `${surface} p-[0.9rem] mb-[0.8rem]`;
/** A box inside a card. */
export const subpanel = 'bg-panel-2 border border-line rounded-panel p-[0.7rem] my-[0.6rem]';
/** Gold-edged tip or warning. */
export const hint = 'bg-hint border-l-[3px] border-gold py-[0.4rem] px-[0.6rem] rounded-chip text-[0.85rem]';

/** A list row; consecutive rows get a divider. Vertical alignment and wrapping are left to the caller. */
export const row = 'flex gap-[0.6rem] py-[0.35rem] [&+&]:border-t [&+&]:border-line';
/** Takes the free space in a flex row and lets long text wrap or truncate. */
export const grow = 'flex-1 min-w-0';
export const rowTitle = 'font-semibold wrap-anywhere';

/** Form grid: as many 150px+ columns as fit, fields aligned on their inputs. */
export const form = 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[0.6rem] items-end';
/** A labelled field: small muted label above a full-size input. */
export const field =
  'flex flex-col gap-[0.25rem] text-small text-muted [&>input]:text-fg [&>select]:text-fg [&>input]:text-[0.95rem] [&>select]:text-[0.95rem]';
/** A checkbox with its label, as tall as a button so it lines up in a form row. */
export const check = 'flex items-center gap-[0.4rem] text-[0.85rem] min-h-[38px] md:[&>input]:shrink-0';
/** A wrapping line of buttons under a form or row. */
export const actions = 'flex flex-wrap gap-[0.4rem] items-center mt-[0.6rem]';
/** Heading with buttons on the right. */
export const toolbar = 'flex justify-between items-center gap-2 my-[0.4rem] [&_h2]:m-0';
/** Buttons at the bottom of a modal. */
export const modalFoot = 'flex justify-end gap-2 mt-4 border-t border-line pt-[0.8rem]';

/** − level + control: square buttons around a gold level label. */
export const stepper = 'flex items-center gap-[0.3rem] [&>button]:w-[38px] [&>button]:p-0 [&>button]:text-[1.2rem]';
export const stepperVal = 'min-w-[40px] text-center font-bold text-gold';

/** Chip colors: each sets background, border and text together. */
export const chipTone = {
  plain: 'bg-panel-2 border-line text-fg',
  muted: 'bg-panel-2 border-line text-muted',
  limited: 'bg-panel-2 border-gold text-gold',
  urgent: 'bg-red border-red text-white',
  upcoming: 'bg-panel-2 border-sky text-sky',
  guest: 'bg-panel-2 border-pink text-pink',
  source: 'bg-panel-2 border-steel text-steel-fg',
  good: 'bg-panel-2 border-ok text-ok',
  unlock: 'bg-panel-2 border-cyan text-cyan',
  warn: 'bg-panel-2 border-warn text-warn',
};
export type ChipTone = keyof typeof chipTone;
