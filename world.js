// Office layout, cast, routing.
export const W = 1200, H = 780;
export const ROOM = { x: 20, y: 20, w: 1160, h: 740 };
export const SPEED = 82; // world units per second, same pace for every trip

export const BOTS = [
  { id: 'ara', shape: 'ara', name: 'Ara', role: 'Chief of Staff', color: '#ffffff', finish: 'pearl', tier: 'head', R: 33, base: 412300, rate: 36,
    work: ['reviewing handoffs', 'planning the day', 'checking routines', 'prioritizing the queue', 'writing a summary'] },
  { id: 'stan', shape: 'stan', name: 'Stan', role: 'New Job Finder', color: '#00c972', finish: 'candy', tier: 'active', R: 27, base: 286400, rate: 33,
    work: ['scanning job boards', 'scoring a lead', 'reading a posting', 'matching skills', 'checking salary bands'] },
  { id: 'researchy', shape: 'researchy', name: 'Researchy', role: 'Research', color: '#00bca6', finish: 'anodized', tier: 'active', R: 27, base: 351800, rate: 51,
    work: ['reading sources', 'drafting a brief', 'checking citations', 'comparing reports', 'summarizing findings'] },
  { id: 'pete', shape: 'pete', name: 'Pete', role: 'Inbox Manager', color: '#1084fe', finish: 'brushed', tier: 'active', R: 27, base: 198200, rate: 27,
    work: ['sorting the inbox', 'labeling threads', 'drafting replies', 'filing receipts', 'flagging what matters'] },
  { id: 'nikolai', shape: 'nikolai', name: 'Nikolai', role: 'X Assistant', color: '#777777', finish: 'mirror', tier: 'active', R: 27, base: 143600, rate: 22,
    work: ['drafting X posts', 'checking trends', 'queuing drafts for review', 'reading replies', 'tightening a hook'] },
  { id: 'yahn', shape: 'yahn', name: 'Yahn', role: 'YouTube Expert', color: '#ff6700', finish: 'liquid', tier: 'active', R: 27, base: 224900, rate: 40,
    work: ['analyzing retention', 'reviewing a transcript', 'comparing thumbnails', 'testing titles', 'mapping chapters'] },
  { id: 'jeff', shape: 'jeff', name: 'Jeff', role: 'Job Tracker', color: '#1084fe', finish: 'chrome', tier: 'ready', R: 27, base: 96400, rate: 13,
    work: ['updating the tracker', 'logging an application', 'checking deadlines', 'tidying the pipeline'] },
  { id: 'wedding', shape: 'wedding', name: 'Wedding Planner', role: 'Wedding Planner', color: '#9159fe', finish: 'pearl', tier: 'ready', R: 27, base: 41200, rate: 7,
    work: ['updating the timeline', 'checking RSVPs', 'comparing options', 'refreshing the checklist'] },
];
export const BOT = Object.fromEntries(BOTS.map(b => [b.id, b]));

// Aisles: horizontal lanes (y) and vertical lanes (x). Every location's chain ends on a horizontal lane.
export const HL = [96, 408, 718];
export const VL = [300, 715, 1095];

export const CLUSTERS = [{ x: 530, y: 245 }, { x: 900, y: 245 }, { x: 530, y: 570 }, { x: 900, y: 570 }];
export const DW = 104, DH = 56, GAP = 6;

// Seat occupants per cluster (TL, TR, BL, BR). 'ready' = set-up desk awaiting a new bot. null = unused.
const OCC = [
  ['stan', 'jeff', 'researchy', 'READY'],
  ['pete', 'nikolai', 'yahn', 'wedding'],
  ['READY', null, null, null],
  [null, null, null, null],
];

export const DESKS = [];
CLUSTERS.forEach((c, ci) => {
  for (let s = 0; s < 4; s++) {
    const col = s % 2, row = s >> 1;
    const x = c.x + (col ? 1 : -1) * (GAP / 2 + DW / 2);
    const y = c.y + (row ? 1 : -1) * (GAP / 2 + DH / 2);
    const top = row === 0;
    const seat = { x, y: top ? y - DH / 2 - 30 : y + DH / 2 + 30 };
    const lane = top ? (ci < 2 ? HL[0] : HL[1]) : (ci < 2 ? HL[1] : HL[2]);
    const occ = OCC[ci][s];
    DESKS.push({ ci, s, x, y, top, seat, lane, occ: occ === 'READY' ? null : occ, state: occ === 'READY' ? 'ready' : occ ? 'occupied' : 'unused' });
  }
});

