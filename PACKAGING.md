# RC — packaging (Android APK + Windows/Linux desktop)

This repo can produce **installable apps** from source:

| Platform | Output | Built by |
|---|---|---|
| Android | `RC-debug.apk` (+ `RC-release.apk` when signing is configured) | Capacitor → Gradle |
| Windows | `RC-Setup-<ver>-x64.exe` / `-arm64.exe` (installer) | Electron → electron-builder (NSIS) |
| Linux | `RC-<ver>-<arch>.AppImage` and `.deb` | Electron → electron-builder |

## Where the install files come from

> **Note:** the artifacts are **compiled on CI**, not committed to the repo.
> Binaries are large and platform-specific, so they belong in Actions
> artifacts / Releases rather than in git history.

### Option A — GitHub Actions (recommended; nothing to install)

1. Push this repo to GitHub.
2. Go to **Actions → "Build apps (Android + Desktop)" → Run workflow**.
3. When it finishes, download the files from the **Artifacts** section of that run:
   - `android-apk` → your APK
   - `desktop-windows` → the `.exe` installer
   - `desktop-linux` → the `.AppImage` / `.deb`

**To get permanent, easily shareable download links**, push a version tag — the
workflow then publishes everything to a **GitHub Release**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The Release page will list the APK, the Windows installer and the Linux
packages as direct downloads.

### Option B — build locally

Requires the platform SDKs on your machine (JDK 21 + Android SDK for Android;
Node for desktop).

```bash
# one-time
bun install

# Android APK  →  android/app/build/outputs/apk/debug/app-debug.apk
bun run android:apk

# Desktop installers  →  desktop/release/
bun run desktop:install
bun run desktop:dist          # or: desktop:dist:win / desktop:dist:linux
```

## Android

- **Package id:** `club.rc.app` · **min Android:** 7.0 (API 24) · **target:** API 36
- One **universal APK** contains every CPU ABI (`armeabi-v7a`, `arm64-v8a`,
  `x86`, `x86_64`), so a single file installs on essentially any device.
- Installing: transfer the `.apk` to the phone, tap it, and allow
  “Install unknown apps” for your browser/file manager (the APK is not from the
  Play Store). Or use `adb install RC-debug.apk`.
- Declared permissions (all actually used — see
  `android/app/src/main/AndroidManifest.xml`):
  `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` (QR + unit photos),
  `VIBRATE`, `POST_NOTIFICATIONS`.
  Camera features are marked `required="false"` so the app also installs on
  camera-less devices. **No storage permission is needed** — file picking uses
  the Android Photo Picker/SAF and offline data lives in the WebView's
  IndexedDB, which is why the old freewebtoapk “cannot find the storage /
  permission is not set” error disappears with Capacitor.
- Icons and splash use the project's own logo (`public/logo-*.png`).

### Release signing (optional but recommended)

Without a keystore the workflow still builds a **debug-signed release** APK,
which is fine for side-loading. For a proper release build add these repository
**secrets** (Settings → Secrets and variables → Actions):

| Secret | Meaning |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `ANDROID_STORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create a keystore once with:

```bash
keytool -genkey -v -keystore release.keystore -alias rc \
  -keyalg RSA -keysize 2048 -validity 10000
```

## Desktop (Windows / Linux)

- The Electron shell serves the built web app from an internal localhost server
  (so React Router, IndexedDB and the Convex websocket all work exactly like in
  a browser), opens external links in the real browser, and ships no source.
- **Windows:** run the `RC-Setup-*.exe`; it installs per-user (no admin
  needed) and can create Desktop/Start Menu shortcuts.
- **Linux:** `chmod +x RC-*.AppImage && ./RC-*.AppImage`, or
  `sudo dpkg -i RC-*.deb`.
- macOS (`dmg`) is configured but is **not** built by the default workflow —
  it requires a macOS runner (Apple's tooling cannot cross-compile from Linux).

## Build-time values CI needs

The web bundle inlines configuration at build time, so the workflow passes:

- `VITE_CONVEX_URL` — the public Convex deployment URL. Defaults to
  `https://agreeable-firefly-466.convex.cloud`; set a repository **variable**
  `VITE_CONVEX_URL` to override.
- `VLY_INTEGRATION_KEY` — **secret**. Add it under *Secrets* if your build needs
  it; the app otherwise still loads and talks to Convex.

## Known limitations (please read)

- **Web Push** (`public/sw.js`, `src/hooks/use-push.ts`) is **not** available in
  the Android WebView; the app already falls back to in-app banners there. Real
  background push on Android needs a native plugin (e.g.
  `@capacitor/push-notifications` + Firebase) — not configured here.
- **File downloads** (CSV/PDF/ZIP exports) work in Electron. In the Android
  WebView, `blob:` downloads are not handled by default; adding
  `@capacitor/filesystem` + `@capacitor/share` is the fix if you need
  on-device export.
- External links (Telegram/GitHub) open in the system browser on desktop; in the
  Android WebView they currently open in-app (add `@capacitor/browser` for the
  native behaviour).
- These builds are **not** store-ready (Play Console/App Store signing, privacy
  declarations and review are separate work).

## Files added

```
capacitor.config.json          Capacitor project config (webDir: dist)
android/                       Native Android project (manifest, icons, signing)
desktop/main.cjs               Electron main process (localhost static server)
desktop/preload.cjs            Minimal, sandboxed preload
desktop/electron-builder.yml   Windows NSIS + Linux AppImage/deb targets
desktop/package.json           Isolated Electron tooling (electron, electron-builder)
desktop/build/icon.png         App icon for installers
.github/workflows/build-apps.yml   CI that builds + publishes every installer
```
