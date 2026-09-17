# Sprint plan — claude-hud-lcars

Development plan for this fork, scoped to how you actually work rather than to
the upstream roadmap. Read [FORK-ANALYSIS.md](FORK-ANALYSIS.md) first — the
sprints below follow from its findings.

---

## The thesis

Upstream built a **mirror of `~/.claude/`**. That is the right tool for someone
whose Claude Code setup is global.

Yours is not. Your agent configuration lives in repositories — 25 skills in
`worldmonitor/skills/`, a `sentry-triage` skill in `.agents/skills/`, two MCP
servers in `mcp.json`, a 123-line `AGENTS.md` of task routing and authority
rules, five review subagents from the `compound-engineering` plugin, a
`preflight` JSON gate, per-task worktrees, and 40 GitHub workflows. The
dashboard sees none of it.

So the single highest-value change is not a new panel. It is **changing the unit
of observation from the home directory to the workspace.** Everything in Sprint 1
follows from that, and Sprints 3–4 are only worth building afterwards.

Three supporting goals, in priority order:

1. **Make it see your real setup** (Sprint 1) — without this, nothing else matters.
2. **Make it obey your own design system** (Sprint 2) — you maintain three LCARS palettes; collapse to one.
3. **Make it an instrument, not a mirror** (Sprints 3–4) — surface what agents are *doing*, then take it to the NUC.

Sprint 0 clears the fork residue that would otherwise bite during all of the above.

---

## Sprint 0 — Take ownership

**Status: done.** See the Unreleased section of [CHANGELOG.md](CHANGELOG.md) for what
landed. Tests are green as root and non-root, CI covers Node 18/20/22/24, and no
operative path in the repo points outside it.

*Small. Everything here was a precondition for working in this repo at all.*

| # | Task | Why now |
|---|---|---|
| 0.1 | Make the four `chmod 000` tests skip when `process.getuid?.() === 0` | They fail as root. `.githooks/pre-commit` blocks commits on a red suite, so the first containerised build jams your whole workflow. One guard, four call sites. |
| 0.2 | Delete or rewrite `.claude/hooks/autorelease.sh` | Hardcodes `/Users/andrefigueira/Code/claude-ideas/claude-dashboard`. Dead on your machine. |
| 0.3 | Wire `.claude/settings.json` — currently `{}` | Neither of the repo's hooks is connected to anything. See §Recommendations for what to put in it. |
| 0.4 | Bind the server to `127.0.0.1` by default; `HOST` env to opt out | Unauthenticated write access to `~/.claude/` currently listens on all interfaces. Same exposure class your *Nearby Things* runbook put behind a tailnet. |
| 0.5 | Rewrite `ROADMAP.md` against the code; log the burn-rate subsystem in `CHANGELOG.md` | The roadmap lists three shipped features as future work and never mentions burn rate. Your own `DESIGN.md` §8: *check docs against the code before trusting them.* |
| 0.6 | Record the licence boundary in `README.md` | PolyForm Noncommercial here vs AGPL-3.0 in `worldmonitor`. Incompatible. Write it down before you are tempted to copy a file across. |
| 0.7 | Add Node 24 to the CI matrix | `worldmonitor` standardises on 24 via `.nvmrc`; this repo tests 18/20/22. Keep 18 while `engines` claims it. |

**Done when:** `npm test` is green as root and as you, CI passes on 18/20/22/24,
and no file in the repo references a path that is not yours. — *met; the only
remaining mentions of the upstream author are the README Credits (required
attribution) and test fixtures.*

---

## Sprint 1 — Workspace awareness

**Status: 1.1, 1.2 and 1.3 done; 1.4 partial.** Project assets now appear inside
the existing sections with an origin badge, and a PROJECTS panel lists each
project and drills into it. The project *filter* axis described in 1.4 is still
open — see the note under that heading.

*The main event. Turns the dashboard from a view of `~/.claude/` into a view of
your machine's agent configuration.*

### 1.1 A workspace registry

Replace the `CLAUDE_HUD_DIRS` scan with a real project registry. A configured
list of roots, each scanned for agent configuration, each rendering as a
first-class project with its own asset counts.

Ship as `~/.lcars/workspaces.json` (the `~/.lcars/` directory already exists for
the memory subsystem), editable from CONFIG:

