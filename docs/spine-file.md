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

- A rod is a path of points along its middle.
- A screw has the point where it grips the rod (`head`), where its thread starts (`entry`) and
  its `tip`.
- A hook has the point where it grips the rod (`at`), the middle of its blade (`mid`) and the
  `tip` of the blade.
- Every piece can carry a `source`, the same way a vertebra does.
- Every piece can carry a `color`: `titanium`, `steel`, `blue`, `green`, `purple` or `gold`.
- A hook's `kind` is `pedicle`, `lamina` or `transverse process`. It sets the width of the blade.

## Marks

    { "kind": "pain", "text": "Sharp pain", "at": [x, y, z], "radius": 17 }
    { "kind": "pain", "text": "Ache", "from": [x, y, z], "to": [x, y, z], "radius": 30 }

A mark is either a spot (`at`) or a stretch (`from` and `to`).

## Checking a file

`validateSpine` in `src/core/spinefile.js` checks a file and returns any problems in plain
words. The app shows them when a file is opened.

## Changes to the format

The number in `schema` goes up when the format changes in a way older versions of the app
cannot read. Files of an older format will be converted when they are opened.
