// The poster as SVG: the painting, the title, the finished board (full games) or the terraforming
// instruments (companion games), and the scores band. Pure string building; rasterized by render.ts.
import {BOARDS, GLOBAL} from '../../shared/board';
import {PLAYER_HEX} from '../../shared/game';
import {HEX_R, hexPoints, layout} from '../../shared/hexgeo';
import {TILE_NAME, tileKind} from '../../shared/full';
import type {SpaceModel} from '../../shared/full';
import {terraformProgress} from '../../shared/poster';
import type {PosterFacts, PosterOrientation} from '../../shared/poster';

export type PosterArt = {
  /** data: URI of the background painting, or null for the styled fallback background */
  painting: string | null;
  /** corporation card number → data: URI of its portrait */
  portraits: Map<string, string>;
};

export const POSTER_SIZE: Record<PosterOrientation, {w: number; h: number}> = {
  landscape: {w: 1920, h: 1080},
  portrait: {w: 1080, h: 1920},
};

// Fonts: static instances of Saira cut by tools/poster-assets.py.
const F = {
  wide: "font-family=\"Poster Saira Wide\" font-weight=\"900\"",
  bold: "font-family=\"Poster Saira\" font-weight=\"700\"",
  semi: "font-family=\"Poster Saira\" font-weight=\"600\"",
  text: "font-family=\"Poster Saira\" font-weight=\"400\"",
  cond: "font-family=\"Poster Saira Cond\" font-weight=\"600\"",
};
const ICE = '#EAF2F4';
const DIM = 'rgba(234,242,244,.72)';
const FAINT = 'rgba(234,242,244,.5)';
const GOLD = '#F2C230';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Hard cap on characters so a long name or title never runs into its neighbour. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…` : s);
const hex = (c: string) => PLAYER_HEX[c] ?? '#9AA1AE';
const fmtDate = (t: number) => new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}).format(t);
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

// ---- words ------------------------------------------------------------------------------------
export function headline(f: PosterFacts): string {
  const winners = f.players.filter((p) => p.placement === 1);
  if (f.players.length === 1) return `${f.players[0].name} finished with ${f.players[0].vp} points`;
  if (winners.length === f.players.length) return `A draw on ${f.players[0].vp} points`;
  if (winners.length > 1) return `Shared victory for ${listNames(winners.map((w) => w.name))}`;
  return `${winners[0].name} wins with ${winners[0].vp} points`;
}

function listNames(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function subline(f: PosterFacts): string {
  if (f.terraformed) return 'Mars is terraformed';
  return `Mars is ${Math.round(terraformProgress(f) * 100)}% terraformed`;
}

// ---- pieces -----------------------------------------------------------------------------------
function defs(): string {
  return `<defs>
  <linearGradient id="t-ocean" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#3C95D2"/><stop offset="0.55" stop-color="#1C5E92"/><stop offset="1" stop-color="#0C3558"/></linearGradient>
  <radialGradient id="t-glint" cx="0.35" cy="0.3" r="0.5"><stop offset="0" stop-color="#CFEAFF" stop-opacity="0.5"/><stop offset="1" stop-color="#CFEAFF" stop-opacity="0"/></radialGradient>
  <linearGradient id="t-green" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#5DAE5E"/><stop offset="1" stop-color="#23592C"/></linearGradient>
  <linearGradient id="t-city" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6B7080"/><stop offset="1" stop-color="#2B2E38"/></linearGradient>
  <linearGradient id="t-special" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A34"/><stop offset="1" stop-color="#3E2416"/></linearGradient>
  <linearGradient id="s-land" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#6A3322"/><stop offset="1" stop-color="#3A1B12"/></linearGradient>
  <linearGradient id="s-ocean" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#23384A"/><stop offset="1" stop-color="#131E2A"/></linearGradient>
  <radialGradient id="disc" cx="0.42" cy="0.38" r="0.7"><stop offset="0" stop-color="#7A3A24" stop-opacity="0.92"/><stop offset="0.7" stop-color="#3A1A10" stop-opacity="0.9"/><stop offset="1" stop-color="#1A0B07" stop-opacity="0.9"/></radialGradient>
  <linearGradient id="fade-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0C0503" stop-opacity="0.82"/><stop offset="1" stop-color="#0C0503" stop-opacity="0"/></linearGradient>
  <linearGradient id="fade-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0C0503" stop-opacity="0"/><stop offset="1" stop-color="#0C0503" stop-opacity="0.94"/></linearGradient>
  <linearGradient id="fallback" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#241A36"/><stop offset="0.5" stop-color="#4A2218"/><stop offset="1" stop-color="#1A0D0A"/></linearGradient>
  <clipPath id="hexclip"><polygon points="${hexPoints(HEX_R - 2.5)}"/></clipPath>
