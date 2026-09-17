// test/workspace.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  expandHome, workspaceConfigPath, loadWorkspaceConfig, looksLikeProject,
  resolveProjectIdentity, discoverProjects, scanProjectSkills, parseMcpTransport,
  scanProjectMcp, scanProjectInstructions, scanProjectPlugin, scanProjectSubagents,
  scanProject, scanWorkspaces,
} from '../src/lib/workspace.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hud-ws-')); }
function rm(d) { fs.rmSync(d, { recursive: true, force: true }); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

describe('expandHome', () => {
  test('expands a leading tilde', () => {
    assert.equal(expandHome('~/Code', '/home/me'), path.join('/home/me', 'Code'));
    assert.equal(expandHome('~', '/home/me'), '/home/me');
  });
  test('leaves absolute and relative paths alone', () => {
    assert.equal(expandHome('/abs/path', '/home/me'), '/abs/path');
    assert.equal(expandHome('rel/path', '/home/me'), 'rel/path');
  });
  test('does not expand a tilde mid-path or a ~user form', () => {
    assert.equal(expandHome('/a/~/b', '/home/me'), '/a/~/b');
    assert.equal(expandHome('~other/Code', '/home/me'), '~other/Code');
  });
  test('tolerates non-strings', () => {
    assert.equal(expandHome(null), '');
    assert.equal(expandHome(undefined), '');
    assert.equal(expandHome(''), '');
  });
});

describe('loadWorkspaceConfig', () => {
  test('missing config is not an error', () => {
    const d = tmp();
    try {
      const cfg = loadWorkspaceConfig(d, {}, '/home/me');
      assert.deepEqual(cfg.roots, []);
      assert.deepEqual(cfg.pinned, []);
      assert.equal(cfg.worktreePattern, null);
      assert.equal(cfg.error, null);
    } finally { rm(d); }
  });

  test('reads roots, pinned and worktreePattern, expanding tildes', () => {
    const d = tmp();
    try {
      write(workspaceConfigPath(d), JSON.stringify({
        roots: ['~/Code', '/srv/work'],
        pinned: ['~/Code/worldmonitor'],
        worktreePattern: '^(?<project>.+?)-wt-.+$',
      }));
      const cfg = loadWorkspaceConfig(d, {}, '/home/me');
      assert.deepEqual(cfg.roots, [path.join('/home/me', 'Code'), '/srv/work']);
      assert.deepEqual(cfg.pinned, [path.join('/home/me', 'Code', 'worldmonitor')]);
      assert.equal(cfg.worktreePattern, '^(?<project>.+?)-wt-.+$');
    } finally { rm(d); }
  });

  test('malformed JSON is reported, not thrown', () => {
    const d = tmp();
    try {
      write(workspaceConfigPath(d), '{ not json');
      const cfg = loadWorkspaceConfig(d, {}, '/home/me');
      assert.match(cfg.error, /parse error/);
      assert.deepEqual(cfg.roots, []);
    } finally { rm(d); }
  });

  test('CLAUDE_HUD_DIRS is merged in and deduplicated', () => {
    const d = tmp();
    try {
      write(workspaceConfigPath(d), JSON.stringify({ roots: ['/srv/a'] }));
      const cfg = loadWorkspaceConfig(d, { CLAUDE_HUD_DIRS: '/srv/a:/srv/b:~/c' }, '/home/me');
      assert.deepEqual(cfg.roots, ['/srv/a', '/srv/b', path.join('/home/me', 'c')]);
    } finally { rm(d); }
  });

  test('ignores non-array and non-string entries', () => {
    const d = tmp();
    try {
      write(workspaceConfigPath(d), JSON.stringify({ roots: 'nope', pinned: [1, null, '/ok'], worktreePattern: 5 }));
      const cfg = loadWorkspaceConfig(d, {}, '/home/me');
      assert.deepEqual(cfg.roots, []);
      assert.deepEqual(cfg.pinned, ['/ok']);
      assert.equal(cfg.worktreePattern, null);
    } finally { rm(d); }
  });
});

describe('looksLikeProject', () => {
  test('recognises each marker', () => {
    for (const marker of ['AGENTS.md', 'CLAUDE.md', 'mcp.json', '.mcp.json', 'plugin.json']) {
      const d = tmp();
      try {
        write(path.join(d, marker), 'x');
        assert.equal(looksLikeProject(d), true, marker + ' should mark a project');
      } finally { rm(d); }
    }
    for (const dirMarker of ['skills', '.agents', '.claude']) {
      const d = tmp();
      try {
        fs.mkdirSync(path.join(d, dirMarker), { recursive: true });
        assert.equal(looksLikeProject(d), true, dirMarker + '/ should mark a project');
      } finally { rm(d); }
    }
  });

  test('a plain directory is not a project', () => {
    const d = tmp();
    try {
      write(path.join(d, 'README.md'), '# hi');
      assert.equal(looksLikeProject(d), false);
    } finally { rm(d); }
  });
});

describe('resolveProjectIdentity', () => {
  test('without a pattern every directory is its own project', () => {
    assert.deepEqual(resolveProjectIdentity('/a/worldmonitor-wt-x'), { name: 'worldmonitor-wt-x', isWorktree: false });
  });

  test('named capture group collapses a suffix worktree', () => {
    const r = resolveProjectIdentity('/a/worldmonitor-wt-feature', '^(?<project>.+?)-wt-.+$');
    assert.deepEqual(r, { name: 'worldmonitor', isWorktree: true });
  });

  test('falls back to capture group 1', () => {
    const r = resolveProjectIdentity('/a/worldmonitor-wt-feature', '^(.+?)-wt-.+$');
    assert.deepEqual(r, { name: 'worldmonitor', isWorktree: true });
  });

  test('matches against the full path for nested worktrees', () => {
    const r = resolveProjectIdentity('/a/worldmonitor/.worktrees/feat', '^(?<project>.+?)/\\.worktrees/.+$');
    assert.deepEqual(r, { name: 'worldmonitor', isWorktree: true });
  });

  test('a non-matching directory is not a worktree', () => {
    const r = resolveProjectIdentity('/a/nearby-things', '^(?<project>.+?)-wt-.+$');
    assert.deepEqual(r, { name: 'nearby-things', isWorktree: false });
  });

  test('an invalid regex degrades instead of throwing', () => {
    const r = resolveProjectIdentity('/a/proj', '^(unclosed');
    assert.deepEqual(r, { name: 'proj', isWorktree: false });
  });
});

describe('discoverProjects', () => {
  test('finds projects one level down and skips non-projects', () => {
    const d = tmp();
    try {
      write(path.join(d, 'root', 'proj-a', 'AGENTS.md'), 'a');
      write(path.join(d, 'root', 'proj-b', 'mcp.json'), '{}');
      write(path.join(d, 'root', 'not-a-proj', 'README.md'), 'x');
      const got = discoverProjects([path.join(d, 'root')]);
      assert.deepEqual(got.map(p => path.basename(p)), ['proj-a', 'proj-b']);
    } finally { rm(d); }
  });

  test('skips ignored and dotted directories', () => {
    const d = tmp();
    try {
      write(path.join(d, 'root', 'node_modules', 'AGENTS.md'), 'x');
      write(path.join(d, 'root', '.hidden', 'AGENTS.md'), 'x');
      write(path.join(d, 'root', 'dist', 'CLAUDE.md'), 'x');
      assert.deepEqual(discoverProjects([path.join(d, 'root')]), []);
    } finally { rm(d); }
  });

  test('a missing root is skipped, not fatal', () => {
    assert.deepEqual(discoverProjects(['/definitely/not/here']), []);
  });

  test('pinned directories are included even outside a root', () => {
    const d = tmp();
    try {
      const pin = path.join(d, 'elsewhere', 'pinned-proj');
      write(path.join(pin, 'AGENTS.md'), 'x');
      const got = discoverProjects([], [pin]);
      assert.deepEqual(got, [pin]);
    } finally { rm(d); }
  });

  test('a pinned directory that is not a project is skipped', () => {
    const d = tmp();
    try {
      const pin = path.join(d, 'empty');
      fs.mkdirSync(pin, { recursive: true });
      assert.deepEqual(discoverProjects([], [pin]), []);
    } finally { rm(d); }
  });

  test('does not list the same directory twice', () => {
    const d = tmp();
    try {
      const p = path.join(d, 'root', 'proj');
      write(path.join(p, 'AGENTS.md'), 'x');
      assert.deepEqual(discoverProjects([path.join(d, 'root')], [p]), [p]);
    } finally { rm(d); }
  });
});

describe('scanProjectSkills', () => {
  test('reads skills/, .agents/skills/ and .claude/skills/', () => {
    const d = tmp();
    try {
      write(path.join(d, 'skills', 'track-quakes', 'SKILL.md'),
        '---\nname: track-earthquakes\nversion: 1\ndescription: Find quakes\n---\n\n# body one\n');
      write(path.join(d, '.agents', 'skills', 'sentry-triage', 'SKILL.md'),
        '---\nname: sentry-triage\n---\n\n# body two\n');
      write(path.join(d, '.claude', 'skills', 'local-thing', 'SKILL.md'), 'no frontmatter\n');
      const got = scanProjectSkills(d);
      assert.deepEqual(got.map(s => s.name), ['local-thing', 'sentry-triage', 'track-earthquakes']);
      const quake = got.find(s => s.name === 'track-earthquakes');
      assert.equal(quake.ver, '1');
      assert.equal(quake.desc, 'Find quakes');
      assert.equal(quake.origin, 'skills/');
      assert.match(quake.body, /body one/);
      assert.equal(got.find(s => s.name === 'sentry-triage').origin, '.agents/skills/');
      // No frontmatter: falls back to the directory name.
      assert.equal(got.find(s => s.name === 'local-thing').origin, '.claude/skills/');
    } finally { rm(d); }
  });

  test('a directory without SKILL.md is skipped', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'skills', 'empty'), { recursive: true });
      assert.deepEqual(scanProjectSkills(d), []);
    } finally { rm(d); }
  });

  test('no skills directories at all returns empty', () => {
    const d = tmp();
    try { assert.deepEqual(scanProjectSkills(d), []); } finally { rm(d); }
  });

  test('description is capped at 200 chars', () => {
    const d = tmp();
    try {
      write(path.join(d, 'skills', 'x', 'SKILL.md'), '---\ndescription: ' + 'z'.repeat(400) + '\n---\n');
      assert.equal(scanProjectSkills(d)[0].desc.length, 200);
    } finally { rm(d); }
  });
});

