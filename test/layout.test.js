// test/layout.test.js
//
// Layout contracts for the generated dashboard.
//
// This repo has no browser test harness, so the responsive behaviour cannot be
// observed here — it was measured once with a real Chromium at 1470x865,
// 1440x810, 1280x710, 1100x700, 860x700 and 760x620 (all 19 nav sections
// reachable, no document-level horizontal overflow, 10px scrollbar gutter in
// column mode). These assertions pin the CSS that produced that result so a
// later edit cannot silently undo it.
//
// Same approach as the CSS/JS contracts in mtaylor45/worldmonitor's
// tests/test_static_assets.py: when you cannot watch it, pin it.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let css = '';

before(() => {
  execFileSync(process.execPath, ['src/generate.js', '--no-open'], { cwd: ROOT, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf-8');
  const start = html.indexOf('<style>');
  const end = html.lastIndexOf('</style>');
  assert.ok(start > -1 && end > start, 'generated dashboard has a <style> block');
  css = html.slice(start, end);
});

describe('layout: grid cannot blow out horizontally', () => {
  // A grid item's automatic minimum size is its min-content width. The nowrap
  // data cascade and the stat tiles push that past 1280px, so a plain 1fr
  // column grows to fit them and body{overflow:hidden} clips the excess —
  // measured as 49px of unreachable top/stats bar at 1280 wide.
  test('content column is minmax(0,1fr), not 1fr', () => {
    assert.match(css, /\.lcars\{[^}]*grid-template-columns:var\(--sb-w\) minmax\(0,1fr\)/);
  });

  test('content row is minmax(0,1fr), not 1fr', () => {
    assert.match(css, /\.lcars\{[^}]*grid-template-rows:[^;]*minmax\(0,1fr\)/);
  });

  test('every column-2 grid child sets min-width:0', () => {
    for (const sel of ['tb', 'stb', 'brb', 'mn', 'bb']) {
      const rule = new RegExp('\\.' + sel + '\\{[^}]*min-width:0');
      assert.match(css, rule, `.${sel} must set min-width:0 or it forces the column wide`);
    }
  });

  test('flex children holding nowrap content set min-width:0', () => {
    for (const sel of ['tb-fill', 'tb-dc', 'stb-inner']) {
      const rule = new RegExp('\\.' + sel + '\\{[^}]*min-width:0');
      assert.match(css, rule, `.${sel} must set min-width:0 to shrink instead of overflowing`);
    }
  });
});

describe('layout: the nav scroll affordance', () => {
  // 19 sections at the old fixed 54px need ~1098px. On a 13" panel the nav box
  // is ~520-680px, so it always scrolls. With overflow-y:auto and overlay
  // scrollbars the track reserved 0px and showed no thumb at rest, so ten
  // sections read as absent rather than as scrollable.
  test('nav scrolls vertically with a reserved gutter', () => {
    const m = css.match(/\.sb-nav\{([^}]*)\}/);
    assert.ok(m, '.sb-nav rule exists');
    const rule = m[1];
    assert.match(rule, /overflow-y:scroll/, 'overflow-y must be scroll, not auto — auto reserves no gutter');
    assert.match(rule, /scrollbar-gutter:stable/, 'the reserved gutter is the affordance');
    assert.match(rule, /min-height:0/, 'without min-height:0 a flex child will not shrink');
  });

  test('nav does not scroll horizontally in column mode', () => {
    assert.match(css, /\.sb-nav\{[^}]*overflow-x:hidden/);
  });
});

describe('layout: fluid scale tokens', () => {
  test('layout scale tokens are declared on :root', () => {
    for (const v of ['--sb-w', '--row-top', '--row-stats', '--row-burn', '--row-foot', '--nb-h', '--nb-fs']) {
      assert.ok(css.includes(v + ':'), `${v} must be declared`);
    }
  });

  test('nav buttons scale with viewport height and keep a legible floor', () => {
    assert.match(css, /--nb-h:clamp\(34px,[^)]*\)/, 'nav button height clamps to a 34px floor');
    assert.match(css, /--nb-fs:clamp\(0\.78rem,[^)]*\)/, 'nav button font clamps to a 0.78rem floor');
    assert.match(css, /\.nb\{[^}]*min-height:var\(--nb-h\)/);
    assert.match(css, /\.nb\{[^}]*font-size:var\(--nb-fs\)/);
  });

  test('the stats row does not shrink below the 48px its labels need', () => {
    // v1.7.1 raised this row so the label under each count stops clipping.
    // Short-viewport space is taken from --row-burn instead.
    assert.match(css, /--row-stats:clamp\(48px,/, 'stats row floor stays at 48px');
    assert.match(css, /--row-burn:clamp\(26px,/, 'burn row may shrink to its 26px of content');
  });

  test('the sidebar header shares --row-top with the top bar', () => {
    // The LCARS elbow only reads correctly if the rail header and the top bar
    // terminate at the same y.
    assert.match(css, /\.sb-top\{[^}]*min-height:var\(--row-top\)/);
    assert.match(css, /grid-template-rows:var\(--row-top\)/);
  });
});

describe('layout: breakpoints', () => {
  test('narrow-desktop bands narrow the rail instead of clipping', () => {
    assert.ok(css.includes('@media(max-width:1180px)'), '1180px band exists');
    assert.ok(css.includes('@media(max-width:1020px)'), '1020px band exists');
  });

  test('below 900px the rail becomes a horizontal strip, not display:none', () => {
    const i = css.indexOf('@media(max-width:900px){\n  :root{--sb-w:0px}');
    assert.ok(i > -1, 'the tablet band exists and zeroes --sb-w');
    const block = css.slice(i, css.indexOf('}\n', css.indexOf('.dp{position:fixed', i)));
    assert.doesNotMatch(block, /\.sb\{[^}]*display:none/,
      'hiding .sb removes every route into the dashboard with nothing in its place');
    assert.match(block, /\.sb-nav\{[^}]*flex-direction:row/, 'nav becomes a row');
    assert.match(block, /\.sb-nav\{[^}]*overflow-x:auto/, 'the row scrolls horizontally');
  });
});

describe('layout: no hardcoded sidebar width', () => {
  test('fixed overlays track --sb-w', () => {
    assert.match(css, /\.computer-bar\{[^}]*left:var\(--sb-w\)/);
    assert.match(css, /\.computer-response\{[^}]*left:var\(--sb-w\)/);
  });

  test('no rule pins anything to the old literal 240px sidebar', () => {
    assert.doesNotMatch(css, /left:240px/,
      'a literal 240px breaks the narrow-desktop bands, which change --sb-w');
  });
});
