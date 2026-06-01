# macOS code signing + notarization (the real DMG fix)

Right now the DMG is **unsigned / un-notarized**, so macOS Gatekeeper blocks it
("can't be opened… Apple cannot check it for malicious software"). The in-app
Downloads page tells users the one-time workaround (right-click → Open, or
`xattr -dr com.apple.quarantine "/Applications/NebulaX AI.app"`).

To make it install cleanly with **no warning**, the app must be signed with a
**Developer ID** certificate and notarized by Apple. That requires an Apple
Developer account ($99/yr) — it can't be done from this Linux box and needs your
credentials. Tauri does it automatically during `tauri build` when these env
vars are set (no `tauri.conf.json` change needed):

```bash
# Developer ID Application cert exported as base64 .p12 + its password
export APPLE_CERTIFICATE="$(base64 -w0 DeveloperID.p12)"
export APPLE_CERTIFICATE_PASSWORD="••••"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarization credentials (app-specific password from appleid.apple.com)
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # app-specific password
export APPLE_TEAM_ID="TEAMID"

# Build + sign + notarize + staple, all in one:
npm run tauri build        # (must run on a Mac or macOS CI runner)
```

Notes:
- **Must build on macOS** (GitHub Actions `macos-latest` is the easy path — add a
  release workflow that injects the secrets above and uploads the stapled .dmg).
- Notarization staples a ticket into the .dmg so it opens offline with no prompt.
- Windows has the same class of issue (SmartScreen) — an EV/OV code-signing cert
  + `WINDOWS_CERTIFICATE` env solves that; same pattern.
- Until then, the Downloads-page workaround is the stopgap and is perfectly safe.