</defs>`;
}

const R = HEX_R - 2.5;
const HEX = hexPoints(R);
const CANOPY: Array<[number, number, number]> = [[-16, -6, 13], [4, -14, 14], [18, 4, 12], [-4, 10, 15], [-22, 14, 9], [16, 20, 9], [0, -30, 8]];
const TOWERS: Array<[number, number, number]> = [[-26, 12, 18], [-12, 16, 34], [3, 12, 26], [16, 14, 40], [29, 10, 20]];

function tileSvg(s: SpaceModel): string {
  const kind = tileKind(s.tileType);
  let body = '';
  if (kind === 'ocean') {
    body = `<polygon points="${HEX}" fill="url(#t-ocean)"/><g clip-path="url(#hexclip)" stroke="rgba(210,236,255,.45)" stroke-width="1.6" fill="none" stroke-linecap="round">`
      + [-14, 2, 18].map((y) => `<path d="M-40 ${y} q10 -6 20 0 t20 0 t20 0 t20 0"/>`).join('') + `</g><polygon points="${HEX}" fill="url(#t-glint)"/>`;
  } else if (kind === 'greenery') {
    body = `<polygon points="${HEX}" fill="url(#t-green)"/><g clip-path="url(#hexclip)">`
      + CANOPY.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#2F7A3B"/><circle cx="${x - r * 0.25}" cy="${y - r * 0.3}" r="${(r * 0.62).toFixed(1)}" fill="#6CC070" opacity="0.85"/>`).join('')
      + '</g>';
  } else if (kind === 'city') {
    body = `<polygon points="${HEX}" fill="url(#t-city)"/><g clip-path="url(#hexclip)"><ellipse cx="0" cy="22" rx="40" ry="9" fill="rgba(0,0,0,.35)"/>`
      + TOWERS.map(([x, w, h]) => `<rect x="${x - w / 2}" y="${24 - h}" width="${w}" height="${h}" rx="2" fill="#C9CED8"/><rect x="${x - w / 2}" y="${24 - h}" width="${w / 2}" height="${h}" fill="#9AA1AE"/>`
        + Array.from({length: Math.floor(h / 9)}, (_, k) => `<rect x="${x - w / 2 + 3}" y="${24 - h + 4 + k * 9}" width="${w - 6}" height="2.6" rx="1" fill="#F2C230" opacity="0.9"/>`).join('')).join('')
      + '<path d="M-44 24 H44" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/></g>';
  } else if (kind === 'special') {
    const words = (TILE_NAME[s.tileType ?? -1] ?? 'Special').split(' ').slice(0, 2);
    body = `<polygon points="${HEX}" fill="url(#t-special)"/><polygon points="${hexPoints(R - 7)}" fill="none" stroke="rgba(242,194,48,.55)" stroke-width="1.4" stroke-dasharray="3 3"/>`
      + `<text text-anchor="middle" ${F.cond} font-size="13" fill="#F5E6CF">` + words.map((w, i) => `<tspan x="0" y="${(words.length > 1 ? 2 : 8) + i * 14}">${esc(w)}</tspan>`).join('') + '</text>';
  }
  const owner = s.color && s.color !== 'neutral'
    ? `<g transform="translate(0 ${-R + 13})"><rect x="-8" y="-6" width="16" height="12" rx="3" fill="rgba(0,0,0,.45)" transform="translate(1.5 2)"/><rect x="-8" y="-6" width="16" height="12" rx="3" fill="${hex(s.color)}" stroke="rgba(255,255,255,.55)" stroke-width="1"/></g>`
    : '';
  return `${body}<polygon points="${HEX}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>${owner}`;
}

