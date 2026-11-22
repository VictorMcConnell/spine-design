// The catalogue: picture tiles in small groups, to take one in hand or to change what is
// selected into it. A tile carries no words. Its name shows when the pointer is over it, and
// is said to a screen reader. The page says in words, above the tiles, what is in hand.

const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
export function icon(name, flip) {
  const svg = document.createElementNS(SVG, 'svg'), use = document.createElementNS(SVG, 'use');
  svg.classList.add('i'); if (flip) svg.classList.add('flip'); svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#' + name); svg.appendChild(use);
  return svg;
}

// Fill a box with the groups of a category.
//   groups: [{ name, tiles: [{ id, name, say, icon, flip }] }]
//   pick:   called with the id of the tile that was pressed
// Returns { mark(id): light the tile of that id ('' for none, or a list of ids), pictures(map): give tiles their
// pictures, by id, as addresses an <img> can show }.
export function catalogue(box, groups, pick) {
  box.textContent = '';
  const tiles = [];
  groups.forEach((g, n) => {
    const wrap = make('div', 'catGroup'), head = make('button', 'catHead', g.name), grid = make('div', 'catGrid');
    head.type = 'button'; head.setAttribute('aria-expanded', 'true');
    head.addEventListener('click', () => { const on = head.getAttribute('aria-expanded') !== 'true'; head.setAttribute('aria-expanded', on ? 'true' : 'false'); grid.classList.toggle('folded', !on); });
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', g.name);
    for (const t of g.tiles) {
      const b = make('button', 'pic'), img = make('img');
      b.type = 'button'; b.dataset.tile = t.id; b.dataset.tip = t.name; b.setAttribute('aria-label', t.name + ': ' + t.say); b.setAttribute('aria-pressed', 'false');
      img.alt = ''; img.hidden = true;
      b.append(icon(t.icon, t.flip), img);
      b.addEventListener('click', () => pick(t.id));
      grid.appendChild(b); tiles.push(b);
    }
    if (groups.length > 1 || n) wrap.appendChild(head);
    wrap.appendChild(grid); box.appendChild(wrap);
  });
  return {
    // (a list of ids lights several, for a thing that has one tile in each of two groups)
    mark: (id) => tiles.forEach((b) => b.setAttribute('aria-pressed', (Array.isArray(id) ? id.includes(b.dataset.tile) : b.dataset.tile === id) ? 'true' : 'false')),
    pictures: (map) => tiles.forEach((b) => { const src = map && map[b.dataset.tile], img = b.querySelector('img'); if (!src) return; img.src = src; img.hidden = false; b.querySelector('svg').style.display = 'none'; }),
  };
}
