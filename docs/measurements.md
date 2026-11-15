# Where the measurements come from

The shapes in Spine Builder are drawn by code from plain measurements. No existing 3D model of
a spine or of an implant was used to make them.

The starting point is three spreadsheets of general, typical measurements put together for
this project: vertebra sizes, disc heights and the usual side curves, and generic sizes for
screws, rods, hooks and cross-links. The numbers the app uses are in `src/core/anatomy.js` and
`src/core/hardware.js`.

## Changes made to the vertebra table

Some values in the spreadsheet did not follow well known anatomy. They were replaced with
typical figures. Everything else is used as it came.

**Body width.** Body width. The sheet rises in a straight line and runs 10 to 25% wide in the chest. Real widths dip around T3 to T5.

| Level | Sheet | Used |
|---|---|---|
| C2 | 20.8 | 16.5 |
| C3 | 21.6 | 16 |
| C4 | 22.4 | 16.5 |
| C5 | 23.2 | 17.5 |
| C6 | 24 | 19 |
| C7 | 24.8 | 22 |
| T1 | 28 | 27 |
| T2 | 29.5 | 26 |
| T3 | 31 | 25.5 |
| T4 | 32.5 | 26 |
| T5 | 34 | 27 |
| T6 | 35.5 | 28 |
| T7 | 37 | 29.5 |
| T8 | 38.5 | 31 |
| T9 | 40 | 33 |
| T10 | 41.5 | 35 |
| T11 | 43 | 38 |
| T12 | 44.5 | 41 |
| L1 | 45 | 43 |
| L2 | 47 | 45 |
| L3 | 49 | 47 |
| L4 | 51 | 49 |
| L5 | 53 | 51 |

**Body depth.** Body depth. The sheet runs about 10 to 15% deep.

| Level | Sheet | Used |
|---|---|---|
| C3 | 16 | 15.5 |
| C4 | 16.5 | 15.5 |
| C5 | 17 | 16 |
| C6 | 17.5 | 16.5 |
| C7 | 18 | 17 |
| T1 | 22 | 18.5 |
| T2 | 23.2 | 19.5 |
| T3 | 24.4 | 21 |
| T4 | 25.6 | 22.5 |
| T5 | 26.8 | 24 |
| T6 | 28 | 26 |
| T7 | 29.2 | 27.5 |
| T8 | 30.4 | 28.5 |
| T9 | 31.6 | 29.5 |
| T10 | 32.8 | 30.5 |
| T11 | 34 | 31.5 |
| T12 | 35.2 | 32.5 |
| L1 | 35 | 33 |
| L2 | 36.5 | 34 |
| L3 | 38 | 35 |
| L4 | 39.5 | 35.5 |
| L5 | 41 | 35.5 |

**Side process span.** Span across the side processes. In the chest it shrinks from T1 down to T12, the sheet had it growing. The atlas is the widest in the neck.

| Level | Sheet | Used |
|---|---|---|
| C1 | 45 | 78 |
| C2 | 46 | 52 |
| C3 | 47 | 48 |
| C4 | 48 | 50 |
| C5 | 49 | 52 |
| C6 | 50 | 55 |
| C7 | 51 | 62 |
| T1 | 60 | 75 |
| T2 | 60.5 | 70 |
| T3 | 61 | 66 |
| T4 | 61.5 | 64 |
| T5 | 62 | 63 |
| T6 | 62.5 | 62 |
| T7 | 63 | 61 |
| T8 | 63.5 | 60 |
| T9 | 64 | 59 |
| T10 | 64.5 | 56 |
| T11 | 65 | 50 |
| T12 | 65.5 | 46 |
| L1 | 75 | 70 |
| L2 | 73 | 76 |
| L3 | 71 | 84 |
| L4 | 69 | 82 |
| L5 | 67 | 86 |

**Pedicle width.** Pedicle width. The narrowest pedicles are at T4 to T6, the sheet had them growing steadily from T1.

| Level | Sheet | Used |
|---|---|---|
| T1 | 6 | 8 |
| T2 | 6.2 | 6.5 |
| T3 | 6.4 | 5.5 |
| T4 | 6.6 | 4.8 |
| T5 | 6.8 | 4.8 |
| T6 | 7 | 5 |
| T7 | 7.2 | 5.3 |
| T8 | 7.4 | 5.8 |
| T9 | 7.6 | 6.3 |
| T10 | 7.8 | 7 |
| T11 | 8 | 8.5 |
| T12 | 8.2 | 8.5 |
| L1 | 9 | 8 |
| L2 | 10.2 | 8.5 |
| L3 | 11.4 | 10 |
| L4 | 12.6 | 12.5 |
| L5 | 13.8 | 16 |

**Spinous length.** Spinous process length. C7 is the long one in the neck, C3 to C5 are short.

| Level | Sheet | Used |
|---|---|---|
| C2 | 12.5 | 18 |
| C3 | 15 | 13 |
| C4 | 17.5 | 13 |
| C5 | 20 | 14 |
| C6 | 22.5 | 18 |
| C7 | 25 | 30 |

## Added

- How steeply each spinous process points down (not in the spreadsheet): flat in the lower
  back, steepest around T5 to T8.
- A simple sacrum. The spreadsheet only gives its overall width and depth.

## Used as it came

Body heights, canal width and depth, pedicle heights, disc heights, the side curves
(neck 30, chest 40, lower back 50 degrees, sacral slope 40 degrees) and the hardware sizes.

## A check against a real spine

The example spine carries body sizes measured on one person's CT. Where they differ from this
table the example uses its own sizes, and the rest of each vertebra is scaled to match.
