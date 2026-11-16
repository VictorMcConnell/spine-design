// Builds the two files at the top of the repository that are made from the sources:
//   index.html   the app in one file. A host serves it as the front page of the site, and it
//                also works when opened straight from a folder (browsers refuse to load
//                separate script modules that way).
//   _headers     what a host such as Cloudflare should send along with every page
// The top of the repository is the website: 404.html, robots.txt and picture.png sit there
// as they are. The source of the page is src/page.html.
// The page carries a rule (a content security policy) that lets it run its own script and
// nothing else, and that forbids it to contact any server. The rule names the script by its
// fingerprint, so a page whose script was altered on the way does not run.
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const IMPORT = /^import\s+\{([^}]*)\}\s+from\s+['"](.+?)['"];?[ \t]*$/gm;
const EXPORT = /^export\s+((?:async\s+)?function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

// Each module becomes a function that returns what it exports. Modules are written out in
// the order they are needed.
const order = [], ids = new Map();
function visit(file) {
  if (ids.has(file)) return;
  ids.set(file, 'm' + ids.size);
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(IMPORT)) visit(path.resolve(path.dirname(file), m[2]));
  order.push(file);
}
visit(path.join(src, 'ui', 'app.js'));

const parts = order.map((file) => {
  let code = fs.readFileSync(file, 'utf8');
  const names = [...code.matchAll(EXPORT)].map((m) => m[2]);
  code = code.replace(IMPORT, (all, list, from) => 'const {' + list + '} = M.' + ids.get(path.resolve(path.dirname(file), from)) + ';');
  code = code.replace(EXPORT, '$1 $2');
  if (/^\s*(import|export)\s/m.test(code)) throw new Error('An import or export in ' + file + ' is written in a form this build does not handle.');
  return '// ---- ' + path.relative(src, file) + '\nM.' + ids.get(file) + ' = (() => {\n' + code + '\nreturn { ' + names.join(', ') + ' };\n})();\n';
});

const examples = {};
for (const name of fs.readdirSync(path.join(root, 'examples')).sort()) {
  if (name.endsWith('.spine.json')) examples[name] = JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
}

// What this copy is: its version, where it is hosted and where its source lives. The last
// two are set in site.json and may be left empty.
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const site = JSON.parse(fs.readFileSync(path.join(root, 'site.json'), 'utf8'));
const address = (site.address || '').replace(/\/+$/, ''), source = site.source || '';
for (const [name, value] of [['address', address], ['source', source]]) if (value && !/^https:\/\/[^\s"'<>]+$/.test(value)) throw new Error('site.json: "' + name + '" must be empty or start with https://');

const safe = (text) => text.replace(/</g, '\\u003c');
const scripts = [
  '\nwindow.SPINE_BUILD = ' + safe(JSON.stringify({ version, source })) + ';\nwindow.SPINE_EXAMPLES = ' + safe(JSON.stringify(examples)) + ';\nwindow.SPINE_EXAMPLE_LIST = ' + safe(fs.readFileSync(path.join(root, 'examples', 'index.json'), 'utf8')) + ';\n',
  '\n(() => {\n"use strict";\nconst M = {};\n' + parts.join('\n').replace(/<\/script/g, '<\\/script') + '})();\n',
];
// The rule the page carries. Scripts are allowed by fingerprint only, styles and pictures
// only from the page itself, and nothing may be fetched, posted or connected to.
const prints = scripts.map((text) => "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'");
const policy = "default-src 'none'; script-src " + prints.join(' ') + "; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const escape = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const head = ['<meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '">'];
if (address) {
  // for previews where a link to the site is posted
  const words = 'Sketch a spine in 3D and shape it to look like your own. Free, open source and private.';
  head.push('<link rel="canonical" href="' + escape(address) + '/">', '<meta property="og:type" content="website">', '<meta property="og:title" content="Spine Builder">',
    '<meta property="og:description" content="' + words + '">', '<meta property="og:url" content="' + escape(address) + '/">', '<meta property="og:image" content="' + escape(address) + '/picture.png">',
    '<meta name="twitter:card" content="summary_large_image">');
}

let html = fs.readFileSync(path.join(src, 'page.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('src/page.html no longer contains ' + from); html = html.replace(from, () => to); };
swap('<!doctype html>', '<!doctype html>\n<!-- Built by tools/build.mjs from the files in src/. Change those and build again: do not edit this file by hand. -->');
swap('<!--site-->', head.join('\n'));
swap('<link rel="stylesheet" href="style.css">', '<style>\n' + fs.readFileSync(path.join(src, 'style.css'), 'utf8') + '</style>');
swap('<script type="module" src="ui/app.js"></script>', scripts.map((text) => '<script>' + text + '</script>').join('\n'));

// The headers file is the same rule again, for hosts that can send it with the page.
fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(root, '_headers'), fs.readFileSync(path.join(root, 'tools', 'headers.txt'), 'utf8').replace(/\{\{policy\}\}/g, policy));
console.log('index.html written,', Math.round(html.length / 1024), 'KB,', order.length, 'modules,', Object.keys(examples).length, 'example(s), version', version);
console.log('_headers written', address ? '| hosted at ' + address : '| no address set in site.json');
