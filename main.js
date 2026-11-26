import { W, H, ROOM, SPEED, BOTS, BOT, DESKS, CLUSTERS, DW, DH, GAP, ARA_DESK, ARA_SEAT, seatLoc, visitLoc, SPOTS, route, PLANTS, WINDOWS, TANK, DOOR, HL, LOUNGE, COFFEE } from './world.js';
import { LOOPS, LOOP_LEN, buildLoop } from './script.js';
import { drawEyes, bodySprite, rgba, mix, pathFor } from './avatar.js';

/* ------------------------------------------------------------------ setup */
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let dpr = 1, scale = 1, ox = 0, oy = 0, boost = 1, staticLayer = null, cw = 0, ch = 0;

const rnd = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ bots runtime */
const LOOPS_BUILT = LOOPS.map(buildLoop);
const bots = BOTS.map(b => ({
  ...b, x: 0, y: 0, loc: null, tasks: [], path: null, pathI: 0, mode: 'desk',
  hidden: false, carry: null, plaque: null, err: null, phoneUntil: 0, look: null,
  gx: 0, gy: 0, gtx: 0, gty: 0, nextGlance: 0, blinkAt: 1 + rnd() * 4, blink: 0,
  jx: 0, jy: 0, jtx: 0, jty: 0, nextShift: 0, tilt: 0, ttilt: 0, bob: 0, walkPhase: rnd() * 6,
  tokens: b.base, sent: 0, act: 30, actT: 30, status: '', trail: [], react: 0, workIdx: 0,
}));
const B = Object.fromEntries(bots.map(b => [b.id, b]));
const deskOf = id => DESKS.find(d => d.occ === id);

// Desk screens change on their own (bots "change screens").
const screens = DESKS.map(d => ({ kind: 0, next: rnd() * 4, seed: rnd() * 1000, flash: 0 }));
const araScreens = { kind: 0, next: 2, seed: 7, flash: 0 };

let booted = false;
let simT = 0;           // seconds since page load (never resets)
let loopT = 0;          // seconds into current loop
let loopIdx = 0, loopCount = 1, events = [], evI = 0;
let rings = [];         // pulses on the floor
let feed = [], incidents = [], msgLog = [];
// Rolling 60 s token telemetry in 1 s buckets (ring buffer), kept in simulation time.
const TOK_BUCKETS = new Float64Array(60); let tokBucketSec = 0, tokRolling = 0;
function addTokens(n) {
  const sec = Math.floor(simT);
  while (tokBucketSec < sec) { tokBucketSec++; const i = tokBucketSec % 60; tokRolling -= TOK_BUCKETS[i]; TOK_BUCKETS[i] = 0; }
  TOK_BUCKETS[sec % 60] += n; tokRolling += n;
}

function resetLoop(idx) {
  loopIdx = idx; events = LOOPS_BUILT[idx]; evI = 0; loopT = 0;
  for (const b of bots) {
    const L = seatLoc(b.id);
    b.loc = L; b.x = L.chain[0].x; b.y = L.chain[0].y;
    b.tasks = []; b.path = null; b.mode = 'desk'; b.hidden = false; b.carry = null; b.plaque = null; b.err = null;
    b.phoneUntil = 0; b.look = null; b.trail = []; b.react = 0;
    b.chatWith = null; b.lingerAct = null; b.lingerStatus = null; b.status = ''; b.vx = 0; b.vy = 0; b.dest = null; b.until = 0;
    b.ambient = null;
  }
  rings = [];
  lastAmbientStart = -99;
  for (const b of bots) b.nextAmbient = firstAmbientAt(b);
  feed = []; incidents = [];
  if (booted) { renderFeed(); renderIncidents(); }
}
function nextLoop() {
  // 25% chance the same loop plays again; otherwise one of the other three. Hard cut, no fade.
  const idx = rnd() < .25 ? loopIdx : [0, 1, 2, 3].filter(i => i !== loopIdx)[Math.floor(rnd() * 3)];
  loopCount++;
  resetLoop(idx);
}

function plan(b, tasks) { b.tasks.push(...tasks); }
function startWalk(b, to) {
  b.path = route(b.loc, to); b.pathI = 0; b.dest = to; b.mode = 'walk';
}

function fire(e) {
  switch (e.k) {
    case 'd': {
      const b = B[e.from];
      plan(b, [
        { type: 'walk', to: visitLoc(e.to), status: `Delivering to ${BOT[e.to].name}`, carry: e.ph },
        { type: 'deliver', dur: 2.8, to: e.to, ph: e.ph, tok: e.tok },
        { type: 'walk', to: seatLoc(e.from), status: 'Heading back to desk' },
      ]);
      break;
    }
    case 'v': {
      const b = B[e.from];
      plan(b, [
        { type: 'walk', to: visitLoc(e.to), status: `Walking to ${BOT[e.to].name}` },
        { type: 'chat', dur: e.dur, with: e.to },
        { type: 'walk', to: seatLoc(e.from), status: 'Heading back to desk' },
      ]);
      break;
    }
    case 's': {
      const b = B[e.who];
      const label = e.status || { window: 'Looking out the window', tank: 'Watching the fish tank', call: 'Taking a quick call', coffee: 'At the coffee station' }[e.act];
      plan(b, [
        { type: 'walk', to: SPOTS[e.spot], status: { window: 'Stretching their legs', tank: 'Wandering to the fish tank', call: 'Stepping away for a call', coffee: 'Walking to the coffee station' }[e.act] },
        { type: 'linger', dur: e.dur, act: e.act, status: label },
        { type: 'walk', to: seatLoc(e.who), status: 'Heading back to desk' },
      ]);
      break;
    }
    case 'x': {
      const b = B[e.who];
      const label = { lunch: 'Out · lunch', bathroom: 'Out · quick break', coffee: 'Out · coffee run' }[e.why];
      plan(b, [
        { type: 'walk', to: SPOTS.door, status: { lunch: 'Heading out to lunch', bathroom: 'Stepping out', coffee: 'Grabbing a coffee' }[e.why] },
        { type: 'away', dur: e.dur, status: label },
        { type: 'walk', to: seatLoc(e.who), status: 'Back, heading to desk' },
      ]);
      break;
    }
    case 'st': plan(B[e.who], [{ type: 'stretch', dur: e.dur }]); break;
    case 'p': { const b = B[e.who]; if (b.mode === 'desk' && !b.tasks.length) b.phoneUntil = simT + e.dur; break; }
    case 'h': {
      rings.push({ x: ARA_SEAT.x + 20, y: ARA_SEAT.y, t: simT, color: '#ffffff', big: true });
      for (const b of bots) if (b.id !== 'ara') { b.look = { x: ARA_SEAT.x, y: ARA_SEAT.y, until: simT + 1.8 }; }
      B.ara.react = 1;
      addFeed('ara', null, 'runs a heartbeat check-in');
      break;
    }
    case 'e': {
      const b = B[e.who];
      b.err = { text: 'fetch failed · retrying', until: simT + 5 };
      const inc = { text: e.text, t: simT, ok: false, resolveAt: simT + 6.5 };
      incidents.unshift(inc); incidents = incidents.slice(0, 3);
      if (booted) renderIncidents();
      break;
    }
  }
}

function addFeed(from, to, ph) {
  feed.unshift({ from, to, ph, clock: fmtClock(loopT) });
  feed = feed.slice(0, 7);
  renderFeed();
}

function updateBot(b, dt) {
  // task processing
  if (b.mode === 'desk' || b.mode === 'idle-spot') {
    const t = b.tasks[0];
    if (t) {
      if (t.type === 'walk') { startWalk(b, t.to); b.status = t.status; b.carry = t.carry || null; }
      else if (t.type === 'stretch') { b.mode = 'stretch'; b.until = simT + t.dur; b.status = 'Stretching'; b.tasks.shift(); }
    }
  }
  if (b.mode === 'walk') {
    let budget = SPEED * dt;
    while (budget > 0 && b.pathI < b.path.length) {
      const target = b.path[b.pathI];
      const dx = target.x - b.x, dy = target.y - b.y, dist = Math.hypot(dx, dy);
      if (dist > 1e-6) { b.vx = dx / dist; b.vy = dy / dist; }
      if (dist <= budget) { b.x = target.x; b.y = target.y; b.pathI++; budget -= dist; }
      else { b.x += dx / dist * budget; b.y += dy / dist * budget; budget = 0; }
    }
    if (b.pathI >= b.path.length) arrive(b);
    else {
      b.walkPhase += dt * 9;
      if (!b.trail.length || Math.hypot(b.trail[0].x - b.x, b.trail[0].y - b.y) > 9) b.trail.unshift({ x: b.x, y: b.y, t: simT });
      b.hidden = b.x > ROOM.x + ROOM.w + 8;
    }
  } else if (b.mode === 'hold') {
    if (simT >= b.until) {
      const t = b.tasks.shift();
      if (t && t.type === 'deliver') b.carry = null;
      if (b.chatWith) {
        const other = B[b.chatWith.id];
        if (other && other.chatWith && other.chatWith.id === b.id) {
          other.chatWith = null;
          if (other.lingerAct === 'coffee' && other.mode === 'hold') {
            other.status = other.lingerStatus || 'At the coffee station';
            other.look = { x: COFFEE.x + COFFEE.w / 2, y: other.y, until: other.until };
          }
        }
        b.chatWith = null;
      }
      b.mode = 'idle-spot'; b.look = null; b.lingerAct = null; b.lingerStatus = null;
      if (!b.tasks.length) b.mode = 'desk';
    }
  } else if (b.mode === 'stretch') {
    if (simT >= b.until) b.mode = 'desk';
  }
  b.trail = b.trail.filter(p => simT - p.t < 1.4);
}