```json
{
  "roots": ["~/Code", "~/Projects"],
  "pinned": ["~/Code/worldmonitor", "~/Code/nearby-things"],
  "worktreePattern": "^(?<project>.+?)(-wt-.+|\\.worktrees/.+)$"
}
```

### 1.2 Fix the six blind spots

Each is a small addition to the scanner. Together they are the difference
between the dashboard being wrong and being right.

| Blind spot | Fix | What it surfaces today |
|---|---|---|
| Repo skills | Read `<root>/skills/*/SKILL.md` and `<root>/.agents/skills/*/SKILL.md` | Your 25 `worldmonitor` skills + `sentry-triage` |
| `mcp.json` | Accept `mcp.json` as well as `.mcp.json` | `worldmonitor` + `worldmonitor-docs` streamable-http servers |
| `AGENTS.md` | Treat as a peer of `CLAUDE.md` everywhere — listing, detail panel, health score, search | Your primary instruction file, 123 lines, currently invisible |
| Plugin manifests | Parse `plugin.json` (agent-plugins.org schema) | The `worldmonitor` agent plugin, v2.10.0 |
| Plugin-provided subagents | Enumerate skills/agents *contributed by* plugins, not just the plugin's on/off state | `security-sentinel`, `performance-oracle`, `architecture-strategist`, `kieran-typescript-reviewer`, `code-simplicity-reviewer` |
| Worktree fragmentation | Group sessions by resolved project via `worktreePattern` | `worldmonitor` and its N worktrees as one project, not N+1 |

Do **not** hardcode `worldmonitor` anywhere. These are general Claude Code and
agent-plugin conventions; the repo is just the proof they are unhandled.

### 1.3 Transport-aware MCP

`parseMcpEntry()` assumes a `command` + `args` subprocess. Both your servers are
`{"type": "streamable-http", "url": "…"}` — they render as `unknown` type with
no command. Add `http`/`sse`/`streamable-http` as first-class types, show the
URL, and make the `/api/mcp-status` probe do an HTTP reachability check for them
instead of a spawn.

### 1.4 UI: make project the primary axis

The sidebar is currently a flat list of global asset types. Add a project
selector above it. Selecting a project filters every section to that project's
assets; "ALL" keeps today's behaviour. Show a per-project `AGENTS.md`/`CLAUDE.md`
health score and asset counts on the project row itself.

This is the smallest UI change that makes a multi-repo setup legible.

> **Not done.** The scanner work landed without this. Project assets are visible
> in every section, badged by origin, and the PROJECTS panel gives a per-project
> view — but selecting a project does not yet filter the other sections. That
> filter touches every section's render path, so it was left out rather than
> doubling the diff of a scanner change. The remaining work is the selector and
> the filter, not the data.

**Done when:** opening the dashboard with `~/Code` registered shows 26 skills,
2 MCP servers, an `AGENTS.md` with a health score, and `worldmonitor`'s
worktrees collapsed into one project.

---

## Sprint 2 — LCARS conformance

*Adopt your own design system. This is the UI sprint, and it is mostly deletion.*

Authority: `worldmonitor/preview/lcars-style-guide.html` — **LCARS Design System
2.5.1** — plus `src/themes/lcars/tokens.ts` and `docs/LCARS-ASSETS.md`. Six
measured violations, from FORK-ANALYSIS §3.

### 2.1 Tokens

Extract the `:root` block to a single generated token layer and take the values
from DS 2.5.1's **bright** variant, which is also closest to your
`lcars-profile.svg`:

```
bg        #090909   ← not #000. "One step of lift stops an emissive panel reading as a dead region."
bg-panel  #121212
primary   #ff9c00   ← replaces three different oranges (#FF9933 in :root, #FF9900 in THEMES, #FF9900 in README)
tan       #ffcc66
lilac     #cc99cc
periwinkle #9999ff
ice       #99ccff   ← the dominant hue of your profile SVG
cream     #ffeebb
readout   #ffcc00   ← numeric values only
ok        #99cc99
alert     #cc6666   ← STATUS ONLY
critical  #ff3300   ← STATUS ONLY
```

Because of the licence boundary (FORK-ANALYSIS §1.1), port the **values and the
rules**, not the AGPL CSS. Reimplement independently.

### 2.2 Reserve salmon and red

The one rule your DS calls non-negotiable: *the moment either appears as
ornament, an alert stops meaning anything.* Currently `--salmon` ×17 and
`--red` ×32, on scrollbar thumbs, JSON boolean highlighting, About-page headings
and footer links.

