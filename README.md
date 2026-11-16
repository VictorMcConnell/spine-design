# Spine Builder

A free tool for people with scoliosis or a spinal fusion to build a 3D sketch of their own spine,
in the browser, on their own device.

![The builder: a curved spine with hooks, screws, rods and cross-links, the box of hardware controls over the model and the flat map that puts the parts on](docs/pictures/builder.png)

You start from a basic spine and shape it until it looks like yours: the curve, the fused part,
the rods, screws and hooks. The result is something to look at, turn around and show to other
people. It is a sketch for understanding and conversation. It does not measure and it does not
diagnose.

## Use it

**Online.** Not set up yet. Once the site is up, its address goes here.
[docs/hosting.md](docs/hosting.md) says how to put it up.

**On your own computer.** No install and no internet connection needed.

1. On the page of this repository, press **Code** and then **Download ZIP**.
2. Unzip it.
3. Double-click `index.html` in the folder.

That one file is the whole app. It opens in any current browser.

## Private by design

The site is a set of plain files. There is no account, no tracking, no database and no server
that keeps anything.

- The page does not send what you build anywhere. It also carries a rule that stops it from
  contacting any server once it is open, and that rule is checked by your browser, not by us.
- Files you open are read by your own browser and go nowhere.
- A share link carries the sketch inside the address itself, in the part after the # sign.
  Browsers do not send that part to a web server. Whoever gets the link gets the whole sketch,
  with its name, its pain points and its notes, so send it only to people who should see those.
- On your device the app keeps two small settings: how you set the look, and whether you asked
  not to see the opening note again. Nothing about your spine is kept. Close the page without
  saving and the sketch is gone.
- Like any website, the service that hosts a copy can see that a device asked for the page.
  It does not see what you do there.

If you share a picture or an X-ray later on, check its edges first. X-rays often carry a name
and a date of birth in the margins. [PRIVACY.md](PRIVACY.md) has the same points in one place.

## What it does

Milestone 2 of 5, the builder, is done. What works today:

- The **spine file**, one small JSON document that holds a whole spine (see
  [docs/spine-file.md](docs/spine-file.md)).
- It **opens on a normal spine**. A gallery of **presets** offers fifteen other places to
  start, in groups: the common patterns of sideways curves (one curve in the chest, two, an S
  shape, three, one in the lower back, a long C shape), round and flat backs seen from the
  side, and spines after surgery, with screws, with hooks and screws, with one old-style rod,
  and one real spine. They are made-up shapes of common patterns, not a diagnosis.
  [docs/sources.md](docs/sources.md) says where the patterns were looked up.
- **Three levels of control**, one switch at the top of the panel. **Easy** has the simple
  tools and keeps the rules on. **Standard** adds the tools for fine work under the same
  rules. **Full control** shows everything, lets every rule be switched off and lets parts be
  frozen in place. You can break the model there, and that is the point of it.
- A **ribbon** along the top holds what is needed all the time: new, presets, open, save,
  share, export, undo and redo, the four views, level names, what is shown and how it looks.
  **New** is a full reset: the average spine, and the look, what is shown and the print
  choices back to how they start.
- **A layout for phones and tablets.** On a narrow screen, or a device that is worked by
  touch alone, the app shows one step at a time with the simple tools: **Shape**, **Hardware**,
  **Pain**, **Share**, with one pair of Back and Next that also walks through the four
  hardware steps. The model fills the screen and a short sheet under it holds the few
  controls of the step. Drawing the curve with a finger is the main way to shape the spine.
  In the Hardware step the flat map stands beside the model, so a tap on the map shows on
  the model at once. On a tablet, or a phone on its side, the sheet stands beside the model
  instead of under it. "More" in the sheet brings out the tools that are used less, and
  "More" in the top bar holds the rest of the ribbon and the switch for the layout: **Auto**,
  **Phone and tablet** or **Desktop**. On a computer the same switch is under Appearance.

  ![Three steps on a phone: drawing the curve, the map beside the model, and the share step](docs/pictures/phone.png)

