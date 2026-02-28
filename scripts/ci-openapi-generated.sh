#!/usr/bin/env sh
set -eu

pnpm run openapi:generate

if [ -n "$(git status --porcelain --untracked-files=all -- src/lib/openapi-ts)" ]; then
  echo "Generated OpenAPI files are out of date."
  echo "Run 'pnpm run openapi:generate' and commit the result."
  git status --short --untracked-files=all -- src/lib/openapi-ts
  git --no-pager diff --no-color -- src/lib/openapi-ts || true
  exit 1
fi
