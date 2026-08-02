#!/usr/bin/env bash
# Start/stop the Crown app locally, DETACHED from whatever shell launched it.
#
# The plain `npm run dev` kept dying: launched from an agent/terminal session, it belongs to that
# session's process group and goes down with it. setsid puts the server in its own session, so
# closing the terminal (or the agent exiting) leaves it running.
#
#   ./run-local.sh start | stop | restart | status | log
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.local-server.pid"
LOG_FILE="$DIR/.local-server.log"
PORT=3000

# Node lives in ~/.local (installed without root) and is not on a non-login shell's PATH.
export PATH="$HOME/.local/bin:$PATH"

running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-start}" in
  start)
    if running; then
      echo "already running (pid $(cat "$PID_FILE")) — http://localhost:$PORT"
      exit 0
    fi
    cd "$DIR" || exit 1
    setsid nohup npm run dev > "$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
    # `next dev` forks a child that binds the port, so wait on the PORT, not the pid.
    for _ in $(seq 1 60); do
      if grep -q "Ready in" "$LOG_FILE" 2>/dev/null; then
        echo "up — http://localhost:$PORT  (pid $(cat "$PID_FILE"), log: $LOG_FILE)"
        exit 0
      fi
      if grep -qE "EADDRINUSE|Failed to compile" "$LOG_FILE" 2>/dev/null; then
        echo "failed to start — see $LOG_FILE"; tail -5 "$LOG_FILE"; exit 1
      fi
      sleep 1
    done
    echo "timed out waiting for the server — see $LOG_FILE"; exit 1
    ;;
  stop)
    if running; then
      # Kill the whole process group setsid created, so the `next dev` child goes too.
      kill -- "-$(cat "$PID_FILE")" 2>/dev/null || kill "$(cat "$PID_FILE")" 2>/dev/null
      rm -f "$PID_FILE"
      echo "stopped"
    else
      rm -f "$PID_FILE"
      echo "not running"
    fi
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    if running; then
      echo "running (pid $(cat "$PID_FILE")) — http://localhost:$PORT"
    else
      echo "not running"
    fi
    ;;
  log)
    tail -f "$LOG_FILE"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|log}"; exit 1
    ;;
esac
