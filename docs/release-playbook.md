# Release Playbook

This repository publishes Windows installer releases from GitHub tags in `vX.Y.Z` format.

## Release Flow

1. Update the app version to the same value in:
   - `package.json`
   - `package-lock.json` (root package version)
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Commit the version bump.
3. Create an annotated SemVer tag.
4. Push the branch and the tag to GitHub.
5. Wait for `.github/workflows/release.yml` to complete and verify the release asset.

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
- Release assets include the NSIS installer `.exe` only.
- Branch pushes and `workflow_dispatch` runs build for validation but do not publish a release.

## Windows Trust Warning

Installer binaries are currently unsigned, so Windows SmartScreen can display a warning to users.
