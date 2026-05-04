# ClassNoteAI · Code Signing

> Status (2026-04-28): No production cert obtained yet. This doc captures the
> intended flow so that the moment we have a cert (or SignPath account) we can
> drop in `thumbprint` / env vars and ship signed builds. CI is currently
> producing **unsigned** artifacts.

## 1. Why sign

| Platform | If unsigned | If signed |
|----------|-------------|-----------|
| Windows  | SmartScreen "unrecognized publisher" warning; auto-updater (Tauri) refuses installer signature mismatch on update. | Trusted publisher, silent SmartScreen, updater verifies cert chain. |
| macOS    | Gatekeeper blocks (`damaged / unidentified developer`); user must `xattr -d com.apple.quarantine` manually. | Notarized DMG opens cleanly; required for distribution outside App Store. |
| Updater  | `Tauri Updater` ed25519 signature still required regardless — that is *separate* from OS code signing. | Both signatures pass. |

Tauri's **updater signature** (ed25519, see `plugins.updater.pubkey` in
`tauri.conf.json`) and the **OS code signature** are independent — both are
needed for a clean release.

## 2. Windows signing

### 2.1 Certificate sources

Pick one (rough cost / hassle ladder):

1. **Self-signed** — only useful for internal testing. Users still get
   SmartScreen. Do not ship to public.
2. **DigiCert / Sectigo OV cert** — ~USD 250-500/yr, requires identity
   verification, ships as `.pfx` or HSM token.
3. **DigiCert / Sectigo EV cert** — ~USD 500-700/yr, instant SmartScreen
   reputation, **must** live on a hardware token (HSM / YubiKey FIPS).
4. **SignPath.io / Azure Trusted Signing** — managed signing service; cert
   never leaves their HSM, you submit unsigned binaries via API. Easiest for
   CI; recommended.

### 2.2 How Tauri picks the cert up

`tauri.conf.json → bundle.windows`:

```jsonc
{
  "windows": {
    "certificateThumbprint": null,        // SHA-1 thumbprint of cert in Windows cert store
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

- `certificateThumbprint`: SHA-1 of the cert installed in the local user's
  cert store (`Cert:\CurrentUser\My` on PowerShell). Tauri shells out to
  `signtool.exe sign /sha1 <thumbprint> ...`.
- For HSM / token cert, the thumbprint is enough — `signtool` finds the cert
  and prompts the token (cannot be done in headless CI without dongle pass-
  through; that's why SignPath/Trusted Signing is preferred for CI).
- For SignPath: skip `certificateThumbprint`, use `bundle.windows.signCommand`
  (Tauri ≥ 2.0.0-beta.21) to invoke their CLI instead.

### 2.3 Why timestampUrl matters

When the signing cert expires (typically 1-3 yrs), **without a timestamp** the
signature becomes invalid the moment the cert expires — every shipped build
breaks. With a timestamp, the OS validates: "this binary was signed *while
the cert was valid*", and the signature stays trusted forever.

**Always set `timestampUrl`.** Recommended servers (RFC 3161, sha256):

| Provider  | URL                                  | Notes |
|-----------|--------------------------------------|-------|
| DigiCert  | `http://timestamp.digicert.com`      | Default in this repo. Free, reliable. |
| Sectigo   | `http://timestamp.sectigo.com`       | Backup. |
| GlobalSign| `http://timestamp.globalsign.com/tsa/r6advanced1` | Backup. |

If timestamp server is down at sign time, build fails — keep a fallback in
mind (manually re-run, or switch in conf and re-build).

## 3. macOS signing

### 3.1 Prereqs

- Apple Developer Program membership (USD 99/yr).
- "Developer ID Application" cert installed in Keychain.
- App-specific password for `notarytool` (created at appleid.apple.com).

### 3.2 Tauri config

`tauri.conf.json → bundle.macOS`:

```jsonc
{
  "macOS": {
    "signingIdentity": "Developer ID Application: Your Company (TEAMID)",
    "providerShortName": "TEAMID",
    "entitlements": "entitlements.plist",
    "exceptionDomain": "",
    "minimumSystemVersion": "11.0"
  }
}
```

`entitlements.plist` minimum: `com.apple.security.cs.allow-jit` (Tauri
webview), `com.apple.security.device.audio-input` (recording),
`com.apple.security.network.client` (LLM provider calls).

### 3.3 Notarization

After Tauri builds the `.dmg`:

```sh
xcrun notarytool submit ClassNoteAI.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

xcrun stapler staple ClassNoteAI.dmg
```

Tauri ≥ 2.0.0 can run this automatically when env vars `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID` are set during `tauri build`.

## 4. Environment variables

Set these in CI (GitHub Actions secrets, never check in):

| Var                          | Purpose | Used by |
|------------------------------|---------|---------|
| `TAURI_SIGNING_PRIVATE_KEY`  | ed25519 priv key for **updater** signature | tauri build |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | passphrase for updater key | tauri build |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | SHA-1 of Windows cert (override conf at build time) | tauri build (Windows) |
| `APPLE_ID`                   | Apple ID for notarization | tauri build (macOS) |
| `APPLE_PASSWORD`             | app-specific password | tauri build (macOS) |
| `APPLE_TEAM_ID`              | 10-char team id | tauri build (macOS) |
| `APPLE_SIGNING_IDENTITY`     | Full identity string (overrides conf) | tauri build (macOS) |
| `SIGNPATH_API_TOKEN`         | (if using SignPath) | signCommand |

## 5. CI integration (GitHub Actions sketch)

```yaml
- name: Build & sign Tauri app
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_KEY_PW }}
    # Windows-only
    WINDOWS_CERTIFICATE_THUMBPRINT: ${{ secrets.WIN_CERT_THUMBPRINT }}
    # macOS-only
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_APP_PW }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGN_ID }}
  run: npm run tauri build
```

For Windows, the cert must already be in the runner's cert store — either:
- Self-hosted runner with the HSM dongle plugged in, **or**
- Hosted runner + import a `.pfx` via PowerShell `Import-PfxCertificate` at
  job start (cert content stored as base64 secret), **or**
- SignPath/Trusted Signing — runner just calls their CLI.

## 6. Current status (2026-04-28)

- [x] `timestampUrl` set to DigiCert (this PR).
- [x] CSP draft (Sprint 1 W4 will tighten).
- [ ] Production Windows cert — **not acquired**. Decision pending: SignPath
      vs DigiCert EV. Tracked in PHASE-7-PLAN §9.8 N3.
- [ ] Apple Developer enrollment — **not done**. Blocker for macOS release.
- [x] Updater ed25519 keypair — exists (`plugins.updater.pubkey` in conf,
      private key in repo owner's local password manager).

When cert arrives:

1. Install cert (or upload to SignPath).
2. Drop thumbprint into `WINDOWS_CERTIFICATE_THUMBPRINT` GH secret.
3. Bump version, tag, push — CI signs + uploads to GitHub Releases.
4. Verify: download artifact, `signtool verify /pa /v ClassNoteAI.exe`
   should print `Successfully verified` and a future-dated countersignature
   (the timestamp).

## 7. Verifying a signed build

```powershell
# Windows: expect "Successfully verified" + "The signature is timestamped"
signtool verify /pa /v ClassNoteAI_*.exe
```
```sh
# macOS: spctl must say "accepted source=Notarized"
codesign -dv --verbose=4 ClassNoteAI.app
spctl -a -t exec -vv ClassNoteAI.app
```

## 8. References

- Tauri Distribution docs: https://v2.tauri.app/distribute/
- Microsoft signtool: https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe
- Apple notarytool: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
- SignPath OSS: https://signpath.org/foundation
- Azure Trusted Signing: https://learn.microsoft.com/en-us/azure/trusted-signing/
