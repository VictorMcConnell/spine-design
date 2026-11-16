# Contributing

Thank you for wanting to help. The project is small on purpose, and a few rules keep it that
way.

## The rules

- **No dependencies.** The app is plain HTML, CSS and JavaScript modules. Nothing is
  installed and nothing is fetched while it runs.
- **Nothing leaves the device.** No analytics, no fonts or scripts from other sites, no calls
  to a server. The page forbids itself to do any of that, and the checks fail if it tries.
- **Plain words.** The people who use this are patients, not engineers or doctors. Labels,
  messages and docs use everyday words. The code comments do too.
- **A sketch, not a measurement.** Nothing in the app may read as a diagnosis or as advice.
- **Other people's work keeps its credit.** Shapes or data from elsewhere need a licence that
  allows it and a line in [NOTICE.md](NOTICE.md). No X-rays or scans of real people in the
  repository, except ones a person has shared for it on purpose.

## Working on it

Serve the repository folder with any static web server and open `src/page.html`. Then:

    node tools/test.mjs     # must pass
    node tools/build.mjs    # writes index.html and _headers again

The `index.html` at the top of the repository is the built app, and it is what the hosted
site serves. Change the files in `src`, build, and commit the new `index.html` and `_headers`
together with your change. A check on every pull request builds them again and fails if they
do not match the sources.

## Reporting a problem

Open an issue and say what you did, what you expected and what happened. A saved spine file
helps a lot, as long as it holds nothing you would rather keep to yourself: the name, the
notes and the pain points travel with the file.
