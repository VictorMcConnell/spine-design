# Spine Builder

A free tool for people with scoliosis or a spinal fusion to build a 3D sketch of their own spine,
in the browser, on their own device.

You start from a basic spine and shape it until it looks like yours: the curve, the fused part,
the rods, screws and hooks. The result is something to look at, turn around and show to other
people. It is a sketch for understanding and conversation. It does not measure and it does not
diagnose.

## Status

Milestone 2 of 5 is under way: the builder works and is being polished. What works today:

- The **spine file**, one small JSON document that holds a whole spine (see
  [docs/spine-file.md](docs/spine-file.md)).
- It **opens on a normal spine**. A gallery of examples offers other places to start: one
  curve in the chest, one in the lower back, an S shape, a made-up fusion with rods and one
  real spine.
- A **ribbon** along the top holds what is needed all the time: new, examples, open, save,
  undo and redo, the four views, level names, what is shown and how it looks.
- **Real bone shapes.** The vertebrae and the sacrum are real anatomy, from the open
  BodyParts3D models, resized to the body size of each level. The simple bones drawn from
  measurements are still there, one tick away under Appearance, and stand in for any level
  the real set lacks. See [NOTICE.md](NOTICE.md) for the source and its licence.
- **One vertebra:** click it, then move it, turn it or resize it with handles on the model,
  the way 3D programs do it (arrows to move, rings to turn, knobs to resize), or with sliders
  and number boxes. Moving it can bend the spine around it or slide it on its own.
- **A stretch of the spine:** click the two vertebrae at its ends. **Bow** bulges the middle
  out while both ends stay put, by a slider in degrees or by pulling the middle on the model.
  **Offset** slides the top end over against the bottom end. Both work sideways and front to
  back. The list of curves under the panel is clickable: it picks that stretch for you.
- **Hardware, the easy way:** one sheet with a row for each vertebra. Tap a cell for a screw
  or a hook on the left or the right, and tick the gaps that are fused, that carry a
  cross-link or where the rods end. Drag down a column to fill several rows. The model
  follows every tap, rods are drawn for you, and a spine can have several separate fusions
  and several separate sets of rods. A stretch can also be filled in one go.
- **Hardware, by hand:** pick a screw, hook or cross-link and click the spine. Parts snap to
  the usual spot on each vertebra, or go exactly where you click with snapping off. Click a
  part to move it with handles, resize it, recolour it or remove it. The rods follow.
- On the real bones the usual spot for a screw is the way through the pedicle that was found
  on that bone, so screws start out inside bone.
- **Pain points and notes:** click the spot, then set a label, how strong it is from 1 to 10
  and its size, and move it with arrows. Notes are pins with a few words.
- **Look:** five shadings (soft light, clay, drawing with ink lines, X-ray and a plain quick
  one), background, colours for bone, discs and hardware, a colour for each level of
  hardware, see-through bone. Kept on the device between visits.
- Hardware and marks **move with the vertebrae** when the spine is bent afterwards.
- **Undo and Redo** for every step. **Open** and **Save** for spine files.
- **Hardware drawn from measurements.** Rods, screws, hooks and cross-links are made by code
  from plain numbers (see [docs/measurements.md](docs/measurements.md)). Open data sets that
  could improve the numbers, with their licences, are listed in
  [docs/sources.md](docs/sources.md).

Known rough edges: parts can overlap each other and the bone a little, a fused stretch does
not yet move as one stiff block, and there is no share link or export for 3D printing yet.
A real bone is one person's bone stretched to the size asked for, so it is a likeness and
not a measurement. The X-ray tools do not exist yet. See the roadmap below.

## Try it

Open `dist/index.html` in a browser. That single file is the whole app and works straight from
a folder, with no server and no internet connection.

To work on the code, serve the repository folder with any static web server and open
`src/index.html`. Browsers refuse to load separate script modules straight from a folder, which
is why the single-file build exists.

    node tools/test.mjs           # checks of the core code
    node tools/build.mjs          # writes dist/index.html
    node tools/make-average.mjs   # writes the average spine from the size table
    node tools/make-examples.mjs  # writes the other made-up examples
    node tools/make-shapes.mjs <folder>   # makes the bone shapes again from the BodyParts3D files

There are no dependencies and there is no install step. Node is only needed for those
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

    src/core/    spine maths, size tables, the shapes of bones and hardware, the numbers,
                 bending the spine (shape.js) and placing hardware (place.js). No screen code.
    src/shapes/  the real bone shapes, written by tools/make-shapes.mjs
    src/view/    a small WebGL renderer with its shadings, the scene built from a spine file
                 and the handles drawn on the model (gizmo.js)
    src/io/      opening and saving spine files
    src/ui/      the page (app.js) and the builder panel (build.js)
    examples/    spine files that ship with the app
    docs/        the spine file format, the measurements and the open data sets
    tools/       build and test scripts
    dist/        the single-file build

The bones are real shapes from BodyParts3D, which is under CC Attribution 4.0 and asks to be
named. [NOTICE.md](NOTICE.md) says where the files came from and what was done to them. The
simple bones, the discs and all the hardware are drawn by the code in `src/core` from the
size tables in `anatomy.js` and `hardware.js`. The hardware is generic: a screw is a screw and
a hook is a hook, in a choice of colours, with no maker's product copied.

The renderer is a small one written for this project. It draws the picture, then draws the
scene a second time to work out soft shadow in corners and gaps and the ink lines of the
drawing shading. Where a device cannot do that second pass it is left out and the picture is
still drawn.

## Roadmap

1. **Done:** spine file, example, viewer.
2. **Builder.** Done: handles, sliders and number boxes for one vertebra and for a stretch,
   the hardware sheet and hand placing with handles, real bones, pain points and notes,
   shadings and looks, examples, undo. Still to do: fused stretches that move as one block,
   a share link, STL export.
3. **X-ray:** put your own X-ray behind the model, set its scale, find the metal on it
   automatically, and a score that rises as model and X-ray line up.
4. **Polish:** guided steps in plain words, a glossary, phone layout.
5. **Later, if wanted:** finding the vertebrae on an X-ray automatically.

## Licence

The code is under the MIT licence (see [LICENSE](LICENSE)). The bone shapes are from
BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0
International (see [NOTICE.md](NOTICE.md)). The example of a real spine was made from one
person's own scans and is shared by him for this project.
