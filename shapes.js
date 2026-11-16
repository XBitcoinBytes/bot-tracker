// Bot avatar geometry, matched to Shaun's Grok Bot screenshot (ref/avatars.png).
// All shapes are polygons in a normalized frame (max half-extent = 1, y down).

const TAU = Math.PI * 2;

function rot(pts, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

function normalize(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const h = Math.max(maxX - minX, maxY - minY) / 2;
  return pts.map(([x, y]) => [(x - cx) / h, (y - cy) / h]);
}

// Round each corner with a quadratic curve; d is the cut distance per vertex (number or array).
function roundPoly(pts, d, steps = 10) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const di = Array.isArray(d) ? d[i] : d;
    const v = pts[i], p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    if (!di) { out.push(v); continue; }
    const l1 = Math.hypot(p[0] - v[0], p[1] - v[1]), l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const a = [v[0] + (p[0] - v[0]) / l1 * Math.min(di, l1 * .48), v[1] + (p[1] - v[1]) / l1 * Math.min(di, l1 * .48)];
    const b = [v[0] + (q[0] - v[0]) / l2 * Math.min(di, l2 * .48), v[1] + (q[1] - v[1]) / l2 * Math.min(di, l2 * .48)];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1]]);
    }
  }
  return out;
}

function circle(n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([Math.cos(a), Math.sin(a)]); }
  return pts;
}

function capsule(halfLen, halfThick, a) {
  const pts = [], c = halfLen - halfThick;
  for (let i = 0; i <= 40; i++) { const t = -Math.PI / 2 + i / 40 * Math.PI; pts.push([c + Math.cos(t) * halfThick, Math.sin(t) * halfThick]); }
  for (let i = 0; i <= 40; i++) { const t = Math.PI / 2 + i / 40 * Math.PI; pts.push([-c + Math.cos(t) * halfThick, Math.sin(t) * halfThick]); }
  return rot(pts, a);
}

function cloud(circles, n = 220) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (const [cx, cy, r] of circles) {
      const b = dx * cx + dy * cy, c = cx * cx + cy * cy - r * r, disc = b * b - c;
      if (disc >= 0) best = Math.max(best, b + Math.sqrt(disc));
    }
    pts.push([dx * best, dy * best]);
  }
  return pts;
}

function teardrop(tip, cx, cy, r, tipRound) {
  const dx = tip[0] - cx, dy = tip[1] - cy, L = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx), off = Math.acos(r / L);
  const a1 = base + off, a2 = base - off + TAU;
  const pts = [tip];
  const n = 70;
  for (let i = 0; i <= n; i++) { const a = a1 + (a2 - a1) * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  const d = pts.map((_, i) => (i === 0 ? tipRound : 0));
  return roundPoly(pts, d, 16);
}

function star4(tips, inner, dTip, dIn) {
  const pts = [], d = [];
  for (let i = 0; i < 4; i++) {
    const t = tips[i], u = tips[(i + 1) % 4];
    pts.push(t); d.push(dTip);
    const a1 = Math.atan2(t[1], t[0]), a2 = Math.atan2(u[1], u[0]);
    let mid = (a1 + a2) / 2; if (Math.abs(a2 - a1) > Math.PI) mid += Math.PI;
    pts.push([Math.cos(mid) * inner, Math.sin(mid) * inner]); d.push(dIn);
  }
  return roundPoly(pts, d, 14);
}

export const SHAPES = {
  ara: normalize(circle()),
  wedding: normalize(capsule(1.0, 0.66, -0.3)),
  stan: normalize(capsule(1.0, 0.72, -0.28)),
  yahn: normalize(cloud([[-0.36, -0.28, .46], [0.18, -0.4, .44], [0.55, -0.02, .46], [0.22, 0.42, .46], [-0.3, 0.42, .44], [-0.55, 0.05, .4], [0, 0, .62]])),
  jeff: normalize(teardrop([-0.6, -0.97], 0.04, 0.15, 0.87, 0.26)),
  researchy: normalize(teardrop([-0.56, -0.97], 0.05, 0.2, 0.84, 0.3)),
  pete: normalize(roundPoly([[-1, -0.14], [-0.5, -0.93], [0.6, -0.73], [1, 0.11], [0.35, 0.95], [-0.78, 0.74]], 0.21, 12)),
  nikolai: normalize(star4([[-0.13, -0.96], [0.95, -0.06], [0.11, 0.96], [-0.95, -0.12]], 0.5, 0.36, 0.3)),
};

// Eye placement in the same normalized frame, eyeballed from the screenshot.
// Helpers: slanted ovals (rx, ry, tilt). Ara: tall rounded rectangles.
export const EYES = {
  ara: { kind: 'rect', pts: [[-0.27, -0.28], [0.35, -0.31]], hw: 0.145, hh: 0.34, tilt: 0 },
  wedding: { kind: 'oval', pts: [[0.02, -0.26], [0.5, -0.38]], rx: 0.085, ry: 0.21, tilt: -0.42 },
  stan: { kind: 'oval', pts: [[0.02, -0.2], [0.54, -0.33]], rx: 0.09, ry: 0.23, tilt: -0.42 },
  yahn: { kind: 'oval', pts: [[0.07, -0.29], [0.5, -0.43]], rx: 0.085, ry: 0.21, tilt: -0.42 },
  jeff: { kind: 'oval', pts: [[0.17, -0.21], [0.53, -0.33]], rx: 0.085, ry: 0.21, tilt: -0.38 },
  researchy: { kind: 'oval', pts: [[0.13, -0.2], [0.51, -0.33]], rx: 0.085, ry: 0.21, tilt: -0.38 },
  pete: { kind: 'oval', pts: [[-0.09, -0.04], [0.48, -0.14]], rx: 0.085, ry: 0.24, tilt: -0.4 },
  nikolai: { kind: 'oval', pts: [[-0.04, -0.16], [0.33, -0.24]], rx: 0.065, ry: 0.17, tilt: -0.4 },
};
