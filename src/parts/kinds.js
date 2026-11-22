// The kinds of part a spine file can hold, in the order they are drawn and listed. This file
// is plain facts with no code behind them, so anything may read it: the file checker, the
// scene, the sheets of the page.
//
// To add a kind of part:
//   1. give it a file in this folder that draws it (see screw.js: the shape, and what the
//      scene shows for one piece)
//   2. add a row here
//   3. name its drawing in catalogue.js
// The checks in tools/test.mjs fail if a row here has no drawing.
//
//   kind:   the name of its list under "hardware" in a spine file
//   name, names, word, words: what it is called on the page, one and many
//   sits:   what holds it in place. 'pedicle' and 'arch' are spots on one side of a vertebra,
//           'parts' runs through the screws and hooks of one side, 'rods' spans the two rods
//   finish: its colour when nothing else is chosen (a name from core/finish.js)
//   freezes: true if one piece can be frozen, so that clearing the hardware leaves it
export const PART_KINDS = [
  { kind: 'rods', name: 'Rod', names: 'Rods', word: 'rod', words: 'rods', sits: 'parts', finish: 'blue', freezes: false },
  { kind: 'screws', name: 'Screw', names: 'Screws', word: 'screw', words: 'screws', sits: 'pedicle', finish: 'titanium', freezes: true },
  { kind: 'hooks', name: 'Hook', names: 'Hooks', word: 'hook', words: 'hooks', sits: 'arch', finish: 'purple', freezes: true },
  { kind: 'crosslinks', name: 'Cross-link', names: 'Cross-links', word: 'cross-link', words: 'cross-links', sits: 'rods', finish: 'gold', freezes: true },
];

// The same list as plain names: ['rods', 'screws', 'hooks', 'crosslinks'].
export const KINDS = PART_KINDS.map((p) => p.kind);
// The kinds whose pieces can be frozen.
export const FREEZING = PART_KINDS.filter((p) => p.freezes).map((p) => p.kind);
// The row of a kind, or undefined for anything that is not a part (a vertebra, a mark).
export const kindOf = (kind) => PART_KINDS.find((p) => p.kind === kind);
// The colour each kind of part has when nothing else is chosen.
export const USUAL_FINISH = Object.fromEntries(PART_KINDS.map((p) => [p.kind, p.finish]));

// The types a placed part can be changed to, shown as a grid of pictures on its card. Types
// that share a "group" can stand in for one another: picking one of them for a part that is
// already on the spine swaps it there.
//   group 'side': what holds the rod on one side of a vertebra
//   id:    the name of the type (also the name of the tool that places it on the flat map)
//   kind:  the list it is kept in, and "set" the fields that tell it from the other types of that list
//   name, say: what the page calls it, and a few words under the name
//   icon:  the drawing on its tile (a symbol of the page), "flip" to show it upside down
export const PART_TYPES = [
  { group: 'side', id: 'screw', kind: 'screws', set: { look: 'standard' }, name: 'Screw', say: 'goes into the bone', icon: 'i-screw' },
  { group: 'side', id: 'screw-tall', kind: 'screws', set: { look: 'tall' }, name: 'Tall head screw', say: 'its head stands well above the rod', icon: 'i-screw' },
  { group: 'side', id: 'screw-low', kind: 'screws', set: { look: 'low' }, name: 'Low head screw', say: 'a smaller head, closer to the bone', icon: 'i-screw' },
  { group: 'cross', id: 'link', kind: 'crosslinks', set: { style: 'arch' }, name: 'Cross-link', say: 'an arched bar', icon: 'i-link' },
  { group: 'cross', id: 'link-plate', kind: 'crosslinks', set: { style: 'plate' }, name: 'Flat cross-link', say: 'a flat strap', icon: 'i-link' },
  { group: 'cross', id: 'link-straight', kind: 'crosslinks', set: { style: 'straight' }, name: 'Straight cross-link', say: 'a straight bar', icon: 'i-link' },
  { group: 'side', id: 'hook-down', kind: 'hooks', set: { faces: 'down' }, name: 'Hook down', say: 'grips the bone from above', icon: 'i-hook' },
  { group: 'side', id: 'hook-up', kind: 'hooks', set: { faces: 'up' }, name: 'Hook up', say: 'grips the bone from below', icon: 'i-hook', flip: true },
];
// (what a piece is when its file does not say: a hook points down, a screw has the usual head)
const USUAL = { faces: 'down', look: 'standard', style: 'arch' };
// The type of a piece of a kind, or undefined for a kind that has no types (a rod).
export function typeOf(kind, piece) {
  return PART_TYPES.find((t) => t.kind === kind && Object.entries(t.set).every(([key, value]) => (piece[key] || USUAL[key]) === value));
}
// The types a piece of a kind can be changed to (its own among them), or an empty list.
export function typesFor(kind) {
  const mine = PART_TYPES.find((t) => t.kind === kind);
  return mine ? PART_TYPES.filter((t) => t.group === mine.group) : [];
}

