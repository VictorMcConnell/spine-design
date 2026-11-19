# Getting bone shapes from BodyParts3D

The bones in Spine-Design are real shapes. They come from
[BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), a free archive that
holds basically every part of a human body as its own 3D file. Spine-Design took the 24
vertebrae and the sacrum from it and rebuilt them into an "average" spine that is easy to bend.

If you want to do something like this yourself, the archive is a great place to start. The one
catch is that the download holds the whole body, well over a thousand files named by number.
This page shows how to use the index that comes with it to pick out only the parts you need.

Written from the archive's download page and index as they were on 17 November 2026.

## What to download

Both files are on the archive's
[download page](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html).

| File | Size | What it is |
|---|---|---|
| `partof_BP3D_4.0_obj_99.zip` | 62 MB | The 3D files, one `.obj` file for each part, named by number (`FJ3158.obj`). |
| `partof_element_parts.txt` | 654 KB | The index. It says which file belongs to which part of the body. |

The page also has a second set whose names start with `isa_`. It sorts the same body in a
different way. Spine-Design used the `partof_` set, so that is the one described here.

## Step 1: Download and unzip into one folder

1. Download the zip and the index.
2. Make one working folder, for example `C:\SpineModels\Source`, and put both files in it.
3. Unzip the archive into that folder. It does not matter if the `.obj` files land in a
   folder inside it.

## Step 2: Look at the index

The index is a plain text file with three columns, separated by tabs. The first line holds
the column names.

    concept id    name                        element file id
    FMA9165       first thoracic vertebra     FJ3158
    FMA9187       second thoracic vertebra    FJ3160
    FMA9209       third thoracic vertebra     FJ3163

- **name** is the English name of a part of the body.
- **element file id** is the name of its file. `FJ3158` means `FJ3158.obj`.
- **concept id** is the number of that part in an anatomy reference. You can ignore it.

A large part is listed once for every file it is made of. The whole spine ("vertebral
column") has a line for every vertebra, and one vertebra has one line.

To look at the first lines yourself on Windows, open PowerShell in the folder and run:

    Get-Content .\partof_element_parts.txt -TotalCount 10

## Step 3: Copy out the parts you want

The scripts below read the index, keep the lines for the bones of the spine and copy those
files into a new folder called `Spine`. Change the pattern to get other parts.

### Windows (PowerShell)

Open PowerShell (`Win + X`, then Terminal), go to the working folder and paste the script.

```powershell
cd C:\SpineModels\Source

# The index: tab separated, the first line holds the column names
$index = Import-Csv ".\partof_element_parts.txt" -Delimiter "`t"

# Keep the lines whose name is a bone of the spine
$pattern = '^(atlas|axis|sacrum|\w+ (cervical|thoracic|lumbar) vertebra)$'
$wanted = $index | Where-Object { $_.name -match $pattern }

# Every .obj file that was unzipped, by its name without ".obj"
$files = @{}
Get-ChildItem -Path . -Filter *.obj -Recurse -File | ForEach-Object { $files[$_.BaseName] = $_.FullName }

# Copy the files the index names into a new folder
$out = ".\Spine"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$copied = 0
$missing = @()
foreach ($id in ($wanted.'element file id' | Sort-Object -Unique)) {
    if ($files.ContainsKey($id)) {
        Copy-Item -Path $files[$id] -Destination $out -Force
        $copied++
    } else {
        $missing += "$id.obj"
    }
}

Write-Host "$copied files copied to $out" -ForegroundColor Green
if ($missing.Count -gt 0) { Write-Warning ("Not found: " + ($missing -join ', ')) }
```

### Mac or Linux

```sh
cd ~/SpineModels/Source
mkdir -p Spine
awk -F'\t' 'NR > 1 && $2 ~ /^(atlas|axis|sacrum|[a-z]+ (cervical|thoracic|lumbar) vertebra)$/ { print $3 }' partof_element_parts.txt |
  sort -u |
  while read -r id; do
    find . -name "$id.obj" -not -path "./Spine/*" -exec cp {} Spine/ \;
  done
ls Spine | wc -l
```

## Check the result

The `Spine` folder should hold 25 files: 7 vertebrae of the neck, 12 of the chest, 5 of the
lower back and the sacrum. [NOTICE.md](../NOTICE.md) lists which file is which bone.

Each file also says what it is. Open one in a text editor and the first lines name the part
in English. Any 3D program that reads `.obj` files, Blender for one, can open them. Every
part sits in the place it has in the body, so the files line up when you open them together.

## Other parts of the body

Change the pattern in the script to match other names in the index.

| To get | Pattern |
|---|---|
| The discs between the vertebrae | `^intervertebral disk of` |
| One bone | its name between `^` and `$`, for example `^atlas$` |

For anything else, look in the index first to see how the part is named. Search it for a word:

    Select-String -Path .\partof_element_parts.txt -Pattern "rib"

## Use the files in Spine-Design

The shapes are already in the app, so there is nothing to do if you only want to use it. To
make them again from the files of the archive, give the folder to the script that wrote them:

    node tools/make-shapes.mjs C:\SpineModels\Source\Spine

It turns each bone into the axes and the typical size the app works with and writes
`src/shapes/bodyparts3d.js`. [NOTICE.md](../NOTICE.md) says what is changed on the way. The
script finds each bone by the name inside its file, so the folder with the whole archive in
it works too.

## Credit

BodyParts3D is free to use as long as it is named. Keep this line with anything you make
from its shapes and pass on:

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

The licence is on the archive's
[licence page](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). The header inside
each file still names an older licence. [NOTICE.md](../NOTICE.md) has a note on that.
