#!/usr/bin/env bash
# Serve the app over http so it can be installed to a phone home screen.
# Opening index.html directly works too — you just don't get offline caching
# or the "Add to Home Screen" prompt, because browsers require http(s).
PORT="${1:-8080}"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "Greenwave Ops"
echo "  this computer : http://localhost:${PORT}"
[ -n "$IP" ] && echo "  phone/tablet  : http://${IP}:${PORT}   (same wifi)"
echo
python3 -m http.server "$PORT"