- **Real bone shapes.** The vertebrae and the sacrum are real anatomy, from the open
  BodyParts3D models, resized to the body size of each level. The simple bones drawn from
  measurements are still there, one tick away under Appearance, and stand in for any level
  the real set lacks. See [NOTICE.md](NOTICE.md) for the source and its licence.
- **Draw the curve.** The quick way to shape a spine: press "Draw it from the back" or "from
  the side", drag a line over the model with the mouse or a finger, and the spine takes the
  shape of the line.
- **A line with points.** A line that stays on the model. Drag its points and the spine
  follows, click the line to add a point, remove one you do not need.
- **Blocks.** Every vertebra as a block in a column, seen from the back or from the side.
  Slide a block sideways and its neighbours follow in a smooth bulge, while the rest of the
  spine stays where it is. Good for small, plain curves. Twists and sharp bends are done on
  the model.
- **Locks.** Lock vertebrae so they stay where they are while you draw, move the line or
  slide blocks: tap a block, click a vertebra on the model, or lock everything outside the
  part you are working on. That way one section can be worked on without losing the rest.
- **One vertebra:** click it, then move it, turn it or resize it with handles on the model,
  the way 3D programs do it (arrows to move, rings to turn, knobs to resize), or with sliders
  and number boxes. Moving it can bend the spine around it or slide it on its own. Turning it
  swings the whole spine above along with it, like bending at that joint, unless you switch
  that off.
- **A stretch of the spine:** click the two vertebrae at its ends. **Bow** bulges the middle
  out while both ends stay put, by a slider in degrees or by pulling the middle on the model.
  **Offset** slides the top end over against the bottom end. Both work sideways and front to
  back. The curves in numbers are folded away in the Shape tab, from Standard up. Click one
  and it picks that stretch for you.
- **Fused parts are stiff.** Say which part is fused, in the Shape tab, before or after there
  is any hardware. That stretch is drawn in a cooler colour, keeps its shape and moves as one
  block. Bend the spine and the bend goes into the joints that are still free, which shows
  what a fusion leaves to move. One tick frees the stretch again for reshaping.
- **Hardware in steps.** At the Easy level the hardware goes on one kind at a time: screws,
  then hooks, then cross-links, and the rods last. The controls for it sit in a small box
  over the model, with a large Next, and each step has a colour of its own. The words that
  explain the step stay in the side panel. In each step you tap the spots, on a flat map of
  the spine seen from the back or on the model itself. The box can be dragged aside by its
  top edge.
- **Hardware on a flat map.** From Standard up the box holds a tray of all parts at once:
  screw, hook down, hook up, cross-link, fused, rods and an eraser. Pick a part and tap the
  spots on the map, drag over several to fill them, or drag the part from the tray onto the
  map or straight onto the model. The model follows every tap.
- **Rods from part to part.** Click a screw or a hook, then another one on the same side,
  and a rod runs between the two. That works on the map and on the model, and with "Both
  sides together" the other side gets the same rod. So one spine can have two or more
  separate fusions, each with rods of its own, say T4 to T7 and L1 to L4. "Rods through all
  parts" does it in one press: a rod down each side, and groups of parts that are three or
  more bare vertebrae apart get rods of their own. A rod is ended by a tap between two of
  its parts on the map or by a click on the rod on the model, and joined again the same way.
  A screw put next to a rod makes that rod longer. One put far from the others starts a rod
  of its own.
- **Soft marks show where to click.** The tool in hand marks its places, on the map and on
  the model: the empty spots for a screw or a hook, the gaps that can take a cross-link (it
  needs a rod on both sides), the parts a rod can run from. A click on a mark puts the part
  there. The marks are not in saved pictures and are never printed.
