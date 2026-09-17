#!/usr/bin/env bash
# PreToolUse(Bash) — block commits onto a branch whose PR is already merged or
# closed. Commits there are orphaned: the PR cannot pick them up.
#
# Ported from the husky pre-commit guard in mtaylor45/worldmonitor.
# Exit 2 blocks the tool call; exit 0 allows it.

set -uo pipefail

INPUT="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')"

[[ "$TOOL_NAME" == "Bash" ]] || exit 0
printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+commit' || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

BRANCH="$(git branch --show-current 2>/dev/null || true)"
[[ -n "$BRANCH" && "$BRANCH" != "main" && "$BRANCH" != "master" ]] || exit 0

# No gh, no network, no opinion — never block on a missing tool.
command -v gh >/dev/null 2>&1 || exit 0

PR_STATE="$(gh pr view "$BRANCH" --json state --jq '.state' 2>/dev/null || true)"

if [[ "$PR_STATE" == "MERGED" || "$PR_STATE" == "CLOSED" ]]; then
  cat >&2 <<MSG
Refusing to commit: the PR for '$BRANCH' is $PR_STATE.

Commits on a merged or closed PR branch are orphaned. Start fresh work from
the default branch instead:

  git checkout main && git pull && git checkout -b <new-branch>
MSG
  exit 2
fi

exit 0
