#!/usr/bin/env bash
# Watchdog for the DAIC archive dev server.
# Restarts `npm run dev` whenever it exits, with a 2s pause between attempts.
# Stop it with: kill <this script's PID>   (or Ctrl-C if running in a terminal)

cd "$(dirname "$0")" || exit 1

trap 'echo "[$(date +%H:%M:%S)] watchdog stopping"; kill 0; exit 0' INT TERM

echo "[$(date +%H:%M:%S)] watchdog started (pid $$)"

while true; do
  echo "[$(date +%H:%M:%S)] starting vite..."
  start=$SECONDS

  npm run dev

  code=$?
  ran=$(( SECONDS - start ))
  echo "[$(date +%H:%M:%S)] vite exited (code $code) after ${ran}s"

  # A near-instant exit almost always means the port is still held by another
  # process, or a config error - flag it so a tail of the log makes it obvious
  # rather than looking like a healthy restart cycle.
  if [ "$ran" -lt 5 ]; then
    echo "[$(date +%H:%M:%S)] WARNING: exited in under 5s - likely port 5180 in use or a config error"
  fi

  sleep 2
done