function arrive(b) {
  b.loc = b.dest; b.path = null;
  b.tasks.shift(); // the walk
  const t = b.tasks[0];
  b.vx = 0; b.vy = 0;
  if (!t) { b.mode = 'desk'; b.hidden = false; b.status = ''; return; }
  if (t.type === 'deliver') {
    const r = B[t.to];
    b.mode = 'hold'; b.until = simT + t.dur;
    b.look = { x: r.x, y: r.y, until: b.until };
    r.look = { x: b.x, y: b.y, until: simT + t.dur }; r.react = 1;
    rings.push({ x: r.x, y: r.y, t: simT, color: b.color });
    b.tokens += t.tok; r.tokens += Math.round(t.tok * .35);
    addTokens(t.tok * 1.35);
    b.sent++; msgLog.push(simT);
    b.status = `Delivering to ${BOT[t.to].name}`;
    addFeed(b.id, t.to, t.ph);
  } else if (t.type === 'chat') {
    const r = B[t.with];
    b.mode = 'hold'; b.until = simT + t.dur; b.status = `Chatting with ${r.name}`;
    b.look = { x: r.x, y: r.y, until: b.until }; r.look = { x: b.x, y: b.y, until: b.until };
    r.chatWith = { id: b.id, until: b.until };
  } else if (t.type === 'linger') {
    b.mode = 'hold'; b.until = simT + t.dur; b.status = t.status;
    b.lingerAct = t.act; b.lingerStatus = t.status;
    const L = b.loc.chain[0];
    if (t.act === 'tank') b.look = { x: TANK.x, y: L.y, until: b.until };
    else if (t.act === 'window') b.look = { x: L.x + (rnd() - .5) * 60, y: 0, until: b.until };
    else if (t.act === 'coffee') {
      const other = bots.find(o => o.id !== b.id && o.lingerAct === 'coffee' && o.mode === 'hold' && o.until > simT);
      if (other) {
        const until = Math.min(other.until, b.until);
        b.status = `Chatting with ${other.name}`;
        other.status = `Chatting with ${b.name}`;
        b.look = { x: other.x, y: other.y, until };
        other.look = { x: b.x, y: b.y, until };
        b.chatWith = { id: other.id, until };
        other.chatWith = { id: b.id, until };
      } else {
        b.look = { x: COFFEE.x + COFFEE.w / 2, y: L.y, until: b.until };
      }
    }
    else b.look = null;
    if (t.act === 'call') b.phoneUntil = b.until;
  } else if (t.type === 'away') {
    b.mode = 'hold'; b.until = simT + t.dur; b.status = t.status; b.hidden = true;
  } else { b.mode = 'desk'; }
}

/* ------------------------------------------------------------------ micro-motion: eyes, blinks, shifts */
function updateLife(b, dt) {
  // glance targets
  if (b.look && b.look.until > simT) {
    const dx = b.look.x - b.x, dy = b.look.y - b.y, L = Math.hypot(dx, dy) || 1;
    b.gtx = dx / L * .1; b.gty = dy / L * .08;
  } else if (b.mode === 'walk' && (b.vx || b.vy)) {
    b.gtx = b.vx * .1; b.gty = b.vy * .08;
  } else if (simT > b.nextGlance) {
    const r = rnd();
    if (r < .3) { b.gtx = 0; b.gty = 0; }
    else if (r < .55) { b.gtx = (rnd() - .5) * .2; b.gty = .06; }   // down at the desk
    else if (r < .7) { b.gtx = (rnd() - .5) * .1; b.gty = -.08; }   // up
    else { b.gtx = (rnd() < .5 ? -1 : 1) * (.07 + rnd() * .05); b.gty = (rnd() - .5) * .06; } // sideways
    b.nextGlance = simT + .7 + rnd() * 2.6;
  }
  const k = 1 - Math.exp(-dt * 14);
  b.gx += (b.gtx - b.gx) * k; b.gy += (b.gty - b.gy) * k;
  // blink
  if (simT > b.blinkAt) { b.blinkStart = simT; b.blinkAt = simT + 2.2 + rnd() * 4.5 + (rnd() < .15 ? -1.8 : 0); }
  const bt = simT - (b.blinkStart || -9);
  b.blink = bt < .16 ? Math.sin(bt / .16 * Math.PI) : 0;
  // small shifts at desk
  if (b.mode === 'desk' && simT > b.nextShift) {
    b.jtx = (rnd() - .5) * 7; b.jty = (rnd() - .5) * 4; b.ttilt = (rnd() - .5) * .12;
    b.nextShift = simT + 1.5 + rnd() * 4;
  } else if (b.mode !== 'desk') { b.jtx = 0; b.jty = 0; b.ttilt = 0; }
  const ks = 1 - Math.exp(-dt * 3.2);
  b.jx += (b.jtx - b.jx) * ks; b.jy += (b.jty - b.jy) * ks; b.tilt += (b.ttilt - b.tilt) * ks;
  b.react = Math.max(0, b.react - dt * 1.6);
  // activity gauge (current activity only)
  let a;
  if (b.mode === 'walk') a = b.carry ? 92 : 64;
  else if (b.mode === 'hold') a = b.hidden ? 0 : b.carry ? 97 : b.status.startsWith('Chatting') ? 58 : b.lingerAct === 'call' ? 40 : 16;
  else if (b.mode === 'stretch') a = 22;
  else if (b.phoneUntil > simT) a = 28;
  else {
    const base = b.tier === 'ready' ? 34 : b.tier === 'head' ? 66 : 58;
    a = base + Math.sin(simT * .7 + b.R * 3 + b.workIdx) * 12 + (b.workIdx % 3) * 6;
  }
  if (b.chatWith && b.chatWith.until > simT) a = Math.max(a, 55);
  b.actT = a; b.act += (b.actT - b.act) * (1 - Math.exp(-dt * 2.5));
  // tokens burn while working
  const rate = b.mode === 'desk' ? b.rate : b.mode === 'hold' && b.hidden ? 0 : b.rate * .25;
  const dtok = rate * dt * (b.act / 60);
  b.tokens += dtok; addTokens(dtok);
  if (b.mode === 'desk' && !b.tasks.length) {
    const d = b.id === 'ara' ? araScreens : screens[DESKS.indexOf(deskOf(b.id))];
    b.workIdx = d.kind;
    b.status = b.phoneUntil > simT ? 'Checking phone' : (b.chatWith && b.chatWith.until > simT) ? `Chatting with ${BOT[b.chatWith.id].name}` : cap(b.work[d.kind % b.work.length]);
  }
}
const cap = s => s[0].toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ ambient thought bubbles
   Task-assignment (carry) and error plaques are unchanged and always win.
   Ambient bubbles fill the quiet stretches between deliveries.
   Timings (seconds of simulation time):
     duration           2.3   (reduced-motion: 2.8)
     min gap, any two   1.15  (reduced-motion: 2.2)
     max concurrent     2 plaques in the room, including carry/error (RM: 1 ambient)
     neighbor radius    200 world units — skip if a nearby bot already has a plaque
     per-bot cooldown   7.5–15.5 after a bubble ends (RM: 14–24)
     first fire         0.8 + 1.2×room-region + 0–1.1 jitter, so areas stagger
*/
const AMBIENT_DUR = reducedMotion ? 2.8 : 2.3;
const AMBIENT_GAP = reducedMotion ? 2.2 : 1.15;
const AMBIENT_MAX = reducedMotion ? 1 : 2;
const AMBIENT_NEAR = 200;
const AMBIENT_BOT_MIN = reducedMotion ? 14 : 7.5;
const AMBIENT_BOT_SPAN = reducedMotion ? 10 : 8;
let lastAmbientStart = -99;

