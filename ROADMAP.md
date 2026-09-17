# ROADMAP // CLAUDE HUD LCARS

**The active plan for this fork is [SPRINT-PLAN.md](SPRINT-PLAN.md).**
This file records where the code actually stands, so there is one roadmap and not two.

---

## Why this file was rewritten

The previous version of this document self-rated "Version 1.4.0 — 8/10" and listed a
file watcher, MCP health check and session monitor as future work. All three were
already built. It also never mentioned the context burn-rate subsystem, which ships
and works.

A roadmap that disagrees with its own code is worse than no roadmap: it sends you
building things that exist and hides things that need maintaining. Everything below
was measured against the tree, not recalled.

---

## Shipped, and previously undocumented

These exist in the code today. They were missing from both the old roadmap and the
changelog.

| Feature | Where |
|---|---|
| File watcher — `fs.watch` on `~/.claude/`, categorised, broadcast over SSE | `src/lib/fileWatcher.js`, `src/server.js:1272` |
| Live dashboard updates via `EventSource` | `src/generate.js:7343` |
| Context burn-rate bar — live token pressure, projected time remaining | `src/lib/burnRate.js`, `src/generate.js:2230` |
| MCP health probing | `src/server.js:869` (`/api/mcp-status`) |
| MCP enable/disable, security audit (CVE + risky docker flags) | `src/generate.js:76` |
| `CLAUDE.md` health scoring, 0–100 | `src/generate.js:402` |
| Memory subsystem + `recall` CLI | `src/recall.js`, `src/lib/memory-*.js` |
| MNEMOS panel | `src/generate.js:502` |
| Hook event logger writing `~/.claude/hud-events.jsonl` | INSTALL HUD LOGGER, HOOKS section |

The hook event logger collects data that **nothing yet reads**. Analytics over it is
SPRINT-PLAN Sprint 3.3.

---

## Measured state

Version 1.7.1. Figures from the tree, not estimates.

| Dimension | Score | Note |
|---|---|---|
| Design & aesthetic | 7/10 | Committed LCARS execution, but off-spec against this author's own LCARS Design System 2.5.1 in six measurable ways |
| Read / browse | 5/10 | Excellent for global `~/.claude/` config; blind to repo-level skills, `AGENTS.md`, `mcp.json` and plugin-provided subagents |
| Write / action | 5/10 | Installs and edits work; the UX is rough |
| Observability | 6/10 | SSE, burn rate and MCP probing shipped — see above |
| Intelligence | 4/10 | The COMPUTER bar is a proxy, not a collaborator |
| Code health | 5/10 | `generate.js` is 7,613 lines; ~4,000 lines of client JS sit in template strings where no linter reaches |
| Test coverage | 6/10 | 331 tests, data layer solid, **zero** UI tests |

Full reasoning, with line numbers: [FORK-ANALYSIS.md](FORK-ANALYSIS.md).

**The core limitation is no longer "it's a mirror."** It is that the mirror points at the
wrong thing: `~/.claude/` only, when the agent configuration that matters lives in
repositories. That is what Sprint 1 fixes.

---

## Inherited ideas not yet scheduled

Kept from the upstream roadmap because they are good and should not be lost. Nothing
here is committed work — the scheduled plan is SPRINT-PLAN.md.

**Config as code** — snapshot `settings.json` on load and show a git-style diff when it
changes; one-click rollback from a snapshot history; validate mutations against the
config schema before writing.

**Skill & agent workshop** — form-based skill and agent builders writing straight to
disk; fire a test prompt at a skill from its detail panel; a hook lab that runs a hook
against a sample payload before you commit it.

**MCP setup wizard** — read a server's README for required env vars and prompt for
them; connection test after install; verify `npx`/`uvx`/`docker` exist first.

**Context substrate editors** — structured editors for `CLAUDE.md`/`AGENTS.md` and for
memory files, with live preview. The most important files in the setup currently get
the least UI.

**Setup advisor** — a structured report on what is redundant, missing or conflicting
across the whole configuration; suggestions grounded in what you actually build rather
than a generic list.

**Prompt library** — "save as template" on any COMPUTER bar exchange, browsable later,
so the tool accumulates value instead of being stateless.

**Sharing** — export the configuration as a portable bundle; import someone else's and
cherry-pick from it. Note the licence boundary in FORK-ANALYSIS §1.1 before designing
anything that moves code rather than config.

**Evaluation** — test cases per skill, run as a suite, so you know when a skill
regresses. Synthetic payloads for hooks. A/B two versions of a skill on one prompt.

**Scheduling** — run an agent on a timer or on an event (file change, PR opened, build
failed), with results written to memory.

---

## What we're not building

- **Not a Claude Code replacement.** The CLI stays primary; this augments it.
- **Not a team product.** Personal workflow first.
- **No new runtime dependencies.** Zero-dependency is why this tool is durable. Dev
  dependencies are fine.
- **Not abstracting the filesystem.** Files on disk stay the source of truth — no
  proprietary database, no required cloud sync.

---

*Rewritten 2026-09-17 against `a101bb9` + Sprint 0. If this file and the code ever
disagree again, the code is right and this file is a bug.*
