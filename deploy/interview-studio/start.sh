#!/bin/sh
set -eu
if [ "${INTERVIEW_SERVICE:-web}" = "listener" ]; then
  exec npm run listener
fi
node bootstrap.mjs
exec npm start
