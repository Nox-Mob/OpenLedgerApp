# Release checklist

Releases are a two-step process. `src/lib/release.test.ts` enforces the items a machine can check.

## Step 1: prepare (no version bump yet)

1. **Changelog notes ready.** Everything for the release is listed under `[Unreleased]`.
2. **Readme updated.** Installation steps are still accurate.
3. **Architecture status table** in `docs/architecture.md` matches what is shipping.
4. **Roadmap updated.** Anything not done moves to the next version.
5. **Database changes are applied first.** New files in `db/migrations` were applied with Actions → Migrate (staging, then production) before the release.
6. **All checks green locally:** `npm run test`, type check, lint, `npx prettier --check .`, `node scripts/ci/check-migrations.mjs`, `npm audit --omit=dev`, build.
7. **No Bun lock file** (`bun.lock`, `bun.lockb`) in the commit.
8. **Push and wait.** Stop here until the maintainer confirms every GitHub check is green, including the database safety checks.

## Step 2: bump (only after the maintainer confirms GitHub is green)

1. **Version bumped** in `package.json`, `package-lock.json` and `src/lib/version.ts` (the desktop app reads its version from `package.json`).
2. **Changelog dated.** Move `[Unreleased]` into `## [x.y.z] - YYYY-MM-DD`, leave an empty `[Unreleased]` above it.
3. **Architecture document** says `Current as of vx.y.z`.
4. **Roadmap** marks the release as released with its date.
5. **Merge to main.** The `Desktop release` workflow reruns every CI check, then builds Linux, Windows and macOS installers into a draft GitHub release `vx.y.z`. Test them, add release notes, then publish.