- Repoint every decorative use to `tan`/`lilac`/`ice`.
- Keep `alert`/`critical` for RED ALERT, YELLOW ALERT, MCP-offline and security
  flags only.
- Delete the `defiant` theme or rebuild it — it maps `orange:'#CC3333'`,
  promoting a red to structural chrome, which is the exact inversion of the rule.
- Add a test that fails if `--alert` or `--critical` is referenced outside the
  alert ruleset. You already enforce this class of rule with custom `lint:*`
  scripts in `worldmonitor`; this is the same idea.

### 2.3 Motion: cut, don't fade

> "LCARS cuts, it does not fade. The originals were physical backlit panels — a
> state change was a lamp switching, so it was instantaneous."

Forbidden: fades between states, scale/translate transforms, easing curves,
hover transitions on every block, skeleton shimmer.

Present: **51** `transition` rules, **28** easing keywords, **108** `transform`s.

Delete them, and re-add only the four permitted motions:

| Motion | Rule | Use here |
|---|---|---|
| Block blink | one block at a time, hard cut, never a cascade | live file-change activity per section |
| Sweep | linear fill, constant rate, no easing | context burn-rate bar, install progress |
| Sequential reveal | blocks light in order at ~40ms | the boot sequence — already the right instinct, wrong implementation (it fades) |
| Alert pulse | hard ~1Hz alternation, only while the condition holds | RED ALERT |

An indeterminate sweep is a lie about a known quantity — so the burn bar must
sweep only when it has real numbers, and show nothing when it does not. That
matches your *Nearby Things* principle: *say "unknown" rather than guess.*

Honour `prefers-reduced-motion` globally. On an always-on panel, ambient motion
is a cost paid every hour of the day.

### 2.4 Typography: one family, self-hosted

- Drop JetBrains Mono. One condensed family, all caps — Antonio throughout.
  Keep a monospace stack *only* inside code blocks and JSON viewers, where
  character alignment is load-bearing.
- Self-host Antonio. Delete both `fonts.googleapis.com` `@import`s (lines
  1032–1033) and vendor the two variable subsets — 43 KB for the whole 400–700
  range. Use `font-display: block`, not `swap`: a flash of Arial Narrow reflows
  every rail label because the cap height differs.
- Retain `Antonio-OFL.txt` beside the font.

This also restores the README's "zero external requests" claim, which is
currently false, and matches your *Nearby Things* §3.5 rule: no third parties at
runtime.

### 2.5 Structure

- **Hold the 5px gutter absolutely.** Two coloured blocks never touch. Remove
  borders and shadows used as separation — the gutter *is* the separation.
- **Squared rail blocks.** Individual nav buttons are rectangular; only the
  column as a whole terminates in a curve where it meets the header elbow. Your
  DS records this as a correction to an earlier cut that "read as a stack of
  lozenges rather than a console."
- **Label punch-through.** A text `<span>` carries the *background* colour over a
  coloured bar, punching the label through it. Your DS names this "the authentic
  Okudagram look and the one technique our stylesheet most conspicuously lacks."
  Neither surface has it. Doing it here first makes this repo the reference
  implementation.
- Align labels bottom-right on the block floor.
- At most two pill buttons per screen.

### 2.6 Conformance tests

Port the assertions you already run in `worldmonitor`, as this repo's first
browser tests:

- Page makes **no** request to `fonts.googleapis.com` / `fonts.gstatic.com`.
- Antonio is the face actually resolved for rail labels.
- Every `.lcars-rail-btn` computes `border-radius: 0px`.
- No computed `transition-duration > 0` outside the four permitted motions.
- `--alert` / `--critical` unreferenced outside the alert ruleset.

**Done when:** a screenshot of this dashboard and a screenshot of the
`worldmonitor` kiosk read as the same design system, and the conformance suite
is green.

> **Sequencing note.** Sprint 2 touches most of `generate.js`'s CSS. If you
> intend the extraction in Sprint 5, do it *first* — otherwise you will do this
> work twice. The reverse order is also defensible (conformance is
> user-visible, extraction is not); just pick one deliberately.

---

## Sprint 3 — From mirror to instrument

*Surface what your agents are doing, not just what they are configured to be.
Every item here builds on plumbing that already exists.*

### 3.1 Gate panel

