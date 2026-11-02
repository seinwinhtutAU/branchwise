# Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and published to the `seinwinhtutAU/branchwise-release` repo. The app's auto-updater reads from there.

## Steps

1. If the backend or a migration changed, deploy the backend first (and run `alembic upgrade head`), so the new app has an API to talk to.
2. From a clean `main`, bump the version, tag it and push:

```
npm version patch
git push --follow-tags
```

Use `minor` or `major` instead of `patch` when needed. `npm version` edits `package.json` and `package-lock.json`, commits, and creates the `vX.Y.Z` tag.

3. Watch the run on the source repo's Actions page. It builds Mac (arm64 + x64) and Windows (x64) and uploads the installers and the `latest*.yml` update files to the `vX.Y.Z` release.

## Releasing from your own computer (when GitHub Actions is slow or down)

Cancel the queued run on the Actions page first, so the same version isn't uploaded twice. Then, after the `npm version patch` and push above:

```
export GH_TOKEN=<token with write access to branchwise-release>
VITE_API_BASE_URL=https://<your-backend-domain>.up.railway.app npm run build
npx electron-builder --mac --arm64 --x64 --publish always
npx electron-builder --win --x64 --publish always
```

- `VITE_API_BASE_URL` is baked into the app at build time. Without it the build uses the repo's `.env` (`http://127.0.0.1:8000`), and installed copies can't log in ("No connection").
- The Windows build is made on a Mac here, so it isn't tested on a real Windows machine.
- `GH_TOKEN` only lasts for that terminal window. Run `unset GH_TOKEN` afterwards, because it stops `gh auth refresh` and `gh` commands from using your normal login.

### Clean up afterwards

```
unset GH_TOKEN
rm -rf dist out
git status
```

- `dist/` holds the installers just built (about 2.4 GB) and `out/` the compiled app. Both are git-ignored and already uploaded to the release, so they are safe to delete; the next build recreates them.
- `git status` should be clean. `npm version` refuses to run on a dirty working tree.
- Check the release page once: the installers and `latest.yml` / `latest-mac.yml` should be attached.
- If the token was only made for this release, revoke it on GitHub (Settings → Developer settings → Personal access tokens).

## One-time setup

The workflow needs these configured in **Settings → Secrets and variables → Actions**:
- **Secrets**: `RELEASE_TOKEN` (a GitHub token with **Contents: read and write** on `branchwise-release`).
- **Secrets** or **Variables**: `VITE_API_BASE_URL` (the backend URL, e.g. `http://127.0.0.1:8000`).

## Good to know

- The workflow stops if the tag doesn't match the `package.json` version.
- `branchwise-release` must be public, or nobody else can download or auto-update.
- The Mac and Windows builds are not code-signed, so Windows shows a SmartScreen warning and Mac auto-update may fail.
- On a Mac, a downloaded unsigned app is blocked as "damaged". Fix it once with `xattr -cr /Applications/BranchWise.app`.
- Mac auto-update does not work for an unsigned app: it downloads, says "Restart and Update", and the old version comes back. Mac users must install each new `.dmg` by hand (quit the app, drag the new one into Applications and replace, then run the `xattr` command again). Check which version is installed with `defaults read /Applications/BranchWise.app/Contents/Info CFBundleShortVersionString`.
- The download page for other people lives in `site/` and is hosted on Cloudflare. It reads the latest release by itself, so it only needs re-uploading when the page itself changes.
