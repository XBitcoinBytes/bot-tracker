// Bot Tracker: four scripted 5-minute loops plus a deterministic office-rhythm scheduler.
// (Drafted with Codex, reviewed and tuned by hand.)
//
// Critique of the previous scheduler:
// - Phase membership was aspirational: core work and long outings could override
//   quiet assignments, while failed filler attempts left unmeasured dead periods.
// - Random-comparator sorting biased rotation; scheduled visits were not the same
//   as actual time away. Ara outings and phone checks did not share all guards.
// - Door trips lacked a resource lock, and busy calendars did not prevent two
//   walking routes crossing. Desk stretches reserved a different duration to playback.
// - Late deliveries could be silently omitted; the final return-home cutoff drained
//   the room just before a hard cut that does not require everyone to be seated.
//
// This version retains all core messages and event shapes, balances measured away
// coverage, reserves listeners and desk gestures, locks destinations, and checks
// continuous trajectories. Filler may extend beyond 300 because replay hard-cuts;
// deliveries finish within the loop. The built-in four loops have >=2 away at every
// instant and >=2 unengaged desk workers. Arbitrary new cores may be infeasible:
// buildLoop throws instead of silently discarding required work.
// Existing docking geometry limits strict silhouette clearance (see safeWalk).
import { BOTS, SPEED, seatLoc, visitLoc, SPOTS, route, routeLen } from './world.js';

export const LOOP_LEN = 300;

const d = (t, from, to, ph, tok) => ({ k: 'd', t, from, to, ph, tok });
const h = t => ({ k: 'h', t });
const e = (t, who, text) => ({ k: 'e', t, who, text });

export const LOOPS = [
  { name: 'Heartbeat check-in', seed: 1311, core: [
    h(3), d(6, 'stan', 'ara', 'reports 6 new leads', 2400), d(12, 'pete', 'ara', 'confirms inbox clear', 1800),
    d(19, 'researchy', 'ara', 'shares brief status', 2100), d(27, 'yahn', 'ara', 'sends video notes', 2600),
    d(35, 'nikolai', 'ara', 'queues 3 X drafts', 1900), d(62, 'ara', 'stan', 'approves the shortlist', 1200),
    e(78, 'stan', 'Ara: job board fetch failed, Stan retries'), d(96, 'jeff', 'stan', 'asks for posting links', 900),
    d(112, 'stan', 'jeff', 'hands off 4 job leads', 3100), d(140, 'ara', 'researchy', 'requests a company brief', 1400),
    d(170, 'researchy', 'stan', 'delivers a company brief', 5200), d(196, 'wedding', 'ara', 'shares a timeline update', 1100),
    d(222, 'pete', 'wedding', 'routes an RSVP update', 800), h(240), d(244, 'jeff', 'ara', 'reports pipeline status', 1300),
    d(252, 'researchy', 'ara', 'reports status', 1500), d(262, 'yahn', 'ara', 'reports status', 1400), d(276, 'ara', 'nikolai', 'returns draft edits', 1000),
  ] },
  { name: 'Job lead surge', seed: 2711, core: [
    d(4, 'stan', 'jeff', 'hands off 3 job leads', 2900), d(18, 'jeff', 'ara', 'updates the pipeline', 1300),
    d(30, 'stan', 'researchy', 'requests a company brief', 1100), e(52, 'jeff', 'Jeff: tracker write failed, retries'),
    d(70, 'researchy', 'stan', 'delivers a company brief', 5600), d(92, 'stan', 'ara', 'flags a priority role', 1700),
    d(116, 'ara', 'stan', 'approves the shortlist', 1200), d(132, 'pete', 'jeff', 'forwards a recruiter reply', 900), h(150),
    d(162, 'nikolai', 'yahn', 'asks for clip ideas', 800), d(186, 'yahn', 'nikolai', 'shares 3 clip ideas', 2300),
    d(206, 'stan', 'jeff', 'hands off 2 job leads', 2200), d(230, 'jeff', 'stan', 'confirms leads logged', 700),
    d(254, 'researchy', 'ara', 'shares salary research', 4100), d(279, 'ara', 'jeff', 'sets follow-up dates', 1000),
  ] },
  { name: 'Inbox & X drafts', seed: 4127, core: [
    h(5), d(9, 'pete', 'ara', 'triages 38 emails', 3300), d(30, 'nikolai', 'ara', 'queues 3 X drafts', 1900),
    d(48, 'pete', 'ara', 'flags 2 for review', 1200), d(70, 'ara', 'nikolai', 'returns draft edits', 1100),
    e(90, 'pete', 'Pete: inbox sync timed out, retrying'), d(106, 'yahn', 'nikolai', 'suggests a post hook', 1300),
    d(130, 'nikolai', 'ara', 'sends drafts for approval', 1600), d(150, 'pete', 'wedding', 'routes a venue reply', 900),
    d(176, 'wedding', 'ara', 'updates the checklist', 1000), d(200, 'researchy', 'nikolai', 'shares trend data', 2700),
    d(226, 'ara', 'pete', 'asks for a digest', 700), d(250, 'pete', 'ara', 'delivers the inbox digest', 2800),
    d(276, 'stan', 'ara', 'reports 2 new leads', 1500),
  ] },
  { name: 'Research & YouTube', seed: 6553, core: [
    d(5, 'ara', 'researchy', 'requests a market scan', 1300), d(20, 'yahn', 'ara', 'sends retention analysis', 3800),
    d(40, 'researchy', 'yahn', 'shares topic data', 3100), e(62, 'yahn', 'Yahn: transcript fetch failed, retries'),
    d(80, 'yahn', 'nikolai', 'suggests a post hook', 1200), h(100), d(110, 'researchy', 'ara', 'delivers a research brief', 6200),
    d(136, 'ara', 'yahn', 'approves title tests', 900), d(160, 'stan', 'researchy', 'asks for a company brief', 1000),
    d(190, 'researchy', 'stan', 'delivers a company brief', 5100), d(214, 'jeff', 'ara', 'updates the pipeline', 1200),
    d(240, 'yahn', 'ara', 'reports channel stats', 2400), d(264, 'nikolai', 'ara', 'queues a thread draft', 1500),
    d(284, 'pete', 'ara', 'confirms inbox clear', 1100),
  ] },
];

