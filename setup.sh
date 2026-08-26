#!/usr/bin/env bash
# GreenWave app — one-time setup on Linux Mint (or macOS).
#
#   chmod +x setup.sh && ./setup.sh
#
# Installs base deps, then uses `expo install` so every Expo SDK package
# lands on the exact version that matches the installed SDK (no guessing).

set -euo pipefail

echo "==> Node version:"
node -v
echo "    (Expo SDK 57 requires Node >= 20.19.4)"

echo
echo "==> Installing base dependencies..."
npm install

echo
echo "==> Installing Expo SDK packages at SDK-matched versions..."
npx expo install \
  expo-router \
  expo-constants \
  expo-linking \
  expo-status-bar \
  expo-splash-screen \
  expo-system-ui \
  expo-font \
  expo-web-browser \
  expo-secure-store \
  expo-image \
  expo-image-picker \
  expo-camera \
  expo-file-system \
  expo-haptics \
  react-native-safe-area-context \
  react-native-screens \
  react-native-gesture-handler \
  react-native-reanimated \
  react-native-web \
  react-native-svg \
  @expo/vector-icons \
  @react-native-async-storage/async-storage

echo
echo "==> Aligning any mismatched versions..."
npx expo install --fix

echo
echo "==> Running expo-doctor..."
npx expo-doctor@latest || true

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "==> Created .env from .env.example — edit it before running against the real API."
fi

cat <<'EOF'

============================================================
 Setup complete.

 Run it:
   npm run web        # browser
   npm run android    # Android emulator / device
   npm run ios        # iOS simulator (macOS only)

 The app starts in MOCK MODE (EXPO_PUBLIC_USE_MOCK=1 in .env)
 so you can click through every screen with no backend.

 Demo logins (mock mode, any password):
   admin@gwgc.cloud     — admin
   manager@gwgc.cloud   — manager
   driver@gwgc.cloud    — driver

 To point at your real API, edit .env:
   EXPO_PUBLIC_USE_MOCK=0
   EXPO_PUBLIC_API_BASE_URL=https://api.gwgc.cloud/api/v1
============================================================
EOF
