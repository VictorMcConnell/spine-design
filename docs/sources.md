# Open data that could feed Spine Builder

Spine Builder sizes its shapes from plain numbers (see [measurements.md](measurements.md)).
This page lists open data sets that could make those numbers better or supply real shapes,
and what each licence would mean for the project. One of them, BodyParts3D, now supplies the
bones. The licences were
read from the pages linked below on 14 November 2026. Check them again before using anything.
This is a reading of the licence pages, not legal advice.

## What a licence means here

- **Attribution only (CC BY).** Fine for this project. Numbers measured from the data, or
  shapes taken from it, can go in the repository as long as the source is credited.
- **Share-alike (CC BY-SA).** Anything made from the data has to carry the same licence. A
  spine someone builds and exports from shapes like that would carry it too. Keep these out
  of the core. They could work as an optional download a person adds themselves.
- **Non-commercial (CC BY-NC and relatives).** Not compatible with a project anyone may reuse
  freely. Keep these out.

## The data sets

| Data set | What it holds | Licence | Use for this project |
|---|---|---|---|
| [TotalSegmentator CT, version 2](https://zenodo.org/records/10047292) | 1,228 CT scans with 117 structures outlined, every vertebra among them | CC BY 4.0 | Good. Measuring each vertebra across the whole set would give real average sizes for `src/core/anatomy.js` in place of the general tables. Needs the download (large) and a measuring script. |
| [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) | Ready-made 3D shapes of every bone, each vertebra and disc as its own file | CC BY 4.0 on the archive's licence page. Credit line asked for: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International". Older copies passed around the web still say CC BY-SA 2.1 Japan. | **In use since 15 November 2026** for the shapes of the vertebrae and the sacrum. The files came from the archive itself and [NOTICE.md](../NOTICE.md) keeps the credit, the source and the list of changes. |
| [VerSe](https://github.com/anjany/verse) | 374 CT scans from 355 people with the vertebrae outlined | CC BY-SA 4.0 | Share-alike. Not for the core. |
| CTSpine1K | About 1,000 CT scans with the vertebrae outlined | Reported as CC BY-NC-SA 4.0 (not read from its own page) | Non-commercial. Keep out. |
| [CTSpinoPelvic1K](https://huggingface.co/datasets/gregoryschwingmdphd/CTSpinoPelvic1K) | Lower back, sacrum and hips outlined, built from three other public sets | CC BY-NC-SA 4.0 | Non-commercial. Keep out. It is its own data set, not a part of TotalSegmentator. |
| Spine-Mets-CT-SEG (The Cancer Imaging Archive) | 55 CT studies of spines with tumours | Reported as CC BY 4.0 (not read from its own page) | Not needed. The app does not model tumours. |

## Hardware

The hardware in Spine Builder is generic: a rod, a threaded screw with a rod-holding head, a
hook, a cross-link. The sizes are typical published figures (rod 5.5 mm, heads 12 to 14 mm
across, screws 3.5 to 7.5 mm by part of the spine). No maker's drawing or model was used.
The head that swivels on the screw has been a common design for decades. Its first patent
(US 4,946,459, granted in 1990) is reported to have run out. That is background, not a
reason the shapes are allowed. They are allowed because they are plain shapes of their kind.

## Left out on purpose

- Bench test standards for implants (ASTM F1717) and strength figures. Spine Builder shows
  shape and position. It does not work out forces and should not look as if it does.
- Rules such as "a screw should fill no more than four fifths of the pedicle". The app uses
  that only to pick a starting size for a new screw. It never judges a real person's hardware
  against average anatomy, because surgeons size hardware to the person.
