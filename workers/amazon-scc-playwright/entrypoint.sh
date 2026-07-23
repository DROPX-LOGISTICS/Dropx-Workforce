#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${SESSION_STATE_DIR:-/var/lib/dropx-scc-worker/sessions}"
mkdir -p "${DEBUG_ARTIFACT_DIR:-/var/lib/dropx-scc-worker/artifacts}"

enable_vnc="$(printf '%s' "${ENABLE_VNC:-false}" | tr '[:upper:]' '[:lower:]')"

if [[ "$enable_vnc" == "true" || "$enable_vnc" == "1" || "$enable_vnc" == "yes" ]]; then
  export DISPLAY="${DISPLAY:-:99}"
  export SCREEN_WIDTH="${SCREEN_WIDTH:-1440}"
  export SCREEN_HEIGHT="${SCREEN_HEIGHT:-1000}"
  export SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
  export VNC_PORT="${VNC_PORT:-5900}"
  export NOVNC_PORT="${NOVNC_PORT:-6080}"

  rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"
  Xvfb "$DISPLAY" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" -nolisten tcp &
  openbox >/tmp/dropx-openbox.log 2>&1 &

  vnc_args=(-display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT")
  if [[ -n "${VNC_PASSWORD:-}" ]]; then
    mkdir -p /tmp/dropx-vnc
    x11vnc -storepasswd "$VNC_PASSWORD" /tmp/dropx-vnc/passwd >/dev/null
    vnc_args+=(-rfbauth /tmp/dropx-vnc/passwd)
  else
    vnc_args+=(-nopw)
  fi

  x11vnc "${vnc_args[@]}" >/tmp/dropx-x11vnc.log 2>&1 &
  websockify --web=/usr/share/novnc/ "$NOVNC_PORT" "localhost:$VNC_PORT" >/tmp/dropx-novnc.log 2>&1 &
fi

exec npm start
