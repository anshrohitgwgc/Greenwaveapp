#!/usr/bin/env bash
#
# Push this project to github.com/anshrohitgwgc/Greenwaveapp
#
#   chmod +x push-to-github.sh && ./push-to-github.sh
#
# The commit history is already in this folder — this only wires up the
# remote and pushes. It works whether the repo is empty or already has a
# README, and it never force-pushes.

set -euo pipefail

REMOTE_URL="https://github.com/anshrohitgwgc/Greenwaveapp.git"
BRANCH="main"

echo "==> Target: ${REMOTE_URL}"
echo

# --- sanity ------------------------------------------------------------------
if [ ! -f package.json ] || [ ! -d app ]; then
  echo "ERROR: run this from inside the greenwave-app folder." >&2
  exit 1
fi

if [ ! -d .git ]; then
  echo "==> No git repo here — creating one."
  git init -b "${BRANCH}"
  git add -A
  git commit -m "GreenWave staff app"
fi

# Make sure the branch is called main.
git branch -M "${BRANCH}"

# Commit anything still uncommitted so nothing is left behind.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "==> Committing local changes."
  git add -A
  git commit -m "Local changes before push"
fi

# --- remote ------------------------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "${REMOTE_URL}"
else
  git remote add origin "${REMOTE_URL}"
fi
echo "==> origin -> $(git remote get-url origin)"

# --- reconcile with whatever is already on GitHub ----------------------------
# A repo created with "Add a README" already has a commit, so a plain push
# would be rejected. Replay our history on top of it instead of force-pushing
# over something the user might want.
echo
echo "==> Checking what's already on the remote..."
if git fetch origin "${BRANCH}" 2>/dev/null; then
  if [ -n "$(git rev-list --count "origin/${BRANCH}" 2>/dev/null || echo '')" ]; then
    echo "==> Remote already has commits — replaying local history on top."
    if ! git pull --rebase --allow-unrelated-histories origin "${BRANCH}"; then
      cat <<'EOF'

The rebase hit a conflict (usually a README that exists in both places).
Fix it, then:

    git status                 # see the conflicting files
    # edit them, then:
    git add <file>
    git rebase --continue
    git push -u origin main

Or, if the remote is empty apart from an auto-generated README and you
are happy to discard it:

    git rebase --abort
    git push -u origin main --force-with-lease

EOF
      exit 1
    fi
  fi
else
  echo "==> Remote branch doesn't exist yet — this will create it."
fi

# --- push --------------------------------------------------------------------
echo
echo "==> Pushing ${BRANCH}..."
git push -u origin "${BRANCH}"

cat <<'EOF'

============================================================
 Pushed: https://github.com/anshrohitgwgc/Greenwaveapp

 Next:
   ./setup.sh        install dependencies
   npm run typecheck verify it compiles
   npm run web       open it in a browser
============================================================
EOF