Your `AGENTS.md` makes `npm run agent:preflight -- --issue N` the start gate:
`status: "ready"` and `expensiveTestsAllowed: true` in its JSON. That is a
machine-readable health check for a repo's agent-readiness, and you run it by
hand.

Add a GATE section: per project, a PREFLIGHT button that runs the script and
renders the JSON as an LCARS status block — stale `main`, duplicate PRs, active
worktrees, missing credentials, dirty tree. Red/yellow/green per row. This turns
a command you remember to run into a panel you glance at.

Generalise: any project may declare its own gate.

```json
{ "gate": { "cmd": "npm run --silent agent:preflight", "format": "json" } }
```

### 3.2 PR and CI panel

`agent:pr-snapshot` is already your "authoritative PR read surface" — head/base
OIDs, mergeability, check runs, actionable review threads, remote alignment,
cached by head OID. Render it. One row per open PR per project, with the check
rollup and unresolved-thread count.

With 40 workflows in `worldmonitor`, "which of my PRs is actually blocked, and
on what" is a question worth a panel.

### 3.3 Hook event analytics

`hud-events.jsonl` and the INSTALL HUD LOGGER button already exist, and
`buildHudEvent()` already parses the lines. Nothing consumes them.

Build the analytics the upstream roadmap deferred to Phase 2.0:

- Tool-call frequency by type and by project.
- **Skill invocation counts** — with 26 skills, which ever fire? Which are dead?
- Session duration and token burn per project, from the `burnRate` module.
- Dead-config detection: skills untouched in 30 days, MCP servers that have not
  responded in a week, hooks that never fired.

This is where the tool starts accumulating value instead of being stateless.

### 3.4 Subagent visibility

Your `compound-engineering.local.md` declares five review agents. Show them as
an AGENTS sub-panel: which plugin provides each, its review focus, and — once
3.3 lands — how often each actually ran and what it found.

### 3.5 Design-conformance panel (optional, high leverage)

You now own a written design system with mechanically checkable rules. Add a
panel that runs the Sprint 2.6 assertions against *any* registered project and
reports pass/fail per rule.

That makes this dashboard the compliance surface for the LCARS design system
across `worldmonitor`, this repo, and the profile SVG — which is a genuinely
novel reason for it to exist, and the point where it stops being a Claude Code
accessory.

---

## Sprint 4 — Kiosk and local voice

*Aligns this repo with the direction your profile states: an always-on NUC
display with a local voice interface.*

### 4.1 Kiosk mode

`--kiosk` renders a read-only dashboard at the DS's 1280×720 target: no detail
panel, no install buttons, no editor. Ambient rotation across OPS / GATE / PR /
ALERT archetypes, driven by SSE. Alert conditions interrupt the rotation.

Everything hostile to a wall panel gets suppressed: Q encounters, toasts,
anything requiring a pointer.

### 4.2 Local model for the COMPUTER bar

The most consequential item in this sprint. Today `/api/chat` hard-codes
`https://api.anthropic.com/v1/messages` and requires `CLAUDE_DASHBOARD_API_KEY`.
Your stated direction is *"small, purpose-built models handle specific jobs
rather than sending every interaction to a cloud API."*

Add a provider abstraction with an Ollama backend:

```
LCARS_LLM_PROVIDER=ollama
LCARS_LLM_URL=http://localhost:11434
LCARS_LLM_MODEL=qwen2.5:7b
```

Both backends already stream SSE, so the client needs no change beyond parsing a
second event shape. Keep Anthropic as the default so nothing breaks; make local
a one-variable switch. This is also what makes a kiosk viable — an always-on
panel that bills per token is not.

### 4.3 Voice, properly

Replace the Web Speech API path with the sound and voice architecture you have
already designed in `worldmonitor`:

- **Slot-based sounds.** Callers ask for a slot (`wake-ack`, `command-accepted`,
  `panel-change`, `refusal`), never a filename, so a theme can ship a different
  set without touching a call site. Six preloaded `Audio` objects, rewound
  rather than reallocated.
- **Every dispatched action gets an audible outcome.** The refusal tone is what
  stops a dead control reading as a broken panel.
- **Stay silent-but-harmless until first interaction** — browsers block audio
  until the user touches the page, and a wall panel boots untouched.
- Voice state tokens already exist: `voice-idle`, `voice-listening`,
  `voice-speaking`.

