#!/usr/bin/env bash
#
# Create the GitHub repo and push this project to it.
#
#   chmod +x push-to-github.sh && ./push-to-github.sh
#
# The repo history is already here — this only creates the remote and pushes.

set -euo pipefail

OWNER="anshrohitgwgc"
REPO="greenwave-app"
VISIBILITY="private"

echo "==> Target: github.com/${OWNER}/${REPO} (${VISIBILITY})"
echo

# --- 1. Make sure we're in the project and it has a commit -------------------
if [ ! -f package.json ] || [ ! -d app ]; then
  echo "ERROR: run this from inside the greenwave-app folder." >&2
  exit 1
fi

if [ ! -d .git ]; then
  echo "==> No git repo here yet — creating one."
  git init -b main
  git add -A
  git commit -m "GreenWave staff app"
fi

# Commit anything uncommitted so nothing is left behind.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "==> Committing local changes."
  git add -A
  git commit -m "Local changes before first push"
fi

# --- 2. Create the remote repo ----------------------------------------------
if command -v gh >/dev/null 2>&1; then
  echo "==> Using the GitHub CLI."
  gh auth status >/dev/null 2>&1 || gh auth login

  if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
    echo "==> ${OWNER}/${REPO} already exists — reusing it."
    git remote remove origin 2>/dev/null || true
    git remote add origin "https://github.com/${OWNER}/${REPO}.git"
  else
    gh repo create "${OWNER}/${REPO}" \
      --"${VISIBILITY}" \
      --source=. \
      --remote=origin \
      --description "GreenWave staff app — pickups, dropoffs, material weights and staff hours. iOS, Android and web from one Expo codebase."
  fi
else
  cat <<EOF
==> The GitHub CLI (gh) isn't installed.

On Linux Mint:
    sudo apt install gh          # or: https://github.com/cli/cli#installation
    gh auth login

Or create the repo by hand at https://github.com/new
  name:       ${REPO}
  visibility: ${VISIBILITY}
  do NOT tick "Add a README" — this project already has one

then re-run this script.
EOF
  exit 1
fi

# --- 3. Push -----------------------------------------------------------------
echo
echo "==> Pushing main..."
git push -u origin main

echo
echo "============================================================"
echo " Done: https://github.com/${OWNER}/${REPO}"
echo
echo " Next:"
echo "   ./setup.sh        install dependencies"
echo "   npm run web       open it in a browser"
echo "============================================================"
