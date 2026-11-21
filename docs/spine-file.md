# The spine file

A spine file is a JSON document, usually named `something.spine.json`. It holds everything the
app needs to draw one spine. This page describes format 1.

## Directions and units

- Lengths are in millimetres, angles in degrees.
- `x` points to the person's left, `y` to their back and `z` up.
- The person is taken as standing. The origin can be anywhere. The example puts it at the
  centre of S1.

## Top level

| Field | What it holds |
|---|---|
| `schema` | The format number. `1` for this page. |
| `name` | A short title shown in the app. |
| `about` | A sentence or two on where the spine came from. |
| `levels` | The vertebrae. |
| `fused` | Stretches that are fused, each written as `[top, bottom]`, for example `["T4", "L2"]`. |
| `hardware` | Rods, screws, hooks and cross-links. |
| `marks` | Things the person wants to point at, such as where it hurts. |
| `discs` | The discs that are not standard, by name. Optional. |
| `steps` | Optional. The same spine at other moments, such as before and after an operation. See below. |
| `pictures` | Reserved for X-rays and their scale. Empty for now: a picture traced over in the app is not kept in the file. |

## A vertebra

    { "id": "T5", "centre": [-4.8, 52.8, 349.7], "tilt": [10.7, -13.0], "turn": -28.8,
      "size": [29.1, 24.1, 17.6], "source": "measured" }

- `id`: `C1` to `C7`, `T1` to `T12`, `L1` to `L5` or `S1`.
- `centre`: the middle of the vertebral body.
- `tilt`: two angles. The first is how far the top of the vertebra leans to the left when seen
  from the front. The second is how far it leans to the back when seen from the side.
- `turn`: how far the vertebra is turned about its own axis. Plus means its front faces left.
- `size`: width, depth and height of the body.
- `wear`: optional, how worn the bone looks, from just above 0 to 1 (aged and porous). It changes
  the look only: duller bone with small pits. Without it the bone is clean. Versions of the app
  before 0.22 ignore it.
- `arch`: optional, what is different about the back of the vertebra: `laminectomy` (the bone
  over the canal and the process at the back are taken away), `spinous` (the process at the
  back is broken), `tp-left` or `tp-right` (the side process on that side is broken). It changes
  what is drawn, not where anything is. Versions of the app before 0.23 ignore it.
- `bone`: optional, what else the bone shows: `spurs` (bony lips at the rims of the body),
  `dense` (hardened, chalky bone) or `sore` (the bone next to the discs is inflamed). It changes
  the look only. From version 0.27. Earlier versions ignore it.
- `fracture`: optional, for a vertebra whose body is broken:
  `{ "kind": "wedge", "amount": 0.5, "was": 28.4, "lean": 8.3 }`. `kind` is `wedge` (the front
  of the body is squashed), `crush` (the whole body) or `burst` (squashed and spread outward).
  `amount` runs from 0.1 to 1. `was` is the height the body had. `size` holds the height it
  has now, for a wedge at the middle of the body, and the vertebrae in the file are already
  where that leaves them. `lean` is by how many degrees a wedge tipped the vertebra and the
  spine above it forward. From version 0.27 `kind` can also be `wedge-left` or `wedge-right`
  (that side of the body is squashed, and `lean` is to that side), `hairline` (a fine crack),
  `split` (a break straight across the body and the back of the bone) or `chip` (a corner off
  the front of the body). The last three squash nothing, and `amount` is how far the line runs,
  how wide it is or how big the chip is. Versions 0.21 to 0.26 do not know these five and say so
  when the file is opened. Versions of the app before 0.21 ignore the field and draw the whole
  vertebra at the lower height. These are general pictures of their kind, not a reading of a
  scan.
- `source`: `measured` (from a scan), `traced` (from an X-ray), `guessed` or `typical` (the
  ready-made average spine). Guessed parts are drawn paler.

The tilt is applied first, the shortest way from upright, and the turn after it. Doing it in
that order keeps a strongly tilted vertebra from looking turned when it is not.

