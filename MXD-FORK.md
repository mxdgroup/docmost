# MXD-FORK — how this fork of Docmost works

This repo is `mxdgroup/docmost`, a fork of [docmost/docmost](https://github.com/docmost/docmost)
serving `docs.mxd.digital`. The ops repo (`mxdgroup/mxdcompass_mostdocs`) deploys the image this
repo builds; the plan of record is that repo's
`docs/plans/2026-08-08-001-feat-docmost-fork-coda-roadmap-plan.md`.

## Branch & tag model

- **Base:** upstream tag `v0.95.0` (commit `4132dd5`). We base on stable tags, never upstream `main`.
- **`mxd-main`:** `v0.95.0` + our commits. Branch-protected: PR review + green checks required;
  no direct pushes.
- **Image tags:** `v0.95.0-mxd.N` (annotated git tags on `mxd-main`). Tagging is the promote step —
  production pins only `v*-mxd.*` tags by digest. `-mxd.0` is always patch-free (identical content
  to the upstream tag; base layers may drift — the recorded digest in the CI job summary is the
  provenance).
- **CI:** `.github/workflows/mxd-image.yml` — EE clean-room check → build → Trivy scan (fails on
  fixable HIGH/CRITICAL, gates the push) → push to `ghcr.io/mxdgroup/docmost` → SBOM → cosign
  keyless signature.

## Version-pin coupling (ops repo gotcha G6)

The ops repo's `docker-compose.yml` image tag and `migration/docmost_import.py`'s
`EXPECTED_VERSION` move together. `EXPECTED_VERSION` tracks the **upstream base** of the deployed
fork tag (`0.95.0` for any `v0.95.0-mxd.N`).

## Rebase loop (per upstream release)

1. Evaluate the upstream release notes (breaking env/config changes, migrations, collab-layer churn).
2. `git fetch upstream --tags`, then rebase `mxd-main`'s patch series onto the new tag
   (`git rebase --onto vX.Y.Z v<old-base> mxd-main`) via a PR.
3. **Prefer upstream:** if upstream shipped its own version of something we carry (editable shares,
   page-permission UI, list keymap fix), drop our patch and adopt theirs.
4. Rebuild; run the staging boot test (below); re-run the plan's source-verification checklist for
   any patched surface (collab extensions especially — they churn upstream).
5. Tag `vX.Y.Z-mxd.1`, deploy through the ops repo's `08-upgrade-rollback.md` runbook
   (maintenance window; forward-only migrations; DB backup + volume snapshot first).

**Expedited security path:** for an upstream security advisory, cherry-pick the fix onto `mxd-main`
out of cycle (tag `-mxd.N+1`), or rebase early — do not wait for the normal cadence.

## "Staging" definition

There is no standing staging environment. "Staging boot test" means: a throwaway compose stack
(Postgres 16 + Redis 7 + the candidate image) seeded from the **latest production dump**, booted
with production-like env, then the ops repo `08` runbook's five-check smoke gate:
page render + search, attachment upload **then `docker compose restart`**, two-browser collab edit,
test email send, share-link resolution.

## Fork migrations — the separate-migrator design

Upstream boots via `migrator.migrateToLatest()` (Kysely default `Migrator`, `process.exit(1)` on
error — `apps/server/src/database/services/migration.service.ts`). Kysely's default migrator fails
("corrupted migrations") if its ledger records an executed migration missing from the image's
migration folder, and rejects out-of-order pending migrations. Therefore:

- Fork migrations live in **`apps/server/src/database/migrations-mxd/`** — never in
  `migrations/` — and run through a **second Migrator with `migrationTableName: 'mxd_migration'`**,
  leaving upstream's `kysely_migration` ledger untouched.
- Schema changes are **additive only**: new tables, or nullable/defaulted columns on upstream
  tables. Never destructive alters.
- **Rollback eras:** before the first fork migration runs in an environment, any image flip is a
  complete rollback. After, fork↔fork image flips stay simple; rolling back to a *pure upstream*
  image is schema-safe (additive columns are ignored) and ledger-safe (upstream's ledger was never
  touched) — the `mxd_migration` table simply lies dormant. Fallback if the separate-table design
  ever regresses: delete the fork rows from the shared ledger before booting upstream
  (documented here so nobody re-derives it mid-incident).
- The falsification test (every fork migration re-earns it): after the migration runs, the
  **pure upstream image must still boot** against the database.

## EE clean-room rule

`apps/client/src/ee/**`, `apps/server/src/ee/**`, `packages/ee/**`, and `packages/base-formula/**`
are Docmost Enterprise-licensed. Fork commits never modify them and non-EE code never imports from
them — enforced by the `ee-clean-room` CI job. AGPL-core plumbing (e.g. `PagePermissionRepo`,
`page_access`/`page_permissions`) is fair game. Features re-implemented in core (page-permission
management UI/API) are built from documented behavior, not from EE source.

## Source-verification deltas at v0.95.0 (vs. main@89378ee, checked 2026-08-08)

- `persistence.extension.ts` uses `context.user.id` at the tag (main renamed it `lastContext`);
  the unguarded `lastUpdatedById: context.user.id` write at line 154 is the hazard the plan's
  Unit 6 must handle. The contributor path guards with `if (!userId) return;` (line 224).
- `authentication.extension.ts`, share module + `20250408T191830-shares.ts`,
  `20260224T233803-page-permissions.ts` + `page-permission.repo.ts`, audit-event constants
  (`PAGE_PERMISSION_ADDED`/`REMOVED`), and `integrations/throttle/` all match the plan's
  descriptions at the tag.
- Editor: no `bullet-list.css`; no app-level Tab keymap; `packages/editor-ext/src/lib/indent.ts`
  excludes `listItem`/`taskItem` from its global Tab handler; note
  `packages/editor-ext/src/lib/table/table.ts:24` binds Tab→`sinkListItem` inside tables — a
  candidate interference source for the list-indent diagnosis (plan Unit 4).
