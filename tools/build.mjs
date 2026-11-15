// Builds dist/index.html: the whole app in one file that works when opened straight from a
// folder (browsers refuse to load separate script modules that way).
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
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
for (const name of fs.readdirSync(path.join(root, 'examples'))) {
  if (name.endsWith('.spine.json')) examples[name] = JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
}

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('index.html no longer contains ' + from); html = html.replace(from, () => to); };
swap('<link rel="stylesheet" href="style.css">', '<style>\n' + fs.readFileSync(path.join(src, 'style.css'), 'utf8') + '</style>');
swap('<script type="module" src="ui/app.js"></script>',
  '<script>\nwindow.SPINE_EXAMPLES = ' + JSON.stringify(examples).replace(/</g, '\\u003c') + ';\nwindow.SPINE_EXAMPLE_LIST = ' + fs.readFileSync(path.join(root, 'examples', 'index.json'), 'utf8').replace(/</g, '\\u003c') + ';\n</script>\n<script>\n(() => {\n"use strict";\nconst M = {};\n' + parts.join('\n').replace(/<\/script/g, '<\\/script') + '})();\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('dist/index.html written,', Math.round(html.length / 1024), 'KB,', order.length, 'modules,', Object.keys(examples).length, 'example(s)');
