## Git workflow

- `main` holds released versions only. It is protected: never push to it directly. A release is a PR from `develop` to `main`, followed by a SemVer tag on `main` (for example `v0.2.0`). Version numbers stay 0.x for now; bump rules are in `docs/adr/0001-versioning.md`. Set the same version in `frontend/package.json` and `backend/build.gradle.kts` before releasing.
- `develop` is the default branch. All work branches start from an up-to-date `develop` and go back to it through a PR.
- Branch names: `feat/<issue-number>-<short-name>` for a ticket (for example `feat/1-backend-skeleton`), `fix/<issue-number>-<short-name>` for a bug, `chore/<short-name>` for work with no issue.
- A ticket's PR targets `develop` and its body contains `Closes #<issue-number>`, so merging closes the issue and unblocks the tickets it blocks.
- Hotfix for a release: branch `hotfix/<short-name>` from `main`, PR it to `main` and tag a patch version, then merge `main` back into `develop` through a PR (`develop` is protected too).

## CI

`.github/workflows/ci.yml` runs on every PR to `develop` or `main`, and again on each new commit pushed to it. Two jobs:

- **Backend tests**: `./gradlew test` in `backend/`, which runs the engine and api tests, including the `openapi.json` sync check.
- **Frontend lint and build**: in `frontend/`, `npm ci` (its postinstall generates the API types from `openapi.json`), then `npm run lint`, `npm test` (Vitest unit tests) and `npm run build` (`tsc -b` type check, then `vite build`). The job name stays "Frontend lint and build" because branch protection requires that check by name.

Run the same commands locally before opening a PR. If the sync check fails, run `./gradlew :api:generateOpenApi` and commit the updated `openapi.json`.

## Working conventions

These rules used to live only in one machine's agent memory; keep them here so every device and session follows them.

- **Language**: reply to the user in Traditional Chinese (繁體中文). Issues, PR titles and bodies, and the docs (`docs/v1-spec.md`, `ROADMAP.md`, `GLOSSARY.md`) are Traditional Chinese too; commit messages are English. Identifiers, paths and commands stay as written.
- **Planning**: each version starts with a grilling session with the user. Its decisions go into the version's milestone issues, each with acceptance criteria that list the browser-test items. A UI question gets a throwaway prototype on a `prototype/<name>` branch, left unmerged and linked from the issue.
- **Ticket loop**, in the agreed order: implement → run the CI commands above → review your own diff against the issue → fix → open the PR, saying what was not browser-tested → once CI is green, merge and start the next ticket. Merging needs the user's go-ahead for that milestone in the current conversation; without it, stop at a green PR and ask.
- **Ask the user first** before a release PR, before starting the next milestone, on a product decision and on a merge conflict. Release testing follows the 瀏覽器測試 section of `ROADMAP.md`.
- **Browser testing**: open the app at `http://[::1]:5173`, not `localhost:5173`. The two origins keep separate `localStorage`, so test topologies never overwrite the canvas the user autosaved on `localhost`. Findings that need a fix become `bug` issues in the release's milestone.
- **Package names**: Java packages and the Gradle `group` live under `simulator.*` (`simulator.engine`, `simulator.api`); name new packages after the domain, never after the repo host, the GitHub org or a person.
- **Formatting**: `frontend/.prettierrc` records the frontend style (no semicolons, single quotes, print width 120). Prettier is not a dependency or a CI check: format new files with `npx prettier@3 --write <file>` in `frontend/`, and edit existing files in their current layout, because about two dozen predate the config and a full reformat would bury the real change in the diff.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
