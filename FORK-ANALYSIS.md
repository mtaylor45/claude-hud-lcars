# Fork analysis — claude-hud-lcars

An assessment of this fork as a base for continued development, written against
the code at `a101bb9` (v1.7.1), not from the README or ROADMAP. Every number
below was measured. Where upstream documentation and the code disagree, the
code wins and the disagreement is recorded.

Companion document: [SPRINT-PLAN.md](SPRINT-PLAN.md).

---

## 1. Fork position

| Fact | Value |
|---|---|
| Upstream | [`polyxmedia/claude-hud-lcars`](https://github.com/polyxmedia/claude-hud-lcars) (Andre Figueira) |
| Upstream last push | 2026-05-08 — **same commit this fork sits on** |
| Upstream activity | 34 stars, 5 forks, 0 open issues, no commits in ~4 months |
| This fork's divergence | None yet — `main` is identical to upstream |
| Upstream licence | PolyForm Noncommercial 1.0.0 |

**Implication.** You are not behind, and there is no upstream velocity to track
or rebase against. Nothing about this codebase needs to be preserved for
mergeability. Treat it as a starting point you own outright rather than a fork
you maintain — that removes the main argument against the structural changes in
Sprint 1.

### 1.1 The licence boundary is a real constraint

This matters more than it looks:

- `claude-hud-lcars` — **PolyForm Noncommercial 1.0.0** (noncommercial only)
- `worldmonitor` — **AGPL-3.0-only**
- `louh/lcars` (your LCARS asset source) — GPL-3.0

PolyForm Noncommercial is **not** GPL-compatible. You cannot lift code from this
repo into `worldmonitor`, and you cannot lift AGPL code from `worldmonitor` into
this repo, without a licence problem in one direction or the other.

This kills "share the LCARS design system as a package" as a naive plan. What
*is* safe is sharing the **token values and the written rules** — facts and
design decisions are not the copyrightable expression the licences attach to —
and reimplementing the CSS independently on each side. Sprint 2 is scoped that
way deliberately. If you want genuine code sharing, the clean route is asking
Andre to dual-licence, or rewriting the parts you need.

---

## 2. What the code actually is

A zero-dependency Node generator that walks `~/.claude/`, embeds the result as a
JSON blob in one self-contained HTML file, and optionally serves it with a small
API for chat, file editing and installs.

```
src/generate.js   7,613 lines   scanner + entire UI (HTML + CSS + JS as template strings)
src/server.js     1,322 lines   26 HTTP routes, SSE, Anthropic + ElevenLabs proxies
src/recall.js       250 lines   memory CLI
src/lib/*           647 lines   6 extracted pure-function modules
test/*            3,212 lines   331 tests
```

Zero runtime dependencies is real and worth keeping. It matches your stated
preference for self-hosted things that do not rot, and it is the reason this
runs anywhere with `npx`.

### 2.1 Code health

**`generate.js` at 7,613 lines is the dominant liability.** The upstream ROADMAP
flags this at "5,600+ lines"; it has since grown 36% without being addressed. It
is not merely long — it is four different languages in one file, which means:

- The dashboard's own ~4,000 lines of client JS are inside template strings, so
  no linter, formatter or type checker ever sees them. CI's only check is
  `node --check` on the extracted `<script>` block — a syntax check, not
  analysis. In `worldmonitor` you run Biome plus nine custom `lint:*` enforcement
  scripts over comparable code. Here there is nothing.
- The CSS is one ~1,200-line block of string-concatenated rules with no token
  discipline (see §3).
- Every UI change risks a quoting bug that only surfaces at runtime. The
  codebase has three separate escaping helpers (`esc`, `escJ`, `escA`) precisely
  because of this hazard.

**Test coverage is lopsided but honest.** 331 tests cover the data layer well —
parsers, path containment, version comparison, marketplace normalisation. The UI
has **zero** tests. You already run Playwright in both `worldmonitor` and
*Nearby Things*; this repo has no browser test at all.

**Four tests fail on a clean checkout.** Not product bugs:

```
not ok - skips unreadable SKILL.md without crashing     (generate.test.js:297)
not ok - skips unreadable agent files without crashing
not ok - skips unreadable memory files without crashing
not ok - skips unreadable CLAUDE.md without crashing
```

All four `chmod 000` a file and assert it is skipped. Root ignores file
permissions, so they pass as you and fail as root. This is not academic: you run
Docker Swarm, containers default to root, and `.githooks/pre-commit` blocks any
commit on a failing suite. The first time you build this in a container the
whole workflow jams. Fix: skip when `process.getuid?.() === 0`.

**Fork residue.** `.claude/hooks/autorelease.sh` hardcodes
`PROJECT_DIR="/Users/andrefigueira/Code/claude-ideas/claude-dashboard"`. It is
dead on your machine. `.claude/settings.json` is `{}`, so neither of the repo's
two hooks is wired to anything regardless.

**Documentation drift.** `ROADMAP.md` self-rates "Version 1.4.0 — 8/10" and
lists a file watcher, MCP health check and session monitor as future work. All
three are **already built**: SSE at `server.js:1272`, `EventSource` at
`generate.js:7343`, `/api/mcp-status` at `server.js:869`, and a live context
burn-rate bar at `generate.js:2230`. Neither `CHANGELOG.md` nor `ROADMAP.md`
mentions the burn-rate subsystem at all.

Your own *Nearby Things* `DESIGN.md` §8 records this exact failure — "the
documentation described features that did not exist" — and the lesson drawn from
it: *check docs against the code before trusting them; update both in the same
commit.* The same discipline is what this repo needs on arrival.

### 2.2 Security posture

Better than typical for a tool of this shape, and recently hardened:

- Path containment uses `path.relative` rather than `startsWith`, so
  `~/.claude-backup/` cannot slip past the guard (`server.js:169`). This was a
  real v1.7.1 fix.
- `execFile` rather than `execSync` for editor/`which` calls.
- MCP `env` blocks are redacted to `{redacted — N vars}` before reaching HTML.
- The API key stays server-side.
- A small MCP audit flags CVE-2025-6514 (`mcp-remote`), `--privileged`,
  `--cap-add SYS_ADMIN` and `--network host`.

Two things to be deliberate about rather than bugs to fix:

1. **The server is unauthenticated and can write to `~/.claude/`.** Anything
   reaching `localhost:3200` can edit your settings, install MCP servers and
   open files. It binds all interfaces by default. This is the same class of
   exposure your *Nearby Things* runbook took seriously enough to put behind a
   tailnet and an admin token. Bind to `127.0.0.1` at minimum; if it ever runs
   on the NUC, it needs the same treatment.
2. **`/api/replicator` and `/api/marketplace/install-remote` fetch and install
   from the network.** Reasonable for a personal tool, worth knowing about.

---

## 3. LCARS design conformance

You already have a real LCARS design system. It lives in `worldmonitor`:

- `src/themes/lcars/tokens.ts` — two palette variants, semantically named ramp
- `src/themes/lcars/lcars.css` — 1,044 lines of structural chrome
- `preview/lcars-style-guide.html` — **LCARS DESIGN SYSTEM · 2.5.1**, with
  explicit DO/DON'T rules, five page archetypes, and four permitted motions
- `docs/LCARS-ASSETS.md` — take/skip decisions, licence obligations, sound slots

It is a better-specified system than this dashboard's, and it is *yours*. Judged
against it, this fork's UI is off-spec in six measurable ways. All counts are
from `src/generate.js`.

| Your DS 2.5.1 rule | This fork | Measured |
|---|---|---|
| Field is `#090909`, **never pure black** — "one step of lift stops an emissive panel reading as a dead region" | `--bg:#000` | line 1037; not themeable — `THEMES` overrides only 8 accent vars |
| **One condensed family, all caps.** Never mix a second typeface | Antonio *and* JetBrains Mono | body is JetBrains Mono (1047); Antonio for display only |
| Self-hosted fonts, **zero network dependency**; an e2e test fails if the page reaches `fonts.googleapis.com` | Two CDN `@import`s | lines 1032–1033 |
| **"LCARS cuts, it does not fade."** Fades, easing curves and transforms are *forbidden* | Pervasive | **51** `transition` rules, **28** easing keywords, **108** `transform`s |
| **Salmon and red are status only.** "The moment either appears as ornament, an alert stops meaning anything" | Decorative | `var(--salmon)` ×17, `var(--red)` ×32 — scrollbar thumbs, JSON boolean syntax highlighting, About-page headings, footer links |
| Hold the **5px gutter** absolutely; two coloured blocks never touch | No gutter discipline | borders and shadows used as separation instead |

Two further inconsistencies inside the fork itself:

- `:root` declares `--orange:#FF9933` (line 1039). The README claims `#FF9900`.
  The runtime `THEMES.enterprise` object emits `#FF9900` (line 6640). Three
  values, one colour.
- `THEMES.defiant` maps `orange:'#CC3333'` — a red promoted to *structural
  chrome*. This is the precise inversion of the one rule your DS calls
  non-negotiable.

None of this is bad taste; it is an unrelated author's LCARS interpretation.
But you now maintain two LCARS surfaces, and the third — `mtaylor45/mtaylor45`'s
`lcars-profile.svg` — uses a *third* palette again (`#99CCFF` dominant across 41
uses, with `#FFCC66`, `#FF9966`, `#66CC99`, `#CC99CC`). That one is closest to
your DS "bright" variant but not identical to it.

**Three LCARS palettes across three properties is the real design finding.**
Sprint 2 collapses them to one.

---

## 4. The central functional gap: it cannot see your work

This is the finding that should drive the roadmap.

The scanner is hardcoded to `~/.claude/` — every read in `generate.js` is
`path.join(CLAUDE_DIR, …)`. The one escape hatch, `CLAUDE_HUD_DIRS`, looks for
`.mcp.json` one level deep and nothing else.

Your actual agent configuration lives in repositories. Measured against
`worldmonitor` alone, the dashboard is blind to all of this:

| What you have | Where | Does the HUD see it? |
|---|---|---|
| 25 agent skills (`track-earthquakes`, `check-country-risk`, …) | `worldmonitor/skills/*/SKILL.md` | **No** — only reads `~/.claude/skills/` |
| `sentry-triage` skill | `worldmonitor/.agents/skills/` | **No** |
| 2 MCP servers (`worldmonitor`, `worldmonitor-docs`, streamable-http) | `worldmonitor/mcp.json` | **No** — scanner looks for `.mcp.json`, with a dot |
| Agent plugin manifest | `worldmonitor/plugin.json` | **No** |
| Root agent instructions — 123 lines of task routing, authority and gates | `worldmonitor/AGENTS.md` | **No** — only `CLAUDE.md` is recognised |
| 5 review subagents (`security-sentinel`, `performance-oracle`, …) | `compound-engineering.local.md` frontmatter | **No** |
| Design context for UX copy | `worldmonitor/.impeccable.md` | **No** |

So the dashboard that exists to show you "every skill, agent, hook, MCP server
and plugin you've built" currently shows **none of the 26 skills and neither of
the MCP servers you actually built.** It reflects a Claude Code setup where
everything is global. Yours is not that setup.

Two smaller consequences of the same assumption:

- **Worktrees fragment.** You bootstrap per-task worktrees
  (`npm run worktree:bootstrap`). Each becomes a separate unrelated row in
  SESSIONS, because grouping is by `~/.claude/projects/` directory name.
- **`AGENTS.md` scores 0.** `scoreClaudeMd()` rates instruction files 0–100 for
  structure and rule coverage. It never runs on your primary instruction file
  because the filename does not match.

---

## 5. What is genuinely good and should be kept

Not everything needs changing. This fork brings real assets:

- **Zero dependencies, single-file output.** Runs via `npx` anywhere, no build
  step. Keep this constraint; it is why the thing is durable.
- **The data layer is well tested and cleanly separated.** `src/lib/` is five
  pure-function modules with real unit tests — `burnRate.js` in particular is
  good work, and `readCurrentContextTokens()` correctly understands that an
  assistant turn's `input_tokens` is cumulative.
- **Live plumbing already exists.** SSE broadcast, `fs.watch` categorisation,
  MCP status probing, context burn-rate bar. Undocumented, but built. Sprint 3
  builds on it rather than starting it.
- **The detail-panel pattern is right.** Row → slide-out panel → rendered
  markdown with syntax-highlit JSON and real action buttons is the correct
  interaction for this data, and `Cmd+K` universal search across every type is
  genuinely useful.
- **The COMPUTER bar is the right primitive** for where you are heading. It is
  currently a thin Anthropic proxy, but it is the natural socket for the local
  voice sidecar (Sprint 4).
- **PWA and icon generation with no external assets.** `solidPng()` hand-builds
  a PNG with CRC32 and zlib. Slightly unhinged, entirely in keeping.

---

## 6. Summary judgement

A well-made personal tool by a competent author, at a natural handover point:
upstream is dormant, the architecture has hit its structural ceiling, and the
core assumption — *that your Claude Code setup lives in `~/.claude/`* — does not
hold for you.

The gap between this and what you need is not a list of missing features. It is
one wrong assumption about scope, plus a design language that predates the
design system you have since written. Both are fixable, and neither requires
discarding the parts that work.

Rated on the upstream ROADMAP's own axes, for continuity:

| Dimension | Upstream self-rating (v1.4.0) | Measured (v1.7.1) | Note |
|---|---|---|---|
| Design & aesthetic | 9/10 | 7/10 | Beautiful, but off-spec against your own DS 2.5.1 in six ways |
| Read / browse | 8/10 | 5/10 | Excellent for global config; blind to 26 of your skills and 2 MCP servers |
| Write / action | 5/10 | 5/10 | Unchanged |
| Observability | 4/10 | 6/10 | SSE, burn rate and MCP probing shipped since — just undocumented |
| Intelligence | 4/10 | 4/10 | Chat is still a wrapper |
| Code health | 7/10 | 5/10 | 7,613-line generator; 4,000 lines of unlinted client JS; 4 tests fail as root |
| Test coverage | 8/10 | 6/10 | 331 data-layer tests, zero UI tests |

---

*Analysis performed 2026-09-17 against `a101bb9`. Design conformance judged
against `worldmonitor` LCARS Design System 2.5.1 and
`mtaylor45/mtaylor45@c578201`.*
