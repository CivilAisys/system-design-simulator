## Git workflow

- `main` holds released versions only. It is protected: never push to it directly. A release is a PR from `develop` to `main`, followed by a SemVer tag on `main` (for example `v1.0.0`).
- `develop` is the default branch. All work branches start from an up-to-date `develop` and go back to it through a PR.
- Branch names: `feat/<issue-number>-<short-name>` for a ticket (for example `feat/1-backend-skeleton`), `fix/<issue-number>-<short-name>` for a bug, `chore/<short-name>` for work with no issue.
- A ticket's PR targets `develop` and its body contains `Closes #<issue-number>`, so merging closes the issue and unblocks the tickets it blocks.
- Hotfix for a release: branch `hotfix/<short-name>` from `main`, PR it to `main` and tag a patch version, then merge it back into `develop`.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
