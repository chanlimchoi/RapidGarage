#!/bin/sh
# Container entrypoint.
#  - Started as root (the default): make the uploads directory writable for the
#    unprivileged "node" user (Fly/Render volumes are mounted root-owned), then
#    re-exec as "node". Only the directory itself is chowned, not its contents.
#  - RUN_MIGRATIONS (default true): run the release step (precheck + migrate)
#    before the app. Set false where the host runs `node scripts/release.js`
#    itself (Fly release_command, Render preDeployCommand) or when several
#    instances start at once.
set -eu

if [ "$(id -u)" = "0" ]; then
  dir="${UPLOAD_DIR:-/data/uploads}"
  mkdir -p "$dir"
  chown node:node "$dir" 2>/dev/null || echo "entrypoint: could not chown $dir; uploads may fail" >&2
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

case "$(echo "${RUN_MIGRATIONS:-true}" | tr 'A-Z' 'a-z')" in
  1|true|yes|on) node scripts/release.js ;;
esac

exec "$@"
