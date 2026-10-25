#!/bin/sh
# Keep hashed assets from previous deploys available for a while.
#
# Installed PWAs keep running an older build (cached app shell) until the user
# applies the update. Without this, every chunk that build lazy-loads after a
# deploy 404s. /var/cache/tab-assets should be a persistent volume; without
# one this is a harmless no-op per container.
# Never block nginx from starting: failures here only cost the safety net.
set -u

ARCHIVE=/var/cache/tab-assets/assets
RETAIN_DAYS="${RETAIN_ASSETS_DAYS:-14}"

mkdir -p "$ARCHIVE" || { echo "retain-assets: cannot create $ARCHIVE" >&2; exit 0; }
# Plain copy (no -p) stamps current files with "now", so a file only ages out
# RETAIN_DAYS after the last deploy that still shipped it.
cp -R /usr/share/nginx/html/assets/. "$ARCHIVE/" ||
  echo "retain-assets: copy failed" >&2
find "$ARCHIVE" -type f -mtime +"$RETAIN_DAYS" -delete ||
  echo "retain-assets: prune failed" >&2