- **Which block is which bone.** Click a vertebra on the model and its block lights up on
  the map or on the chart of blocks. Press a block and its bone lights up on the model. With
  a mouse, pointing is enough.
- **Or have it filled in:** three questions. Where is the fusion, what holds it (screws,
  hooks on top, screws on every other vertebra or hooks) and how many cross-links. One button
  puts it all on.
- **Select and change.** Click any part, on the model or on the map, to select it. Give that
  one part its own colour or change the colour of all parts of its kind, turn a hook up or
  down, drag it over the bone, or remove it. Click a vertebra for a small card that sets what
  its left and its right side carry. From Standard up, Shift-click selects several parts at
  once, a selected part has arrows for small steps, and a rod can be dragged to bend it.
  Drag one of several selected screws or hooks along the spine and the others move with it,
  vertebra by vertebra, with their rods, cross-links and rod ends.
- **Full control** adds free placing off the usual spots, the place of a part as numbers, a
  table with a row for each vertebra that also sets where the rods end, and **frozen** parts:
  a frozen part cannot be moved, changed or removed until it is unfrozen.
- **Rods that stay believable.** A rod is drawn as one smooth bar through its screws and
  hooks, in their order along the spine, so it cannot zigzag. A part that is dragged out of
  line stops where the rod could no longer follow, and a bend made by hand stops at what a
  rod could take. One switch turns these limits off.
- **Colours for telling parts apart.** Fourteen colours for rods, screws, hooks and
  cross-links, as ready-made sets or one kind at a time, and any single part can have its
  own. The colours are kept in the spine file, so they travel with a link. Hardware is always
  drawn solid, however it was put on.
- On the real bones the usual spot for a screw is the way through the pedicle that was found
  on that bone, so screws start out inside bone. A hook sits on the lamina, the plate of bone
  behind the canal, with its foot on the bone, also in the lower back where the screws go in
  much further out to the side.
- **Pain points and notes:** click the spot, then set a label, how strong it is from 1 to 10
  and its size, and move it with arrows. Notes are pins with a few words. A label sits above
  its spot, and can be dragged further away: a line then joins the two, so the words never
  cover the spot.
- **Look:** five shadings (soft light, clay, drawing with ink lines, X-ray and a plain quick
  one), background, colours for bone and discs, a colour for each level of hardware,
  see-through bone. Kept on the device between visits.
- Hardware and marks **move with the vertebrae** when the spine is bent afterwards.
- **Undo and Redo** for every step. **Open** and **Save** for spine files.
- **Share:** a link that holds the whole sketch.
- **Export:** the view as a picture (PNG), an STL file for 3D printing at full size, a half,
  a third or a quarter, and an OBJ file with colours for other 3D programs, in which every
  vertebra and every part is its own named object. For the print the bones and discs can be
  made smoother: each step cuts every triangle into four and rounds the facets off.
- **A stand for the print.** Choose a round base with a post, or a tall hanger. The stand is
  shown with the spine and saved as a part of its own: the spine gets a peg that plugs into
  the post, or a ring that hangs from the arm of the hanger.
- **Hardware drawn from measurements.** Rods, screws, hooks and cross-links are made by code
  from plain numbers (see [docs/measurements.md](docs/measurements.md)). Open data sets that
  could improve the numbers, with their licences, are listed in
  [docs/sources.md](docs/sources.md).

![The same spine in the five shadings: soft light, clay, drawing, X-ray and plain](docs/pictures/shadings.png)

Known rough edges: parts can overlap each other and the bone a little. The limits on rods
are rules of thumb for a sketch, not engineering. A real bone is one
person's bone stretched to the size asked for, so it is a likeness and not a measurement.
The STL file is made of separate shapes that overlap, which slicers join but which has not
been tried on a printer yet. The same goes for the stand: its fit was worked out, not tried.
Several selected parts move together only along the spine, by whole vertebrae, and only
while snapping is on. The phone and tablet layout was tried with touch events in an
emulated phone and tablet, not yet on real devices. With the Desktop layout chosen on a
phone, the box of hardware controls lies over the top of the model: drag it aside by its
top edge. The X-ray tools do not exist yet. See the roadmap below.