export const ARA_DESK = { x: 92, y: 323, w: 122, h: 170 };
export const ARA_SEAT = { x: 58, y: 408 };

// Locations: chain[0] is where the bot stands; last element sits on a horizontal lane.
export function seatLoc(id) {
  if (id === 'ara') return { key: 'seat:ara', chain: [ARA_SEAT, { x: 58, y: 296 }, { x: 252, y: 296 }, { x: 252, y: 408 }] };
  const d = DESKS.find(d => d.occ === id);
  return { key: 'seat:' + id, chain: [d.seat, { x: d.seat.x, y: d.lane }] };
}
export function visitLoc(targetId, off = 0) {
  if (targetId === 'ara') return { key: 'visit:ara', chain: [{ x: 256 + off * .3, y: 404 + off }, { x: 256 + off * .3, y: 408 }] };
  const d = DESKS.find(d => d.occ === targetId);
  const sg = Math.sign(d.seat.y - d.lane), gap = Math.min(30, Math.abs(d.seat.y - d.lane) - 52);
  // stand diagonally on the outer side of the coworker, so the two never overlap
  const side = d.s % 2 === 0 ? -1 : 1;
  const p = { x: d.seat.x + side * 56 + off, y: d.lane + sg * gap };
  return { key: 'visit:' + targetId, chain: [p, { x: p.x, y: d.lane }] };
}
export const SPOTS = {
  door: { key: 'door', chain: [{ x: 1240, y: 408 }, { x: 1166, y: 408 }] },
  tank: { key: 'tank', chain: [{ x: 128, y: 640 }, { x: 128, y: 718 }] },
  window1: { key: 'window1', chain: [{ x: 470, y: 70 }, { x: 470, y: 96 }] },
  window2: { key: 'window2', chain: [{ x: 930, y: 70 }, { x: 930, y: 96 }] },
  window1b: { key: 'window1b', chain: [{ x: 556, y: 72 }, { x: 556, y: 96 }] },
  window2b: { key: 'window2b', chain: [{ x: 848, y: 72 }, { x: 848, y: 96 }] },
  pace1: { key: 'pace1', chain: [{ x: 715, y: 724 }, { x: 715, y: 718 }] },
  pace2: { key: 'pace2', chain: [{ x: 1095, y: 690 }, { x: 1095, y: 718 }] },
  lounge: { key: 'lounge', chain: [{ x: 1104, y: 336 }, { x: 1104, y: 408 }] },
};

function lane2lane(p, q) {
  if (Math.abs(p.y - q.y) < 1) return [q];
  let best = VL[0], bc = Infinity;
  for (const vx of VL) { const c = Math.abs(p.x - vx) + Math.abs(q.x - vx); if (c < bc) { bc = c; best = vx; } }
  return [{ x: best, y: p.y }, { x: best, y: q.y }, q];
}
export function route(from, to) {
  const a = from.chain, b = to.chain;
  const pts = [...a.slice(1)];
  pts.push(...lane2lane(a[a.length - 1], b[b.length - 1]));
  for (let i = b.length - 2; i >= 0; i--) pts.push(b[i]);
  // drop zero-length hops
  const out = [];
  let prev = a[0];
  for (const p of pts) { if (Math.hypot(p.x - prev.x, p.y - prev.y) > .5) { out.push(p); prev = p; } }
  return out;
}
export function routeLen(from, to) {
  let L = 0, prev = from.chain[0];
  for (const p of route(from, to)) { L += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return L;
}

export const PLANTS = [
  { x: 52, y: 54, r: 24, seed: 1 }, { x: 1146, y: 54, r: 26, seed: 2 }, { x: 1146, y: 724, r: 26, seed: 3 },
  { x: 56, y: 536, r: 22, seed: 4 }, { x: 715, y: 50, r: 18, seed: 5 }, { x: 1150, y: 590, r: 20, seed: 6 }, { x: 300, y: 742, r: 15, seed: 7 },
];
export const WINDOWS = [{ x: 392, w: 232 }, { x: 772, w: 232 }];
export const TANK = { x: 28, y: 566, w: 54, h: 150 };
export const DOOR = { y: 374, h: 68 };
export const LOUNGE = { sofa: { x: 1128, y: 132, w: 44, h: 170 }, table: { x: 1070, y: 216, r: 21 }, lamp: { x: 1150, y: 112 } };