## Hardware

    "rods":       [{ "id": "right", "side": "right", "diameter": 6.0, "points": [[x, y, z], ...],
                     "via": [[x, y, z]] }]
    "screws":     [{ "level": "T5", "side": "right", "rod": "right", "head": [x, y, z],
                     "entry": [x, y, z], "tip": [x, y, z], "diameter": 5.0 }]
    "hooks":      [{ "level": "T4", "side": "left", "rod": "left", "kind": "transverse process",
                     "at": [x, y, z], "mid": [x, y, z], "tip": [x, y, z], "faces": "down" }]
    "crosslinks": [{ "level": "T8", "from": [x, y, z], "to": [x, y, z], "style": "plate" }]
    "rodSize":    6.35
    "splits":     ["T10", "T7:left"]
    "colors":     { "rods": "blue", "screws": "titanium", "hooks": "purple", "crosslinks": "gold" }

- A rod is a path of points along its middle.
- `via` is optional. It lists the spots a rod was bent through by hand, between its screws and
  hooks. The builder keeps them when it redraws the rod and moves them along when the spine is
  bent.
- A screw has the point where it grips the rod (`head`), where its thread starts (`entry`) and
  its `tip`. It can carry a `look` for its head: `tall` (the head stands well above the rod) or
  `low` (a smaller head, closer to the bone). Without it, or with `standard`, the head is the
  usual one. Versions of the app before 0.19 draw every screw with the usual head.
- A hook has the point where it grips the rod (`at`), the middle of its blade (`mid`) and the
  `tip` of the blade.
- A cross-link can carry a `style` for its bar: `plate` (a flat strap) or `straight` (a straight
  bar). Without it, or with `arch`, the bar arches away from the spine. From version 0.26.
  Earlier versions draw every cross-link arched.
- `rodSize` is optional: the thickness in millimetres (3 to 8) that new rods get. Without it
  they are 5.5 thick. Every rod in the file still has its own `diameter`. From version 0.26.
- Every piece can carry a `source`, the same way a vertebra does.
- A hook's `faces` is `down` or `up`: the way its blade points along the spine. Without it the
  blade points down.
- Every piece can carry a `color`: `titanium`, `steel`, `black`, `white`, `blue`, `sky`, `teal`,
  `green`, `lime`, `gold`, `orange`, `red`, `pink` or `purple`, or a colour written as `#rrggbb`.
- `colors` is optional. It gives a colour to each kind of part. A piece's own `color` wins
  over it.
- A vertebra can carry a `color` too, written the same way. It is the colour of that one
  vertebra. Without it the vertebra has the bone colour of the person looking, which is not
  kept in the file.
- `"norods": true` in the hardware says that the rods have not been put on yet. The builder
  sets it when the first part goes on a bare spine, because the rods wait for the Rod tool. The rods are still worked out and
  kept in the file, so that cross-links have something to sit on, but they are not drawn,
  printed or exported until the person puts them on.
- A screw, a hook or a cross-link can carry `"locked": true`. The builder calls that frozen:
  it does not move, change or remove such a piece until the person unfreezes it.
- A hook's `kind` is `pedicle`, `lamina` or `transverse process`. It sets the width of the blade.
- A rod or a cross-link drawn by the builder carries `"auto": true`. The builder redraws such a
  rod whenever a screw or hook on its side is added or removed. A rod without it (traced from a
  scan, say) is left alone until the person asks for the rods to be redrawn.
- A cross-link put in by the builder carries `"below": "T6"`: it sits in the gap under that
  vertebra, halfway between the parts of the two vertebrae, and is set again there when the
  rods are redrawn. A cross-link without it (placed by hand or traced) stays where it is. The
  builder then takes it to be in the gap it is nearest to.
- `splits` is optional. It lists where rods end. An entry is the id of a vertebra, `"T7"`,
  for both sides, or an id and a side, `"T7:left"`, for one side: the rod of that side ends
  below that vertebra, and the screws and hooks further down get a rod of their own, with the
  ids `left-2` and `right-2` and so on. A part that is cut off on both sides of itself has no
  rod at all. This is how a file holds two or more separate fusions, each with its own rods:

      "splits": ["T7:left", "T7:right"]

  The builder writes these entries when a rod is drawn from one part to another, when a rod
  is ended by hand, and when parts are put on far from the others (three or more vertebrae
  without a part in between).

## Discs

    "discs": { "L4/L5": { "state": "herniated", "amount": 0.5, "toward": "back-left" },
               "L3/L4": { "state": "thin", "amount": 0.6, "drop": 4.05 } }