// The catalogue of the Hardware place: categories down its edge, and for the open one a
// grid of pictures in small groups. A tile is taken in hand to put that part on the spine,
// or pressed while a part is selected to change that part into it.
//   id:    of a tile: for a part with types, the id of its type in PART_TYPES
//   tool:  the tool the tile puts in hand ('screw', 'hook', 'link', 'rod', 'disc', 'bone', or 'erase' for None), "face" for a hook
//          and "look" for a screw
//   name, say: what it is called, and a few words on what it does
//   icon:  the drawing on the tile until its picture is made (a symbol of the page), "flip" upside down
//   shot:  true if a small picture of the real part is drawn for the tile (see sampleOf in catalogue.js)
const NONE = { id: 'none', tool: 'erase', name: 'None', say: 'takes a part off', icon: 'i-none' };
export const CATEGORIES = [
  { id: 'side', name: 'Screws and hooks', icon: 'i-screw', kinds: ['screws', 'hooks'], tool: 'screw', groups: [
    { name: 'Screws', tiles: [NONE, { id: 'screw', tool: 'screw', look: 'standard', name: 'Screw', say: 'goes into the bone, on a dotted spot', icon: 'i-screw', shot: true },
      { id: 'screw-tall', tool: 'screw', look: 'tall', name: 'Tall head screw', say: 'its head stands well above the rod', icon: 'i-screw', shot: true },
      { id: 'screw-low', tool: 'screw', look: 'low', name: 'Low head screw', say: 'a smaller head, closer to the bone', icon: 'i-screw', shot: true }] },
    { name: 'Hooks', tiles: [
      { id: 'hook-down', tool: 'hook', face: 'down', name: 'Hook down', say: 'grips the bone from above', icon: 'i-hook', shot: true },
      { id: 'hook-up', tool: 'hook', face: 'up', name: 'Hook up', say: 'grips the bone from below', icon: 'i-hook', flip: true, shot: true }] },
  ] },
  { id: 'links', name: 'Cross-links', icon: 'i-link', kinds: ['crosslinks'], tool: 'link', groups: [
    { name: 'Cross-links', tiles: [NONE,
      { id: 'link', tool: 'link', style: 'arch', name: 'Cross-link', say: 'joins the two rods with an arched bar, between two vertebrae', icon: 'i-link', shot: true },
      { id: 'link-plate', tool: 'link', style: 'plate', name: 'Flat cross-link', say: 'joins the two rods with a flat strap', icon: 'i-link', shot: true },
      { id: 'link-straight', tool: 'link', style: 'straight', name: 'Straight cross-link', say: 'joins the two rods with a straight bar', icon: 'i-link', shot: true }] },
  ] },
  { id: 'rods', name: 'Rods', icon: 'i-rod', kinds: ['rods'], tool: 'rod', groups: [
    // ("diameter" is the thickness in millimetres: of the selected rod, or with none selected of every rod and of new ones)
    { name: 'Rods', tiles: [
      { id: 'rod', tool: 'rod', diameter: 5.5, name: 'Rod', say: 'the usual thickness, runs through the parts of one side', icon: 'i-rod', shot: true },
      { id: 'rod-thick', tool: 'rod', diameter: 6.35, name: 'Thick rod', say: 'a stiffer rod', icon: 'i-rod', shot: true },
      { id: 'rod-thin', tool: 'rod', diameter: 4.5, name: 'Thin rod', say: 'a lighter rod', icon: 'i-rod', shot: true }] },
  ] },
  // (a disc is not put on: every space has one. Its tiles say what a disc is, and "state" is what the file keeps.
  // Opening this category puts everything down, since a disc is selected first and then changed.)
  { id: 'discs', name: 'Discs', icon: 'i-disc', kinds: ['discs'], tool: 'turn', groups: [
    { name: 'Natural', tiles: [
      { id: 'disc-standard', tool: 'disc', state: 'standard', name: 'Standard', say: 'a healthy disc', icon: 'i-disc', shot: true },
      { id: 'disc-thin', tool: 'disc', state: 'thin', name: 'Thin', say: 'it has lost height, and the spine above comes down with it', icon: 'i-disc', shot: true },
      { id: 'disc-bulging', tool: 'disc', state: 'bulging', name: 'Bulging', say: 'it pushes out past the edges of the bones', icon: 'i-disc', shot: true },
      { id: 'disc-herniated', tool: 'disc', state: 'herniated', name: 'Herniated', say: 'its soft middle has pushed out at one spot', icon: 'i-disc', shot: true },
      { id: 'disc-dried', tool: 'disc', state: 'dried', name: 'Dried out', say: 'it has dried and darkened', icon: 'i-disc', shot: true },
      { id: 'disc-none', tool: 'disc', state: 'none', name: 'None', say: 'the disc is gone', icon: 'i-none' }] },
    // (implants: two stand in the place of the disc and are states of it. The spacer sits at the back, between the
    // two back processes, and goes with any disc: its tile puts it there or takes it away.)
    { name: 'Implants', tiles: [
      { id: 'disc-replacement', tool: 'disc', state: 'replacement', name: 'Artificial disc', say: 'a disc replacement: a plate on each bone and a core that lets them move', icon: 'i-disc', shot: true },
      { id: 'disc-cage', tool: 'disc', state: 'cage', name: 'Fusion cage', say: 'a block in the place of the disc, holding the bones apart while they grow together', icon: 'i-disc', shot: true },
      { id: 'disc-cage-screws', tool: 'disc', state: 'cage-screws', name: 'Cage with screws', say: 'a fusion cage held by its own screws, two into each bone', icon: 'i-disc', shot: true },
      { id: 'disc-plate', tool: 'disc', plate: true, name: 'Plate on the front', say: 'a plate screwed to the front of the two bones, across the disc. In the neck or the low back. Plates on discs next to each other join into one long plate', icon: 'i-disc', shot: true },
      { id: 'disc-spacer', tool: 'disc', spacer: true, name: 'Spacer at the back', say: 'a block between the two back processes that holds them apart. In the low back', icon: 'i-disc', shot: true }] },
  ] },
  // (the vertebrae work the way the discs do: one is selected and then changed, or a tile is taken in hand.
  // "state" is the kind of fracture the file keeps, or 'healthy'. A vertebra is selected in other categories
  // too, to say what it carries, so this category lists no kind of its own.)
  { id: 'bones', name: 'Vertebrae', icon: 'i-one', kinds: [], tool: 'turn', groups: [
    { name: 'Shape', tiles: [
      { id: 'bone-healthy', tool: 'bone', state: 'healthy', name: 'Healthy', say: 'a whole vertebra', icon: 'i-one', shot: true },
      { id: 'bone-wedge', tool: 'bone', state: 'wedge', name: 'Wedge fracture', say: 'the front of the body is squashed, and the spine above tips forward', icon: 'i-one', shot: true },
      { id: 'bone-crush', tool: 'bone', state: 'crush', name: 'Crush fracture', say: 'the whole body is squashed', icon: 'i-one', shot: true },
      { id: 'bone-burst', tool: 'bone', state: 'burst', name: 'Burst fracture', say: 'the body is squashed and has spread outward', icon: 'i-one', shot: true },
      { id: 'bone-wedge-left', tool: 'bone', state: 'wedge-left', name: 'Squashed on the left', say: 'the left side of the body is squashed, and the spine above tips to the left', icon: 'i-one', shot: true },
      { id: 'bone-wedge-right', tool: 'bone', state: 'wedge-right', name: 'Squashed on the right', say: 'the right side of the body is squashed, and the spine above tips to the right', icon: 'i-one', shot: true },
      { id: 'bone-hairline', tool: 'bone', state: 'hairline', name: 'Hairline crack', say: 'a fine crack in the body, nothing has moved', icon: 'i-one', shot: true },
      { id: 'bone-split', tool: 'bone', state: 'split', name: 'Split across', say: 'a break straight across the body and the back of the bone', icon: 'i-one', shot: true },
      { id: 'bone-chip', tool: 'bone', state: 'chip', name: 'Chipped corner', say: 'a corner is broken off the front of the body', icon: 'i-one', shot: true }] },
    // (how the bone itself looks: "wear" from 0, clean, to 1, aged and porous. A vertebra has one tile of each group.)
    { name: 'Bone', tiles: [
      { id: 'bone-clean', tool: 'bone', wear: 0, name: 'Clean bone', say: 'smooth, even bone', icon: 'i-one', shot: true },
      { id: 'bone-aged', tool: 'bone', wear: 0.5, name: 'Aged bone', say: 'duller, with small pits', icon: 'i-one', shot: true },
      { id: 'bone-porous', tool: 'bone', wear: 1, name: 'Porous bone', say: 'aged and full of pits', icon: 'i-one', shot: true }] },
    // (what else the bone shows: "bone" is what the file keeps, '' for nothing)
    { name: 'Bone changes', tiles: [
      { id: 'look-plain', tool: 'bone', bone: '', name: 'None', say: 'no other changes', icon: 'i-one', shot: true },
      { id: 'look-spurs', tool: 'bone', bone: 'spurs', name: 'Bone spurs', say: 'bony lips have grown at the rims of the body', icon: 'i-one', shot: true },
      { id: 'look-dense', tool: 'bone', bone: 'dense', name: 'Hardened bone', say: 'paler, chalky bone, most next to the discs', icon: 'i-one', shot: true },
      { id: 'look-sore', tool: 'bone', bone: 'sore', name: 'Sore end plates', say: 'the bone next to the discs is inflamed', icon: 'i-one', shot: true }] },
    // (the back of the vertebra: "arch" is what the file keeps, '' for a whole back)
    { name: 'Back of the bone', tiles: [
      { id: 'arch-whole', tool: 'bone', arch: '', name: 'Whole back', say: 'nothing taken away, nothing broken', icon: 'i-one', shot: true },
      { id: 'arch-laminectomy', tool: 'bone', arch: 'laminectomy', name: 'Back opened', say: 'a laminectomy: the bone over the nerves is taken away', icon: 'i-one', shot: true },
      { id: 'arch-spinous', tool: 'bone', arch: 'spinous', name: 'Back process broken', say: 'a break through the bump at the back', icon: 'i-one', shot: true },
      { id: 'arch-tp-left', tool: 'bone', arch: 'tp-left', name: 'Left side process broken', say: 'a break through the wing on the left', icon: 'i-one', shot: true },
      { id: 'arch-tp-right', tool: 'bone', arch: 'tp-right', name: 'Right side process broken', say: 'a break through the wing on the right', icon: 'i-one', shot: true }] },
  ] },
];
// The category a kind of part is found in, and every tile of a category in one list.
export const categoryOf = (kind) => (CATEGORIES.find((c) => c.kinds.includes(kind)) || {}).id;
export const tilesOf = (id) => ((CATEGORIES.find((c) => c.id === id) || {}).groups || []).flatMap((g) => g.tiles);

// Make sure a spine has a list for every kind of part, empty if need be. Returns its hardware.
export function allKinds(spine) {
  spine.hardware = spine.hardware || {};
  for (const kind of KINDS) spine.hardware[kind] = spine.hardware[kind] || [];
  return spine.hardware;
}
