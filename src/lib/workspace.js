// src/lib/workspace.js
//
// Workspace awareness: read agent configuration out of project repositories,
// not just out of ~/.claude/.
//
// The dashboard was built for a setup where everything is global. That is not
// how Claude Code is actually used once a project ships its own skills, its own
// MCP servers and its own AGENTS.md — all of which are invisible to a scanner
// rooted at the home directory.
//
// Everything here is a pure function over a directory argument, matching the
// other modules in this folder: no ambient state, no side effects, fully
// testable against a tmp dir.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_LCARS_DIR = path.join(os.homedir(), '.lcars');

// Directories that are never projects, so a scan of ~/Code does not descend
// into tool caches and report them as workspaces.
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target',
  'vendor', '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.cache',
  'coverage', '.turbo', '.pnpm-store', 'Library', 'Applications',
]);

// The files and directories that make a directory worth listing as a project.
// A bare directory with none of these is not agent configuration and is
// skipped, so the registry stays signal rather than a directory listing.
const PROJECT_MARKERS = [
  'AGENTS.md', 'CLAUDE.md', 'mcp.json', '.mcp.json', 'plugin.json',
  'skills', '.agents', '.claude',
];

/** Expand a leading `~` against a home directory. */
export function expandHome(p, home = os.homedir()) {
  if (typeof p !== 'string' || !p) return '';
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

export function workspaceConfigPath(lcarsDir = DEFAULT_LCARS_DIR) {
  return path.join(lcarsDir, 'workspaces.json');
}

/**
 * Read ~/.lcars/workspaces.json.
 *
 * Absent or malformed config is not an error — it means "no workspaces
 * registered yet", and the dashboard still renders its global sections. A
 * parse error is reported to the caller rather than thrown, so the UI can say
 * so instead of the scan dying.
 *
 * CLAUDE_HUD_DIRS (colon-separated) is still honoured and merged in, so the
 * documented environment variable keeps working.
 *
 * @returns {{roots:string[], pinned:string[], worktreePattern:string|null, error:string|null}}
 */
export function loadWorkspaceConfig(lcarsDir = DEFAULT_LCARS_DIR, env = process.env, home = os.homedir()) {
  const out = { roots: [], pinned: [], worktreePattern: null, error: null };
  const p = workspaceConfigPath(lcarsDir);

  if (fs.existsSync(p)) {
    let raw;
    try { raw = fs.readFileSync(p, 'utf-8'); } catch (e) { out.error = 'unreadable: ' + e.message; raw = null; }
    if (raw !== null) {
      try {
        const cfg = JSON.parse(raw);
        if (Array.isArray(cfg.roots)) out.roots = cfg.roots.filter(x => typeof x === 'string' && x);
        if (Array.isArray(cfg.pinned)) out.pinned = cfg.pinned.filter(x => typeof x === 'string' && x);
        if (typeof cfg.worktreePattern === 'string' && cfg.worktreePattern) {
          out.worktreePattern = cfg.worktreePattern;
        }
      } catch (e) {
        out.error = 'parse error: ' + e.message;
      }
    }
  }

  // CLAUDE_HUD_DIRS keeps working — it is documented in the README.
  const extra = env?.CLAUDE_HUD_DIRS;
  if (typeof extra === 'string' && extra) {
    for (const d of extra.split(':').filter(Boolean)) out.roots.push(d);
  }

  const seen = new Set();
  out.roots = out.roots.map(r => expandHome(r, home)).filter(r => r && !seen.has(r) && seen.add(r));
  const seenPinned = new Set();
  out.pinned = out.pinned.map(r => expandHome(r, home))
    .filter(r => r && !seenPinned.has(r) && seenPinned.add(r));
  return out;
}

/** True when a directory holds anything the dashboard would call agent config. */
export function looksLikeProject(dir) {
  for (const marker of PROJECT_MARKERS) {
    if (fs.existsSync(path.join(dir, marker))) return true;
  }
  return false;
}

/**
 * Collapse a worktree directory onto the project it belongs to.
 *
 * Per-task worktrees (`worldmonitor-wt-foo`, `worldmonitor/.worktrees/foo`)
 * otherwise appear as N unrelated projects. The pattern is configurable
 * because the naming convention is the user's, not ours; a named capture
 * group `project` is used when present, else capture group 1.
 *
 * An invalid pattern degrades to "not a worktree" rather than throwing — a bad
 * regex in a config file must not take the dashboard down.
 *
 * @returns {{name:string, isWorktree:boolean}}
 */
export function resolveProjectIdentity(dir, worktreePattern = null) {
  const base = path.basename(dir);
  if (!worktreePattern) return { name: base, isWorktree: false };
  let re;
  try { re = new RegExp(worktreePattern); } catch { return { name: base, isWorktree: false }; }

  // Match against the basename first, then the full path, so patterns can
  // target either `name-wt-x` or `.../name/.worktrees/x`.
  for (const subject of [base, dir]) {
    const m = subject.match(re);
    if (!m) continue;
    const captured = (m.groups && m.groups.project) || m[1];
    if (captured) return { name: path.basename(captured), isWorktree: true };
  }
  return { name: base, isWorktree: false };
}

/**
 * Find candidate project directories one level below each root.
 *
 * One level, deliberately: a recursive walk of ~/Code is slow and would report
 * every package in a monorepo as its own project.
 */
export function discoverProjects(roots, pinned = []) {
  const found = new Map(); // absolute dir -> true

  for (const dir of pinned) {
    try { if (fs.statSync(dir).isDirectory() && looksLikeProject(dir)) found.set(dir, true); } catch { /* gone */ }
  }

  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || IGNORED_DIR_NAMES.has(e.name)) continue;
      const dir = path.join(root, e.name);
      if (found.has(dir)) continue;
      try { if (looksLikeProject(dir)) found.set(dir, true); } catch { /* unreadable */ }
    }
  }
  return [...found.keys()].sort();
}

