#!/usr/bin/env bash
#
# Create a new GitHub repo and push this project to it.
#
#   chmod +x push-to-github.sh && ./push-to-github.sh
#
# The commit is already made — this only creates the remote and pushes.
# Change REPO below if you want a different name.

set -euo pipefail

OWNER="anshrohitgwgc"
REPO="greenwave-invoicing"
VISIBILITY="private"

echo "==> Creating github.com/${OWNER}/${REPO} (${VISIBILITY})"
echo

if [ ! -f index.html ] || [ ! -d assets ]; then
  echo "ERROR: run this from inside the greenwave-invoicing folder." >&2
  exit 1
fi

# --- git repo -----------------------------------------------------------
if [ ! -d .git ]; then
  git init -b main
  git add -A
  git commit -m "Greenwave Ops — invoice maker and stock ledger"
fi
git branch -M main

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "==> Committing local changes."
  git add -A
  git commit -m "Local changes before first push"
fi

# --- create the remote --------------------------------------------------
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 || gh auth login

  if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
    echo "==> Repo already exists — reusing it."
    git remote remove origin 2>/dev/null || true
    git remote add origin "https://github.com/${OWNER}/${REPO}.git"
    git fetch origin main 2>/dev/null || true
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      echo "==> Remote has commits — replaying local history on top."
      git pull --rebase --allow-unrelated-histories origin main || {
        echo
        echo "Rebase hit a conflict (usually a README in both places)."
        echo "Fix the files, then:  git add <file> && git rebase --continue && git push -u origin main"
        exit 1
      }
    fi
  else
    gh repo create "${OWNER}/${REPO}" \
      --"${VISIBILITY}" \
      --source=. \
      --remote=origin \
      --description "Greenwave Ops — invoice maker and stock ledger for Greenwave Recycling and Healthcare"
  fi
else
  cat <<EOF
==> The GitHub CLI (gh) isn't installed.

On Linux Mint:
    sudo apt install gh
    gh auth login

Or create the repo by hand at https://github.com/new
  name:       ${REPO}
  visibility: ${VISIBILITY}
  do NOT tick "Add a README" — this project already has one

then run:
    git remote add origin https://github.com/${OWNER}/${REPO}.git
    git push -u origin main

EOF
  exit 1
fi

# --- push ---------------------------------------------------------------
echo
echo "==> Pushing main..."
git push -u origin main

cat <<EOF

============================================================
 Pushed: https://github.com/${OWNER}/${REPO}

 To run the app: open index.html in a browser.
============================================================
EOF
