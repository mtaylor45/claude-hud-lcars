#!/usr/bin/env bash
# PostToolUse(Edit|Write) — syntax-check the dashboard's own client JS after any
# edit to the generator.
#
# ~4,000 lines of browser JS live inside template strings in src/generate.js, so
# no linter sees them and a quoting slip only surfaces when the page loads. This
# is the same check CI runs, moved to edit time.

set -uo pipefail

INPUT="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0

FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')"
case "$FILE" in
  */src/generate.js|src/generate.js) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! node src/generate.js --no-open >"$TMP/gen.log" 2>&1; then
  echo "dashboard-check: generate.js failed to run" >&2
  sed 's/^/dashboard-check: /' "$TMP/gen.log" >&2
  exit 2
fi

node -e '
  const fs = require("fs");
  const html = fs.readFileSync("dashboard.html", "utf8");
  const start = html.indexOf("<script>") + 8;
  const end = html.lastIndexOf("</script>");
  if (start < 8 || end < start) { console.error("no <script> block found"); process.exit(1); }
  fs.writeFileSync(process.argv[1], html.slice(start, end));
' "$TMP/dashboard.js" || { echo "dashboard-check: could not extract client JS" >&2; exit 2; }

if ! node --check "$TMP/dashboard.js" 2>"$TMP/check.log"; then
  echo "dashboard-check: the generated dashboard JS has a syntax error" >&2
  sed 's/^/dashboard-check: /' "$TMP/check.log" >&2
  exit 2
fi

exit 0
