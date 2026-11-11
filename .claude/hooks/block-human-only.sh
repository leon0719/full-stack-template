#!/bin/sh
# PreToolUse(Bash) guard for the "Human-only operations" list in CLAUDE.md.
# permissions.deny patterns miss variants such as `git -C . push` or `sh -c "git push"`;
# this checks the whole command string instead. Exit 2 = block and tell Claude why.
input=$(cat)
# Without jq, fall back to matching the raw hook payload (stricter, never looser).
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || cmd=$input
# Normalize so quoting/whitespace tricks (`git "push"`, tabs, newlines) cannot dodge the patterns.
cmd=$(printf '%s' "$cmd" | tr '\t\n' '  ' | tr -d "\"'\\\\")

block() {
  echo "Blocked: $1 is a human-only operation (see CLAUDE.md). Stop and hand the exact command to the user." >&2
  exit 2
}

matches() { printf '%s' "$cmd" | grep -Eq "$1"; }

matches 'git( +-[^ ]+( +[^- ][^ ]*)?)* +push([^[:alnum:]_.-]|$)' && block "git push"
matches '\.env\.prod(uction)?([^.[:alnum:]]|$)' && block "touching the prod env file"
matches 'docker-compose\.prod|make[^|;&]* prod-' && block "a prod Docker operation"
matches 'make[^|;&]* docker-clean' && block "make docker-clean (wipes the local DB volume)"
matches '(^|[^[:alnum:]_./-])aws +|deploy-frontend' && block "a deploy / AWS command"
exit 0
