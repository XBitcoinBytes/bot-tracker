// Lightweight smoke checks for Bot Tracker. No network, no load tests.
// Run: node tests/smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fails = [];
const pass = (name) => console.log('ok  ' + name);
const check = (name, fn) => {
  try { fn(); pass(name); }
  catch (err) { fails.push(name + ': ' + (err && err.message ? err.message : err)); console.error('FAIL  ' + name + ': ' + (err && err.stack ? err.stack : err)); }
};

check('required files exist', () => {
  for (const f of ['index.html', 'style.css', 'main.js', 'world.js', 'script.js', 'avatar.js', 'shapes.js', 'favicon.svg', 'vercel.json', 'og-image.png', 'README.md']) {
    assert.ok(fs.existsSync(path.join(root, f)), 'missing ' + f);
  }
});

check('JS modules parse', () => {
  for (const f of ['main.js', 'world.js', 'script.js', 'avatar.js', 'shapes.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
  }
});

check('vercel.json is valid and static', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.framework, null);
  assert.equal(v.outputDirectory, '.');
  assert.equal(v.cleanUrls, true);
  assert.ok(Array.isArray(v.headers) && v.headers.length >= 1);
});

check('index.html has required landmarks and ids', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Bot Tracker/);
  for (const id of ['office', 'stage', 'side', 'roster', 'feed', 'incidents', 'teamGauges', 'chatty', 'modeLabel', 'clock']) {
    assert.ok(html.includes(`id="${id}"`), 'missing id ' + id);
  }
  assert.match(html, /<script type="module" src="\/main.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/style.css">/);
  assert.match(html, /data-tab="team"/);
  assert.match(html, /data-tab="flow"/);
  assert.match(html, /data-tab="alerts"/);
  assert.match(html, /prefers-reduced-motion|Replay/); // chip still present for JS
  assert.ok(html.includes('aria-label="Aerial view of a virtual office'), 'canvas aria-label');
});

check('style.css is balanced and keeps hidden replay chip', () => {
  const css = read('style.css');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, `unbalanced braces ${open} vs ${close}`);
  assert.match(css, /\.modechip\{[^}]*display:none !important/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /\.bottombar/);
  assert.match(css, /--bg:/);
});

check('favicon.svg is a well-formed SVG', () => {
  const svg = read('favicon.svg');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>\s*$/);
});

const world = await import(pathToFileURL(path.join(root, 'world.js')).href);
const script = await import(pathToFileURL(path.join(root, 'script.js')).href);
const shapes = await import(pathToFileURL(path.join(root, 'shapes.js')).href);

check('cast is complete and consistent', () => {
  const ids = world.BOTS.map((b) => b.id);
  assert.deepEqual(ids, ['ara', 'stan', 'researchy', 'pete', 'nikolai', 'yahn', 'jeff', 'wedding']);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of world.BOTS) {
    assert.ok(b.name && b.role && b.color && b.finish && b.shape, b.id + ' missing fields');
    assert.ok(Array.isArray(b.work) && b.work.length >= 4, b.id + ' work');
    assert.ok(Array.isArray(b.thoughts) && b.thoughts.length >= 1, b.id + ' thoughts');
    assert.ok(shapes.SHAPES[b.shape], b.id + ' shape');
    assert.ok(shapes.EYES[b.shape], b.id + ' eyes');
    assert.ok(world.BOT[b.id] === b);
    const seat = world.seatLoc(b.id);
    assert.ok(seat.chain && seat.chain.length >= 2, b.id + ' seat chain');
    const route = world.route(seat, world.SPOTS.door);
    assert.ok(route.length >= 1, b.id + ' route to door');
    assert.ok(world.routeLen(seat, world.SPOTS.door) > 0, b.id + ' route length');
  }
  assert.equal(world.DESKS.length, 16);
  assert.equal(world.BOTS.find((b) => b.id === 'wedding').name, 'Wendy');
  assert.ok(Number.isFinite(world.SPEED) && world.SPEED > 0);
});

check('four loops build deterministically and keep core deliveries', () => {
  assert.equal(script.LOOP_LEN, 300);
  assert.equal(script.LOOPS.length, 4);
  for (const def of script.LOOPS) {
    const before = JSON.stringify(def);
    const events = script.buildLoop(def);
    assert.equal(JSON.stringify(def), before, def.name + ' mutated');
    assert.deepEqual(script.buildLoop(def), events, def.name + ' not deterministic');
    const corePh = def.core.filter((e) => e.k === 'd').map((e) => e.ph).sort();
    const builtPh = events.filter((e) => e.k === 'd').map((e) => e.ph).sort();
    assert.deepEqual(builtPh, corePh, def.name + ' lost a delivery');
    for (const e of events) {
      assert.ok(Number.isFinite(e.t) && e.t >= 0, def.name + ' bad time');
      if (e.k === 'd') {
        const dur = e.dur ?? e.total;
        if (Number.isFinite(dur)) assert.ok(e.t + dur <= script.LOOP_LEN + 1e-6, def.name + ' late delivery');
      }
    }
    assert.ok(events.some((e) => e.k === 'd'), def.name + ' has deliveries');
  }
});

check('main.js keeps ambient bubble guards and plaque priority', () => {
  const js = read('main.js');
  for (const token of ['updateAmbient', 'firstAmbientAt', 'AMBIENT_DUR', 'AMBIENT_GAP', 'AMBIENT_MAX', 'AMBIENT_NEAR', 'lastAmbientStart', 'b.ambient']) {
    assert.ok(js.includes(token), 'missing ' + token);
  }
  assert.match(js, /Task and error plaques always take the slot/);
  assert.match(js, /else if \(v\.b\.ambient && v\.b\.ambient\.until > simT\)/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  // remaining pose and desk motions stay behind the same reduced-motion flag
  assert.match(js, /if \(!reducedMotion && b\.mode === 'stretch'\)/);
  assert.match(js, /if \(!reducedMotion && b\.mode === 'hold' && b\.status\.startsWith\('Chatting'\)\)/);
  assert.match(js, /if \(!reducedMotion && b\.chatWith && b\.chatWith\.until > simT\)/);
  assert.match(js, /if \(!reducedMotion && b\.react > 0\)/);
  assert.match(js, /if \(!reducedMotion && b\.phoneUntil > simT && b\.mode !== 'walk'\)/);
  assert.match(js, /if \(!reducedMotion\) \{[\s\S]*?b\.jtx = \(rnd\(\) - \.5\) \* 7[\s\S]*?b\.tilt \+= \(b\.ttilt - b\.tilt\) \* ks;\s*\}/);
  // replay chip elements still updated
  assert.match(js, /modeEl\.textContent/);
  assert.match(js, /clockEl\.textContent/);
});

if (fails.length) {
  console.error('\n' + fails.length + ' check(s) failed.');
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