Note the provenance caveat from your own `LCARS-ASSETS.md`: the `louh/lcars`
`.ogg` files are likely show-sourced and **must be replaced before any public
distribution.** This repo is public. Either keep synthesised Web Audio beeps
here — which the fork already does well — or source clean assets. Do not vendor
those files into a public repo.

### 4.4 Context burn as an ambient signal

The burn-rate bar is the most genuinely useful thing upstream built and it is
undocumented. On a kiosk it becomes ambient: a sweep showing live context
pressure on the active session, with a block blink when a session crosses 80%.

That is the single most actionable number for someone running long Claude Code
sessions, and it belongs on a wall.

---

## Sprint 5 — Structural (fold in where convenient)

Not a standalone sprint. `generate.js` at 7,613 lines will obstruct Sprints 1–4,
so pay it down as you pass through.

| Task | Notes |
|---|---|
| Split `generate.js` | `src/scan/*.js` (one module per source), `src/ui/sections/*.js`, `src/ui/styles.js`. The `src/lib/` extractions are the proven pattern — six modules, all unit-tested. |
| Get the client JS out of template strings | ~4,000 lines currently unlinted and untypechecked. Move to `src/client/*.js`, inline at generate time. Then Biome can see it, as it does in `worldmonitor`. |
| First browser tests | Playwright, which you run in both other projects. Boot sequence completes, every nav section renders, `Cmd+K` finds a known skill, detail panel opens. Plus the Sprint 2.6 conformance suite. |
| Keep zero runtime dependencies | Non-negotiable constraint, and the reason this tool is durable. Dev dependencies are fine. |

---

## Recommendations — leveraging the wider Claude Code surface

Distinct from the dashboard work: how to get more out of Claude Code given what
you are building, and how this repo should participate.

### Skills

**Package the dashboard's own operations as skills.** You have 26 skills for
querying World Monitor and none for operating your own tooling. Candidates, as
`skills/*/SKILL.md` in this repo so they travel with it:

- `lcars-conformance` — run the DS 2.5.1 assertions against a project and report
  violations by rule. Useful across all three LCARS surfaces.
- `hud-scan` — report a project's agent configuration (skills, MCP servers,
  instruction files, hooks) and flag what is missing or dead.
- `claude-md-audit` — wrap the existing `scoreClaudeMd()` so the health score is
  available in a session, not just in the UI.

**Split `AGENTS.md`.** At 123 lines covering task authority, preflight, worktree
trust boundaries, import invariants, surface routing and PR delivery, it is
doing six jobs. The routing table and authority rules are genuinely universal;
the boundary invariants only matter when touching `src/`. Moving the
situational parts into skills that load on demand keeps the always-on context
smaller and sharper.

**Your skill descriptions are already good.** `track-earthquakes` explains *when
to use it* ("whether an earthquake was natural"), not just what it does. That is
the thing most skill authors get wrong. Keep that standard for the new ones.

### MCP servers

- **Add an MCP server to this dashboard.** It already has the data layer and an
  HTTP server. Exposing `list_skills`, `list_mcp_servers`, `get_claude_md`,
  `get_session_stats` and `get_context_burn` as MCP tools means Claude Code can
  *query its own configuration mid-session* — "which of my skills mention
  Redis?", "is my context about to run out?". A dashboard that only humans can
  read is half a tool. This is the highest-leverage single item in this section.
- **Register it the way you already know how.** `worldmonitor` ships
  `plugin.json` + `mcp.json` against the agent-plugins.org schema and publishes
  to the MCP registry via `publish-mcp-registry.yml`. Reuse that shape here.
- **Filesystem MCP over bespoke endpoints.** `/api/open`, `/api/save` and
  `/api/delete` reimplement sandboxed file operations that a filesystem MCP
  server already provides with better-audited path containment. Worth
  considering when you touch that code.

### Hooks

`.claude/settings.json` is `{}`. Put the enforcement you already trust into it —
your `worldmonitor` husky hooks are the model, especially the merged-PR-branch
guard, which is exactly the failure this environment's instructions also warn
about:

| Event | Hook | Rationale |
|---|---|---|
| `PreToolUse` on `Bash(git commit)` | Block if the current branch's PR is MERGED or CLOSED | Direct port of your husky `pre-commit`. Prevents orphaned commits. |
| `PostToolUse` on `Edit`/`Write` to `src/generate.js` | Run `node --check` on the extracted dashboard JS | Catches the template-string quoting bugs this file is prone to, at edit time rather than at page load. |
| `PostToolUse` on `Edit`/`Write` to CSS | Run the Sprint 2.6 conformance assertions | Keeps design drift from accumulating silently. |
| `Stop` | Append a session summary to `~/.claude/hud-events.jsonl` | Feeds Sprint 3.3 analytics with real data from day one. |
| `SessionStart` | `node src/generate.js --no-open` | Dashboard is always current when you open it. |

