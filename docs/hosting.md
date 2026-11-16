# Hosting Spine Builder

The top of this repository is the website. `index.html` sits there, so a host that is
pointed at the repository serves the app as its front page. There is nothing to build on the
host, nothing runs on a server and there is no database.

    index.html    the app, all in one file
    _headers      what the host should send along with every page (Cloudflare reads it)
    404.html      shown for an address that does not exist
    robots.txt    keeps the source folders out of search results
    picture.png   the picture shown where a link to the site is posted

`index.html` and `_headers` are built from the sources by `node tools/build.mjs` and kept in
the repository, so the host takes them as they are.

The steps below were written from the hosts' own documentation in November 2026. They have
not been run from this repository yet, so treat the first deployment as the test.

## Cloudflare Pages

1. Put this repository on GitHub.
2. In the Cloudflare dashboard create a Pages project and connect it to the repository.
3. Leave the build command empty and use the top of the repository as the folder to serve.
4. Deploy. Every later push to the main branch deploys again on its own.
5. To use your own domain, add it under **Custom domains** in the project.

Cloudflare sends the headers in `_headers` with every page. That is the reason to prefer it
over GitHub Pages, which cannot.

**Leave these Cloudflare features off**

- Web Analytics. The opening note promises no tracking, and the page would block the script
  anyway.
- Rocket Loader and anything else that rewrites pages. The page names its own script by
  fingerprint and refuses to run a script that was altered. That is on purpose.

## GitHub Pages

Under **Settings**, **Pages**, choose **Deploy from a branch**, the main branch and the
folder `/ (root)`. The empty file `.nojekyll` tells GitHub to serve the files as they are.

GitHub Pages cannot send the headers file. The rule inside the page still applies there: the
app still cannot contact any server.

## Any other host

Point it at the repository, or copy `index.html`, `404.html`, `robots.txt` and `picture.png`
to it. If the host lets you set headers, copy them from `_headers`.

## The rest of the repository is served too

A host that serves the top of the repository also serves the folders `src`, `docs`,
`examples` and `tools` as plain files. That does no harm: they are the same files anyone can
read on GitHub. `robots.txt` keeps them out of search results. The page in `src` is for
working on the code. On Cloudflare it does not run, because the headers allow only the built
app's script.

Do not add a folder named `functions` or a file named `_worker.js` at the top. Cloudflare
would treat those as code to run on its servers. The checks fail if either appears.

## After you know the address: site.json

Two optional lines in `site.json` tell the app where it lives:

    {
      "address": "https://your-site.example",
      "source": "https://github.com/you/spine-builder"
    }

- `address` adds the tags that make a link to the site show a title and a picture where it is
  posted.
- `source` adds a "Source code" link to the opening note.

After changing it, run `node tools/build.mjs` (it needs Node 18 or newer and nothing else)
and commit the new `index.html` and `_headers`. Also put the address into the "Use it" part
of the README.

## What the headers do

| Header | What it tells the browser |
|---|---|
| Content-Security-Policy | Run only the app's own script, named by fingerprint. Load nothing from other sites. Contact no server. Do not show the site inside a frame on another site. |
| X-Content-Type-Options | Do not guess what kind of file something is. |
| X-Frame-Options | The older way of saying "not inside a frame". |
| Referrer-Policy | Do not tell other sites which page a visitor came from. |
| Permissions-Policy | This site never asks for camera, microphone, location, payment or USB. |
| Cross-Origin-Opener-Policy | Keep the page apart from windows of other sites. |

The same Content-Security-Policy, without the part about frames, is written into the page
itself. So it also holds on hosts that send no headers and when the app is opened from a
folder.

To let other sites show the app in a frame, take `frame-ancestors 'none'` and the
X-Frame-Options line out of `tools/headers.txt` and build again.

## After the first deployment

- Open the site. The opening note should appear and the spine should draw.
- Open the browser's developer tools, the Network tab, and load the page again. There should
  be one request for the page and nothing after it.
- Make a share link under **Share** and open it in a private window.
- Paste the address into https://securityheaders.com to see the headers the host sends.
- Post the address somewhere that shows previews to see the title and the picture.

## What a host can see

A host sees what every web host sees: that a device asked for the page, when, and with what
kind of browser. It never sees a sketch, a file or a share link's contents, because none of
those are sent. [PRIVACY.md](../PRIVACY.md) has the full statement.
