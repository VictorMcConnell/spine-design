# Hosting Spine Builder

The top of this repository is the website. `index.html` sits there, so a host that is
pointed at the repository serves the app as its front page. There is nothing to build on the
host, nothing runs on a server and there is no database.

    index.html    the app, all in one file
    _headers      what the host should send along with every page (Cloudflare reads it)
    404.html      shown for an address that does not exist
    privacy.html, terms.html, accessibility.html   the plain pages the app links to
    robots.txt    keeps the source folders out of search results
    sitemap.xml   the four pages of the site, for search engines
    picture.png   the picture shown where a link to the site is posted
    apple-touch-icon.png   the icon a phone puts on its home screen
    .well-known/security.txt   where to report a security problem

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
      "address": "https://spine-design.com",
      "source": "https://github.com/VictorMcConnell/spine-design"
    }

- `address` adds the tags that make a link to the site show a title and a picture where it is
  posted.
- `source` adds a "Source code" link to the opening note.

After changing it, run `node tools/build.mjs` (it needs Node 18 or newer and nothing else)
and commit the new `index.html` and `_headers`. Also put the address into the "Use it" part
of the README.

The address is written out in a few plain files too, which the build does not touch. If you
host a copy under another address, change it there:

- `privacy.html`, `terms.html` and `accessibility.html`: the link in the head, and the links
  to the page for questions,
- `sitemap.xml`, and the last line of `robots.txt`,
- `.well-known/security.txt`. It also carries a date after which it counts as stale. Move
  that date on once a year.

## Before you tell people about it

- Add the domain to the project, with and without `www`, and let one lead to the other.
- Check that the host has turned on HTTPS for it. Both hosts above do that on their own.
- Open `/privacy.html`, `/terms.html` and `/accessibility.html` on the site. The privacy
  page speaks of "a web host" without naming it. Name yours there if you want to.
- The terms were written in plain words for a free tool. They name no country whose law
  applies and no lawyer has read them. Have them read before you sell anything.
- Run through the list under "After the first deployment" below.

## What the headers do

| Header | What it tells the browser |
|---|---|
| Content-Security-Policy | Run only the app's own script, named by fingerprint. Load nothing from other sites. Contact no server. Do not show the site inside a frame on another site. |
| X-Content-Type-Options | Do not guess what kind of file something is. |
| X-Frame-Options | The older way of saying "not inside a frame". |
| Referrer-Policy | Do not tell other sites which page a visitor came from. |
| Permissions-Policy | This site never asks for camera, microphone, location, payment or USB. |
| Cross-Origin-Opener-Policy | Keep the page apart from windows of other sites. |
| Strict-Transport-Security | For the next year, reach this site over HTTPS only. Leave it out if your host cannot serve HTTPS. |

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
