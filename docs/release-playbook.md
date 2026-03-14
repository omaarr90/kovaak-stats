# Release Playbook

This repository publishes Windows installer releases from GitHub tags in `vX.Y.Z` format.

## One-Time Updater Setup

Generate a single long-lived updater keypair before your first updater-enabled release:

```powershell
npm install
npm run tauri signer generate -- -w ~/.tauri/kovaak-stats.key -p "<strong-password>"
```

- Commit the generated public key into `src-tauri/tauri.conf.json`.
- Store the private key contents in the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
- Store the key password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Do not rotate this key for routine releases. Installed builds trust the committed public key, so losing or replacing the private key breaks future in-app updates for existing users.

## Release Flow

1. Update the app version to the same value in:
   - `package.json`
   - `package-lock.json` (root package version)
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Commit the version bump.
3. Create an annotated SemVer tag.
4. Push the branch and the tag to GitHub.
5. Wait for `.github/workflows/release.yml` to complete and verify the release assets.

## Exact Commands

Use `X.Y.Z` as your next version:

```powershell
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## CI Contracts

- Only tag pushes matching `v*.*.*` create a GitHub Release.
- The workflow fails if tag version does not match app version metadata.
- Release assets include the NSIS installer, updater signature files, and `latest.json`.
- `workflow_dispatch` runs a signed validation build and verifies the installer plus `.sig`, but does not publish a release.
- GitHub Actions requires both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Updater Notes

- The updater manifest is published at `https://github.com/omaarr90/kovaak-stats/releases/latest/download/latest.json`.
- `latest.json` is uploaded by `tauri-apps/tauri-action` during tag releases. A local `npm run tauri build` produces the installer and `.sig`, but not the release manifest.
- Existing users must manually install the first updater-enabled release. In-app updates only work after that version is installed once.
- If you intentionally rotate the updater key, old installs will no longer trust new updates until users manually reinstall.

## Windows Trust Warning

Installer binaries are currently unsigned, so Windows SmartScreen can display a warning to users.
