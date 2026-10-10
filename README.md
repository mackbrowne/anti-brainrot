# Anti-Brainrot

Instagram DMs without the brainrot. An Android app that wraps instagram.com and
only lets you reach your inbox and conversations. The feed, reels, stories,
explore, posts and profiles are blocked, including reels and posts people send
you in chats.

## Install

Open this page on your Android phone and tap a button. Each app is a separate
install with its own login, so you can use one per Instagram account.

### <img src="assets/variants/main/icon.png" width="36" align="center" alt=""> Anti-Brainrot

For your main account.

<p>
  <a href="https://github.com/mackbrowne/anti-brainrot/releases/latest/download/anti-brainrot-main.apk"><img src="https://img.shields.io/badge/Download_APK-0095F6?style=for-the-badge&logo=android&logoColor=white" height="44" alt="Download APK"></a>
  <a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22app.antibrainrot%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fmackbrowne%2Fanti-brainrot%22%2C%22author%22%3A%22Anti-Brainrot%22%2C%22name%22%3A%22Anti-Brainrot%22%2C%22additionalSettings%22%3A%22%7B%5C%22apkFilterRegEx%5C%22%3A%5C%22anti-brainrot-main%5C%5C%5C%5C.apk%5C%22%2C%5C%22appName%5C%22%3A%5C%22Anti-Brainrot%5C%22%2C%5C%22about%5C%22%3A%5C%22Instagram%20DMs%20without%20the%20brainrot%5C%22%7D%22%7D"><img src="assets/readme/badge-obtainium.png" height="44" alt="Get it on Obtainium"></a>
</p>

### <img src="assets/variants/two/icon.png" width="36" align="center" alt=""> Anti-Brainrot 2

A second, separate app for another account.

<p>
  <a href="https://github.com/mackbrowne/anti-brainrot/releases/latest/download/anti-brainrot-two.apk"><img src="https://img.shields.io/badge/Download_APK-8E5CF7?style=for-the-badge&logo=android&logoColor=white" height="44" alt="Download APK"></a>
  <a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22app.antibrainrot.two%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fmackbrowne%2Fanti-brainrot%22%2C%22author%22%3A%22Anti-Brainrot%22%2C%22name%22%3A%22Anti-Brainrot%202%22%2C%22additionalSettings%22%3A%22%7B%5C%22apkFilterRegEx%5C%22%3A%5C%22anti-brainrot-two%5C%5C%5C%5C.apk%5C%22%2C%5C%22appName%5C%22%3A%5C%22Anti-Brainrot%202%5C%22%2C%5C%22about%5C%22%3A%5C%22Instagram%20DMs%20without%20the%20brainrot%5C%22%7D%22%7D"><img src="assets/readme/badge-obtainium.png" height="44" alt="Get it on Obtainium"></a>
</p>

On a computer? Scan this with your phone to open the latest release:

<img src="assets/readme/qr-latest-release.png" width="160" alt="QR code linking to the latest release">

1. Tap **Download APK**, then open the file.
2. Android asks once to allow your browser to install apps. Allow it, then tap
   **Install**.
3. Google Play Protect may say it hasn't seen this app before. That's normal
   for apps from outside the Play Store: tap **Scan app** (it uploads the app
   to Google for a check) or **More details → Install without scanning**.
4. Open the app, log in to Instagram, and allow notifications.

