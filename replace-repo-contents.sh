#!/usr/bin/env bash
#
# Replace everything in an existing GitHub repo with this app.
#
#   chmod +x replace-repo-contents.sh
#   ./replace-repo-contents.sh                                   # uses Greenwaveapp
#   ./replace-repo-contents.sh https://github.com/you/other.git  # or any repo
#
# The old code is REMOVED from the latest commit but stays in the history,
# so you can always get it back:
#
#   git log --oneline                    # find the commit before the swap
#   git checkout <that-commit> -- .      # restore all of it
#
# This never force-pushes and never rewrites history. If you would rather
# wipe the history too, that is a different (and irreversible) operation —
# don't use this script for it.

set -euo pipefail

REPO_URL="${1:-https://github.com/anshrohitgwgc/Greenwaveapp.git}"
BRANCH="main"
WORK="$(mktemp -d)"
SRC="$(pwd)"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

if [ ! -f index.html ] || [ ! -d assets ]; then
  echo "ERROR: run this from inside the greenwave-invoicing folder." >&2
  exit 1
fi

echo "==> Source : $SRC"
echo "==> Target : $REPO_URL"
echo

# --- 1. get the existing repo -------------------------------------------
echo "==> Cloning the target repo..."
if ! git clone --quiet "$REPO_URL" "$WORK/repo" 2>/dev/null; then
  echo
  echo "Could not clone $REPO_URL" >&2
  echo "Check the URL, and that you are signed in:  gh auth status" >&2
  exit 1
fi

cd "$WORK/repo"
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH"

# --- 2. show what is about to go ----------------------------------------
EXISTING=$(git ls-files | wc -l | tr -d ' ')
echo
if [ "$EXISTING" -eq 0 ]; then
  echo "==> Repo is empty — nothing to remove."
else
  echo "==> This repo currently has $EXISTING tracked files, for example:"
  git ls-files | head -12 | sed 's/^/      /'
  [ "$EXISTING" -gt 12 ] && echo "      ... and $((EXISTING - 12)) more"
  echo
  echo "    They will be removed from the latest commit."
  echo "    They stay in the history and can be restored at any time."
  echo
  read -r -p "    Continue? [y/N] " reply
  case "$reply" in
    [yY]*) ;;
    *) echo "    Cancelled — nothing was changed."; exit 0 ;;
  esac
fi

# --- 3. swap the contents ------------------------------------------------
echo
echo "==> Removing old files..."
git ls-files -z | xargs -0 -r git rm -q --cached
find . -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} +

echo "==> Copying the app in..."
cd "$SRC"
for item in index.html assets README.md .gitignore push-to-github.sh replace-repo-contents.sh; do
  [ -e "$item" ] && cp -R "$item" "$WORK/repo/"
done

# --- 4. commit and push --------------------------------------------------
cd "$WORK/repo"
git add -A

if git diff --cached --quiet; then
  echo "==> Nothing changed — the repo already matches this app."
  exit 0
fi

git commit -q -m "Replace with Greenwave Ops — invoice maker and stock ledger

Removes the previous contents of this repo and replaces them with the
invoicing and inventory app. The old files remain in the history:

    git log --oneline
    git checkout <commit-before-this> -- .
"

echo "==> Pushing to $BRANCH..."
git push origin "$BRANCH"

cat <<EOF

============================================================
 Done. $REPO_URL now holds the app.

 The old code is still in the history — nothing was destroyed:
     git log --oneline
     git checkout <commit-before-the-swap> -- .
============================================================
EOF
