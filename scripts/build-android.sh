#!/usr/bin/env bash
# Build a release APK per variant into dist/<id>.apk.
#   scripts/build-android.sh             # every variant (variants.json + local/variants.json)
#   scripts/build-android.sh main two    # just these
#
# Signing: if ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and
# ANDROID_KEY_PASSWORD are set (directly, or in $SIGNING_ENV, default
# ~/.android/anti-brainrot-signing.env), the APKs are signed with that key.
# Otherwise they keep the template debug key: fine for your own phone, but
# updates only install over builds signed with the same key.
set -euo pipefail
cd "$(dirname "$0")/.."
export LANG=en_US.UTF-8
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

SIGNING_ENV="${SIGNING_ENV:-$HOME/.android/anti-brainrot-signing.env}"
if [ -z "${ANDROID_KEYSTORE:-}" ] && [ -f "$SIGNING_ENV" ]; then
  set -a; . "$SIGNING_ENV"; set +a
fi

# Version: CI passes it from the release tag. Locally, use the latest tag so a
# local build never has a lower versionCode than an installed release.
if [ -z "${APP_VERSION:-}" ]; then
  tag=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || echo v1.0.0)
  IFS=. read -r major minor patch <<<"${tag#v}"
  export APP_VERSION="${tag#v}"
  export APP_VERSION_CODE=$(( 10#$major * 10000 + 10#$minor * 100 + 10#$patch ))
fi

if [ $# -gt 0 ]; then variants=("$@"); else read -ra variants <<<"$(node scripts/variants.js ids)"; fi
build_tools="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
unsigned=android/app/build/outputs/apk/release/app-release.apk

mkdir -p dist
for v in "${variants[@]}"; do
  echo "==> $v (version $APP_VERSION, code $APP_VERSION_CODE)"
  APP_VARIANT=$v npx expo prebuild --platform android --clean --no-install
  (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)
  out="dist/$v.apk"
  if [ -n "${ANDROID_KEYSTORE:-}" ]; then
    "$build_tools/zipalign" -f -P 16 4 "$unsigned" "$out"
    "$build_tools/apksigner" sign --ks "$ANDROID_KEYSTORE" --ks-key-alias "$ANDROID_KEY_ALIAS" \
      --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD "$out"
    rm -f "$out.idsig"
    "$build_tools/apksigner" verify "$out"
    echo "    signed with $(basename "$ANDROID_KEYSTORE")"
  else
    cp "$unsigned" "$out"
    echo "    debug-signed (set ANDROID_KEYSTORE to sign with your own key)"
  fi
done
ls -lh dist/*.apk
