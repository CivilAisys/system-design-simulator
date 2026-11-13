## Git workflow

- `main` holds released versions only. It is protected: never push to it directly. A release is a PR from `develop` to `main`, followed by a SemVer tag on `main` (for example `v0.2.0`). Version numbers stay 0.x for now; bump rules are in `docs/adr/0001-versioning.md`. Set the same version in `frontend/package.json` and `backend/build.gradle.kts` before releasing.
- `develop` is the default branch. All work branches start from an up-to-date `develop` and go back to it through a PR.
- Branch names: `feat/<issue-number>-<short-name>` for a ticket (for example `feat/1-backend-skeleton`), `fix/<issue-number>-<short-name>` for a bug, `chore/<short-name>` for work with no issue.
- A ticket's PR targets `develop` and its body contains `Closes #<issue-number>`, so merging closes the issue and unblocks the tickets it blocks.
- Hotfix for a release: branch `hotfix/<short-name>` from `main`, PR it to `main` and tag a patch version, then merge it back into `develop`.

## CI

`.github/workflows/ci.yml` runs on every PR to `develop` or `main`, and again on each new commit pushed to it. Two jobs:

- **Backend tests**: `./gradlew test` in `backend/`, which runs the engine and api tests, including the `openapi.json` sync check.
- **Frontend lint and build**: in `frontend/`, `npm ci` (its postinstall generates the API types from `openapi.json`), then `npm run lint` and `npm run build` (`tsc -b` type check, then `vite build`).

Run the same commands locally before opening a PR. If the sync check fails, run `./gradlew :api:generateOpenApi` and commit the updated `openapi.json`.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
