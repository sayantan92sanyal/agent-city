#!/bin/bash
# Runs Agent City as an always-on macOS login service (a launchd LaunchAgent):
# it starts when you log in, restarts if it crashes, and serves the whole app
# at http://localhost:4317 — no `npm run dev` needed.
#
#   scripts/agent-city-service.sh install    build the app and start the service
#   scripts/agent-city-service.sh restart    rebuild and restart (after code changes)
#   scripts/agent-city-service.sh status     is it running?
#   scripts/agent-city-service.sh uninstall  stop it and remove the login service
set -euo pipefail

LABEL="com.agentcity.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/AgentCity"
URL="http://127.0.0.1:4317"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

is_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

wait_until_up() {
  for _ in $(seq 1 30); do
    if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
      echo "Agent City is running at http://localhost:4317"
      return 0
    fi
    sleep 0.5
  done
  echo "The service did not come up. Recent log:" >&2
  tail -n 20 "$LOG_DIR/server.log" >&2 || true
  return 1
}

build_client() {
  echo "Building the app…"
  npm --prefix "$REPO/client" run build --silent >/dev/null
}

install() {
  local node
  node="$(command -v node)" || { echo "node is not on your PATH" >&2; exit 1; }
  command -v claude >/dev/null || { echo "claude is not on your PATH" >&2; exit 1; }

  if ! is_loaded && lsof -iTCP:4317 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 4317 is in use (is 'npm run dev' running?). Stop it, then run install again." >&2
    exit 1
  fi

  build_client
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  # The service gets this shell's PATH so `claude` and the tools agents use
  # resolve exactly as they do in your terminal.
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(printf '%s' "$node" | xml_escape)</string>
    <string>src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$(printf '%s' "$REPO/server" | xml_escape)</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(printf '%s' "$PATH" | xml_escape)</string>
    <key>HOME</key><string>$(printf '%s' "$HOME" | xml_escape)</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(printf '%s' "$LOG_DIR/server.log" | xml_escape)</string>
  <key>StandardErrorPath</key><string>$(printf '%s' "$LOG_DIR/server.log" | xml_escape)</string>
</dict>
</plist>
PLIST

  if is_loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; sleep 1; fi
  launchctl bootstrap "$DOMAIN" "$PLIST"
  wait_until_up
}

restart() {
  is_loaded || { echo "The service is not installed. Run: $0 install" >&2; exit 1; }
  build_client
  launchctl kickstart -k "$DOMAIN/$LABEL"
  wait_until_up
}

status() {
  if is_loaded; then
    echo "Login service: installed"
    curl -fsS "$URL/api/health" >/dev/null 2>&1 && echo "Server: running at http://localhost:4317" || echo "Server: not responding (log: $LOG_DIR/server.log)"
  else
    echo "Login service: not installed"
  fi
}

uninstall() {
  if is_loaded; then launchctl bootout "$DOMAIN/$LABEL" || true; fi
  rm -f "$PLIST"
  echo "Agent City login service removed."
}

case "${1:-}" in
  install) install ;;
  restart) restart ;;
  status) status ;;
  uninstall) uninstall ;;
  *) echo "usage: $0 install|restart|status|uninstall" >&2; exit 2 ;;
esac
