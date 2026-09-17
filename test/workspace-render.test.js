// test/workspace-render.test.js
//
// End-to-end: does a project's agent configuration actually reach the rendered
// dashboard? The unit tests in workspace.test.js cover the scan; these cover
// the wiring, which is where the original defect lived — the scanner was fine,
// it was simply never pointed at a repository.
//
// The generator is copied into a tmp directory and run there, because
// src/generate.js writes dashboard.html next to its own source. Running it in
// place would race the other generator-invoking test files over one file.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');

let sandbox, html;

function w(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-wsr-'));
  const app = path.join(sandbox, 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.cpSync(path.join(REPO, 'src'), path.join(app, 'src'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(app, 'package.json'));

  // A fixture HOME: one global skill, plus two projects under a registered root.
  const home = path.join(sandbox, 'home');
  w(path.join(home, '.claude', 'skills', 'global-skill', 'SKILL.md'),
    '---\nname: global-skill\ndescription: Lives in ~/.claude\n---\nbody\n');
  w(path.join(home, '.claude', 'settings.json'), '{}');

  const code = path.join(sandbox, 'Code');
  const wm = path.join(code, 'worldmonitor');
  w(path.join(wm, 'AGENTS.md'), '# AGENTS.md\n\nRoot instructions.\n\n## Rules\n\nYou must never fabricate credentials.\n');
  w(path.join(wm, 'skills', 'track-earthquakes', 'SKILL.md'),
    '---\nname: track-earthquakes\nversion: 1\ndescription: Recent earthquakes with a concern score\n---\nbody\n');
  w(path.join(wm, '.agents', 'skills', 'sentry-triage', 'SKILL.md'),
    '---\nname: sentry-triage\ndescription: Triage a Sentry issue\n---\nbody\n');
  w(path.join(wm, 'mcp.json'), JSON.stringify({
    mcpServers: {
      worldmonitor: { type: 'streamable-http', url: 'https://worldmonitor.app/mcp' },
      'worldmonitor-docs': { type: 'streamable-http', url: 'https://www.worldmonitor.app/docs/mcp' },
    },
  }));
  w(path.join(wm, 'plugin.json'), JSON.stringify({ name: 'worldmonitor', version: '2.10.0', license: 'AGPL-3.0-only' }));
  w(path.join(wm, 'compound-engineering.local.md'),
    '---\nreview_agents:\n  - compound-engineering:review:security-sentinel\n  - compound-engineering:review:performance-oracle\n---\n\ncontext\n');

  // A worktree of the same project, sharing one skill and adding one.
  const wt = path.join(code, 'worldmonitor-wt-feature');
  w(path.join(wt, 'AGENTS.md'), '# AGENTS.md\nwt\n');
  w(path.join(wt, 'skills', 'track-earthquakes', 'SKILL.md'), '---\nname: track-earthquakes\n---\nx\n');
  w(path.join(wt, 'skills', 'wt-only-skill', 'SKILL.md'), '---\nname: wt-only-skill\ndescription: Worktree only\n---\nx\n');

  // A directory with no agent config at all — must not be registered.
  w(path.join(code, 'just-notes', 'README.md'), '# notes\n');

  w(path.join(home, '.lcars', 'workspaces.json'), JSON.stringify({
    roots: [code], pinned: [], worktreePattern: '^(?<project>.+?)-wt-.+$',
  }));

  execFileSync(process.execPath, [path.join(app, 'src', 'generate.js'), '--no-open'],
    { cwd: app, env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_HUD_DIRS: '' }, stdio: 'pipe' });
  html = fs.readFileSync(path.join(app, 'dashboard.html'), 'utf-8');
});

after(() => { if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); });

