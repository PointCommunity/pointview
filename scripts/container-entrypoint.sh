#!/bin/sh
set -eu

case "${1:-web}" in
  web)
    shift || true
    exec node /app/server.js "$@"
    ;;
  migrate)
    shift || true
    exec /app/node_modules/.bin/tsx /app/src/cli/migrate-up.ts "$@"
    ;;
  triage)
    shift || true
    exec /app/node_modules/.bin/tsx /app/src/cli/triage-once.ts "$@"
    ;;
  retention)
    shift || true
    exec /app/node_modules/.bin/tsx /app/src/cli/retention-once.ts "$@"
    ;;
  *)
    printf '%s\n' 'Usage: container-entrypoint.sh {web|migrate|triage|retention}' >&2
    exit 64
    ;;
esac
