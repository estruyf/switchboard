# Building, signing and notarisation

How to package Switchboard as a Mac app, and how to sign and notarise it with an Apple Developer ID so it opens on any Mac without warnings.

[← Back to the README](../README.md)

## Building the app

Needs macOS on Apple Silicon, Node 24+ and npm 11+.

```bash
npm install
npm run dist
```

This builds `apps/desktop/dist/mac-arm64/Switchboard.app` and `apps/desktop/dist/Switchboard-<version>-arm64.dmg`. Open the `.dmg` and drag Switchboard to Applications.

Switchboard uses your installed Claude Code (`claude` on your PATH) and its login; it doesn't ship its own copy.

### Opening an unsigned build

Without a Developer ID certificate, the build is unsigned. On the Mac that built it, it opens normally. If you copy it to another Mac, macOS blocks the first launch: right-click the app and choose **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Switchboard.app
```

## Signing and notarisation

With an Apple Developer ID, the app is signed with the hardened runtime and notarised by Apple.

1. **Signing identity.** `security find-identity -v -p codesigning` must list your `Developer ID Application` certificate. It needs its private key in the keychain (made from a certificate request on this Mac, or imported as a `.p12`) and Apple's [Developer ID G2 intermediate](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer). With that in place, `npm run dist` signs automatically.
2. **Notarisation credentials, once.** Create an app-specific password at [account.apple.com](https://account.apple.com) (Sign-In and Security → App-Specific Passwords), then store it in your keychain:

   ```bash
   xcrun notarytool store-credentials switchboard-notary --apple-id you@example.com --team-id YOURTEAMID
   ```

   It prompts for the password; nothing is written to the repository.
3. **Build:**

   ```bash
   npm run dist:notarized
   ```

   This signs the app, sends it to Apple's notary service (usually a few minutes), and staples the ticket to the app.

### Checking the result

```bash
spctl -a -vv apps/desktop/dist/mac-arm64/Switchboard.app
xcrun stapler validate apps/desktop/dist/mac-arm64/Switchboard.app
```

`spctl` should say `accepted` and `source=Notarized Developer ID`.

The `.dmg` itself isn't signed or notarised (electron-builder doesn't by default). That's fine for installing: the app inside carries its own stapled ticket.

### What's in the package

The configuration is in [`apps/desktop/electron-builder.yml`](../apps/desktop/electron-builder.yml), and the hardened-runtime entitlements in [`apps/desktop/build/entitlements.mac.plist`](../apps/desktop/build/entitlements.mac.plist). Electron's V8 needs JIT and unsigned executable memory; nothing else is opted out of.

- The Agent SDK's bundled `claude` binary is left out; the user's own `claude` is used.
- `node-pty` is unpacked from the asar archive, because its native helper must be executable.
- Electron is pinned to an exact version, which electron-builder needs.

## Releasing (automated in GitHub Actions)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when a release is published on GitHub. To release:

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to [`CHANGELOG.md`](../CHANGELOG.md), written for people using the app, and push it.
2. On GitHub, create a release with a new tag `vX.Y.Z` (Releases → Draft a new release) and publish it. You can leave the notes empty.

The workflow then:

1. runs the typecheck and unit tests;
2. builds the app on an Apple Silicon runner, with the version taken from the tag;
3. signs it with your Developer ID, and notarises and staples it;
4. checks the signature and that Gatekeeper accepts it as notarised;
5. attaches `Switchboard-X.Y.Z-arm64.dmg` to the release;
6. fills in the release notes from the CHANGELOG section, if you left them empty.

Nothing is attached unsigned: without the secrets below the run fails. To retry, re-run the failed workflow run from the Actions tab.

### Signing secrets

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `MAC_CERTIFICATE_P12_BASE64` | Your *Developer ID Application* certificate **with its private key**, exported from Keychain Access as a `.p12`, then base64-encoded: `base64 -i DeveloperID.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | The password you gave the `.p12` when exporting it. Leave it out if the `.p12` has no password |
| `APPLE_ID` | The Apple ID of your developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for it ([account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | Your team ID (the 10 characters in brackets after your name in the certificate) |

`MAC_CERTIFICATE_PASSWORD` may be left out only if the `.p12` was exported without a password.

### Testing the packaged app

```bash
npm run smoke:packaged
```

Runs the smoke test (see [Development](development.md)) against `dist/mac-arm64/Switchboard.app` instead of the development build.