describe('parseMcpTransport', () => {
  test('classifies remote transports and keeps the url', () => {
    for (const type of ['streamable-http', 'http', 'sse']) {
      const r = parseMcpTransport({ type, url: 'https://example.com/mcp' });
      assert.equal(r.remote, true, type + ' is remote');
      assert.equal(r.transport, type);
      assert.equal(r.url, 'https://example.com/mcp');
      assert.equal(r.display, 'https://example.com/mcp');
    }
  });

  test('a bare url with no type is treated as http', () => {
    const r = parseMcpTransport({ url: 'https://x/mcp' });
    assert.equal(r.remote, true);
    assert.equal(r.transport, 'http');
  });

  test('type is matched case-insensitively', () => {
    assert.equal(parseMcpTransport({ type: 'Streamable-HTTP', url: 'https://x' }).remote, true);
  });

  test('classifies stdio runners', () => {
    assert.equal(parseMcpTransport({ command: 'node', args: ['s.js'] }).transport, 'node');
    assert.equal(parseMcpTransport({ command: 'npx', args: ['-y', 'p'] }).transport, 'npx');
    assert.equal(parseMcpTransport({ command: 'bunx', args: ['p'] }).transport, 'npx');
    assert.equal(parseMcpTransport({ command: 'uvx', args: ['p'] }).transport, 'python');
    assert.equal(parseMcpTransport({ command: 'uv', args: ['run'] }).transport, 'python');
    assert.equal(parseMcpTransport({ command: 'docker', args: ['run'] }).transport, 'docker');
    assert.equal(parseMcpTransport({ command: 'podman', args: ['run'] }).transport, 'docker');
    assert.equal(parseMcpTransport({ command: './bin/srv' }).transport, 'stdio');
  });

  test('stdio entries are not remote and display the command line', () => {
    const r = parseMcpTransport({ command: 'npx', args: ['-y', 'pkg'] });
    assert.equal(r.remote, false);
    assert.equal(r.url, '');
    assert.equal(r.display, 'npx -y pkg');
  });

  test('an empty entry is unknown rather than a crash', () => {
    assert.equal(parseMcpTransport({}).transport, 'unknown');
    assert.equal(parseMcpTransport(null).transport, 'unknown');
    assert.equal(parseMcpTransport(undefined).display, 'unknown');
  });
});