For automatic updates, install [Obtainium](https://obtainium.imranr.dev/) first
and use its button instead: it adds the app and keeps it updated from this
repo's releases.

There's no iPhone version: iOS doesn't allow installing apps from outside the
App Store, and this one wouldn't get in.

## How the blocking works

Everything is driven by the allowlist in [`src/policy.ts`](src/policy.ts).

1. **Native navigation guard**: `onShouldStartLoadWithRequest` checks every full
   page load. Blocked Instagram routes redirect to the inbox. Outbound links,
   including `l.instagram.com/?u=` shims, open in a browser sheet unless they
   point back to Instagram content.
2. **In-page guard** ([`src/injected.ts`](src/injected.ts)): Instagram is a SPA,
   so most route changes never trigger a page load. A script injected before
   the page's own JS adds three layers:
   - a capture-phase click guard on links to blocked routes (buttons nested
     inside such links, like the chat header's back arrow, still work)
   - Navigation API interception: a blocked navigation is cancelled and the
     page hard-reloads to the inbox, discarding anything already rendered
   - a watchdog (patched `history`, `popstate`, polling) that does the same
3. **Native SPA backstop**: `onNavigationStateChange` sees `pushState` URL
   changes on both platforms and bounces anything blocked.
4. **CSS**: hides the nav entries to the feed, explore and reels, and the story rings.
5. **Shared content in chats**: reels, posts and stories that friends forward
   play in an in-chat viewer without any URL change. Their message bubbles
   always link to the original poster (photos and videos sent directly never
   do), so those bubbles are blurred, labelled "🧠 blocked", and made untappable.

If Instagram changes its URL scheme again, edit `ALLOWED_IG_PATHS` in `src/policy.ts`.

## DM notifications (Android)

Instagram's web push needs the browser Push API, which WebViews don't support.
Instead, [`src/dmNotifications.ts`](src/dmNotifications.ts) registers a
WorkManager job (`expo-background-task`, about every 15 minutes) that calls the
web inbox's own `get_badge_count` endpoint. React Native's fetch shares the
WebView's cookie jar, so each app checks its own account. When the unread count
rises above what it was when you last left the app, the job posts a local
notification. Expect delays of 15 minutes or more, longer in Doze.

To test without waiting: `adb shell cmd jobscheduler run -f <package> 0`.

## Make your own variant (name and icon)

A variant is a separately installable copy of the app with its own name, icon,
app ID and login. The public ones live in [`variants.json`](variants.json):

```json
{
  "id": "two",
  "name": "Anti-Brainrot 2",
  "appId": "app.antibrainrot.two",
  "icon": "assets/variants/two/icon.png",
  "color": "#3A1C71"
}
```

| Field | Required | What it is |
| --- | --- | --- |
| `id` | yes | Short name: lowercase letters, digits, dashes. Used in file names. |
| `name` | yes | The app's name on your home screen. |
| `appId` | yes | Unique Android app ID, like `com.yourname.dms`. Each variant needs its own. |
| `icon` | yes | Square PNG, ideally 1024×1024. Android crops the edges into the launcher's shape, so keep the important part centred. |
| `color` | no | Background colour behind the icon (default black). |
| `accent` | no | Notification colour. |
| `adaptiveForeground`, `adaptiveBackground`, `monochrome` | no | Separate Android adaptive-icon layers, if you want full control. |

**Without installing anything (GitHub only):**

1. Fork this repo.
2. Upload your icon, and add your variant to `variants.json` (both in the browser).
3. In your fork, open **Actions → Release → Run workflow**. When it finishes,
   download your APK from the run's **Artifacts**.

Forks have no signing key, so these APKs are debug-signed. They install and run
fine. To ship updates that install over them, add your own key as repo secrets
(see below).

**On your own computer:** put personal variants in `local/variants.json`, with
the same format, and their icons in `local/`. That folder is git-ignored, so
your names and pictures never end up in a commit. Local entries are added to
the public ones, or replace one with the same `id`.

## Building

```bash
npm install
scripts/build-android.sh            # every variant -> dist/<id>.apk
scripts/build-android.sh main       # just one
```

Needs Node, a JDK 17 and the Android SDK. The version comes from the latest
`vX.Y.Z` tag, so a local build never downgrades an installed release.

**Signing.** Android only installs an update over an app signed with the same
key. The script signs with your key when `ANDROID_KEYSTORE`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`
are set, or when they're in `~/.android/anti-brainrot-signing.env`. Without
them, APKs keep the debug key.

**Releasing.** Push a `vX.Y.Z` tag. [`.github/workflows/release.yml`](.github/workflows/release.yml)
builds every variant in `variants.json`, signs them with the key in the repo
secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and attaches
`anti-brainrot-<id>.apk` to a GitHub Release. The file names carry no version,
so the download buttons above always point at the newest release.

Set `EXPO_PUBLIC_WEBVIEW_DEBUG=1` when building to make the WebView inspectable
via `chrome://inspect`.

## Development

```bash
npm install
APP_VARIANT=main npx expo run:android
```

This needs a dev build (custom native modules), not Expo Go. If `pod install`
crashes with an encoding error on iOS, run `export LANG=en_US.UTF-8` first.
