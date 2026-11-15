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
| `pictures` | Reserved for X-rays and their scale. Empty for now. |

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

    "rods":       [{ "id": "right", "side": "right", "diameter": 6.0, "points": [[x, y, z], ...] }]
    "screws":     [{ "level": "T5", "side": "right", "rod": "right", "head": [x, y, z],
                     "entry": [x, y, z], "tip": [x, y, z], "diameter": 5.0 }]
    "hooks":      [{ "level": "T4", "side": "left", "rod": "left", "kind": "transverse process",
                     "at": [x, y, z], "mid": [x, y, z], "tip": [x, y, z] }]
    "crosslinks": [{ "level": "T8", "from": [x, y, z], "to": [x, y, z] }]
    "splits":     ["T10"]

- A rod is a path of points along its middle.
- A screw has the point where it grips the rod (`head`), where its thread starts (`entry`) and
  its `tip`.
- A hook has the point where it grips the rod (`at`), the middle of its blade (`mid`) and the
  `tip` of the blade.
- Every piece can carry a `source`, the same way a vertebra does.
- Every piece can carry a `color`: `titanium`, `steel`, `blue`, `green`, `purple` or `gold`.
- A hook's `kind` is `pedicle`, `lamina` or `transverse process`. It sets the width of the blade.
- A rod or a cross-link drawn by the builder carries `"auto": true`. The builder redraws such a
  rod whenever a screw or hook on its side is added or removed. A rod without it (traced from a
  scan, say) is left alone until the person asks for the rods to be redrawn.
- A cross-link put in from the hardware sheet carries `"below": "T6"`: it sits in the gap
  under that vertebra and is set again there when the rods are redrawn.
- `splits` is optional. It lists the vertebrae below which the rods end. The screws and hooks
  further down get rods of their own, with the ids `left-2` and `right-2` and so on. This is
  how a file holds two separate constructs.

## Marks

    { "kind": "pain", "text": "Sharp pain", "at": [x, y, z], "radius": 17, "strength": 8 }
    { "kind": "pain", "text": "Ache", "from": [x, y, z], "to": [x, y, z], "radius": 30 }
    { "kind": "note", "text": "Ask about this", "at": [x, y, z] }

A pain mark is either a spot (`at`) or a stretch (`from` and `to`). Its `strength` runs from 1
(mild) to 10 (the worst) and sets its colour, from yellow to red. Without it the mark counts
as 5. A note is a pin with a few words.

## Checking a file

`validateSpine` in `src/core/spinefile.js` checks a file and returns any problems in plain
words. The app shows them when a file is opened.

## Changes to the format

The number in `schema` goes up when the format changes in a way older versions of the app
cannot read. Files of an older format will be converted when they are opened.
