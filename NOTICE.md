# Notices

Spine Builder's own code is under the MIT licence (see [LICENSE](LICENSE)). One part of the
app comes from somebody else's work and keeps its own licence.

## Bone shapes: BodyParts3D

The shapes of the 24 vertebrae and the sacrum in `src/shapes/bodyparts3d.js`, and so in
`index.html`, are made from the BodyParts3D anatomy models.

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

- Home of the data: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- Its licence page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- The licence: https://creativecommons.org/licenses/by/4.0/
- The files were taken in November 2026 from
  https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip
  (the "part of" tree, version 4.0, OBJ files at 99 percent detail).

The same credit line is shown in the app, under the panel.

### Which files

| Bone | File | Bone | File | Bone | File |
|---|---|---|---|---|---|
| C1 | FJ3176 | T3 | FJ3163 | T12 | FJ3156 |
| C2 | FJ3177 | T4 | FJ3166 | L1 | FJ3157 |
| C3 | FJ3161 | T5 | FJ3169 | L2 | FJ3159 |
| C4 | FJ3164 | T6 | FJ3171 | L3 | FJ3162 |
| C5 | FJ3167 | T7 | FJ3173 | L4 | FJ3165 |
| C6 | FJ3170 | T8 | FJ3174 | L5 | FJ3168 |
| C7 | FJ3172 | T9 | FJ3175 | Sacrum | FJ3393 |
| T1 | FJ3158 | T10 | FJ3154 | | |
| T2 | FJ3160 | T11 | FJ3155 | | |

The 23 discs of the archive (FJ3202 to FJ3224) were used to measure with. Their shapes are
not in the app. The discs on screen are drawn by the code.

### What was changed

The shapes in the app are not the files as they came. `tools/make-shapes.mjs` does this to
each bone, and can be run again on the files from the archive:

- It finds the axes of the bone from the top and the underside of its body, and moves the
  bone so the middle of its body is at 0, 0, 0 with x to the left, y to the back and z up.
- It resizes the bone, by a different amount in each of those three directions, so that its
  body has the typical width, depth and height listed in `src/core/anatomy.js`. The amounts
  are between 0.91 and 1.20. The app stretches a bone again when a spine file gives a
  vertebra its own size.
- It merges points that were written twice and rounds every number to 0.01 mm.
- It records where the discs meet the bone and where a screw can enter it. Those are
  measurements made by this project, not part of BodyParts3D.

The atlas has no body, so it keeps the place it has on the axis in the archive. The sacrum
is placed by the surface the lowest disc sits on.

### A note on the licence wording

The header inside each OBJ file of the archive still names the older licence, "Creative
Commons Attribution-Share Alike 2.1 Japan", and points to the licence page above. That page
now states CC Attribution 4.0 International, and this project follows the page. This is a
reading of the two texts, not legal advice. If you pass the shapes on, keep this notice and
the credit line with them.

BodyParts3D and the Database Center for Life Science have no part in this project and do not
endorse it.
