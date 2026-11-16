// Metallic avatar renderer: per-bot reflective finish, cached as sprites; eyes drawn live.
import { SHAPES, EYES } from './shapes.js';

export const EYE_COLOR = '#141414';

export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
export function mix(h, h2, t) {
  const a = hexRgb(h), b = hexRgb(h2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function shapePath(id) {
  const p = new Path2D(); const pts = SHAPES[id];
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}
const PATHS = {};
export function pathFor(id) { return PATHS[id] || (PATHS[id] = shapePath(id)); }

// Finish recipes. All keep the sampled base color as the dominant tone.
export const FINISHES = {
  pearl:    { hi: .45, lo: .16, angle: -.9, spec: .9, irid: .1, edge: .22 },
  candy:    { hi: .42, lo: .22, angle: -.6, spec: 1.0, irid: 0, edge: .32, gloss: true },
  liquid:   { hi: .38, lo: .2, angle: -.3, spec: .85, irid: 0, edge: .26, waves: true },
  chrome:   { hi: .5, lo: .3, angle: -.75, spec: .95, irid: 0, edge: .28, bands: true },
  anodized: { hi: .34, lo: .2, angle: -1.0, spec: .8, irid: .06, edge: .26, grain: true },
  brushed:  { hi: .36, lo: .22, angle: -.5, spec: .75, irid: 0, edge: .28, brushed: true },
  mirror:   { hi: .62, lo: .42, angle: -.7, spec: 1.0, irid: .05, edge: .3, bands: true, mirror: true },
  satin:    { hi: .4, lo: .18, angle: -.8, spec: .8, irid: .1, edge: .24 },
};

function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Draw the body in unit coordinates (caller has scaled so 1 unit = bot radius).
export function drawBody(ctx, bot) {
  const f = FINISHES[bot.finish];
  const path = pathFor(bot.shape);
  const c = bot.color;
  const isWhite = c.toLowerCase() === '#ffffff';
  ctx.save();
  // base
  const g = ctx.createLinearGradient(-1, -1, 1, 1);
  if (isWhite) { g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#fbfbfc'); g.addColorStop(1, '#d4d6dc'); }
  else { g.addColorStop(0, mix(c, '#ffffff', .22)); g.addColorStop(.42, c); g.addColorStop(1, mix(c, '#000000', .32)); }
  ctx.fillStyle = g; ctx.fill(path);
  ctx.clip(path);

  // environment reflection bands (the "metal")
  const a = f.angle, ca = Math.cos(a), sa = Math.sin(a);
  const eg = ctx.createLinearGradient(-ca * 1.1, -sa * 1.1 - 1, ca * 1.1, sa * 1.1 + 1);
  const W = isWhite ? .5 : 1;
  eg.addColorStop(0, `rgba(255,255,255,${f.hi * .5 * W})`);
  eg.addColorStop(.26, `rgba(255,255,255,${f.hi * W})`);
  eg.addColorStop(f.mirror ? .34 : .4, 'rgba(255,255,255,0)');
  eg.addColorStop(.52, `rgba(0,0,0,${f.lo * (isWhite ? .25 : 1)})`);
  eg.addColorStop(.7, 'rgba(0,0,0,0)');
  eg.addColorStop(.88, `rgba(255,255,255,${.1 * W})`);
  eg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = eg; ctx.fillRect(-1.5, -1.5, 3, 3);

  if (f.bands) { // crisp horizon line, like polished chrome
    ctx.save(); ctx.rotate(-0.25);
    const hg = ctx.createLinearGradient(0, -.2, 0, .25);
    hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(.4, `rgba(255,255,255,${f.mirror ? .35 : .16})`);
    hg.addColorStop(.55, `rgba(0,0,0,${f.mirror ? .3 : .14})`); hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(-1.5, -.2, 3, .45);
    ctx.restore();
  }
  if (f.waves) { // molten / liquid ripples
    ctx.lineWidth = .07;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${.12 - i * .02})`;
      ctx.beginPath();
      for (let x = -1.2; x <= 1.2; x += .05) { const y = -.55 + i * .32 + Math.sin(x * 3 + i) * .08; x === -1.2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  if (f.brushed) { // fine directional lines
    const r = seeded(7); ctx.save(); ctx.rotate(-.27); ctx.lineWidth = .012;
    for (let i = 0; i < 90; i++) { const y = -1.3 + i * .029; ctx.strokeStyle = r() > .5 ? `rgba(255,255,255,${.05 + r() * .05})` : `rgba(0,0,0,${.05 + r() * .06})`; ctx.beginPath(); ctx.moveTo(-1.4, y); ctx.lineTo(1.4, y); ctx.stroke(); }
    ctx.restore();
  }
  if (f.grain) { // anodized micro-sparkle
    const r = seeded(11);
    for (let i = 0; i < 260; i++) { ctx.fillStyle = r() > .5 ? 'rgba(255,255,255,.10)' : 'rgba(0,40,40,.10)'; ctx.fillRect(r() * 2.4 - 1.2, r() * 2.4 - 1.2, .02, .02); }
  }
  if (f.irid) { // pearlescent hue drift
    const cg = ctx.createConicGradient ? ctx.createConicGradient(.6, -.2, -.2) : null;
    if (cg) {
      ['#ff9ad5', '#9ad7ff', '#b8ffcf', '#fff1a8', '#d3a8ff', '#ff9ad5'].forEach((col, i) => cg.addColorStop(i / 5, col));
      ctx.globalAlpha = f.irid; ctx.globalCompositeOperation = isWhite ? 'multiply' : 'soft-light';
      ctx.fillStyle = cg; ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  // edge falloff (gives volume)
  const rg = ctx.createRadialGradient(-.2, -.25, .2, 0, 0, 1.25);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(.7, 'rgba(0,0,0,0)'); rg.addColorStop(1, `rgba(0,0,0,${f.edge + (isWhite ? .02 : 0)})`);
  ctx.fillStyle = rg; ctx.fillRect(-1.5, -1.5, 3, 3);
  // bottom-right bounce light rim
  ctx.lineWidth = .1;
  const rimG = ctx.createLinearGradient(-1, -1, 1, 1);
  rimG.addColorStop(0, 'rgba(255,255,255,0)'); rimG.addColorStop(.62, 'rgba(255,255,255,0)'); rimG.addColorStop(1, `rgba(255,255,255,${isWhite ? .5 : .38})`);
  ctx.strokeStyle = rimG; ctx.stroke(path);
  // top-left catch rim
  const rim2 = ctx.createLinearGradient(-1, -1, .2, .2);
  rim2.addColorStop(0, 'rgba(255,255,255,.55)'); rim2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.lineWidth = .05; ctx.strokeStyle = rim2; ctx.stroke(path);
  // specular highlight
  ctx.save(); ctx.translate(-.4, -.5); ctx.rotate(-.55); ctx.scale(1, .55);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, .42);
  sg.addColorStop(0, `rgba(255,255,255,${.75 * f.spec})`); sg.addColorStop(.5, `rgba(255,255,255,${.22 * f.spec})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, .42, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (f.gloss) { // candy gloss: sharp window reflection
    ctx.save(); ctx.translate(-.36, -.5); ctx.rotate(-.5);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(0, 0, .2, .06, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(-.5, -.56, .045, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // hairline outline to separate from floor
  ctx.save(); ctx.lineWidth = .025; ctx.strokeStyle = isWhite ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.35)'; ctx.stroke(path); ctx.restore();
}

// Eyes. gx, gy: glance offset in units; blink: 0 open .. 1 closed.
export function drawEyes(ctx, bot, gx, gy, blink) {
  const e = EYES[bot.shape];
  ctx.save();
  ctx.fillStyle = EYE_COLOR;
  const sy = Math.max(.08, 1 - blink);
  for (const [x, y] of e.pts) {
    ctx.save();
    ctx.translate(x + gx, y + gy);
    if (e.kind === 'rect') {
      ctx.scale(1, sy);
      const w = e.hw, h = e.hh, r = Math.min(w, h) * .95;
      ctx.beginPath(); ctx.roundRect(-w, -h, 2 * w, 2 * h, r); ctx.fill();
    } else {
      ctx.rotate(e.tilt); ctx.scale(1, sy);
      ctx.beginPath(); ctx.ellipse(0, 0, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

// Sprite cache for bodies.
const cache = new Map();
export function bodySprite(bot, pxPerUnit) {
  const key = bot.id + '@' + Math.round(pxPerUnit * 4);
  let s = cache.get(key);
  if (s) return s;
  const size = Math.ceil(pxPerUnit * 2.5);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.translate(size / 2, size / 2); c.scale(pxPerUnit, pxPerUnit);
  drawBody(c, bot);
  s = { cv, size, ppu: pxPerUnit };
  cache.set(key, s);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return s;
}
