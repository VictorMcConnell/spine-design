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
    "crosslinks": [{ "level": "T8", "from": [x, y, z], "to": [x, y, z] }]
    "splits":     ["T10", "T7:left"]
    "colors":     { "rods": "blue", "screws": "titanium", "hooks": "purple", "crosslinks": "gold" }

- A rod is a path of points along its middle.
- `via` is optional. It lists the spots a rod was bent through by hand, between its screws and
  hooks. The builder keeps them when it redraws the rod and moves them along when the spine is
  bent.
- A screw has the point where it grips the rod (`head`), where its thread starts (`entry`) and
  its `tip`.
- A hook has the point where it grips the rod (`at`), the middle of its blade (`mid`) and the
  `tip` of the blade.
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

## Marks

    { "kind": "pain", "text": "Sharp pain", "at": [x, y, z], "radius": 17, "strength": 8 }
    { "kind": "pain", "text": "Ache", "from": [x, y, z], "to": [x, y, z], "radius": 30 }
    { "kind": "note", "text": "Ask about this", "at": [x, y, z], "label": [x, y, z] }

A pain mark is either a spot (`at`) or a stretch (`from` and `to`). Its `strength` runs from 1
(mild) to 10 (the worst) and sets its colour, from yellow to red. Without it the mark counts
as 5. A note is a pin with a few words. Either can carry a `label`: the place its words were
moved to, away from the mark. The app joins the two with a line.

## A spine in a link

The Share menu makes a link that holds a whole spine file. The file goes into the part of
the address after the # sign, as `#spine=` followed by one letter and text in base 64 (the
kind that is safe in addresses, without padding):

- `z`: the JSON text of the file, squeezed with raw deflate.
- `j`: the JSON text as it is, for a browser that cannot squeeze.

A plain spine makes a link of about 1,100 characters, one with rods and screws about 3,500.
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
