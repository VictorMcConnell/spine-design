# Spine Builder

A free tool for people with scoliosis or a spinal fusion to build a 3D sketch of their own spine,
in the browser, on their own device.

You start from a basic spine and shape it until it looks like yours: the curve, the fused part,
the rods, screws and hooks. The result is something to look at, turn around and show to other
people. It is a sketch for understanding and conversation. It does not measure and it does not
diagnose.

## Status

This is milestone 1 of 5. What works today:

- The **spine file**, one small JSON document that holds a whole spine (see
  [docs/spine-file.md](docs/spine-file.md)).
- A **viewer** that opens a spine file and draws it: vertebrae, discs, rods, screws, hooks,
  cross-links and pain marks, with level names and a few rough numbers.
- **Bones and hardware drawn from measurements.** Every shape is made by code from plain
  numbers. No existing 3D model was used (see [docs/measurements.md](docs/measurements.md)).
- **Open** and **Save a copy** for spine files.
- Two **examples**: an average spine to start from, and a real fusion from T4 to L2 with rods
  down to L4, shared by the person who started the project.

What does not exist yet: the builder itself (dragging and sliders), the X-ray tools and export
for 3D printing. See the roadmap below.

## Try it

Open `dist/index.html` in a browser. That single file is the whole app and works straight from
a folder, with no server and no internet connection.

To work on the code, serve the repository folder with any static web server and open
`src/index.html`. Browsers refuse to load separate script modules straight from a folder, which
is why the single-file build exists.

    node tools/test.mjs          # checks of the core code
    node tools/build.mjs         # writes dist/index.html
    node tools/make-average.mjs  # writes the average spine from the size table

There are no dependencies and there is no install step. Node is only needed for those two
scripts.

## Your files stay with you

Everything runs in your browser. Nothing you open is uploaded, and the app has no accounts,
no tracking and no server.

If you share a picture or an X-ray later on, check its edges first. X-rays often carry a name
and a date of birth in the margins.

## What this is not

It is not a medical device and it is not medical advice. The shapes are drawn from the numbers
in a spine file, and those numbers are only as good as where they came from. Every part of a
spine file says whether it was measured, traced or guessed, and guessed parts are drawn paler.

## How the code is laid out

    src/core/    spine maths, size tables, the shapes of bones and hardware, the numbers
                 (no screen code)
    src/view/    a small WebGL renderer and the scene built from a spine file
    src/io/      opening and saving spine files
    src/ui/      the page
    examples/    spine files that ship with the app
    docs/        the spine file format
    tools/       build and test scripts
    dist/        the single-file build

The bone and hardware shapes are drawn by the code in `src/core` from the size tables in
`anatomy.js` and `hardware.js`. No third-party 3D models are included, so nothing in the
repository carries a model licence. The hardware is generic: a screw is a screw and a hook is
a hook, in a choice of colours, with no maker's product copied.

The renderer is a small one written for this project. A 3D library such as three.js would make
the builder's drag handles easier and may replace it. Only `src/view` would change.

## Roadmap

1. **Done:** spine file, example, viewer.
2. **Builder:** drag the curve in front and side views, sliders, placing hardware, fused
   stretches that move as one block, undo, share link, STL export.
3. **X-ray:** put your own X-ray behind the model, set its scale, find the metal on it
   automatically, and a score that rises as model and X-ray line up.
4. **Polish:** guided steps in plain words, a glossary, phone layout.
5. **Later, if wanted:** finding the vertebrae on an X-ray automatically.

## Licence

The code is under the MIT licence (see [LICENSE](LICENSE)). The example spine file was made
from one person's own scans and is shared by him for this project.
