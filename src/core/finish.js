// The colour of the discs, and how a part of a disc that is dried out or sore is shaded away from it.
export const DISC = [0.33, 0.52, 0.74];
export function discTint(base, tint) {
  const to = tint === 'dried' ? [0.36, 0.31, 0.27] : tint === 'sore' ? [0.84, 0.36, 0.33] : null;
  return to ? base.map((v, i) => v + (to[i] - v) * 0.62) : base;
}

// The colours a part or a bone can be given, by name or as '#rrggbb'.

// Colours a person can pick for a piece of hardware. The first two are what the metal looks
// like. The rest are there to tell parts apart at a glance and to make a point in a picture.
export const FINISHES = {
  titanium: [0.6, 0.62, 0.66], steel: [0.78, 0.8, 0.83], black: [0.13, 0.14, 0.16], white: [0.93, 0.93, 0.9],
  blue: [0.16, 0.33, 0.72], sky: [0.3, 0.62, 0.92], teal: [0.1, 0.6, 0.6], green: [0.2, 0.55, 0.3], lime: [0.58, 0.78, 0.2],
  gold: [0.8, 0.62, 0.2], orange: [0.93, 0.5, 0.13], red: [0.82, 0.2, 0.18], pink: [0.92, 0.42, 0.66], purple: [0.5, 0.36, 0.78],
};
// Sets of colours that go together, for one click.
export const PALETTES = {
  metal: { rods: 'steel', screws: 'titanium', hooks: 'titanium', crosslinks: 'steel' },
  classic: { rods: 'blue', screws: 'titanium', hooks: 'purple', crosslinks: 'gold' },
  bright: { rods: 'sky', screws: 'orange', hooks: 'pink', crosslinks: 'lime' },
  bold: { rods: 'red', screws: 'white', hooks: 'gold', crosslinks: 'black' },
};
// A colour from its name in FINISHES or from '#rrggbb', as [red, green, blue] from 0 to 1.
export function colorOf(name) {
  if (FINISHES[name]) return FINISHES[name];
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(name || '');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : null;
}