describe('scanProjectMcp', () => {
  test('reads mcp.json — not just the dotted name', () => {
    const d = tmp();
    try {
      write(path.join(d, 'mcp.json'), JSON.stringify({
        mcpServers: {
          worldmonitor: { type: 'streamable-http', url: 'https://worldmonitor.app/mcp' },
          'worldmonitor-docs': { type: 'streamable-http', url: 'https://www.worldmonitor.app/docs/mcp' },
        },
      }));
      const got = scanProjectMcp(d);
      assert.deepEqual(got.map(s => s.name), ['worldmonitor', 'worldmonitor-docs']);
      assert.equal(got[0].remote, true);
      assert.equal(got[0].url, 'https://worldmonitor.app/mcp');
      assert.equal(got[0].source, 'mcp.json');
    } finally { rm(d); }
  });

  test('reads .mcp.json and .claude/settings.json too', () => {
    const d = tmp();
    try {
      write(path.join(d, '.mcp.json'), JSON.stringify({ mcpServers: { dotted: { command: 'node' } } }));
      write(path.join(d, '.claude', 'settings.json'), JSON.stringify({ mcpServers: { settings: { command: 'npx' } } }));
      assert.deepEqual(scanProjectMcp(d).map(s => s.name), ['dotted', 'settings']);
    } finally { rm(d); }
  });

  test('mcp.json wins over a duplicate name in a later source', () => {
    const d = tmp();
    try {
      write(path.join(d, 'mcp.json'), JSON.stringify({ mcpServers: { dup: { type: 'sse', url: 'https://a' } } }));
      write(path.join(d, '.mcp.json'), JSON.stringify({ mcpServers: { dup: { command: 'node' } } }));
      const got = scanProjectMcp(d);
      assert.equal(got.length, 1);
      assert.equal(got[0].source, 'mcp.json');
      assert.equal(got[0].url, 'https://a');
    } finally { rm(d); }
  });

  test('env values are redacted and counted', () => {
    const d = tmp();
    try {
      write(path.join(d, 'mcp.json'), JSON.stringify({
        mcpServers: { s: { command: 'node', env: { TOKEN: 'ghp_secret', URL: 'postgres://u:p@h/db' } } },
      }));
      const got = scanProjectMcp(d);
      assert.equal(got[0].envCount, 2);
      assert.equal(got[0].config.env, '{redacted — 2 vars}');
      assert.ok(!JSON.stringify(got[0]).includes('ghp_secret'), 'no secret may reach the record');
      assert.ok(!JSON.stringify(got[0]).includes('postgres://'), 'no secret may reach the record');
    } finally { rm(d); }
  });

  test('an env-less server carries no env key', () => {
    const d = tmp();
    try {
      write(path.join(d, 'mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'node' } } }));
      assert.equal(scanProjectMcp(d)[0].config.env, undefined);
      assert.equal(scanProjectMcp(d)[0].envCount, 0);
    } finally { rm(d); }
  });

  test('malformed or irrelevant files are skipped', () => {
    const d = tmp();
    try {
      write(path.join(d, 'mcp.json'), '{ broken');
      write(path.join(d, '.mcp.json'), JSON.stringify({ somethingElse: true }));
      assert.deepEqual(scanProjectMcp(d), []);
    } finally { rm(d); }
  });
});

describe('scanProjectInstructions', () => {
  test('treats AGENTS.md as a peer of CLAUDE.md', () => {
    const d = tmp();
    try {
      write(path.join(d, 'AGENTS.md'), '# agents\nline\n');
      write(path.join(d, 'CLAUDE.md'), '# claude\n');
      write(path.join(d, '.claude', 'CLAUDE.md'), '# nested\n');
      const got = scanProjectInstructions(d);
      assert.deepEqual(got.map(i => i.rel), ['AGENTS.md', 'CLAUDE.md', path.join('.claude', 'CLAUDE.md')]);
      assert.equal(got[0].kind, 'AGENTS.md');
      assert.equal(got[0].lines, 3);
    } finally { rm(d); }
  });

  test('a project with neither returns empty', () => {
    const d = tmp();
    try { assert.deepEqual(scanProjectInstructions(d), []); } finally { rm(d); }
  });
});

describe('scanProjectPlugin', () => {
  test('reads an agent-plugin manifest', () => {
    const d = tmp();
    try {
      write(path.join(d, 'plugin.json'), JSON.stringify({
        name: 'worldmonitor', version: '2.10.0', description: 'live data',
        license: 'AGPL-3.0-only', keywords: ['mcp', 'agent-skills'],
      }));
      const got = scanProjectPlugin(d);
      assert.equal(got.name, 'worldmonitor');
      assert.equal(got.version, '2.10.0');
      assert.deepEqual(got.keywords, ['mcp', 'agent-skills']);
    } finally { rm(d); }
  });

  test('missing, malformed or nameless manifests return null', () => {
    const d = tmp();
    try {
      assert.equal(scanProjectPlugin(d), null);
      write(path.join(d, 'plugin.json'), '{ broken');
      assert.equal(scanProjectPlugin(d), null);
      write(path.join(d, 'plugin.json'), JSON.stringify({ version: '1' }));
      assert.equal(scanProjectPlugin(d), null);
    } finally { rm(d); }
  });
});

describe('scanProjectSubagents', () => {
  test('reads review_agents out of frontmatter', () => {
    const d = tmp();
    try {
      write(path.join(d, 'compound-engineering.local.md'),
        '---\nreview_agents:\n  - compound-engineering:review:security-sentinel\n' +
        '  - compound-engineering:review:performance-oracle\n---\n\n# context\n');
      const got = scanProjectSubagents(d);
      assert.equal(got.length, 2);
      assert.equal(got[0].name, 'security-sentinel');
      assert.equal(got[0].plugin, 'compound-engineering');
      assert.equal(got[0].declaredIn, 'compound-engineering.local.md');
    } finally { rm(d); }
  });

  test('markdown without review_agents is ignored', () => {
    const d = tmp();
    try {
      write(path.join(d, 'AGENTS.md'), '---\ntitle: x\n---\n# hi\n');
      write(path.join(d, 'README.md'), '# no frontmatter\n');
      assert.deepEqual(scanProjectSubagents(d), []);
    } finally { rm(d); }
  });
});

describe('scanProject', () => {
  test('rolls a directory into one record with counts', () => {
    const d = tmp();
    try {
      write(path.join(d, 'AGENTS.md'), '# a\n');
      write(path.join(d, 'mcp.json'), JSON.stringify({ mcpServers: { a: { type: 'sse', url: 'https://x' } } }));
      write(path.join(d, 'skills', 's1', 'SKILL.md'), '---\nname: s1\n---\n');
      write(path.join(d, 'plugin.json'), JSON.stringify({ name: 'p', version: '1' }));
      const got = scanProject(d);
      assert.equal(got.name, path.basename(d));
      assert.deepEqual(got.counts, { skills: 1, mcp: 1, instructions: 1, subagents: 0 });
      assert.equal(got.plugin.name, 'p');
      assert.equal(got.isWorktree, false);
    } finally { rm(d); }
  });
});

describe('scanWorkspaces', () => {
  test('scans registered roots and totals the assets', () => {
    const d = tmp();
    try {
      const code = path.join(d, 'Code');
      write(path.join(code, 'worldmonitor', 'AGENTS.md'), '# a\n');
      write(path.join(code, 'worldmonitor', 'mcp.json'),
        JSON.stringify({ mcpServers: { wm: { type: 'streamable-http', url: 'https://wm/mcp' } } }));
      write(path.join(code, 'worldmonitor', 'skills', 'track', 'SKILL.md'), '---\nname: track\n---\n');
      write(path.join(code, 'worldmonitor', '.agents', 'skills', 'triage', 'SKILL.md'), '---\nname: triage\n---\n');
      write(path.join(code, 'nearby-things', 'CLAUDE.md'), '# c\n');
      write(workspaceConfigPath(d), JSON.stringify({ roots: [code] }));

      const got = scanWorkspaces(d, {}, '/home/me');
      assert.equal(got.error, null);
      assert.deepEqual(got.projects.map(p => p.name), ['nearby-things', 'worldmonitor']);
      assert.equal(got.totals.projects, 2);
      assert.equal(got.totals.skills, 2);
      assert.equal(got.totals.mcp, 1);
      assert.equal(got.totals.instructions, 2);
    } finally { rm(d); }
  });

  test('worktrees collapse onto their project and assets deduplicate', () => {
    const d = tmp();
    try {
      const code = path.join(d, 'Code');
      // Two checkouts of the same project, each with the same skill.
      write(path.join(code, 'wm', 'AGENTS.md'), '# a\n');
      write(path.join(code, 'wm', 'skills', 'track', 'SKILL.md'), '---\nname: track\n---\n');
      write(path.join(code, 'wm-wt-feature', 'AGENTS.md'), '# a\n');
      write(path.join(code, 'wm-wt-feature', 'skills', 'track', 'SKILL.md'), '---\nname: track\n---\n');
      write(path.join(code, 'wm-wt-feature', 'skills', 'extra', 'SKILL.md'), '---\nname: extra\n---\n');
      write(workspaceConfigPath(d), JSON.stringify({
        roots: [code], worktreePattern: '^(?<project>.+?)-wt-.+$',
      }));

      const got = scanWorkspaces(d, {}, '/home/me');
      assert.deepEqual(got.projects.map(p => p.name), ['wm']);
      const wm = got.projects[0];
      assert.equal(wm.dirs.length, 2, 'both checkouts recorded');
      assert.equal(wm.worktrees, 1);
      // `track` appears in both checkouts but must be counted once.
      assert.deepEqual(wm.skills.map(s => s.name).sort(), ['extra', 'track']);
      assert.equal(got.totals.skills, 2);
      assert.equal(got.totals.worktrees, 1);
    } finally { rm(d); }
  });

  test('without a worktreePattern each checkout stays separate', () => {
    const d = tmp();
    try {
      const code = path.join(d, 'Code');
      write(path.join(code, 'wm', 'AGENTS.md'), 'a');
      write(path.join(code, 'wm-wt-x', 'AGENTS.md'), 'a');
      write(workspaceConfigPath(d), JSON.stringify({ roots: [code] }));
      const got = scanWorkspaces(d, {}, '/home/me');
      assert.deepEqual(got.projects.map(p => p.name), ['wm', 'wm-wt-x']);
    } finally { rm(d); }
  });

  test('no registered roots yields an empty, non-erroring scan', () => {
    const d = tmp();
    try {
      const got = scanWorkspaces(d, {}, '/home/me');
      assert.deepEqual(got.projects, []);
      assert.equal(got.totals.projects, 0);
      assert.equal(got.error, null);
    } finally { rm(d); }
  });

  test('a config parse error is surfaced on the result', () => {
    const d = tmp();
    try {
      write(workspaceConfigPath(d), 'nope');
      const got = scanWorkspaces(d, {}, '/home/me');
      assert.match(got.error, /parse error/);
      assert.deepEqual(got.projects, []);
    } finally { rm(d); }
  });
});