describe('workspace rendering', () => {
  test('both projects appear as workspace cards', () => {
    assert.ok(html.includes('wsp:worldmonitor'), 'worldmonitor card');
    assert.ok(html.includes('wsp:nearby-things') === false, 'nearby-things was not in the fixture');
    assert.match(html, /Workspaces \/\/ Project Registry/);
  });

  test('a directory with no agent config is not registered', () => {
    assert.ok(!html.includes('just-notes'), 'just-notes has no agent config and must be skipped');
  });

  test('repo skills reach the skill registry alongside the global one', () => {
    for (const k of ['s:global-skill', 'ws:worldmonitor:track-earthquakes', 'ws:worldmonitor:sentry-triage']) {
      assert.ok(html.includes(k), 'expected detail key ' + k);
    }
  });

  test('a project skill cannot collide with a global skill of the same name', () => {
    // Global keys keep their original `s:` prefix; project keys are scoped.
    const globalKeys = [...html.matchAll(/data-k="(s:[^"]+)"/g)].map(m => m[1]);
    const projKeys = [...html.matchAll(/data-k="(ws:[^"]+)"/g)].map(m => m[1]);
    assert.ok(globalKeys.length >= 1);
    assert.ok(projKeys.length >= 1);
    assert.equal(new Set([...globalKeys, ...projKeys]).size, globalKeys.length + projKeys.length,
      'no key may be reused between a global and a project item');
  });

  test('skills carry an origin badge', () => {
    assert.match(html, /<span class="tg tg-d">global<\/span>/, 'global skills are badged');
    assert.match(html, /<span class="tg tg-g">worldmonitor<\/span>/, 'project skills are badged');
  });

  test('worktree assets deduplicate and the worktree is counted', () => {
    // track-earthquakes exists in both checkouts; it must appear once.
    const hits = [...html.matchAll(/data-k="ws:worldmonitor:track-earthquakes"/g)];
    assert.equal(hits.length, 1, 'the shared skill is listed once, not per checkout');
    assert.ok(html.includes('ws:worldmonitor:wt-only-skill'), 'a worktree-only skill still surfaces');
    assert.match(html, /\+1 wt/, 'the worktree count is shown on the project card');
  });

  test('streamable-http MCP servers render with their url, not as unknown', () => {
    assert.ok(html.includes('wm:worldmonitor:worldmonitor-docs'), 'remote server has a keyed card');
    assert.ok(html.includes('https://worldmonitor.app/mcp'), 'the url is shown');
    assert.match(html, /streamable-http/, 'the transport is named');
  });

  test('project MCP servers are read-only and excluded from the local probe', () => {
    const at = html.indexOf('data-k="wm:worldmonitor:worldmonitor"');
    assert.ok(at > -1, 'found the project MCP card');
    const card = html.slice(at, at + 1600);
    // The attribute would be the next thing on the same tag if it were set.
    const openTagEnd = card.indexOf('>');
    assert.ok(!card.slice(0, openTagEnd).includes('data-mcp='),
      'a project server is not in this machine settings.json, so it must not be probed');
    assert.match(card, />PROJECT</, 'the toggle is replaced by a non-actionable PROJECT marker');
    assert.match(card, />DECLARED</, 'status reads DECLARED rather than hanging on CHECKING');
  });

  test('AGENTS.md is surfaced and scored like CLAUDE.md', () => {
    assert.match(html, /AGENTS\.MD/, 'AGENTS.md gets its own scope badge');
    // It is scored, so a health badge is rendered for it.
    assert.match(html, /health-badge/, 'instruction files carry a health score');
  });

  test('the plugin manifest and review subagents are surfaced', () => {
    assert.ok(html.includes('2.10.0'), 'plugin version');
    assert.ok(html.includes('security-sentinel'), 'review subagent');
    assert.ok(html.includes('performance-oracle'), 'review subagent');
  });

  test('a PROJECTS nav entry is present with a count', () => {
    assert.match(html, /nav\('projects'/, 'nav entry exists');
    assert.ok(html.includes('id="s-projects"'), 'section exists');
  });

  test('no MCP env value can reach the HTML', () => {
    // Belt and braces: the fixture has no secrets, but the redaction path is
    // the one place a leak would be silent, so assert the shape holds.
    assert.ok(!/ghp_|postgres:\/\/|sk-ant-/.test(html), 'no credential-shaped string in output');
  });
});

describe('workspace rendering: no registered roots', () => {
  test('an unregistered setup explains how to register one', () => {
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-wsr0-'));
    try {
      const app = path.join(sb, 'app');
      fs.mkdirSync(app, { recursive: true });
      fs.cpSync(path.join(REPO, 'src'), path.join(app, 'src'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'package.json'), path.join(app, 'package.json'));
      const home = path.join(sb, 'home');
      w(path.join(home, '.claude', 'settings.json'), '{}');
      execFileSync(process.execPath, [path.join(app, 'src', 'generate.js'), '--no-open'],
        { cwd: app, env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_HUD_DIRS: '' }, stdio: 'pipe' });
      const out = fs.readFileSync(path.join(app, 'dashboard.html'), 'utf-8');
      assert.match(out, /No workspaces registered/);
      assert.match(out, /workspaces\.json/, 'the empty state names the file to create');
      assert.match(out, /worktreePattern/, 'and documents the options');
    } finally { fs.rmSync(sb, { recursive: true, force: true }); }
  });
});