## What this is not

It is not a medical device and it is not medical advice. The shapes are drawn from the numbers
in a spine file, and those numbers are only as good as where they came from. Every part of a
spine file says whether it was measured, traced or guessed, and guessed parts are drawn paler.

## Host it or change it

**Host your own copy.** The top of this repository is the website: `index.html` sits there,
so a host that is pointed at the repository serves the app with nothing to build or set.
[docs/hosting.md](docs/hosting.md) walks through Cloudflare Pages and GitHub Pages.

**Work on the code.** The `index.html` at the top is built from the files in `src`. Serve the
repository folder with any static web server and open `src/page.html` to run the sources
directly. Browsers refuse to load separate script modules straight from a folder, which is
why the single-file build exists.

    node tools/test.mjs           # checks of the core code
    node tools/build.mjs          # writes index.html and _headers again
    node tools/make-average.mjs   # writes the average spine from the size table
    node tools/make-examples.mjs  # writes the other made-up examples
    node tools/make-shapes.mjs <folder>   # makes the bone shapes again from the BodyParts3D files

There are no dependencies and there is no install step. Node 18 or newer is only needed for
those scripts. [CONTRIBUTING.md](CONTRIBUTING.md) has the few house rules.

## How the code is laid out

    src/core/    spine maths, size tables, the shapes of bones and hardware, the numbers,
                 bending the spine (shape.js), placing hardware (place.js) and the stand for
                 a print (stand.js). No screen code.
    src/shapes/  the real bone shapes, written by tools/make-shapes.mjs
    src/view/    a small WebGL renderer with its shadings, the scene built from a spine file
                 and the handles drawn on the model (gizmo.js)
    src/io/      opening and saving spine files, share links, the STL and OBJ files, the zip
                 they are saved in
    src/ui/      the page and its two layouts (app.js), the builder panel and the steps of
                 the phone layout (build.js), its easy ways in (easy.js) and the flat ways
                 to shape the spine (chart.js)
    src/page.html, src/style.css   the page and its looks, as written
    examples/    the presets: spine files that ship with the app
    docs/        the spine file format, the measurements, the open data sets and hosting
    tools/       build and test scripts
    site.json    the address of the hosted copy and of the source, both optional

    index.html   the app in one file, built from src. This is what a host serves and what
                 you open from a folder. Do not edit it by hand.
    _headers     what a host should send with every page, built with it
    404.html, robots.txt, picture.png   the other files a website needs

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
2. **Done:** the builder. Three levels of control, drawing the curve freely or as a line
   with points, sliding blocks, locks, handles, sliders and number boxes for one vertebra and
   for a stretch, stiff fused parts, hardware in steps, on a flat map, in three questions and
   by hand, rods from part to part with separate fusions, rods that can be bent and stay
   believable, soft marks that show where to click, a layout for phones and tablets, real
   bones, pain points and notes, shadings and looks, presets, undo, share link, picture, STL
   with a stand and OBJ.
3. **X-ray:** put your own X-ray behind the model, set its scale, find the metal on it
   automatically, and a score that rises as model and X-ray line up.
4. **Polish:** guided steps in plain words, a glossary, phone layout.
   **Done early:** a copy that is ready to host, with an opening note about what the tool is
   and what it keeps.
5. **Later, if wanted:** finding the vertebrae on an X-ray automatically.

## Licence

The code is under the MIT licence (see [LICENSE](LICENSE)). The bone shapes are from
BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0
International (see [NOTICE.md](NOTICE.md)). A picture or an STL file made with the real bones
is made from those shapes, so pass the credit line on with it. Saved pictures carry it in a
corner and the STL file carries it in its header. The example of a real spine was made from
one person's own scans and is shared by him for this project.