/** The finished board, centred on (cx, cy), `size` pixels across the Mars disc behind it. */
function boardSvg(spaces: SpaceModel[], cx: number, cy: number, size: number): string {
  const {cells, offMap, width, height} = layout(spaces);
  const discR = size / 2;
  const scale = (discR * 1.62) / Math.max(width, height);
  const out: string[] = [];
  out.push(`<circle cx="${cx}" cy="${cy}" r="${discR}" fill="url(#disc)" stroke="rgba(193,80,43,.55)" stroke-width="3"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${discR + 10}" fill="none" stroke="rgba(234,242,244,.12)" stroke-width="1.5"/>`);
  out.push(`<g transform="translate(${cx} ${cy}) scale(${scale.toFixed(4)})">`);
  for (const c of cells) {
    const s = c.space;
    const reserved = s.spaceType === 'ocean' || s.spaceType === 'cove';
    out.push(`<g transform="translate(${c.cx.toFixed(1)} ${c.cy.toFixed(1)})">`);
    if (s.tileType === undefined) {
      out.push(`<polygon points="${HEX}" fill="url(#${reserved ? 's-ocean' : 's-land'})" stroke="rgba(255,196,160,.16)" stroke-width="1.5"/>`);
    } else out.push(tileSvg(s));
    out.push('</g>');
  }
  // Off-map spaces (Phobos, Ganymede) only when something was built there.
  const built = offMap.filter((s) => s.tileType !== undefined);
  built.forEach((s, i) => {
    const x = (i % 2 === 0 ? -1 : 1) * (width / 2 + HEX_R * 0.2);
    const y = -height / 2 + HEX_R * 1.2;
    out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(0.8)">${tileSvg(s)}</g>`);
  });
  out.push('</g>');
  return out.join('');
}

/** Companion games have no tile positions: three instrument arcs and the tile totals instead of a board. */
function instrumentsSvg(f: PosterFacts, cx: number, cy: number, size: number): string {
  const t = (f.temperature - GLOBAL.temperature.min) / (GLOBAL.temperature.max - GLOBAL.temperature.min);
  const arcs: Array<[number, string, number]> = [[t, '#F0643A', 0], [f.oxygen / GLOBAL.oxygen.max, '#5BBE6A', 1], [f.oceans / GLOBAL.oceans.max, '#3E8FE0', 2]];
  const out: string[] = [`<circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="rgba(12,5,3,.55)" stroke="rgba(234,242,244,.14)" stroke-width="2"/>`];
  arcs.forEach(([v, color, i]) => {
    const r = size / 2 - 34 - i * 30;
    const c = 2 * Math.PI * r;
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="18"/>`);
    // An untouched parameter shows only its track (a round cap on a zero-length arc would draw a dot).
    if (v > 0.005) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${(c * Math.min(1, v)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  });
  const pct = f.terraformed ? 100 : Math.round(terraformProgress(f) * 100);
  out.push(`<text x="${cx}" y="${cy + 18}" text-anchor="middle" ${F.wide} font-size="${Math.round(size * 0.19)}" fill="${ICE}">${pct}%</text>`);
  out.push(`<text x="${cx}" y="${cy + 18 + Math.round(size * 0.09)}" text-anchor="middle" ${F.cond} font-size="${Math.round(size * 0.055)}" fill="${DIM}">terraformed</text>`);
  return out.join('');
}

/** The three global parameters and the tile totals, as a row of readouts. */
function readouts(f: PosterFacts, x: number, y: number, gap: number, size = 1): string {
  const items: Array<[string, string, string]> = [
    ['Temperature', `${signed(f.temperature)}`, '°C'],
    ['Oxygen', `${f.oxygen}`, '%'],
    ['Oceans', `${f.oceans}`, `of ${GLOBAL.oceans.max}`],
    ['Greenery', `${f.greenery}`, 'tiles'],
    ['Cities', `${f.cities}`, ''],
  ];
  return items.map(([label, value, unit], i) => {
    const xi = x + i * gap;
    return `<text x="${xi}" y="${y}" ${F.cond} font-size="${Math.round(20 * size)}" fill="${FAINT}">${label}</text>`
      + `<text x="${xi}" y="${y + Math.round(44 * size)}" ${F.wide} font-size="${Math.round(40 * size)}" fill="${ICE}">${esc(value)}<tspan ${F.cond} font-size="${Math.round(20 * size)}" fill="${DIM}" dx="6">${esc(unit)}</tspan></text>`;
  }).join('');
}

function avatar(art: PosterArt, portrait: string | null, color: string, name: string, cx: number, cy: number, r: number, id: string): string {
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${hex(color)}" stroke-width="4"/>`;
  const uri = portrait ? art.portraits.get(portrait) : undefined;
  if (uri) {
    return `<clipPath id="av-${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
      + `<image href="${uri}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#av-${id})" preserveAspectRatio="xMidYMid slice"/>${ring}`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hex(color)}"/><text x="${cx}" y="${cy + r * 0.36}" text-anchor="middle" ${F.bold} font-size="${Math.round(r)}" fill="#1A0D0A">${esc(name.slice(0, 1).toUpperCase())}</text>${ring}`;
}

function titleBlock(f: PosterFacts, x: number, y: number, s: number): string {
  const board = BOARDS[f.board]?.title ?? 'Tharsis';
  return `<text x="${x}" y="${y}" ${F.wide} font-size="${Math.round(66 * s)}" fill="${ICE}">Mars Ledger</text>`
    + `<text x="${x}" y="${y + Math.round(52 * s)}" ${F.semi} font-size="${Math.round(28 * s)}" fill="${ICE}">${esc(board)}`
    + `<tspan ${F.text} fill="${DIM}" dx="${Math.round(22 * s)}">${esc(fmtDate(f.endedAt))}</tspan>`
    + `<tspan ${F.text} fill="${DIM}" dx="${Math.round(22 * s)}">${f.generations} generation${f.generations === 1 ? '' : 's'}</tspan>`
    + `<tspan ${F.text} fill="${DIM}" dx="${Math.round(22 * s)}">${f.mode === 'full' ? 'Full game' : 'Companion'}</tspan></text>`;
}

/**
 * Break text into at most `maxLines` lines of about `width` characters. Two-line text is split where
 * the lines come out most even, so a headline never leaves one word on its own.
 */
export function wrap(text: string, width: number, maxLines: number): string[] {
  if (text.length <= width || maxLines <= 1) return [clip(text, width)];
  const words = text.split(/\s+/);
  if (maxLines === 2) {
    let best: string[] | null = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (a.length > width) break;
      if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) best = [a, b];
    }
    if (best) return [best[0], clip(best[1], width)];
  }
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= width) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(lines.slice(maxLines - 1).join(' '), width);
  return kept;
}