function ambientRegion(b) {
  if (b.x < 320) return 0; // Ara / west wall
  const col = b.x < 750 ? 0 : 1;
  const row = b.y < 400 ? 0 : 1;
  return 1 + row * 2 + col;
}
function firstAmbientAt(b) {
  return 0.8 + ambientRegion(b) * 1.2 + rnd() * 1.1;
}
function showingPlaque(b) {
  return !!(b.carry || (b.err && b.err.until > simT) || (b.ambient && b.ambient.until > simT));
}
function plaqueCount() { return bots.reduce((n, b) => n + (showingPlaque(b) ? 1 : 0), 0); }
function neighborHasPlaque(b) {
  return bots.some(o => o !== b && showingPlaque(o) && Math.hypot(o.x - b.x, o.y - b.y) < AMBIENT_NEAR);
}
function ambientLines(b) {
  return b.thoughts && b.thoughts.length ? b.work.concat(b.thoughts) : b.work;
}
function updateAmbient() {
  for (const b of bots) {
    if (b.ambient && b.ambient.until <= simT) b.ambient = null;
    // Task and error plaques always take the slot.
    if (b.carry || (b.err && b.err.until > simT)) {
      b.ambient = null;
      if (b.nextAmbient < simT + 1) b.nextAmbient = simT + 1 + rnd();
    }
  }
  for (const b of bots) {
    if (b.hidden || b.carry || (b.err && b.err.until > simT) || (b.ambient && b.ambient.until > simT)) continue;
    if (simT < b.nextAmbient) continue;
    if (simT - lastAmbientStart < AMBIENT_GAP) {
      b.nextAmbient = lastAmbientStart + AMBIENT_GAP + rnd() * .4;
      continue;
    }
    if (plaqueCount() >= AMBIENT_MAX) {
      b.nextAmbient = simT + .5 + rnd() * .8;
      continue;
    }
    if (neighborHasPlaque(b)) {
      b.nextAmbient = simT + .8 + rnd() * 1.2;
      continue;
    }
    const lines = ambientLines(b);
    let text = lines[Math.floor(rnd() * lines.length)];
    if (b.ambientLast && lines.length > 1) {
      let guard = 0;
      while (text === b.ambientLast && guard++ < 8) text = lines[Math.floor(rnd() * lines.length)];
    }
    b.ambient = { text: cap(text), until: simT + AMBIENT_DUR };
    b.ambientLast = text;
    lastAmbientStart = simT;
    b.nextAmbient = simT + AMBIENT_DUR + AMBIENT_BOT_MIN + rnd() * AMBIENT_BOT_SPAN;
  }
}

/* ------------------------------------------------------------------ layout */
let lastSizeKey = '';
function resize() {
  const r = canvas.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return false;
  const MAX_PIXELS = 4.2e6;
  dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (r.width * r.height)));
  const key = `${Math.round(r.width)}x${Math.round(r.height)}@${dpr.toFixed(2)}`;
  if (key === lastSizeKey && staticLayer) return true;
  lastSizeKey = key;
  cw = r.width; ch = r.height;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const pad = cw < 600 ? 4 : 28;
  scale = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H);
  ox = (cw - W * scale) / 2; oy = (ch - H * scale) / 2;
  boost = scale < .62 ? Math.min(1.45, .62 / scale) : 1;
  staticLayer = buildStatic();
  screenCache.clear();
  return true;
}
let resizeQueued = false;
function queueResize() { if (resizeQueued) return; resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; resize(); }); }

/* ------------------------------------------------------------------ static room */
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

function buildStatic() {
  const cv = document.createElement('canvas');
  cv.width = canvas.width; cv.height = canvas.height;
  const c = cv.getContext('2d');
  c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);

  // outer drop shadow of the whole floor plate
  c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 60 * scale * dpr; c.shadowOffsetY = 20 * scale * dpr;
  rr(c, 4, 4, W - 8, H - 8, 22); c.fillStyle = '#16171a'; c.fill(); c.restore();

  // floor
  c.save(); rr(c, ROOM.x, ROOM.y, ROOM.w, ROOM.h, 10); c.clip();
  const fg = c.createLinearGradient(0, 0, W, H);
  fg.addColorStop(0, '#1f2024'); fg.addColorStop(1, '#1a1b1f');
  c.fillStyle = fg; c.fillRect(0, 0, W, H);
  // low-opacity checkerboard carpet
  const S = 30;
  c.fillStyle = 'rgba(255,255,255,.026)';
  for (let y = ROOM.y; y < ROOM.y + ROOM.h; y += S) for (let x = ROOM.x; x < ROOM.x + ROOM.w; x += S)
    if (((x - ROOM.x) / S + (y - ROOM.y) / S) % 2 === 0) c.fillRect(x, y, S, S);
  // vignette (no ceiling light: the room is lit only by lamps, windows and the tank)
  const vg = c.createRadialGradient(W * .55, H * .5, 120, W * .55, H * .5, 760);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.42)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);

  c.globalCompositeOperation = 'lighter';
  // window glow (soft, fixed, no sunbeam)
  for (const w of WINDOWS) {
    const g = c.createRadialGradient(w.x + w.w / 2, ROOM.y - 30, 10, w.x + w.w / 2, ROOM.y - 30, 300);
    g.addColorStop(0, 'rgba(170,200,255,.16)'); g.addColorStop(.5, 'rgba(150,185,255,.05)'); g.addColorStop(1, 'rgba(150,185,255,0)');
    c.fillStyle = g; c.fillRect(w.x - 300, 0, w.w + 600, 360);
  }
  // fish tank glow
  {
    const g = c.createRadialGradient(TANK.x + TANK.w / 2, TANK.y + TANK.h / 2, 10, TANK.x + TANK.w / 2, TANK.y + TANK.h / 2, 210);
    g.addColorStop(0, 'rgba(50,140,255,.24)'); g.addColorStop(.45, 'rgba(40,120,255,.07)'); g.addColorStop(1, 'rgba(40,120,255,0)');
    c.fillStyle = g; c.fillRect(0, 400, 420, 380);
  }
  // lamp pools
  for (const d of DESKS) {
    const L = lampPos(d);
    const strength = d.state === 'unused' ? .05 : .10;
    const g = c.createRadialGradient(L.x, L.y, 2, L.x, L.y, 95);
    g.addColorStop(0, `rgba(255,190,120,${strength * 1.6})`); g.addColorStop(.4, `rgba(255,170,100,${strength * .55})`); g.addColorStop(1, 'rgba(255,170,100,0)');
    c.fillStyle = g; c.fillRect(L.x - 100, L.y - 100, 200, 200);
  }
  {
    const L = araLamp();
    const g = c.createRadialGradient(L.x, L.y, 2, L.x, L.y, 160);
    g.addColorStop(0, 'rgba(255,200,140,.2)'); g.addColorStop(.4, 'rgba(255,180,110,.07)'); g.addColorStop(1, 'rgba(255,180,110,0)');
    c.fillStyle = g; c.fillRect(L.x - 170, L.y - 170, 340, 340);
  }
  {
    const L = LOUNGE.lamp;
    const g = c.createRadialGradient(L.x, L.y, 2, L.x, L.y, 150);
    g.addColorStop(0, 'rgba(255,196,130,.2)'); g.addColorStop(.45, 'rgba(255,176,105,.06)'); g.addColorStop(1, 'rgba(255,176,105,0)');
    c.fillStyle = g; c.fillRect(L.x - 160, L.y - 160, 320, 320);
  }
  {
    const L = COFFEE.lamp;
    const g = c.createRadialGradient(L.x, L.y, 2, L.x, L.y, 110);
    g.addColorStop(0, 'rgba(255,196,130,.16)'); g.addColorStop(.45, 'rgba(255,176,105,.05)'); g.addColorStop(1, 'rgba(255,176,105,0)');
    c.fillStyle = g; c.fillRect(L.x - 120, L.y - 120, 240, 240);
  }
  c.globalCompositeOperation = 'source-over';

  // lounge rug
  c.save(); c.beginPath(); c.ellipse(1098, 218, 70, 104, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.03)'; c.fill(); c.lineWidth = 1; c.strokeStyle = 'rgba(214,190,150,.10)'; c.stroke(); c.restore();

  // head-desk rug
  c.save(); rr(c, 28, 300, 222, 220, 18);
  c.fillStyle = 'rgba(255,255,255,.028)'; c.fill();
  c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.07)'; c.stroke();
  rr(c, 36, 308, 206, 204, 13); c.lineWidth = .8; c.strokeStyle = 'rgba(214,190,150,.10)'; c.stroke(); c.restore();

  c.restore(); // end floor clip

  drawWalls(c);
  for (const d of DESKS) drawChair(c, d.seat.x, d.seat.y, d.state === 'unused' ? .6 : 1);
  drawChair(c, ARA_SEAT.x, ARA_SEAT.y, 1, true);
  CLUSTERS.forEach(drawClusterBase);
  for (const d of DESKS) drawDesk(c, d);
  CLUSTERS.forEach(cl => drawDividers(c, cl));
  drawAraDesk(c);
  drawTank(c);
  drawLounge(c);
  drawCoffee(c);
  for (const p of PLANTS) drawPlant(c, p);
  // lamp heads on top
  for (const d of DESKS) drawLampHead(c, lampPos(d), d.state === 'unused' ? .55 : 1);
  drawLampHead(c, araLamp(), 1.25);
  drawLampHead(c, LOUNGE.lamp, 1.5);
  drawLampHead(c, COFFEE.lamp, .9);
  return cv;

  function drawClusterBase(cl) {
    c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 22 * scale * dpr; c.shadowOffsetY = 8 * scale * dpr;
    rr(c, cl.x - DW - GAP / 2 - 2, cl.y - DH - GAP / 2 - 2, DW * 2 + GAP + 4, DH * 2 + GAP + 4, 8);
    c.fillStyle = '#16171a'; c.fill(); c.restore();
  }
}

