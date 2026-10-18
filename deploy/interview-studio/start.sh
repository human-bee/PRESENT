#!/bin/sh
set -eu
if [ "${INTERVIEW_SERVICE:-web}" = "listener" ]; then
  exec npm run listener
fi
node bootstrap.mjs
if [ "${INTERVIEW_SMOKE_TEST:-false}" = "true" ]; then
  npx tsx --tsconfig tsconfig.json smoke.ts prepare
  npx tsx --tsconfig tsconfig.json smoke.ts run &
fi
exec npm start
