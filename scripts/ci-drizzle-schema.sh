#!/usr/bin/env sh
set -eu

pnpm run drizzle:schema:generate

if [ -n "$(git status --porcelain --untracked-files=all -- db/schema.sql)" ]; then
  echo "Generated Drizzle schema is out of date."
  echo "Run 'pnpm run drizzle:schema:generate' and commit the result."
  git status --short --untracked-files=all -- db/schema.sql
  git --no-pager diff --no-color -- db/schema.sql || true
  exit 1
fi