/** Headline (wrapped) and the terraforming line under it; returns the SVG and the y below it. */
function headlineBlock(f: PosterFacts, x: number, y: number, s: number, width: number, maxLines = 1): {svg: string; bottom: number} {
  const lh = Math.round(58 * s);
  const lines = wrap(headline(f), width, maxLines);
  const svg = `<text ${F.bold} font-size="${Math.round(50 * s)}" fill="${ICE}">` + lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${esc(l)}</tspan>`).join('') + '</text>'
    + `<text x="${x}" y="${y + (lines.length - 1) * lh + Math.round(46 * s)}" ${F.semi} font-size="${Math.round(28 * s)}" fill="${f.terraformed ? '#9FD7A4' : DIM}">${esc(subline(f))}</text>`;
  return {svg, bottom: y + (lines.length - 1) * lh + Math.round(46 * s)};
}

// ---- layouts ----------------------------------------------------------------------------------
export function posterSvg(f: PosterFacts, art: PosterArt, orientation: PosterOrientation): string {
  return orientation === 'portrait' ? portrait(f, art) : landscape(f, art);
}

function background(art: PosterArt, w: number, h: number): string {
  return art.painting
    ? `<image href="${art.painting}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${w}" height="${h}" fill="url(#fallback)"/>`;
}

function landscape(f: PosterFacts, art: PosterArt): string {
  const {w, h} = POSTER_SIZE.landscape;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, defs(), background(art, w, h)];
  out.push(`<rect width="${w}" height="${Math.round(h * 0.46)}" fill="url(#fade-top)"/>`);
  out.push(`<rect y="${Math.round(h * 0.5)}" width="${w}" height="${Math.round(h * 0.5)}" fill="url(#fade-bottom)"/>`);
  out.push(titleBlock(f, 80, 124, 1));
  out.push(headlineBlock(f, 80, 290, 1, 40).svg);
  out.push(readouts(f, 80, 420, 150));
  // The board (or the instruments) on the right, above the scores band.
  if (f.spaces) out.push(boardSvg(f.spaces, 1452, 404, 620));
  else out.push(instrumentsSvg(f, 1452, 404, 520));
  // Scores band.
  const n = Math.max(1, f.players.length);
  const left = 80, right = w - 80, top = 770;
  const colW = (right - left) / n;
  const chars = Math.max(10, Math.floor(colW / 16));
  out.push(`<line x1="${left}" y1="${top - 26}" x2="${right}" y2="${top - 26}" stroke="rgba(234,242,244,.18)" stroke-width="1.5"/>`);
  f.players.forEach((p, i) => {
    const x = left + i * colW;
    const win = p.placement === 1 && f.players.length > 1;
    out.push(`<text x="${x}" y="${top + 34}" ${F.wide} font-size="34" fill="${win ? GOLD : FAINT}">${p.placement}</text>`);
    out.push(avatar(art, p.portrait, p.color, p.name, x + 88, top + 22, 34, `l${i}`));
    out.push(`<text x="${x + 138}" y="${top + 14}" ${F.bold} font-size="30" fill="${ICE}">${esc(clip(p.name, chars - 6))}</text>`);
    out.push(`<text x="${x + 138}" y="${top + 44}" ${F.cond} font-size="20" fill="${DIM}">${esc(clip(p.corporation ?? '', chars))}</text>`);
    out.push(`<text x="${x}" y="${top + 150}" ${F.wide} font-size="76" fill="${win ? GOLD : ICE}">${p.vp}<tspan ${F.cond} font-size="24" fill="${DIM}" dx="10">points</tspan></text>`);
    if (p.title) {
      out.push(`<text x="${x}" y="${top + 200}" ${F.semi} font-size="26" fill="${hex(p.color)}">${esc(clip(p.title, chars))}</text>`);
      if (p.detail) out.push(`<text x="${x}" y="${top + 232}" ${F.text} font-size="21" fill="${DIM}">${esc(clip(p.detail, chars + 4))}</text>`);
    }
  });
  out.push('</svg>');
  return out.join('\n');
}

function portrait(f: PosterFacts, art: PosterArt): string {
  const {w, h} = POSTER_SIZE.portrait;
  // Seen on a phone at about a third of its size: everything is set larger than on the landscape poster.
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, defs(), background(art, w, h)];
  out.push(`<rect width="${w}" height="${Math.round(h * 0.32)}" fill="url(#fade-top)"/>`);
  out.push(`<rect y="${Math.round(h * 0.4)}" width="${w}" height="${Math.round(h * 0.6)}" fill="url(#fade-bottom)"/>`);
  out.push(`<rect y="${Math.round(h * 0.68)}" width="${w}" height="${Math.round(h * 0.32)}" fill="rgba(12,5,3,.55)"/>`);
  out.push(titleBlock(f, 64, 128, 1.02));
  const head = headlineBlock(f, 64, 272, 1.12, 26, 2);
  out.push(head.svg);
  const boardTop = head.bottom + 50;
  const boardSize = Math.min(820, 1250 - boardTop);
  if (f.spaces) out.push(boardSvg(f.spaces, w / 2, boardTop + boardSize / 2, boardSize));
  else out.push(instrumentsSvg(f, w / 2, boardTop + boardSize / 2, Math.min(640, boardSize)));
  out.push(readouts(f, 64, 1316, 192, 1.28));
  // Scores: one row per player, centred in the band under the readouts.
  const bandTop = 1420, bandBottom = h - 56;
  const n = Math.max(1, f.players.length);
  const rowH = Math.min(150, Math.floor((bandBottom - bandTop) / n));
  const top = bandTop + Math.max(0, Math.floor((bandBottom - bandTop - rowH * n) / 2));
  f.players.forEach((p, i) => {
    const y = top + i * rowH;
    const mid = y + rowH / 2;
    const win = p.placement === 1 && f.players.length > 1;
    out.push(`<text x="64" y="${mid + 17}" ${F.wide} font-size="48" fill="${win ? GOLD : FAINT}">${p.placement}</text>`);
    out.push(avatar(art, p.portrait, p.color, p.name, 170, mid, 46, `p${i}`));
    out.push(`<text x="238" y="${mid - 6}" ${F.bold} font-size="42" fill="${ICE}">${esc(clip(p.name, 14))}</text>`);
    const sub = [p.title, p.corporation].filter(Boolean).join(', ');
    out.push(`<text x="238" y="${mid + 36}" ${F.cond} font-size="30" fill="${p.title ? hex(p.color) : DIM}">${esc(clip(sub, 34))}</text>`);
    out.push(`<text x="${w - 64}" y="${mid + 28}" text-anchor="end" ${F.wide} font-size="84" fill="${win ? GOLD : ICE}">${p.vp}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}