Install the HUD logger hooks early even if Sprint 3 is far off — analytics need
history, and history only accumulates if collection starts now.

### Subagents

- **Point `compound-engineering`'s reviewers at this repo.** The five agents are
  configured for a TypeScript monorepo. `code-simplicity-reviewer` and
  `architecture-strategist` against a 7,613-line generator will produce a better
  decomposition plan than working from `FORK-ANALYSIS.md` alone, and
  `security-sentinel` should see the unauthenticated write surface in §2.2.
- **Use worktrees per sprint.** `npm run worktree:bootstrap` already exists in
  `worldmonitor`; the equivalent here is trivial (no build step). Sprint 1
  (scanner) and Sprint 2 (CSS) barely overlap and can run in parallel — and
  Sprint 1.2's worktree grouping makes that legible in the dashboard, which is a
  pleasant way to dogfood it.

### Plugins

Once Sprints 1–3 land, this is plausibly a **plugin** rather than a standalone
CLI: the MCP server, the skills above, and the hooks, distributed as one
installable unit against the same agent-plugins.org schema you already use. That
is also the answer to "how does anyone else get value from my fork" without
touching the licence question.

### Cross-project

- **One LCARS design system, three consumers.** Promote DS 2.5.1 to the single
  authority for `worldmonitor`, `claude-hud-lcars` and `lcars-profile.svg`. Ship
  the tokens as data (JSON, plus generated CSS and TS), keep the written rules in
  one style guide, and reimplement the CSS per repo to respect the licence
  boundary. The profile SVG is the easiest conformance win — it is one file and
  already close to the bright variant.
- **A `DESIGN.md` for this repo.** Your *Nearby Things* `DESIGN.md` is the best
  artefact across your projects: principles as tie-breakers, a decision log, a
  "what went wrong and what it taught" section, and "declined, and why" so
  rejected ideas do not get re-proposed without new information. This repo has a
  roadmap that disagrees with its own code. Start the `DESIGN.md` with the six
  conformance decisions from Sprint 2 and the licence boundary, and the
  documentation drift problem does not recur.

---

## Sequencing

```
Sprint 0  ──►  Sprint 1  ──►  Sprint 3
   │             │
   │             └──► (worktrees enable parallel work from here)
   │
   └──►  Sprint 2  ──►  Sprint 4
              ▲
              └── Sprint 5 folds in wherever it unblocks the current sprint
```

Sprint 0 gates everything. Sprints 1 and 2 are independent — 1 is the scanner,
2 is the stylesheet — and are the natural parallel pair. Sprint 3 needs 1's
project registry. Sprint 4 needs 2's tokens and motion rules.

If you only do one sprint: **Sprint 1.** A dashboard that cannot see 26 of your
skills or either of your MCP servers is wrong in a way that no amount of polish
fixes.

---

## Caveat on sources

You asked for a review of previous conversations about LCARS projects, design and
style guides. I cannot read past Claude conversations — no tool in this session
exposes chat history. What follows is reconstructed from durable artefacts
instead, which is why the design findings cite files and line numbers rather than
recollections:

- `mtaylor45/worldmonitor` — LCARS Design System 2.5.1 (`preview/lcars-style-guide.html`),
  `src/themes/lcars/tokens.ts`, `docs/LCARS-ASSETS.md`, `AGENTS.md`,
  `.impeccable.md`, `compound-engineering.local.md`, `skills/`, `mcp.json`
- `mtaylor45/mtaylor45` — `lcars-profile.svg`, `README.md`
- Your pinned **DESIGN.md** artifact — *Nearby Things* design & decision record
- Your pinned **Origin Gate Runbook** artifact — homelab, tailnet and deploy conventions
- This repository at `a101bb9`

If there are design decisions that exist only in conversation and not in a file,
they are not reflected here — point me at them and I will reconcile. The more
robust fix is the `DESIGN.md` recommended above: decisions that live only in chat
are decisions you will re-litigate.

---

*Written 2026-09-17 against `a101bb9` (v1.7.1).*