function lampPos(d) {
  const outer = (d.s % 2 === 0) ? -1 : 1;
  return { x: d.x + outer * (DW / 2 - 10), y: d.top ? d.y - DH / 2 + 10 : d.y + DH / 2 - 10 };
}
function araLamp() { return { x: ARA_DESK.x + 20, y: ARA_DESK.y + 20 }; }

function drawWalls(c) {
  const t = 14;
  c.save();
  const wg = c.createLinearGradient(0, 0, W, H);
  wg.addColorStop(0, '#34363c'); wg.addColorStop(.5, '#26282d'); wg.addColorStop(1, '#2e3035');
  c.fillStyle = wg;
  const segs = [
    [ROOM.x - t, ROOM.y - t, ROOM.w + 2 * t, t],                      // top (windows cut later)
    [ROOM.x - t, ROOM.y + ROOM.h, ROOM.w + 2 * t, t],                 // bottom
    [ROOM.x - t, ROOM.y, t, ROOM.h],                                  // left
    [ROOM.x + ROOM.w, ROOM.y, t, DOOR.y - ROOM.y],                    // right upper
    [ROOM.x + ROOM.w, DOOR.y + DOOR.h, t, ROOM.y + ROOM.h - DOOR.y - DOOR.h], // right lower
  ];
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 14 * scale * dpr;
  for (const s of segs) { rr(c, ...s, 3); c.fill(); }
  c.shadowColor = 'transparent';
  // chrome cap line
  c.strokeStyle = 'rgba(255,255,255,.13)'; c.lineWidth = 1;
  for (const s of segs) { rr(c, s[0] + .5, s[1] + .5, s[2] - 1, s[3] - 1, 3); c.stroke(); }
  // inner edge shadow on floor
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3;
  rr(c, ROOM.x + 1.5, ROOM.y + 1.5, ROOM.w - 3, ROOM.h - 3, 9); c.stroke();
  // windows
  for (const w of WINDOWS) {
    const g = c.createLinearGradient(0, ROOM.y - t, 0, ROOM.y);
    g.addColorStop(0, '#9fb6dc'); g.addColorStop(.5, '#e6eeff'); g.addColorStop(1, '#bcd0f2');
    c.save(); c.shadowColor = 'rgba(180,205,255,.9)'; c.shadowBlur = 18 * scale * dpr;
    c.fillStyle = g; rr(c, w.x, ROOM.y - t + 3, w.w, t - 6, 2); c.fill(); c.restore();
    c.fillStyle = 'rgba(40,44,52,.9)';
    for (let i = 1; i < 4; i++) c.fillRect(w.x + w.w * i / 4 - 1.2, ROOM.y - t + 3, 2.4, t - 6);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = .8; rr(c, w.x, ROOM.y - t + 3, w.w, t - 6, 2); c.stroke();
  }
  // doorway: threshold + open door leaf
  c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(ROOM.x + ROOM.w, DOOR.y, t, DOOR.h);
  // door leaf swung inward against the wall, with a faint swing arc
  c.save(); c.translate(ROOM.x + ROOM.w - 1, DOOR.y); c.rotate(-Math.PI / 2 - .38);
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.setLineDash([3, 4]);
  c.beginPath(); c.arc(0, 0, DOOR.h - 4, 0, .38 + Math.PI / 2 - Math.PI / 2 + .0001 + 1.18); c.stroke(); c.setLineDash([]);
  const dg = c.createLinearGradient(0, 0, 0, 6); dg.addColorStop(0, '#3e4047'); dg.addColorStop(1, '#2a2c31');
  c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 6 * scale * dpr;
  c.fillStyle = dg; rr(c, 0, -2.5, DOOR.h - 4, 5, 2); c.fill(); c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = .8; c.stroke(); c.restore();
  c.restore();
}

function drawChair(c, x, y, a, big) {
  c.save(); c.globalAlpha = a;
  const r = big ? 26 : 20;
  c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 8 * scale * dpr; c.shadowOffsetY = 3 * scale * dpr;
  const g = c.createRadialGradient(x - 4, y - 5, 2, x, y, r);
  g.addColorStop(0, '#34363c'); g.addColorStop(1, '#212226');
  c.fillStyle = g; rr(c, x - r, y - r, 2 * r, 2 * r, r * .45); c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.stroke();
  c.restore();
}

function deskSurface(c, x, y, w, h, rad, premium) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 12 * scale * dpr; c.shadowOffsetY = 4 * scale * dpr;
  const g = c.createLinearGradient(x, y, x + w, y + h);
  if (premium) { g.addColorStop(0, '#3a3530'); g.addColorStop(.5, '#2a2622'); g.addColorStop(1, '#221f1c'); }
  else { g.addColorStop(0, '#30323a'); g.addColorStop(1, '#25272d'); }
  c.fillStyle = g; rr(c, x, y, w, h, rad); c.fill();
  c.shadowColor = 'transparent';
  // brushed sheen
  c.save(); rr(c, x, y, w, h, rad); c.clip();
  const sh = c.createLinearGradient(x, y, x + w * .6, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,.07)'); sh.addColorStop(.35, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,.02)');
  c.fillStyle = sh; c.fillRect(x, y, w, h); c.restore();
  // chrome edge
  const eg = c.createLinearGradient(x, y, x + w, y + h);
  eg.addColorStop(0, 'rgba(255,255,255,.32)'); eg.addColorStop(.5, 'rgba(255,255,255,.08)'); eg.addColorStop(1, 'rgba(255,255,255,.22)');
  c.strokeStyle = eg; c.lineWidth = premium ? 1.6 : 1; rr(c, x + .5, y + .5, w - 1, h - 1, rad); c.stroke();
  c.restore();
}