// Scheduling uses half-open intervals throughout. Times are seconds, never frames.
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ s >>> 15, s | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const IDS = BOTS.map(b => b.id);
const HOLD = 2.8;
const PAD = .35;
const walkT = (a, b) => routeLen(a, b) / SPEED;
const actor = e => e.from || e.who;
const isTrip = e => ['d', 'v', 's', 'x'].includes(e.k);
const duration = e => e.k === 'd' ? e.dur : e.total ?? (isTrip(e) ? 2 * e.w + e.dur : e.dur || 0);

/** Number of distinct bots away at t=0,1,...,299. Desk stretches and phone
 * checks do not count; walking, visits, and offsite breaks do. An event spanning
 * the hard cut is clipped to this loop, and overlapping events cannot double count. */
export function analyzeLoop(events) {
  return Array.from({ length: LOOP_LEN }, (_, t) => new Set(events
    .filter(e => isTrip(e) && e.t <= t && t < e.t + duration(e))
    .map(actor)).size);
}

// Piecewise linear trajectories permit continuous collision checks, including
// head-on walks and crossings between integer samples. Holds count as stationary.
function trajectory(e) {
  const home = seatLoc(actor(e));
  const dest = e.k === 'd' || e.k === 'v' ? visitLoc(e.to) : SPOTS[e.k === 'x' ? 'door' : e.spot];
  const segments = [];
  let t = e.t, p = home.chain[0];
  function walk(a, b) {
    for (const q of route(a, b)) {
      const end = t + Math.hypot(q.x - p.x, q.y - p.y) / SPEED;
      segments.push({ a: t, b: end, p, q }); t = end; p = q;
    }
  }
  walk(home, dest);
  const hold = e.k === 'd' ? HOLD : e.dur;
  segments.push({ a: t, b: t + hold, p, q: p }); t += hold;
  walk(dest, home);
  return segments;
}
function at(s, t) {
  const u = s.b === s.a ? 0 : (t - s.a) / (s.b - s.a);
  return { x: s.p.x + (s.q.x - s.p.x) * u, y: s.p.y + (s.q.y - s.p.y) * u };
}
function collides(a, b, clearance) {
  const lo = Math.max(a.a, b.a), hi = Math.min(a.b, b.b);
  if (hi <= lo) return false;
  const p = at(a, lo), q = at(b, lo), r = at(a, hi), s = at(b, hi);
  const x = p.x - q.x, y = p.y - q.y;
  const dx = r.x - s.x - x, dy = r.y - s.y - y;
  const u = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x + u * dx, y + u * dy) < clearance;
}