A disc is named by the two vertebrae it sits between, the upper one first. Only discs that are
not standard are listed. A file without `discs` has standard discs throughout, and versions of
the app before 0.20 ignore the field.

- `state`: `standard`, `thin`, `bulging`, `herniated`, `dried`, `none` (the disc is gone),
  `replacement` (an artificial disc in its place), `cage` (a fusion cage in its place) or
  `cage-screws` (a fusion cage held by its own screws). `replacement` and `cage` are from
  version 0.24 and `cage-screws` from 0.29. Earlier versions do not know them and say so when
  the file is opened.
- `spacer`: `true` for a spacer between the two back processes. It goes with any state, and not
  with the disc above the sacrum. From version 0.24.
- `amount`: how much, from 0.1 to 1, for a thin, bulging or herniated disc. Without it, 0.5.
- `plate`: `true` for a plate on the front of the two vertebrae, across the disc. It goes with
  any state. From version 0.26. From version 0.29 plates on discs next to each other are drawn
  as one long plate. Versions 0.26 to 0.28 draw a short plate for each.
- `toward`: which way a bulging or herniated disc pushes: `back`, `back-left` or `back-right`,
  and from version 0.26 also `left`, `front` or `right`. Earlier versions do not know those
  three and say so when the file is opened.
- `drop`: for a thin disc, by how many millimetres its space was closed. The vertebrae in the
  file are already where that leaves them. The app uses the number to open the space again
  when the disc is made something else.

These are general pictures of their kind for a sketch. They are not a reading of a scan.

## Marks

    { "kind": "pain", "text": "Sharp pain", "at": [x, y, z], "radius": 17, "strength": 8 }
    { "kind": "pain", "text": "Ache", "from": [x, y, z], "to": [x, y, z], "radius": 30 }
    { "kind": "note", "text": "Ask about this", "at": [x, y, z], "label": [x, y, z] }

A pain mark is either a spot (`at`) or a stretch (`from` and `to`). Its `strength` runs from 1
(mild) to 10 (the worst) and sets its colour, from yellow to red. Without it the mark counts
as 5. A note is a pin with a few words. Either can carry a `label`: the place its words were
moved to, away from the mark. The app joins the two with a line.

## Steps

A sketch can hold the same spine at several moments, each with a few words. The step that
is open stays where a spine always is, at the top level of the file, so a reader that knows
nothing of steps still shows a spine. The other steps are in `steps`, in their order, each
with its own `levels`, `fused`, `hardware` and `marks`. The place of the open step is held
by an entry that says `"here": true`:

    "steps": [ { "caption": "Before", "levels": [...], "fused": [], "hardware": {...}, "marks": [] },
               { "caption": "After", "here": true } ]

- There are 2 to 12 entries, and exactly one of them says `here`.
- `caption` is up to 80 characters. It can be empty.
- The steps need not have the same vertebrae: one can be drawn without its neck.
- A file without `steps` is a sketch with one step.

## A spine in a link

The Share menu makes a link that holds a whole spine file. The file goes into the part of
the address after the # sign, as `#spine=` followed by one letter and text in base 64 (the
kind that is safe in addresses, without padding):

- `z`: the JSON text of the file, squeezed with raw deflate.
- `j`: the JSON text as it is, for a browser that cannot squeeze.

A plain spine makes a link of about 1,100 characters, one with rods and screws about 3,500.
Every step of a sketch is in the link, so each step adds about as much again.
The app refuses a link that unpacks to more than 2 MB, checks the result like any opened
file and then takes the link out of the address bar. `src/io/share.js` does the packing.

## Fused stretches

`fused` lists the stretches that are fused, each as its top and bottom vertebra. A file can
hold several. The builder treats each one as a stiff block while "Fused parts stay stiff"
is ticked: the vertebrae of a block keep their places against each other, and bending the
spine only changes the joints outside the blocks. The file itself stores no stiffness. It
stores where every vertebra is, as always.

## Checking a file

`validateSpine` in `src/core/spinefile.js` checks a file and returns any problems in plain
words. The app shows them when a file is opened.

## Changes to the format

The number in `schema` goes up when the format changes in a way older versions of the app
cannot read. Files of an older format will be converted when they are opened.