function drawDesk(c, d) {
  const x = d.x - DW / 2, y = d.y - DH / 2;
  deskSurface(c, x, y, DW, DH, 4, false);
  const near = d.top ? y + 8 : y + DH - 8; // edge nearest the bot
  if (d.state === 'unused') {
    // closed laptop
    const lx = d.x - 15, ly = d.y - 9;
    c.save(); c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 4 * scale * dpr; c.shadowOffsetY = 1.5 * scale * dpr;
    const g = c.createLinearGradient(lx, ly, lx + 30, ly + 19);
    g.addColorStop(0, '#c9ccd2'); g.addColorStop(.5, '#8f939b'); g.addColorStop(1, '#b4b7be');
    c.fillStyle = g; rr(c, lx, ly, 30, 19, 2.5); c.fill(); c.restore();
    c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(d.x, d.y + .5, 1.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(lx + 2, d.top ? ly + 17.6 : ly + .4, 26, 1);
  } else {
    // keyboard near the bot
    c.fillStyle = '#1a1b1f'; rr(c, d.x - 16, near - 4, 32, 8, 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) c.fillRect(d.x - 14 + i * 3.6, near - 2.6 + j * 2.8, 2.6, 1.8);
    if (d.state === 'occupied') { // mug
      const mx = d.x + (d.s % 2 === 0 ? 24 : -24), my = near + (d.top ? 4 : -4);
      c.save(); c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 3 * scale * dpr; c.shadowOffsetY = 1 * scale * dpr;
      c.fillStyle = '#d8d6d0'; c.beginPath(); c.arc(mx, my, 4.6, 0, Math.PI * 2); c.fill(); c.restore();
      c.fillStyle = '#5a3a22'; c.beginPath(); c.arc(mx, my, 3.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,230,200,.35)'; c.beginPath(); c.arc(mx - 1, my - 1, 1.1, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d8d6d0'; rr(c, mx + 4, my - 1.3, 3, 2.6, 1); c.fill();
    }
  }
}

function drawDividers(c, cl) {
  c.save();
  const h = DH * 2 + GAP + 10, w = DW * 2 + GAP + 10;
  c.fillStyle = 'rgba(205,215,235,.10)';
  rr(c, cl.x - 2, cl.y - h / 2, 4, h, 2); c.fill();
  rr(c, cl.x - w / 2, cl.y - 2, w, 4, 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.32)'; c.lineWidth = .7;
  c.beginPath(); c.moveTo(cl.x - 1.5, cl.y - h / 2); c.lineTo(cl.x - 1.5, cl.y + h / 2);
  c.moveTo(cl.x - w / 2, cl.y - 1.5); c.lineTo(cl.x + w / 2, cl.y - 1.5); c.stroke();
  c.fillStyle = '#c9ccd2'; c.beginPath(); c.arc(cl.x, cl.y, 3, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawAraDesk(c) {
  const { x, y, w, h } = ARA_DESK;
  deskSurface(c, x, y, w, h, 10, true);
  // inlay strip
  c.save(); c.strokeStyle = 'rgba(214,190,150,.18)'; c.lineWidth = .8; rr(c, x + 6, y + 6, w - 12, h - 12, 6); c.stroke(); c.restore();
  // keyboard facing Ara (on the left side of the desk)
  c.fillStyle = '#18191c'; rr(c, x + 12, y + h / 2 - 20, 10, 40, 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,.06)';
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) c.fillRect(x + 13.5 + j * 4, y + h / 2 - 18 + i * 3.6, 2.6, 2.4);
  // mug + small succulent
  c.fillStyle = '#efeeea'; c.beginPath(); c.arc(x + 22, y + h - 20, 5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3b2618'; c.beginPath(); c.arc(x + 22, y + h - 20, 3.5, 0, Math.PI * 2); c.fill();
  drawPlant(c, { x: x + w - 16, y: y + h - 16, r: 10, seed: 9 });
}

function drawLampHead(c, p, k) {
  c.save();
  const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7 * k);
  g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(.35, 'rgba(255,200,140,.9)'); g.addColorStop(1, 'rgba(255,170,100,0)');
  c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 7 * k, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = 'rgba(210,214,222,.55)'; c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, 3.6 * k, 0, Math.PI * 2); c.stroke();
  c.restore();
}

function drawLounge(c) {
  const { sofa, table } = LOUNGE;
  c.save();
  // sofa: deep charcoal velvet with chrome piping, seen from above
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 16 * scale * dpr; c.shadowOffsetY = 5 * scale * dpr;
  const sg = c.createLinearGradient(sofa.x, 0, sofa.x + sofa.w, 0);
  sg.addColorStop(0, '#3a3c44'); sg.addColorStop(1, '#2a2b31');
  c.fillStyle = sg; rr(c, sofa.x, sofa.y, sofa.w, sofa.h, 12); c.fill();
  c.shadowColor = 'transparent';
  // back rest + arms
  c.fillStyle = '#24252a'; rr(c, sofa.x + sofa.w - 12, sofa.y + 2, 10, sofa.h - 4, 6); c.fill();
  rr(c, sofa.x + 2, sofa.y + 2, sofa.w - 4, 12, 6); c.fill(); rr(c, sofa.x + 2, sofa.y + sofa.h - 14, sofa.w - 4, 12, 6); c.fill();
  // cushions
  for (let i = 0; i < 3; i++) {
    const cy = sofa.y + 16 + i * (sofa.h - 32) / 3;
    const cg = c.createLinearGradient(sofa.x, cy, sofa.x + 30, cy + 40);
    cg.addColorStop(0, '#44464f'); cg.addColorStop(1, '#33353c');
    c.fillStyle = cg; rr(c, sofa.x + 4, cy + 1.5, sofa.w - 18, (sofa.h - 32) / 3 - 3, 6); c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = .8; rr(c, sofa.x + .5, sofa.y + .5, sofa.w - 1, sofa.h - 1, 12); c.stroke();
  // accent pillow
  c.fillStyle = '#5b4b8a'; c.save(); c.translate(sofa.x + 16, sofa.y + 34); c.rotate(.3); rr(c, -8, -8, 16, 16, 4); c.fill(); c.restore();
  // round glass coffee table
  c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 10 * scale * dpr; c.shadowOffsetY = 3 * scale * dpr;
  const tg = c.createRadialGradient(table.x - 6, table.y - 8, 2, table.x, table.y, table.r);
  tg.addColorStop(0, 'rgba(200,215,235,.28)'); tg.addColorStop(1, 'rgba(120,135,160,.14)');
  c.fillStyle = tg; c.beginPath(); c.arc(table.x, table.y, table.r, 0, Math.PI * 2); c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = '#d9d6cf'; rr(c, table.x - 8, table.y - 5, 12, 9, 1.5); c.fill(); // a book
  c.fillStyle = '#7a5bd0'; c.fillRect(table.x - 8, table.y - 5, 2, 9);
  c.restore();
}

function drawCoffee(c) {
  const { x, y, w, h } = COFFEE;
  deskSurface(c, x, y, w, h, 6, true);
  c.save();
  c.strokeStyle = 'rgba(214,190,150,.16)'; c.lineWidth = .7; rr(c, x + 3, y + 3, w - 6, h - 6, 4); c.stroke();

  // espresso machine, seen from above, against the wall edge
  const mx = x + 10, my = y + 10, mw = w - 14, mh = 34;
  c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 6 * scale * dpr; c.shadowOffsetY = 2 * scale * dpr;
  const mg = c.createLinearGradient(mx, my, mx + mw, my + mh);
  mg.addColorStop(0, '#3a3c44'); mg.addColorStop(.45, '#1c1d22'); mg.addColorStop(1, '#2a2c32');
  c.fillStyle = mg; rr(c, mx, my, mw, mh, 4); c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = .8; rr(c, mx + .4, my + .4, mw - .8, mh - .8, 4); c.stroke();
  // group head / drip tray
  c.fillStyle = '#121316'; rr(c, mx + 5, my + 8, mw - 14, 12, 2); c.fill();
  c.fillStyle = '#c9ccd2'; rr(c, mx + mw - 8, my + 12, 6, 3.2, 1); c.fill(); // portafilter
  c.fillStyle = '#d8d6d0'; c.beginPath(); c.arc(mx + 12, my + 22, 3.2, 0, Math.PI * 2); c.fill(); // cup
  c.fillStyle = '#5a3a22'; c.beginPath(); c.arc(mx + 12, my + 22, 2.2, 0, Math.PI * 2); c.fill();
  // warm status light on the machine
  c.fillStyle = 'rgba(255,200,130,.85)'; c.beginPath(); c.arc(mx + mw - 6, my + 6, 1.5, 0, Math.PI * 2); c.fill();

  // mugs along the middle of the board
  [[x + 14, y + 54, '#efeeea'], [x + 26, y + 58, '#d8d6d0'], [x + 16, y + 66, '#cfc8be']].forEach(([cx, cy, col]) => {
    c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 3 * scale * dpr; c.shadowOffsetY = 1 * scale * dpr;
    c.fillStyle = col; c.beginPath(); c.arc(cx, cy, 4.2, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#5a3a22'; c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,230,200,.35)'; c.beginPath(); c.arc(cx - .8, cy - .8, 1, 0, Math.PI * 2); c.fill();
    c.fillStyle = col; rr(c, cx + 3.6, cy - 1.2, 2.8, 2.4, 1); c.fill();
  });

  // snack tray
  const tx = x + 8, ty = y + h - 24, tw = w - 14, th = 14;
  c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 4 * scale * dpr; c.shadowOffsetY = 1.5 * scale * dpr;
  const tg = c.createLinearGradient(tx, ty, tx + tw, ty + th);
  tg.addColorStop(0, '#d9d6cf'); tg.addColorStop(1, '#b7b1a6');
  c.fillStyle = tg; rr(c, tx, ty, tw, th, 2); c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = .6; c.stroke();
  c.fillStyle = '#c48a4a'; c.beginPath(); c.ellipse(tx + 8, ty + 7, 4.2, 3.1, .2, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#d4a05c'; c.beginPath(); c.ellipse(tx + 16, ty + 6.5, 3.6, 2.8, -.15, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#8a4a2a'; c.beginPath(); c.ellipse(tx + 23, ty + 7.2, 3.3, 2.6, .3, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawTank(c) {
  const { x, y, w, h } = TANK;
  c.save();
  c.shadowColor = 'rgba(60,150,255,.55)'; c.shadowBlur = 26 * scale * dpr;
  c.fillStyle = '#060708'; rr(c, x, y, w, h, 5); c.fill(); c.restore();
  // glass opening in the black lid showing the water
  const ix = x + 7, iy = y + 10, iw = w - 14, ih = h - 20;
  c.save(); rr(c, ix, iy, iw, ih, 3); c.clip();
  const wg = c.createLinearGradient(ix, iy, ix + iw, iy + ih);
  wg.addColorStop(0, '#1d5f9e'); wg.addColorStop(.5, '#123f73'); wg.addColorStop(1, '#0b2a52');
  c.fillStyle = wg; c.fillRect(ix, iy, iw, ih);
  // pebbles + weed (still)
  c.fillStyle = 'rgba(190,210,230,.18)';
  for (let i = 0; i < 26; i++) { const px = ix + ((i * 37) % iw), py = iy + ih - 6 + ((i * 13) % 6); c.beginPath(); c.arc(px, py, 1.6, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(70,190,140,.55)'; c.lineWidth = 1.6;
  [[ix + 8, 30], [ix + 14, 46], [ix + iw - 9, 38]].forEach(([px, hh]) => { c.beginPath(); c.moveTo(px, iy + ih - 4); c.quadraticCurveTo(px + 5, iy + ih - hh / 2, px - 2, iy + ih - hh); c.stroke(); });
  // still fish
  [[ix + 18, iy + 30, '#ffb35c'], [ix + 26, iy + 64, '#ff8a6b'], [ix + 14, iy + 92, '#f2f0ea']].forEach(([fx, fy, col]) => {
    c.fillStyle = col; c.beginPath(); c.ellipse(fx, fy, 5, 2.3, .2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(fx - 4.5, fy); c.lineTo(fx - 8, fy - 2.4); c.lineTo(fx - 8, fy + 2.6); c.fill();
  });
  const gl = c.createLinearGradient(ix, iy, ix + iw, iy);
  gl.addColorStop(0, 'rgba(255,255,255,.18)'); gl.addColorStop(.3, 'rgba(255,255,255,0)');
  c.fillStyle = gl; c.fillRect(ix, iy, iw, ih);
  c.restore();
  c.strokeStyle = 'rgba(140,200,255,.55)'; c.lineWidth = 1; rr(c, ix, iy, iw, ih, 3); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; rr(c, x + .5, y + .5, w - 1, h - 1, 5); c.stroke();
}

function drawPlant(c, p) {
  let s = p.seed * 9301; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  c.save();
  c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 10 * scale * dpr; c.shadowOffsetY = 4 * scale * dpr;
  const pg = c.createRadialGradient(p.x - p.r * .3, p.y - p.r * .3, 1, p.x, p.y, p.r * .62);
  pg.addColorStop(0, '#4a4c52'); pg.addColorStop(1, '#232428');
  c.fillStyle = pg; c.beginPath(); c.arc(p.x, p.y, p.r * .6, 0, Math.PI * 2); c.fill();
  c.shadowColor = 'transparent';
  const n = 9 + Math.floor(r() * 4);
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + r() * .4 + layer * .3;
      const len = p.r * (layer ? .7 : 1) * (.8 + r() * .3);
      c.save(); c.translate(p.x, p.y); c.rotate(a);
      const lg = c.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, layer ? '#2f7a4c' : '#1f5a37'); lg.addColorStop(1, layer ? '#5fae6e' : '#3d8a54');
      c.fillStyle = lg;
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * .5, -len * .26, len, 0); c.quadraticCurveTo(len * .5, len * .26, 0, 0); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = .5; c.beginPath(); c.moveTo(len * .1, 0); c.lineTo(len * .9, 0); c.stroke();
      c.restore();
    }
  }
  c.restore();
}

/* ------------------------------------------------------------------ dynamic drawing */
const SCREEN_PALETTES = 5;
const screenCache = new Map();
function drawScreen(c, x, y, w, h, color, kind, seed, vertical, dim) {
  c.save();
  // glow onto the desk
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, Math.max(w, h) * 1.3);
  g.addColorStop(0, rgba(color === '#ffffff' ? '#cfe0ff' : color, dim ? .08 : .2)); g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g; c.fillRect(x - w, y - h * 2, w * 3, h * 5);
  c.globalCompositeOperation = 'source-over';
  const key = `${w}x${h}|${color}|${kind % SCREEN_PALETTES}|${seed}|${vertical ? 1 : 0}|${dim ? 1 : 0}`;
  let bmp = screenCache.get(key);
  if (!bmp) {
    const k = scale * dpr, pad = 1.4;
    bmp = document.createElement('canvas');
    bmp.width = Math.ceil((w + pad * 2) * k); bmp.height = Math.ceil((h + pad * 2) * k);
    const sc = bmp.getContext('2d');
    sc.setTransform(k, 0, 0, k, (pad - x) * k, (pad - y) * k);
    paintScreenPanel(sc, x, y, w, h, color, kind, seed, vertical, dim);
    screenCache.set(key, bmp);
    if (screenCache.size > 160) screenCache.delete(screenCache.keys().next().value);
  }
  c.drawImage(bmp, x - 1.4, y - 1.4, w + 2.8, h + 2.8);
  c.restore();
}

function paintScreenPanel(c, x, y, w, h, color, kind, seed, vertical, dim) {
  c.save();
  // bezel + panel
  c.fillStyle = '#0b0c0e'; rr(c, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 2); c.fill();
  const pg = c.createLinearGradient(x, y, x + w, y + h);
  pg.addColorStop(0, dim ? '#121a26' : '#16233a'); pg.addColorStop(1, dim ? '#0d121a' : '#0e1626');
  c.fillStyle = pg; rr(c, x, y, w, h, 1.2); c.fill();
  c.save(); rr(c, x, y, w, h, 1.2); c.clip();
  if (dim) {
    c.fillStyle = 'rgba(160,190,255,.25)'; c.beginPath(); c.arc(x + w / 2, y + h / 2, Math.min(w, h) * .18, 0, Math.PI * 2); c.fill();
  } else {
    const acc = color === '#ffffff' ? '#e8eefc' : color;
    let s = Math.floor(seed + kind * 97); const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const L = vertical ? h : w, T = vertical ? w : h;
    const P = (a, b, aw, bh) => vertical ? c.fillRect(x + b, y + a, bh, aw) : c.fillRect(x + a, y + b, aw, bh);
    switch (kind % SCREEN_PALETTES) {
      case 0: // text lines
        for (let i = 0; i < 5; i++) { c.fillStyle = i === 0 ? acc : 'rgba(220,230,255,.45)'; P(2, 1.5 + i * (T - 3) / 5, (L - 4) * (.4 + r() * .55), 1); }
        break;
      case 1: // bar chart
        for (let i = 0; i < 9; i++) { const bh = (T - 3) * (.25 + r() * .7); c.fillStyle = i % 3 === 0 ? acc : 'rgba(220,230,255,.4)'; P(2 + i * (L - 4) / 9, T - 1.5 - bh, (L - 4) / 9 - 1, bh); }
        break;
      case 2: // list with highlights
        for (let i = 0; i < 4; i++) { c.fillStyle = i === 1 ? rgba(acc, .9) : 'rgba(220,230,255,.3)'; P(2, 1.5 + i * (T - 3) / 4, L - 4, (T - 3) / 4 - 1); }
        break;
      case 3: // media frame + timeline
        c.fillStyle = rgba(acc, .55); P(2, 1.5, L * .45, T - 3);
        c.fillStyle = 'rgba(220,230,255,.4)'; for (let i = 0; i < 3; i++) P(L * .5 + 1, 2 + i * (T - 4) / 3, L * .45 * (.5 + r() * .5), 1);
        break;
      default: // kanban columns
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (r() > .25) { c.fillStyle = j === 0 && i === 1 ? acc : 'rgba(220,230,255,.35)'; P(2 + i * (L - 4) / 3, 1.5 + j * (T - 3) / 3, (L - 4) / 3 - 1.4, (T - 3) / 3 - 1); }
    }
  }
  c.restore();
  // glass sheen
  const sg = c.createLinearGradient(x, y, x + w, y + h);
  sg.addColorStop(0, 'rgba(255,255,255,.12)'); sg.addColorStop(.4, 'rgba(255,255,255,0)');
  c.fillStyle = sg; rr(c, x, y, w, h, 1.2); c.fill();
  c.restore();
}

function drawDynamicDesks(c, dt) {
  DESKS.forEach((d, i) => {
    if (d.state === 'unused') return;
    const sc = screens[i];
    if (simT > sc.next) { sc.kind = (sc.kind + 1 + Math.floor(rnd() * 3)) % 10; sc.next = simT + 3 + rnd() * 6; sc.seed = rnd() * 1e6 | 0; }
    const occ = d.occ ? B[d.occ] : null;
    const atDesk = occ && (occ.mode === 'desk' || occ.mode === 'stretch');
    const sw = 40, sh = 15;
    const sy = d.top ? d.y + DH / 2 - sh - 5 : d.y - DH / 2 + 5;
    drawScreen(c, d.x - sw / 2, sy, sw, sh, occ ? occ.color : '#9fb4ff', sc.kind, sc.seed, false, !occ || !atDesk);
  });
  // Ara's two screens, facing her
  if (simT > araScreens.next) { araScreens.kind = (araScreens.kind + 1 + Math.floor(rnd() * 3)) % 10; araScreens.next = simT + 3 + rnd() * 5; araScreens.seed = rnd() * 1e6 | 0; }
  const ax = ARA_DESK.x + ARA_DESK.w - 30;
  drawScreen(c, ax, ARA_DESK.y + 18, 16, 50, '#ffffff', araScreens.kind, araScreens.seed, true, B.ara.mode !== 'desk');
  drawScreen(c, ax, ARA_DESK.y + ARA_DESK.h - 68, 16, 50, '#ffffff', araScreens.kind + 2, araScreens.seed + 5, true, B.ara.mode !== 'desk');
}

function drawRings(c) {
  if (reducedMotion) { rings.length = 0; return; }
  rings = rings.filter(r => simT - r.t < (r.big ? 2.6 : 1.2));
  for (const r of rings) {
    const t = (simT - r.t) / (r.big ? 2.6 : 1.2);
    const rad = r.big ? 30 + t * 1150 : 18 + t * 46;
    c.save();
    c.strokeStyle = rgba(r.color, (1 - t) * (r.big ? .22 : .55));
    c.lineWidth = r.big ? 2 : 2.2;
    c.beginPath(); c.arc(r.x, r.y, rad, 0, Math.PI * 2); c.stroke();
    if (r.big) { c.strokeStyle = rgba(r.color, (1 - t) * .08); c.lineWidth = 10; c.stroke(); }
    c.restore();
  }
}

function botPose(b) {
  let x = b.x, y = b.y, sx = 1, sy = 1, lift = 0;
  if (b.mode === 'desk' || b.mode === 'stretch') { x += b.jx; y += b.jy; }
  if (b.mode === 'walk') {
    const p = Math.sin(b.walkPhase);
    if (!reducedMotion) { lift = Math.abs(p) * 3.2; sx = 1 + p * .025; sy = 1 - p * .025; }
  }
  if (b.mode === 'stretch') { const k = Math.sin(Math.min(1, (b.until - simT) / 3) * Math.PI); sy = 1 + k * .08; sx = 1 - k * .05; lift = k * 3; }
  if (b.mode === 'hold' && b.status.startsWith('Chatting')) { lift = Math.abs(Math.sin(simT * 4)) * 1.4; }
  if (b.chatWith && b.chatWith.until > simT) lift = Math.abs(Math.sin(simT * 4 + 1)) * 1.2;
  if (b.react > 0) { lift += Math.sin((1 - b.react) * Math.PI) * 4 * b.react; }
  if (b.phoneUntil > simT && b.mode !== 'walk') { sx *= 1 + Math.sin(simT * 2) * .01; }
  return { x, y, sx, sy, lift };
}

function drawBotShadow(c, b, pose) {
  const R = b.R * boost;
  c.save();
  const g = c.createRadialGradient(pose.x + 3, pose.y + R * .55, 1, pose.x + 3, pose.y + R * .55, R * 1.25);
  g.addColorStop(0, `rgba(0,0,0,${.55 - pose.lift * .03})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.ellipse(pose.x + 3, pose.y + R * .55, R * 1.25, R * .75, 0, 0, Math.PI * 2); c.fill();
  // faint colored floor reflection
  c.globalCompositeOperation = 'lighter';
  const cg = c.createRadialGradient(pose.x, pose.y + R * .4, 1, pose.x, pose.y + R * .4, R * 1.6);
  cg.addColorStop(0, rgba(b.color, b.color === '#ffffff' ? .06 : .09)); cg.addColorStop(1, rgba(b.color, 0));
  c.fillStyle = cg; c.beginPath(); c.arc(pose.x, pose.y + R * .4, R * 1.6, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawBot(c, b, pose) {
  const R = b.R * boost;
  const ppu = R * scale * dpr;
  const spr = bodySprite(b, ppu);
  c.save();
  c.translate(pose.x, pose.y - pose.lift);
  c.rotate(b.tilt);
  c.scale(pose.sx, pose.sy);
  const sz = spr.size / ppu * R;
  c.drawImage(spr.cv, -sz / 2, -sz / 2, sz, sz);
  c.scale(R, R);
  drawEyes(c, b, b.gx, b.gy, b.blink);
  c.restore();
  // phone glow
  if (b.phoneUntil > simT && !b.hidden) {
    const px = pose.x + R * .85, py = pose.y + R * .35 - pose.lift;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(px, py, 0, px, py, 16); g.addColorStop(0, 'rgba(150,190,255,.35)'); g.addColorStop(1, 'rgba(150,190,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(px, py, 16, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#0c0d10'; rr(c, px - 3.6, py - 6, 7.2, 12, 1.8); c.fill();
    c.fillStyle = '#9cc0ff'; rr(c, px - 2.8, py - 5, 5.6, 10, 1.2); c.fill();
    c.restore();
  }
}


function drawLabel(c, b, pose) {
  const R = b.R * boost;
  const fs = labelSize();
  c.save();
  c.font = `600 ${fs}px ${fam()}`;
  c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 4 * scale * dpr;
  c.fillStyle = 'rgba(238,239,243,.92)';
  const y = pose.y - pose.lift - R * (b.shape === 'ara' ? 1.08 : 1.12) - 3;
  c.fillText(b.name, pose.x, y);
  c.restore();
  return y - fs;
}
let _fam = null;
const fam = () => _fam || (_fam = getComputedStyle(document.body).fontFamily);
function labelSize() { const px = scale < .5 ? 10 : 12.5; return px / scale * Math.min(1, Math.max(.82, scale * 1.2)); }

function drawPlaque(c, x, yBottom, text, color, kind) {
  const fs = labelSize() * 1.06;
  c.save();
  c.font = `650 ${fs}px ${fam()}`;
  const tw = c.measureText(text).width;
  const padX = fs * .75, h = fs * 1.85, w = tw + padX * 2 + (kind === 'err' ? fs * .9 : 0);
  let px = clamp(x - w / 2, ROOM.x + 2, ROOM.x + ROOM.w - w - 2);
  let py = yBottom - h - fs * .5;
  // avoid other plaques this frame, and stay inside the visible canvas
  for (let pass = 0; pass < 3; pass++) for (const r of placedPlaques)
    if (px < r.x + r.w + 4 && px + w + 4 > r.x && py < r.y + r.h + 4 && py + h + 4 > r.y) py = r.y - h - 6;
  py = Math.max(py, -oy / scale + 4);
  placedPlaques.push({ x: px, y: py, w, h });
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 10 * scale * dpr; c.shadowOffsetY = 3 * scale * dpr;
  c.fillStyle = 'rgba(21,22,26,.94)'; rr(c, px, py, w, h, h * .32); c.fill();
  c.shadowColor = 'transparent';
  // pointer
  c.beginPath(); c.moveTo(clamp(x, px + 10, px + w - 10) - fs * .4, py + h - .5); c.lineTo(clamp(x, px + 10, px + w - 10), py + h + fs * .45); c.lineTo(clamp(x, px + 10, px + w - 10) + fs * .4, py + h - .5); c.fill();
  // hairline: chrome with a whisper of the sender color
  const bg = c.createLinearGradient(px, py, px + w, py + h);
  bg.addColorStop(0, 'rgba(255,255,255,.22)'); bg.addColorStop(1, kind === 'err' ? 'rgba(255,176,32,.35)' : rgba(color, .35));
  c.strokeStyle = bg; c.lineWidth = Math.max(.8, 1 / scale * .8); rr(c, px + .5, py + .5, w - 1, h - 1, h * .32); c.stroke();
  let tx = px + padX;
  if (kind === 'err') {
    c.fillStyle = '#ffb020'; c.beginPath(); c.arc(tx + fs * .25, py + h / 2, fs * .22, 0, Math.PI * 2); c.fill();
    tx += fs * .9;
  }
  c.textBaseline = 'middle'; c.textAlign = 'left';
  c.lineJoin = 'round';
  if (kind !== 'err') {
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = fs * .13; c.strokeText(text, tx, py + h / 2 + fs * .04);
  }
  c.fillStyle = kind === 'err' ? '#ffc861' : (color === '#ffffff' ? '#ffffff' : color);
  c.fillText(text, tx, py + h / 2 + fs * .04);
  c.restore();
}

const placedPlaques = [];
function drawTrails(c) {
  if (reducedMotion) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (const b of bots) {
    for (const p of b.trail) {
      const a = 1 - (simT - p.t) / 1.4;
      if (a <= 0) continue;
      c.fillStyle = rgba(b.color, a * (b.color === '#ffffff' ? .06 : .1));
      c.beginPath(); c.arc(p.x, p.y + 6, 5 * boost * a + 1, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
}

/* ------------------------------------------------------------------ frame */
let last = performance.now(), acc = 0;
const TICK = 1 / 60;
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  acc += dt;
  while (acc >= TICK) { step(TICK); acc -= TICK; }
  draw(dt);
  updateUI(dt);
  requestAnimationFrame(frame);
}

function step(dt) {
  simT += dt; loopT += dt;
  if (loopT >= LOOP_LEN) nextLoop();
  while (evI < events.length && events[evI].t <= loopT) fire(events[evI++]);
  for (const b of bots) { updateBot(b, dt); updateLife(b, dt); }
  updateAmbient();
  for (const inc of incidents) if (!inc.ok && simT >= inc.resolveAt) { inc.ok = true; if (booted) renderIncidents(); }
}

function draw(dt) {
  if (!staticLayer) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(staticLayer, 0, 0);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  ctx.save(); rr(ctx, ROOM.x, ROOM.y, ROOM.w, ROOM.h, 10); ctx.clip();
  drawDynamicDesks(ctx, dt);
  drawRings(ctx);
  drawTrails(ctx);
  const vis = bots.filter(b => !b.hidden).map(b => ({ b, pose: botPose(b) })).sort((p, q) => p.pose.y - q.pose.y);
  for (const v of vis) drawBotShadow(ctx, v.b, v.pose);
  for (const v of vis) drawBot(ctx, v.b, v.pose);
  ctx.restore();
  const tops = vis.map(v => ({ ...v, top: drawLabel(ctx, v.b, v.pose) }));
  placedPlaques.length = 0;
  for (const v of tops) {
    if (v.b.carry) drawPlaque(ctx, v.pose.x, v.top - 1, v.b.carry, v.b.color, 'msg');
    else if (v.b.err && v.b.err.until > simT) drawPlaque(ctx, v.pose.x, v.top - 1, v.b.err.text, v.b.color, 'err');
    else if (v.b.ambient && v.b.ambient.until > simT) drawPlaque(ctx, v.pose.x, v.top - 1, v.b.ambient.text, v.b.color, 'msg');
  }
}

/* ------------------------------------------------------------------ sidebar UI */
const roster = document.getElementById('roster');
const feedEl = document.getElementById('feed');
const incEl = document.getElementById('incidents');
const gaugesEl = document.getElementById('teamGauges');
const chattyEl = document.getElementById('chatty');
const modeEl = document.getElementById('modeLabel');
const clockEl = document.getElementById('clock');

const order = ['ara', 'stan', 'researchy', 'pete', 'nikolai', 'yahn', 'jeff', 'wedding'];
const rows = {};
const RING_C = 2 * Math.PI * 14;
for (const id of order) {
  const b = B[id];
  const li = document.createElement('li');
  li.innerHTML = `<canvas width="68" height="68" aria-hidden="true"></canvas>
    <div><div class="nm">${b.name}${b.tier === 'head' ? '<span class="tag">lead</span>' : ''}</div><div class="role">${b.role}</div><div class="st"></div></div>
    <svg class="ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3"/>
      <circle class="arc" cx="17" cy="17" r="14" fill="none" stroke="${b.color}" stroke-width="3" stroke-linecap="round" transform="rotate(-90 17 17)" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" style="filter:drop-shadow(0 0 3px ${rgba(b.color, .6)})"/>
      <text x="17" y="20.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="#d9dbe0" font-family="inherit">0</text></svg>
    <div class="tok"><span>0</span><small>0 sent</small></div>`;
  roster.appendChild(li);
  rows[id] = { li, cv: li.querySelector('canvas'), c2: li.querySelector('canvas').getContext('2d'), last: {}, st: li.querySelector('.st'), arc: li.querySelector('.arc'), pct: li.querySelector('text'), tok: li.querySelector('.tok span'), sent: li.querySelector('.tok small') };
}

function gaugeSVG(label, color) {
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  const div = document.createElement('div'); div.className = 'gauge';
  const r = 34, cx = 46, cy = 46, a0 = Math.PI * .75, a1 = Math.PI * 2.25;
  const arc = (a, b) => `M ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)}`;
  let ticks = '';
  for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * i / 24, r1 = i % 6 === 0 ? 39 : 41, r2 = 44; ticks += `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="rgba(255,255,255,${i % 6 === 0 ? .35 : .14})" stroke-width="1"/>`; }
  div.innerHTML = `<svg viewBox="0 0 92 84">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${color.map((c, i) => `<stop offset="${i / (color.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>
    <radialGradient id="${id}f" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#26282e"/><stop offset="1" stop-color="#141518"/></radialGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="29" fill="url(#${id}f)" stroke="rgba(255,255,255,.08)"/>
    ${ticks}
    <path d="${arc(a0, a1)}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5" stroke-linecap="round"/>
    <path class="val" d="${arc(a0, a1)}" fill="none" stroke="url(#${id})" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="filter:drop-shadow(0 0 4px rgba(255,255,255,.25))"/>
    <text class="num" x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="16" font-weight="750" fill="#f1f2f4" font-family="inherit">0</text>
    <text class="unit" x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="7" fill="#80848d" font-family="inherit" letter-spacing=".5"></text>
  </svg><div class="lbl">${label}</div>`;
  gaugesEl.appendChild(div);
  return { val: div.querySelector('.val'), num: div.querySelector('.num'), unit: div.querySelector('.unit'), v: 0 };
}
const G = {
  load: gaugeSVG('Team load', ['#00bca6', '#1084fe', '#9159fe']),
  msgs: gaugeSVG('Messages', ['#ff6700', '#ffb020', '#00c972']),
  toks: gaugeSVG('Tokens', ['#9159fe', '#1084fe', '#00bca6']),
};
G.load.unit.textContent = 'PERCENT'; G.msgs.unit.textContent = 'PER MIN'; G.toks.unit.textContent = 'K / MIN';

function renderFeed() {
  feedEl.innerHTML = feed.map(f => {
    const a = BOT[f.from];
    const who = `<span class="who" style="color:${a.color === '#777777' ? '#a9abb0' : a.color}">${a.name}</span>`;
    const to = f.to ? `<span class="arrow">→</span><span class="who" style="color:${BOT[f.to].color === '#777777' ? '#a9abb0' : BOT[f.to].color}">${BOT[f.to].name}</span>` : '';
    return `<li><span class="t">${f.clock}</span><span>${who}${to} <span class="ph">${f.ph}</span></span></li>`;
  }).join('') || '<li><span class="t"></span><span class="ph">Waiting for the first handoff…</span></li>';
}
function renderIncidents() {
  incEl.innerHTML = incidents.length ? incidents.map(i => `<li class="${i.ok ? 'ok' : ''}"><span class="dot"></span><span>${i.text}</span><span class="rs">${i.ok ? 'resolved' : 'retrying'}</span></li>`).join('')
    : '<li class="empty"><span class="dot" style="background:#00c972;box-shadow:0 0 8px rgba(0,201,114,.6)"></span>All systems normal</li>';
}

function fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : (n / 1e3).toFixed(1) + 'k'; }

let uiAcc = 0;
let avAcc = 0;
const setText = (r, k, el, v) => { if (r.last[k] !== v) { r.last[k] = v; el.textContent = v; } };
function updateUI(dt) {
  // sidebar avatars at ~30 fps, only while the roster is visible
  avAcc += dt;
  const rosterVisible = roster.offsetParent !== null && !document.hidden;
  if (rosterVisible && avAcc >= 1 / 30) { avAcc = 0; for (const id of order) {
    const b = B[id], r = rows[id], c = r.c2;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 68, 68);
    c.globalAlpha = b.hidden ? .35 : 1;
    const ppu = 26;
    const spr = bodySprite(b, ppu);
    c.drawImage(spr.cv, 34 - spr.size / 2, 34 - spr.size / 2);
    c.translate(34, 34); c.scale(ppu, ppu); drawEyes(c, b, b.gx, b.gy, b.blink);
    c.globalAlpha = 1;
  } }
  uiAcc += dt;
  if (uiAcc < .12) return;
  uiAcc = 0;
  msgLog = msgLog.filter(t => simT - t < 60);
  let load = 0;
  for (const id of order) {
    const b = B[id], r = rows[id];
    const v = clamp(b.act, 0, 100);
    load += v;
    const off = (RING_C * (1 - v / 100)).toFixed(1);
    if (r.last.off !== off) { r.last.off = off; r.arc.setAttribute('stroke-dashoffset', off); }
    setText(r, 'pct', r.pct, String(Math.round(v)));
    setText(r, 'st', r.st, b.status || 'Working');
    setText(r, 'tok', r.tok, fmtTok(b.tokens));
    setText(r, 'sent', r.sent, `${b.sent} sent`);
    const moving = b.mode === 'walk' || b.mode === 'hold';
    if (r.last.mv !== moving) { r.last.mv = moving; r.li.classList.toggle('walking', moving); }
  }
  load /= order.length;
  const span = Math.min(60, simT);
  const msgsPerMin = msgLog.length * 60 / Math.max(span, 20);
  addTokens(0);
  const tokPerMin = tokRolling * 60 / Math.max(span, 5) / 1000;
  setGauge(G.load, load, 100, Math.round(load));
  setGauge(G.msgs, msgsPerMin, 8, msgsPerMin.toFixed(1));
  setGauge(G.toks, tokPerMin, 30, tokPerMin.toFixed(1));
  // chattiest / quietest this session
  const sorted = order.slice().sort((a, b) => B[b].sent - B[a].sent);
  if (B[sorted[0]].sent > 0) chattyEl.textContent = `chattiest ${B[sorted[0]].name} · quietest ${B[sorted[sorted.length - 1]].name}`;
  modeEl.textContent = `Replay · ${LOOPS[loopIdx].name}`;
  clockEl.textContent = `${fmtClock(loopT)} / 5:00`;
}
function setGauge(g, v, max, label) {
  g.v += (v - g.v) * .35;
  g.val.setAttribute('stroke-dashoffset', 100 - clamp(g.v / max, 0, 1) * 100);
  g.num.textContent = label;
}

/* ------------------------------------------------------------------ tabs (phone bottom bar) */
const app = document.querySelector('.app');
app.dataset.tab = 'team';
document.querySelectorAll('.bottombar button').forEach(btn => btn.addEventListener('click', () => {
  app.dataset.tab = btn.dataset.tab;
  document.querySelectorAll('.bottombar button').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  const side = document.getElementById('side');
  if (window.scrollY > side.offsetTop) window.scrollTo({ top: side.offsetTop - 8, behavior: 'smooth' });
}));

/* ------------------------------------------------------------------ boot: loads fully formed */
const qs = new URLSearchParams(location.search);
const li = Number(qs.get('loop'));
resetLoop(qs.has('loop') && Number.isInteger(li) ? ((li % LOOPS.length) + LOOPS.length) % LOOPS.length : Math.floor(rnd() * LOOPS.length));
// pre-roll so the first painted frame is already mid-activity (no intro animation)
const pre = qs.get('t');
const ti = Number(pre);
const preroll = pre !== null && Number.isFinite(ti) ? clamp(ti, 0, LOOP_LEN - 1) : 18 + rnd() * 40;
for (let t = 0; t < preroll; t += TICK) step(TICK);
booted = true;
renderFeed(); renderIncidents();
resize();
addEventListener('resize', queueResize);
if (window.ResizeObserver) new ResizeObserver(queueResize).observe(stage);
draw(0); updateUI(1);
requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