export function buildLoop(def) {
  const rnd = rngFrom(def.seed);
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const events = [], reservations = new Map(), trips = new Map(IDS.map(id => [id, []]));
  const engaged = []; // Includes listeners, so at least two bots remain quietly working.
  const away = new Map(IDS.map(id => [id, 0]));
  const restBias = new Map(IDS.map(id => [id, -30 - rnd() * 10]));
  const lastReturn = (id, t) => Math.max(restBias.get(id), ...trips.get(id).filter(x => x.end <= t).map(x => x.end));
  const free = (key, a, b) => (reservations.get(key) || []).every(([s, e]) => b <= s || a >= e);
  const take = (key, a, b) => {
    if (!reservations.has(key)) reservations.set(key, []);
    reservations.get(key).push([a, b]);
  };
  function occupancy(e) {
    const end = e.t + duration(e), id = actor(e);
    if (e.k === 'h') return [{ id: 'ara', a: e.t, b: e.t + 3 }];
    if (e.k === 'e') return [];
    const out = [{ id, a: e.t, b: end }];
    if (e.k === 'd' || e.k === 'v') {
      const w = e.walk ?? e.w;
      out.push({ id: e.to, a: e.t + w - PAD, b: e.t + w + (e.k === 'd' ? HOLD : e.dur) + PAD });
    }
    return out;
  }
  function capacity(extra) {
    const all = [...engaged, ...extra];
    const edges = all.flatMap(x => [[x.a, 1], [x.b, -1]]).sort((a,b) => a[0] - b[0] || a[1] - b[1]);
    let count = 0;
    for (const [, delta] of edges) { count += delta; if (count > IDS.length - 2) return false; }
    return true;
  }
  function safeWalk(e, path) {
    const id = actor(e), end = e.t + duration(e);
    for (const other of IDS) {
      if (other === id) continue;
      // Existing visitLoc puts Ara only 46 units from some seated bots.
      // Cap clearance at that existing docking distance; elsewhere use body radii.
      const radius = Math.min(BOTS.find(b => b.id === id).R + BOTS.find(b => b.id === other).R + 1, 46) - 1e-6;
      const home = seatLoc(other).chain[0];
      const relevant = trips.get(other).filter(x => x.end > e.t && x.start < end).sort((a,b) => a.start - b.start);
      let cursor = e.t;
      for (const x of relevant) {
        if (x.start > cursor && path.some(s => collides(s, { a: cursor, b: x.start, p: home, q: home }, radius))) return false;
        for (const a of path) for (const b of x.path) if (collides(a, b, radius)) return false;
        cursor = Math.max(cursor, x.end);
      }
      if (cursor < end && path.some(s => collides(s, { a: cursor, b: end, p: home, q: home }, radius))) return false;
    }
    return true;
  }
  function place(e) {
    const spans = occupancy(e);
    if (!spans.every(x => free(x.id, x.a - PAD, x.b + PAD)) || !capacity(spans)) return false;
    const trip = isTrip(e), end = e.t + duration(e);
    // Reserve the whole excursion's destination: deliberately generous clearance
    // for doorway traffic, and a single visitor slot per coworker's desk.
    const spot = trip ? (e.to ? 'visit:' + e.to : e.k === 'x' ? 'door' : e.spot) : null;
    if (spot && !free('spot:' + spot, e.t - PAD, end + PAD)) return false;
    const path = trip ? trajectory(e) : null;
    if (trip && !safeWalk(e, path)) return false;
    for (const x of spans) take(x.id, x.a - PAD, x.b + PAD);
    if (spot) take('spot:' + spot, e.t - PAD, end + PAD);
    engaged.push(...spans);
    events.push(e);
    if (trip) {
      const id = actor(e);
      trips.get(id).push({ start: e.t, end, path });
      away.set(id, away.get(id) + Math.min(LOOP_LEN, end) - Math.max(0, e.t));
    }
    return true;
  }

  // Reserve announcements first. Deliveries may move earlier as well as later,
  // so even the final long walk can finish. Missing core work is an explicit error.
  for (const c of def.core.filter(c => c.k !== 'd')) {
    if (!place({ ...c })) throw new Error('Cannot reserve core event at ' + c.t);
  }
  for (const c of def.core.filter(c => c.k === 'd')) {
    const walk = walkT(seatLoc(c.from), visitLoc(c.to));
    const dur = 2 * walk + HOLD;
    const latest = LOOP_LEN - dur - PAD;
    const preferred = Math.min(c.t, latest);
    let placed = false;
    for (let offset = 0; offset <= LOOP_LEN * 2 && !placed; offset++) {
      const shift = Math.ceil(offset / 2) * .5 * (offset % 2 ? 1 : -1);
      const t = preferred + shift;
      if (t >= 0 && t <= latest) placed = place({ ...c, t, walk, dur });
    }
    if (!placed) throw new Error('Cannot schedule delivery: ' + c.from + ' → ' + c.to);
  }

  function makeTrip(id, t, mode) {
    const seat = seatLoc(id);
    if (mode === 'v') {
      const to = pick(IDS.filter(x => x !== id));
      const w = walkT(seat, visitLoc(to)), dur = 5 + rnd() * 5;
      return { k: 'v', from: id, to, t, w, dur, total: 2 * w + dur };
    }
    if (mode === 'x') {
      const why = pick(['bathroom', 'coffee', 'lunch']);
      // Only one lunch per loop; keep most of the team visibly in the room.
      if (events.some(e => e.k === 'x' && (e.t + e.total > t || why === 'lunch' && e.why === 'lunch'))) return null;
      if (why === 'lunch' && (t < 55 || t > 200)) return null;
      const w = walkT(seat, SPOTS.door), dur = why === 'lunch' ? 36 + rnd() * 8 : 10 + rnd() * 8;
      return { k: 'x', who: id, t, why, spot: null, w, dur, total: 2 * w + dur };
    }
    const spot = mode === 'tank' ? 'tank' : mode === 'call' ? pick(['pace1', 'pace2', 'lounge']) : pick(['window1', 'window1b', 'window2', 'window2b']);
    const w = walkT(seat, SPOTS[spot]), dur = 7 + rnd() * 9;
    return { k: 's', who: id, t, act: mode, spot, w, dur, total: 2 * w + dur };
  }
  function awayAt(t) {
    return IDS.filter(id => trips.get(id).some(x => x.start <= t && t < x.end)).length;
  }
  // Overlapping, staggered waves replace synchronized phases. The target ebbs
  // between three and four away; six engaged is a hard ceiling, never a target.
  // Quiet workers rotate according to actual time away and time since returning.
  function nextTick(t) {
    // Refill exactly at returns, not only on the half-second grid: even a short
    // gap between grid samples can make the room feel as if everyone sat down.
    const returns = [...trips.values()].flat().map(x => x.end).filter(end => end > t + 1e-6);
    return Math.min(t + .5, ...returns);
  }
  for (let t = 0; t < LOOP_LEN; t = nextTick(t)) {
    const target = Math.sin(t / 23 + (def.seed % 7)) > .25 ? 4 : 3;
    if (awayAt(t) >= target) continue;
    // Ara (chief of staff) mostly holds the head desk: she wanders far less often.
    const ranked = IDS.map(id => ({ id, rank: away.get(id) * (id === 'ara' ? 3 : 1) + (id === 'ara' ? 25 : 0) + Math.max(0, lastReturn(id, t) + 8 - t) * 12 + rnd() * 12 }))
      .sort((a,b) => a.rank - b.rank);
    for (const { id } of ranked) {
      if (lastReturn(id, t) > t - 5 || !free(id, t - PAD, t + 5)) continue;
      let ok = false;
      // Weighted toward coworker chats (Shaun: bots talking to each other), then window/tank.
      const first = pick(['v', 'v', 'v', 'window', 'window', 'tank', 'tank', 'call', 'x']);
      const modes = [first, 'v', 'v', 'window', 'tank', 'call'];
      for (const mode of modes) {
        const item = makeTrip(id, t, mode);
        if (item && place(item)) { ok = true; break; }
      }
      if (ok && awayAt(t) >= target) break;
    }
  }
  // Small, reserved desk gestures complement quiet work without pretending to
  // contribute to away coverage. Their real durations are also their totals.
  for (let t = 8; t < LOOP_LEN - 8; t += 9 + rnd() * 6) {
    const who = pick(IDS), dur = 3 + rnd() * 3;
    place(rnd() < .5 ? { k: 'p', who, t, dur } : { k: 'st', who, t, dur, w: 0, total: dur });
  }
  return events.sort((a,b) => a.t - b.t);
}