// ── Skills ───────────────────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (fm) {
    const t = fm[1];
    meta.name = t.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    meta.desc = t.match(/^description:\s*["']?([\s\S]+?)["']?\s*$/m)?.[1]?.trim();
    meta.ver = t.match(/^version:\s*(.+)$/m)?.[1]?.trim();
    meta.ctx = t.match(/^context:\s*(.+)$/m)?.[1]?.trim();
  }
  return { meta, body: raw.replace(/^---\n[\s\S]*?\n---\n*/, '') };
}

/**
 * Read `<dir>/SKILL.md` style skills out of every directory Claude Code and
 * the agent-plugins convention place them in.
 *
 * `skills/` is the plugin/agent-skills convention; `.agents/skills/` is the
 * agent-config convention; `.claude/skills/` is the project-local Claude Code
 * one. All three are read because projects in the wild use all three.
 */
export function scanProjectSkills(projectDir) {
  const out = [];
  const bases = [
    { rel: 'skills', origin: 'skills/' },
    { rel: path.join('.agents', 'skills'), origin: '.agents/skills/' },
    { rel: path.join('.claude', 'skills'), origin: '.claude/skills/' },
  ];
  for (const { rel, origin } of bases) {
    const base = path.join(projectDir, rel);
    let entries;
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const f = path.join(base, e.name, 'SKILL.md');
      let raw;
      try { raw = fs.readFileSync(f, 'utf-8'); } catch { continue; }
      const { meta, body } = parseFrontmatter(raw);
      out.push({
        name: meta.name || e.name,
        desc: (meta.desc || '').slice(0, 200),
        ver: meta.ver || '',
        ctx: meta.ctx || '',
        body,
        file: f,
        origin,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── MCP servers ──────────────────────────────────────────────────────────────

/**
 * Classify an MCP server entry's transport.
 *
 * parseMcpEntry() in generate.js assumes a command+args subprocess, so a
 * remote server declared as {"type":"streamable-http","url":"..."} rendered as
 * type "unknown" with no command. Remote transports are first-class here.
 *
 * @returns {{transport:string, remote:boolean, url:string, display:string}}
 */
export function parseMcpTransport(entry) {
  const t = String(entry?.type || '').toLowerCase();
  const url = typeof entry?.url === 'string' ? entry.url : '';

  if (t === 'streamable-http' || t === 'http' || t === 'sse' || (!t && url)) {
    const transport = t || 'http';
    return { transport, remote: true, url, display: url || transport };
  }

  const cmd = typeof entry?.command === 'string' ? entry.command : '';
  const args = Array.isArray(entry?.args) ? entry.args : [];
  let transport = 'stdio';
  if (cmd === 'node') transport = 'node';
  else if (cmd === 'uvx' || cmd === 'uv') transport = 'python';
  else if (cmd === 'npx' || cmd === 'bunx') transport = 'npx';
  else if (cmd === 'docker' || cmd === 'podman') transport = 'docker';
  else if (!cmd) transport = 'unknown';
  return {
    transport,
    remote: false,
    url: '',
    display: [cmd, ...args].filter(Boolean).join(' ') || 'unknown',
  };
}

/**
 * Read a project's MCP servers.
 *
 * Both `mcp.json` and `.mcp.json` are accepted. The scanner previously looked
 * only for the dotted name, which is why a project declaring its servers in
 * `mcp.json` reported none at all.
 */
export function scanProjectMcp(projectDir) {
  const out = [];
  const sources = [
    { rel: 'mcp.json', label: 'mcp.json' },
    { rel: '.mcp.json', label: '.mcp.json' },
    { rel: path.join('.claude', 'settings.json'), label: '.claude/settings.json' },
  ];
  const seen = new Set();
  for (const { rel, label } of sources) {
    const p = path.join(projectDir, rel);
    let raw;
    try { raw = fs.readFileSync(p, 'utf-8'); } catch { continue; }
    let cfg;
    try { cfg = JSON.parse(raw); } catch { continue; }
    const servers = cfg?.mcpServers;
    if (!servers || typeof servers !== 'object') continue;
    for (const [name, entry] of Object.entries(servers)) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const t = parseMcpTransport(entry);
      const envCount = entry?.env && typeof entry.env === 'object' ? Object.keys(entry.env).length : 0;
      out.push({
        name,
        ...t,
        envCount,
        source: label,
        file: p,
        // Never let a declared env value reach the HTML.
        config: { ...entry, env: envCount ? '{redacted — ' + envCount + ' vars}' : undefined },
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Instruction files ────────────────────────────────────────────────────────

/**
 * Read a project's agent instruction files.
 *
 * AGENTS.md is treated as a peer of CLAUDE.md. It was previously unrecognised
 * everywhere — listing, detail panel, health score and search — which meant a
 * project whose primary instruction file is AGENTS.md appeared to have none.
 */
export function scanProjectInstructions(projectDir) {
  const out = [];
  const candidates = [
    { rel: 'AGENTS.md', kind: 'AGENTS.md' },
    { rel: 'CLAUDE.md', kind: 'CLAUDE.md' },
    { rel: path.join('.claude', 'CLAUDE.md'), kind: 'CLAUDE.md' },
  ];
  for (const { rel, kind } of candidates) {
    const p = path.join(projectDir, rel);
    let raw;
    try { raw = fs.readFileSync(p, 'utf-8'); } catch { continue; }
    out.push({ kind, file: p, rel, body: raw, lines: raw.split('\n').length });
  }
  return out;
}

/** Read a project's agent-plugin manifest, if it ships one. */
export function scanProjectPlugin(projectDir) {
  const p = path.join(projectDir, 'plugin.json');
  let raw;
  try { raw = fs.readFileSync(p, 'utf-8'); } catch { return null; }
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return null; }
  if (!cfg || typeof cfg !== 'object' || !cfg.name) return null;
  return {
    name: String(cfg.name),
    version: cfg.version ? String(cfg.version) : '',
    description: cfg.description ? String(cfg.description).slice(0, 300) : '',
    license: cfg.license ? String(cfg.license) : '',
    keywords: Array.isArray(cfg.keywords) ? cfg.keywords.map(String).slice(0, 12) : [],
    file: p,
  };
}

/**
 * Read subagents a project delegates to a review plugin.
 *
 * Files like `compound-engineering.local.md` declare `review_agents:` in YAML
 * frontmatter. Those agents do real work on the repo but are invisible to a
 * scanner that only enumerates a plugin's on/off state.
 */
export function scanProjectSubagents(projectDir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(projectDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(projectDir, e.name), 'utf-8'); } catch { continue; }
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const block = fm[1].match(/^review_agents:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (!block) continue;
    for (const line of block[1].split('\n')) {
      const m = line.match(/^\s*-\s*(.+?)\s*$/);
      if (!m || !m[1]) continue;
      const ref = m[1].replace(/^["']|["']$/g, '');
      const parts = ref.split(':');
      out.push({
        ref,
        plugin: parts.length > 1 ? parts[0] : '',
        name: parts[parts.length - 1],
        declaredIn: e.name,
      });
    }
  }
  return out;
}

/**
 * Scan one project directory into a single record.
 */
export function scanProject(projectDir, worktreePattern = null) {
  const identity = resolveProjectIdentity(projectDir, worktreePattern);
  const skills = scanProjectSkills(projectDir);
  const mcp = scanProjectMcp(projectDir);
  const instructions = scanProjectInstructions(projectDir);
  const plugin = scanProjectPlugin(projectDir);
  const subagents = scanProjectSubagents(projectDir);
  return {
    dir: projectDir,
    name: identity.name,
    isWorktree: identity.isWorktree,
    skills, mcp, instructions, plugin, subagents,
    counts: {
      skills: skills.length,
      mcp: mcp.length,
      instructions: instructions.length,
      subagents: subagents.length,
    },
  };
}

/**
 * Scan every registered workspace, grouping worktrees onto their project.
 *
 * Worktrees are merged into the project they belong to: their assets are
 * deduplicated by name so a project with four active worktrees does not report
 * its skills four times.
 *
 * @returns {{projects:Array, totals:object, error:string|null}}
 */
export function scanWorkspaces(lcarsDir = DEFAULT_LCARS_DIR, env = process.env, home = os.homedir()) {
  const cfg = loadWorkspaceConfig(lcarsDir, env, home);
  const dirs = discoverProjects(cfg.roots, cfg.pinned);

  /** @type {Map<string, any>} */
  const byName = new Map();
  for (const dir of dirs) {
    const scanned = scanProject(dir, cfg.worktreePattern);
    const existing = byName.get(scanned.name);
    if (!existing) {
      byName.set(scanned.name, { ...scanned, dirs: [dir], worktrees: scanned.isWorktree ? 1 : 0 });
      continue;
    }
    // Merge a worktree (or a second checkout) into the project already seen.
    existing.dirs.push(dir);
    if (scanned.isWorktree) existing.worktrees++;
    const mergeBy = (key, idOf) => {
      const seen = new Set(existing[key].map(idOf));
      for (const item of scanned[key]) {
        if (seen.has(idOf(item))) continue;
        seen.add(idOf(item));
        existing[key].push(item);
      }
    };
    mergeBy('skills', s => s.name);
    mergeBy('mcp', s => s.name);
    mergeBy('instructions', s => s.rel);
    mergeBy('subagents', s => s.ref);
    if (!existing.plugin && scanned.plugin) existing.plugin = scanned.plugin;
    existing.counts = {
      skills: existing.skills.length,
      mcp: existing.mcp.length,
      instructions: existing.instructions.length,
      subagents: existing.subagents.length,
    };
  }

  const projects = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totals = { projects: projects.length, skills: 0, mcp: 0, instructions: 0, subagents: 0, worktrees: 0 };
  for (const p of projects) {
    totals.skills += p.counts.skills;
    totals.mcp += p.counts.mcp;
    totals.instructions += p.counts.instructions;
    totals.subagents += p.counts.subagents;
    totals.worktrees += p.worktrees;
  }
  return { projects, totals, error: cfg.error, roots: cfg.roots };
}
