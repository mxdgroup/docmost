---
title: "feat: Cut docs.mxd.digital over to the MXD fork and ship the data platform (two-phase)"
type: feat
status: superseded
date: 2026-08-12
origin: docs/plans/2026-08-09-001-feat-mxd-data-platform-plan.md
---

# feat: Cut docs.mxd.digital over to the MXD fork and ship the data platform (two-phase)

> **SUPERSEDED — do not follow this runbook as written.** It was drafted on the belief that
> production still ran upstream `0.90.1`, so it planned a two-window cutover (Window 1: upstream
> 0.90→0.95 jump + sharing release; Window 2: the data platform).
>
> **That premise was wrong.** The ops repo showed production was already on the fork image
> `v0.95.0-mxd.3` — the upstream jump and sharing cutover had happened on 2026-08-09. So only the
> fork-only bump remained, and it shipped on 2026-08-14 as `v0.95.0-mxd.4` (data platform), then
> `v0.95.0-mxd.5` (public-link access control), each a single short window rather than the
> two-phase plan below.
>
> What actually happened, with evidence, is recorded in the ops repo
> (`mxdgroup/mxdcompass_mostdocs`): `docs/deploy/DEPLOY-RECORD-2026-08-14-mxd.4.md`,
> `DEPLOY-RECORD-2026-08-14-mxd.5.md`, and `docs/deploy/ACCESS.md`. Use those. This document is
> kept only for the reasoning it captures (rollback eras, dark-launch rationale, migration safety).

**Target repos:** `mxdgroup/docmost` (this repo — code, tags, image) and `mxdgroup/mxdcompass_mostdocs` (the ops repo — `docker-compose.yml`, `migration/docmost_import.py`, the `08-upgrade-rollback.md` runbook). Paths below are repo-relative to `mxdgroup/docmost` unless prefixed `ops:`.

## Overview

`docs.mxd.digital` currently runs **stock upstream `docmost/docmost:0.90.1`**. None of the fork is live. This plan takes the fork to production in **two maintenance windows**, dark-launched:

- **Window 1 — the fork cutover.** Deploy the already-tagged, already-CI-built `v0.95.0-mxd.3` (editor fix, editable shares, guest comments, page-permission management). This window absorbs the **upstream `0.90.1 → 0.95.0` migration jump** plus the 2 fork migrations — the highest-risk step, carried with the *smallest already-reviewed* feature set. All fork flags OFF.
- **Window 2 — the data platform.** Merge `mxd/data-platform-e1 → mxd-main`, tag `v0.95.0-mxd.4`, deploy. Runs the 4 data-platform fork migrations. `MXD_DATA_PLATFORM_ENABLED` stays OFF until soaked.

Feature exposure is decoupled from deployment throughout: images ship with flags OFF, then flags flip on after each base upgrade is proven stable.

## Problem Frame

The fork's whole value (Coda-style data platform, editable shares, guest comments, per-page permissions) is committed and verified but **stranded on branches** — production has never run a fork image. Going live means crossing three risk surfaces at once if done naively: (a) an upstream **version jump** whose migrations rewrite the real schema, (b) a **large new feature surface**, and (c) a **cross-repo promote** (code tag in the fork repo, image pin + `EXPECTED_VERSION` in the ops repo). The user has chosen to **separate these**: two-phase sequencing so the scary upstream jump ships with the small feature set, and dark-launch so upgrade risk is verified before feature risk. This plan is the runbook for that.

Data-safety headline (the user's first question): **existing articles/pages are not replaced or deleted.** Content lives in Postgres; deploying swaps a stateless container. Fork migrations are additive-only and run in a separate `mxd_migration` ledger (upstream's `kysely_migration` untouched), with a per-migration falsification test that a pure upstream image still boots afterward. The only step that rewrites existing schema is upstream's own `0.90.1→0.95.0` migrations in Window 1 — designed to be non-destructive, but the reason the backup + snapshot gate is non-negotiable.

## Requirements Trace

- **R1.** Get the data-platform code into a deployable position: independently reviewed, merged to `mxd-main` (clean fast-forward), tagged, and built into a signed image by CI.
- **R2.** Cut production from upstream `0.90.1` to the fork **without data loss** — existing pages, attachments, shares, comments, users, and permissions all intact and verified.
- **R3.** Survive the upstream `0.90.1 → 0.95.0` migration jump; prove it against a **production dump on staging** before touching prod.
- **R4.** Ship dark: images deploy with `SHARE_EDIT_ENABLED`, `SHARE_GUEST_COMMENTS_ENABLED`, `MXD_DATA_PLATFORM_ENABLED` all OFF; enable each only after its base upgrade has soaked.
- **R5.** Keep the ops-repo coupling correct: `ops:docker-compose.yml` image tag and `ops:migration/docmost_import.py` `EXPECTED_VERSION` move together (`EXPECTED_VERSION = 0.95.0` for any `v0.95.0-mxd.N`).
- **R6.** Have a rehearsed rollback for every window, honoring the fork's rollback-era rules.
- **R7.** Verify the `mxd_migration` separate-ledger invariant holds in prod: after fork migrations run, a pure upstream image still boots.

## Scope Boundaries

- **Not** re-reviewing or changing data-platform *feature* behavior — that shipped and was verified in the origin plan. This plan only moves it to prod.
- **Not** building anything new in either repo, except the ops-repo change sets (image tag / `EXPECTED_VERSION` / env) required to deploy.
- **Not** enabling anonymous row-writes or anonymous image upload on shares (deferred by prior decision) — deploy does not change that posture.
- **Not** authoring the ops-repo `08-upgrade-rollback.md` runbook from scratch — it exists; this plan drives it and records the fork-specific deltas. If the ops repo is unavailable at execution time, that becomes a hard prerequisite (Unit 3), not an in-scope authoring task.
- Cross-doc sync is descoped entirely (not in the branch).

## Context & Research

### Relevant Code and Patterns

- **Deploy model / rollback eras / staging definition:** `MXD-FORK.md` — the authoritative source. Image tags `v0.95.0-mxd.N`; tagging is the promote step; prod pins `v*-mxd.*` by digest.
- **CI promote pipeline:** `.github/workflows/mxd-image.yml` — EE clean-room check → build → Trivy scan (gates push on fixable HIGH/CRITICAL) → push to `ghcr.io/mxdgroup/docmost` → SBOM → cosign signature. Triggered by the tag.
- **Separate fork migrator (the load-bearing safety design):** `apps/server/src/database/migrate-mxd.ts`, wired in `apps/server/src/database/database.module.ts`; upstream migrator is `apps/server/src/database/services/migration.service.ts` (Kysely default, `process.exit(1)` on error). Fork migrations live only in `apps/server/src/database/migrations-mxd/` under ledger `mxd_migration`.
- **Fork migrations that run, in order:**
  - Window 1 (already on `mxd-main`): `20260808T170000-mxd-share-mode.ts`, `20260808T190000-mxd-comment-guest-name.ts`.
  - Window 2 (new on `mxd/data-platform-e1`): `20260809T120000-mxd-data-platform-core.ts`, `20260811T120000-mxd-automations.ts`, `20260811T130000-mxd-record-history.ts`, `20260812T120000-mxd-forms.ts`.
- **Feature flags (all default `'false'`):** `apps/server/src/integrations/environment/environment.service.ts:220` (`SHARE_EDIT_ENABLED`), `:227` (`SHARE_GUEST_COMMENTS_ENABLED`), `:234` (`MXD_DATA_PLATFORM_ENABLED`). Injected into the client as `window.CONFIG` at boot by `apps/server/src/integrations/static/static.module.ts:31-57` (replaces `<!--window-config-->` in `index-template.html` **once** at `onModuleInit`) — so a flag change requires a **container restart**, not just an env edit at runtime.
- **Version-pin coupling (ops gotcha G6):** `MXD-FORK.md` §"Version-pin coupling" — `ops:docker-compose.yml` image tag and `ops:migration/docmost_import.py` `EXPECTED_VERSION` move together.
- **Persistence hazard carried since v0.95.0 base:** `apps/server/src/collaboration/extensions/persistence.extension.ts` — the fork's anonymous-share handling around `lastUpdatedById`/contributor writes. Relevant to Window-1 verification of editable shares once the flag is on.

### Institutional Learnings

- **Rollback eras (`MXD-FORK.md`):** *before* the first fork migration runs in an environment, any image flip is a complete rollback. *After* the first fork migration, fork↔fork flips are simple; rolling back to a *pure upstream* image is schema-safe (additive columns ignored) and ledger-safe (`mxd_migration` lies dormant). Emergency fallback if the separate-table design ever regressed: delete fork rows from the shared ledger before booting upstream.
- **Staging = throwaway compose stack** (Postgres 16 + Redis 7 + candidate image) seeded from the **latest production dump**, booted with production-like env, then the `08` runbook's 5-check smoke gate: page render + search; attachment upload **then `docker compose restart`**; two-browser collab edit; test email send; share-link resolution.
- **Local prod-build gotcha (relevant to any staging build):** a client rebuild wipes `apps/client/dist` incl. `index-template.html`; the server re-injects `window.CONFIG` only at boot. The prod **image** bakes this correctly, but any hand-built staging client must `rm index-template.html` + restart or flags never reach the browser.
- **Git state verified 2026-08-12:** `mxd/data-platform-e1` merge-base == `mxd-main` tip (`fe6aa32a`) → clean fast-forward, `git merge-tree` shows **no conflicts**. `mxd-main` == tag `v0.95.0-mxd.3`.

### External References

- **Upstream `0.90.1 → 0.95.0` release notes** — must be read at execution time (Window 1 prerequisite) for breaking env/config changes, migration notes, and collab-layer churn, per the `MXD-FORK.md` rebase-loop step 1. Not pre-fetched here; treated as a gating research task in Unit 4.

## Key Technical Decisions

- **Two-phase, not one window** (user decision): Window 1 carries the upstream jump + the already-reviewed sharing release; Window 2 carries the data platform. Rationale: decouple *upgrade* risk from *new-feature* risk; a failure in Window 1 rolls back to upstream cleanly (pre-fork-migration era ends the moment Window 1's migrations run, so this reasoning applies only up to the backup point — see Rollback).
- **Dark launch** (user decision): deploy images with all fork flags OFF; enable per-feature after soak. Rationale: a bad *upgrade* and a bad *feature* fail differently and should be diagnosed separately; flags are boot-time, so enabling = a controlled restart, itself a mini-verification.
- **`EXPECTED_VERSION = 0.95.0` for both windows.** It tracks the **upstream base**, which is `0.95.0` for every `v0.95.0-mxd.N`. It changes in Window 1 (0.90.1→0.95.0) and stays put in Window 2 (mxd.3→mxd.4 is a fork-only bump).
- **Merge by fast-forward, not squash.** `mxd/data-platform-e1` is a clean descendant of `mxd-main`; preserve the 39-commit history (each commit was individually reviewed/verified) rather than collapsing provenance. Confirm via PR with green CI regardless.
- **Prod-version verification is step 0, not an assumption.** The plan is written for a `0.90.1` baseline (user-confirmed), but Unit 3 still SSHes in and captures the real running digest, DB state, and backup freshness before any change — the runbook branches on what's found.

## Open Questions

### Resolved During Planning

- *Will deploying replace existing articles?* No — stateless container swap; content is in Postgres; fork migrations additive in a separate ledger. Only the upstream `0.90→0.95` migrations touch existing schema, non-destructively, gated by backup+snapshot. (R2)
- *One window or two?* Two (user). *Flags on deploy?* Dark, flip after soak (user). *Prod baseline?* Upstream `0.90.1`, first fork cutover (user).
- *Is the branch mergeable?* Yes — clean fast-forward from `mxd-main` tip, no conflicts (verified).
- *Does Window 2 change `EXPECTED_VERSION`?* No — same `0.95.0` upstream base.

### Deferred to Implementation

- **Exact upstream `0.90.1→0.95.0` migration list and any breaking env/config changes** — read from upstream release notes during Unit 4 staging (may add env or config steps to Window 1).
- **Actual prod running digest, DB size, disk headroom, latest backup age** — captured in Unit 3 via SSH; determines window duration and snapshot mechanics.
- **Maintenance-window scheduling** (date/time, comms, who holds the rollback trigger) — operational, set with the ops owner.
- **Whether attachments live on disk/volume vs S3-compatible store on this box** — affects snapshot scope; confirm in Unit 3.
- **Redis flush/compat across the upstream jump** — check upstream notes; Redis is a cache/queue, not source of truth, but confirm no breaking BullMQ schema change.

## High-Level Technical Design

> *This illustrates the intended sequence and rollback structure and is directional guidance for review, not implementation specification. The implementing agent should treat it as context.*

```mermaid
flowchart TD
    subgraph P0["Phase 0 — Deployable position (no prod change)"]
        U1[Unit 1: independent review of 39-commit delta]
        U2[Unit 2: merge e1→mxd-main, tag mxd.4, CI image]
        U3[Unit 3: SSH baseline + ops-repo access + backup check]
        U1 --> U2
    end

    subgraph W1["Window 1 — fork cutover (deploy mxd.3, dark)"]
        U4[Unit 4: staging boot from prod dump + upstream notes]
        U5[Unit 5: ops change set — image=mxd.3, EXPECTED_VERSION=0.95.0, flags OFF]
        U6[Unit 6: window — backup+snapshot → deploy → 0.90→0.95 + 2 fork migs → verify]
        U7[Unit 7: post-soak flip SHARE_EDIT + GUEST_COMMENTS on]
        U4 --> U5 --> U6 --> U7
    end

    subgraph W2["Window 2 — data platform (deploy mxd.4, dark)"]
        U8[Unit 8: staging boot from post-W1 prod dump]
        U9[Unit 9: ops change set — image=mxd.4, EXPECTED_VERSION unchanged, DP flag OFF]
        U10[Unit 10: window — backup+snapshot → deploy → 4 fork migs → verify]
        U11[Unit 11: post-soak flip MXD_DATA_PLATFORM_ENABLED on]
        U8 --> U9 --> U10 --> U11
    end

    U2 -.mxd.3 already tagged; W1 needs no code.-> U4
    U3 --> U4
    U7 -->|soaked stable| U8
    U2 --> U8

    U6 -. rollback: restore snapshot + repin upstream 0.90.1 .-> RB1[(upstream 0.90.1)]
    U10 -. rollback: fork↔fork repin to mxd.3 additive migs dormant .-> RB2[(fork mxd.3)]
```

## Implementation Units

### Phase 0 — Get the code into a deployable position

- [ ] **Unit 1: Independent review of the data-platform delta**

**Goal:** A fresh adversarial review of the 39 commits on `mxd/data-platform-e1` beyond `mxd-main`, so the merge lands with confidence and any prod-risky defect is caught before it's tagged.

**Requirements:** R1

**Dependencies:** None.

**Files:** (review-only; no changes) — scope is `git log mxd-main..mxd/data-platform-e1` and its diff, concentrated on the public/anonymous surfaces: `apps/server/src/core/mxd-data/mxd-public-data.*`, `mxd-form.controller.ts` public routes, `mxd-data-platform.guard.ts`, and the 4 Window-2 migrations under `apps/server/src/database/migrations-mxd/`.

**Approach:**
- Run the branch review through `/code-review ultra` (cloud multi-agent) on `mxd/data-platform-e1`, or the local `ce:review` with `base:mxd-main`. Prioritize: authz/IDOR on the anon read path, migration additivity, throttle coverage on public endpoints, and the `mxd_migration` ledger invariant.
- Triage findings: P0/P1 block the merge; P2/P3 recorded as follow-ups (do not gate the cutover unless prod-risky).

**Patterns to follow:** The fork's own review posture in `MXD-FORK.md` §"Source-verification deltas" and the security notes commit `fe6aa32a`.

**Test scenarios (verification checks):**
- Happy path: review completes with an explicit, triaged findings list; zero unresolved P0/P1 before Unit 2.
- Edge case: any finding on `mxd-public-data.service.ts` scope enforcement is re-checked against the 7 existing E2E scope tests (out-of-scope table → 404).
- Error path: if a P0 is found, Unit 2 is blocked and the fix loops through `ce:work` before re-review.

**Verification:** Review report attached to the PR; no open P0/P1; the EE clean-room check passes on the branch head.

---

- [ ] **Unit 2: Merge to `mxd-main`, tag `v0.95.0-mxd.4`, build the image**

**Goal:** Turn the reviewed branch into a signed, scanned production image via the fork's promote pipeline.

**Requirements:** R1, R5

**Dependencies:** Unit 1 (clean review).

**Files:**
- Modify (via PR merge): `mxd-main` ref → fast-forward to `mxd/data-platform-e1` head.
- CI: `.github/workflows/mxd-image.yml` (unchanged; triggered by the tag).

**Approach:**
- Open PR `mxd/data-platform-e1 → mxd-main`; require review + green checks (branch is protected). Because merge-base == `mxd-main` tip, this is a clean fast-forward — no conflict resolution.
- After merge, cut annotated tag `v0.95.0-mxd.4` on `mxd-main`. CI runs clean-room → build → Trivy (fixable HIGH/CRITICAL gate) → push `ghcr.io/mxdgroup/docmost:v0.95.0-mxd.4` → SBOM → cosign.
- Record the pushed **image digest** from the CI job summary (prod pins by digest, per `MXD-FORK.md`).

**Execution note:** This unit only *produces the artifact*; it does not touch prod. Window 1 deploys the **pre-existing** `mxd.3` image and needs no code work — Unit 2 exists so Window 2's artifact is ready in parallel.

**Test scenarios (verification checks):**
- Happy path: CI green end-to-end; `mxd.4` image + digest + cosign signature present in the registry.
- Edge case: Trivy surfaces a new fixable HIGH/CRITICAL → push is gated; fix CVEs (pattern: commits `2517cd86`/`0ce7be11`) and re-tag `mxd.5`.
- Integration: `mxd-main` HEAD after merge equals the reviewed `e1` head (fast-forward, not squash) — provenance preserved.

**Verification:** `ghcr.io/mxdgroup/docmost:v0.95.0-mxd.4` exists, signed, with a recorded digest; `mxd-main` fast-forwarded.

---

- [ ] **Unit 3: Production baseline capture + ops-repo access**

**Goal:** Replace the "prod is on 0.90.1" assumption with measured fact, and ensure the ops-repo runbook + credentials are in hand before any window.

**Requirements:** R2, R6

**Dependencies:** None (parallel with Units 1–2).

**Files:**
- Read: `ops:docker-compose.yml` (current image pin), `ops:migration/docmost_import.py` (current `EXPECTED_VERSION`), `ops:docs/plans/08-upgrade-rollback.md` (the runbook).

**Approach:**
- SSH to the box (`deploy@65.108.254.137`; the key is **not** on the planning machine — obtaining it is a hard prerequisite). Capture: running image digest/tag, `docker compose ps`, Postgres version + DB size, disk headroom, attachment storage location (disk/volume vs S3), latest backup age + restore-tested-ness, Redis role.
- Clone/pull `mxdgroup/mxdcompass_mostdocs`; read the `08` runbook end to end; note any drift from `MXD-FORK.md`.
- Confirm a **known-good restore path** exists (a backup you've actually restored on staging, not just a dump that exists).

**Test scenarios (verification checks):**
- Happy path: baseline sheet captured (image, DB version, disk, backup age); ops runbook readable; SSH + registry pull work.
- Edge case: if the running image is **not** `0.90.1`, branch the plan — a different base changes the intervening upstream migration set (re-scope Unit 4).
- Error path: if no recent, restore-tested backup exists, that blocks Window 1 until one is produced and rehearsed.

**Verification:** A one-page baseline recorded in the PR/runbook; ops-repo checked out; deploy owner + rollback-trigger owner named.

### Phase 1 — Window 1: the fork cutover (deploy `v0.95.0-mxd.3`, dark)

- [ ] **Unit 4: Staging boot test — upstream jump on a prod dump**

**Goal:** Prove the `0.90.1 → 0.95.0` upstream migration jump + the 2 fork migrations succeed against **real production data** before touching prod.

**Requirements:** R2, R3, R7

**Dependencies:** Unit 3 (fresh prod dump + baseline).

**Files:** throwaway `ops:docker-compose.staging.yml`-style stack (Postgres 16 + Redis 7 + `ghcr.io/mxdgroup/docmost:v0.95.0-mxd.3`), production-like env with **all fork flags OFF**.

**Approach:**
- Read upstream `0.90.1→0.95.0` release notes first (deferred research from Open Questions); fold any new required env/config into the Window-1 env.
- Restore the latest prod dump into the staging Postgres; boot the `mxd.3` image; watch both migrators run: upstream `kysely_migration` (the 0.90→0.95 set) then fork `mxd_migration` (share-mode, comment-guest-name).
- Run the `08` runbook 5-check smoke gate. Then the **falsification test**: stop `mxd.3`, boot a **pure upstream `0.95.0`** image against the same DB — it must start clean (proves the `mxd_migration` ledger isolation held).
- Time the migration run to size the maintenance window.

**Test scenarios (verification checks):**
- Happy path: both migrators complete; 5-check smoke passes; row counts for `pages`, `attachments`, `comments`, `shares`, `users` match the source dump.
- Edge case: attachment upload **then container restart** still serves the file (catches volume/path regressions across the jump).
- Error path: any upstream migration error → capture, do **not** proceed to prod; diagnose against notes.
- Integration: falsification — pure upstream `0.95.0` boots against the post-fork-migration DB.

**Verification:** Green smoke gate + green falsification on a prod-dump-seeded stack; measured migration duration recorded.

---

- [ ] **Unit 5: Ops-repo change set for Window 1**

**Goal:** The exact, reviewed ops-repo diff that flips prod to the fork — image pin + coupled `EXPECTED_VERSION` + flags OFF.

**Requirements:** R4, R5

**Dependencies:** Unit 4 (staging proven).

**Files:**
- Modify: `ops:docker-compose.yml` — image → `ghcr.io/mxdgroup/docmost:v0.95.0-mxd.3` pinned by the recorded digest; ensure env has `SHARE_EDIT_ENABLED=false`, `SHARE_GUEST_COMMENTS_ENABLED=false`, `MXD_DATA_PLATFORM_ENABLED=false` (explicit, not defaulted).
- Modify: `ops:migration/docmost_import.py` — `EXPECTED_VERSION = "0.95.0"`.
- Add any upstream-notes-required env keys surfaced in Unit 4.

**Approach:** Prepare as a reviewed ops-repo PR held for the window; do **not** merge/apply until inside the window with a fresh backup taken. The digest pin + `EXPECTED_VERSION` bump land together (gotcha G6).

**Test scenarios (verification checks):**
- Happy path: ops PR diff shows exactly image+digest, `EXPECTED_VERSION=0.95.0`, three flags explicitly `false`.
- Edge case: `EXPECTED_VERSION` matches the deployed image's upstream base — a mismatch is the classic importer break (G6).
- Error path: any flag missing/true in the diff is a blocker (violates dark-launch R4).

**Verification:** Ops PR approved and staged; not yet applied.

---

- [ ] **Unit 6: Execute Window 1**

**Goal:** Perform the cutover in a maintenance window with a rehearsed rollback.

**Requirements:** R2, R3, R4, R6

**Dependencies:** Units 4, 5.

**Files:** applies the Unit 5 ops change set on the box.

**Approach (window order):**
1. Announce maintenance; put up maintenance page if the runbook provides one.
2. **Backup + volume snapshot** (DB dump + filesystem/volume snapshot incl. attachments). This is the rollback anchor and the last moment a rollback is a *pure* pre-fork state.
3. Apply the ops change set; `docker compose pull` (verify digest) + `up -d`.
4. Watch logs: upstream `0.90→0.95` migrations, then fork `mxd_migration` (share-mode, comment-guest-name). Boot must reach "Nest application successfully started".
5. Run the 5-check smoke gate on prod with **flags still OFF**: page render + search, attachment upload + restart, collab edit, test email, share-link resolve (view-only, since edit flag is off).
6. Spot-check data integrity: pre/post row counts for `pages`/`attachments`/`comments`/`users`; open a few known pages; confirm existing view-only shares still resolve.

**Rollback trigger (any of):** a migration error, smoke-gate failure, or data-integrity mismatch → restore the snapshot, repin `ops:docker-compose.yml` to upstream `0.90.1` + `EXPECTED_VERSION=0.90.1`, `up -d`, re-smoke. (Pre-migration snapshot restore is the clean path; the additive fork columns would be ignored by upstream anyway, but restore is authoritative.)

**Test scenarios (verification checks):**
- Happy path: clean boot, green smoke, row counts unchanged, flags OFF confirmed in `window.CONFIG`.
- Edge case: attachment served after restart on prod.
- Error path: rehearse the rollback decision explicitly — who calls it, what "failure" means, target = restored snapshot on `0.90.1`.
- Integration: existing view-only `/share/<key>` links resolve post-upgrade.

**Verification:** Prod on `v0.95.0-mxd.3`, flags OFF, smoke green, content verified intact; maintenance lifted.

---

- [ ] **Unit 7: Post-soak — enable sharing flags**

**Goal:** After Window 1 soaks, turn on editable shares and guest comments and verify them live.

**Requirements:** R4

**Dependencies:** Unit 6 + an agreed soak period (e.g. 24–72h of clean prod).

**Files:** `ops:docker-compose.yml` env → `SHARE_EDIT_ENABLED=true`, `SHARE_GUEST_COMMENTS_ENABLED=true`; container **restart** (flags are boot-time via `static.module.ts`).

**Approach:** Flip flags, restart, confirm `window.CONFIG` now advertises them; exercise an editable share end-to-end (anonymous edit persists) and a guest comment (with the server-side ProseMirror allowlist / mention-strip behavior). Watch `persistence.extension.ts` behavior for anonymous edits (the `lastUpdatedById` hazard).

**Test scenarios (verification checks):**
- Happy path: a share set to `mode=edit` accepts an anonymous prose edit that persists across reload; a guest comment posts with a guest name.
- Edge case: a `mode=view` share stays read-only; a guest mention is stripped (no mention-notification spam).
- Error path: anonymous editor cannot reach a non-shared page (token scope holds).
- Integration: contributor tracking doesn't crash on the anonymous sentinel (no user id).

**Verification:** Both features work on prod; error logs clean over the enablement window.

### Phase 2 — Window 2: the data platform (deploy `v0.95.0-mxd.4`, dark)

- [ ] **Unit 8: Staging boot test — data-platform migrations on a post-Window-1 dump**

**Goal:** Prove the 4 data-platform fork migrations succeed against the **now-fork-based** prod data.

**Requirements:** R2, R7

**Dependencies:** Unit 2 (mxd.4 image), Unit 7 (Window 1 stable in prod); a **fresh** prod dump taken after Window 1.

**Files:** throwaway stack with `ghcr.io/mxdgroup/docmost:v0.95.0-mxd.4`, prod-like env, `MXD_DATA_PLATFORM_ENABLED=false` (then a second pass with it `true` to smoke the feature).

**Approach:** Restore the post-Window-1 dump; boot `mxd.4`; watch only the 4 new `mxd_migration` entries run (data-platform-core, automations, record-history, forms) — the 2 prior fork migrations are already recorded and must be skipped, not re-run. Run smoke gate. Falsification: pure upstream `0.95.0` still boots against the post-data-platform DB. Then flip `MXD_DATA_PLATFORM_ENABLED=true`, restart, and run the data-platform E2E surface (embed a table, create/query records, a public-share read) against staging.

**Test scenarios (verification checks):**
- Happy path: 4 new migrations apply; prior 2 skipped; smoke green.
- Edge case: `mxd_migration` ledger shows exactly 6 rows after; no upstream `kysely_migration` change.
- Error path: any migration failure halts Window 2 planning.
- Integration: with the flag on, an embedded table renders and a `/mxd/public/data/*` read works on a staged share; falsification (pure upstream boot) still passes.

**Verification:** Green smoke + green feature E2E on staging with the flag on; green falsification with it off.

---

- [ ] **Unit 9: Ops-repo change set for Window 2**

**Goal:** The ops diff for the fork↔fork bump — image only.

**Requirements:** R4, R5

**Dependencies:** Unit 8.

**Files:** `ops:docker-compose.yml` image → `v0.95.0-mxd.4` (recorded digest); `MXD_DATA_PLATFORM_ENABLED` **stays `false`**. `ops:migration/docmost_import.py` `EXPECTED_VERSION` **unchanged at `0.95.0`** (same upstream base).

**Approach:** Reviewed ops PR staged for the window. Emphasize in review: `EXPECTED_VERSION` must **not** move (mxd.3→mxd.4 is fork-only) — moving it would be an incorrect G6 edit.

**Test scenarios (verification checks):**
- Happy path: diff = image+digest only; `EXPECTED_VERSION` untouched; DP flag `false`.
- Error path: any `EXPECTED_VERSION` change in the diff is a blocker.

**Verification:** Ops PR approved and staged.

---

- [ ] **Unit 10: Execute Window 2**

**Goal:** Deploy the data-platform image with a rehearsed fork↔fork rollback.

**Requirements:** R2, R6

**Dependencies:** Units 8, 9.

**Approach (window order):** maintenance up → **backup + snapshot** → apply ops change set → `pull` (verify digest) + `up -d` → watch the 4 new `mxd_migration` entries → boot to started → 5-check smoke with **DP flag still OFF** (data platform invisible; verifies the upgrade didn't regress the base) → data-integrity spot check.

**Rollback trigger (any of):** migration error / smoke failure / integrity mismatch → **fork↔fork repin** `ops:docker-compose.yml` back to `v0.95.0-mxd.3` (`EXPECTED_VERSION` already `0.95.0`), `up -d`. The data-platform additive tables/columns lie dormant under `mxd.3` — schema-safe and ledger-safe per the rollback-era rules; snapshot restore only if data integrity is in question.

**Test scenarios (verification checks):**
- Happy path: clean boot, 4 migrations applied, base smoke green, DP still dark.
- Edge case: fork↔fork rollback to mxd.3 boots clean with the data-platform tables present-but-dormant.
- Error path: rollback rehearsed; snapshot restore reserved for integrity failures only.
- Integration: existing shares/comments/pages unaffected by the data-platform migrations.

**Verification:** Prod on `v0.95.0-mxd.4`, DP flag OFF, base smoke green, content intact.

---

- [ ] **Unit 11: Post-soak — enable the data platform**

**Goal:** After Window 2 soaks, turn the data platform on and verify end-to-end on prod.

**Requirements:** R4

**Dependencies:** Unit 10 + soak.

**Files:** `ops:docker-compose.yml` env → `MXD_DATA_PLATFORM_ENABLED=true`; container **restart**.

**Approach:** Flip, restart, confirm `window.CONFIG`; the `/`-slash "Data table" item appears; create a table on a scratch page, add fields/records, switch views, and load a public-share embed to confirm the anonymous read path serves on prod (read-only). Watch throttle + error logs.

**Test scenarios (verification checks):**
- Happy path: embed a table, add a record, query a view — all persist; a computed column evaluates.
- Edge case: a public share renders the embedded table read-only (no edit chrome), scope-enforced.
- Error path: an out-of-scope table id on the public endpoint returns 404 in prod.
- Integration: automations fire on record change; a form submit creates a record.

**Verification:** Data platform live and correct on prod; logs clean over the enablement window; the migration is complete.

## System-Wide Impact

- **Interaction graph:** two migrators at boot (`migration.service.ts` upstream, `migrate-mxd.ts` fork) — order and ledger isolation are load-bearing; the collab layer (`persistence.extension.ts`, `authentication.extension.ts`) is exercised the moment share-edit is enabled (Unit 7).
- **Error propagation:** a migration failure `process.exit(1)`s the container — the deploy visibly fails rather than serving a half-migrated DB; this is why boot-watching is a gate, not a courtesy.
- **State lifecycle risks:** attachments across the upstream jump (volume/path); Redis/BullMQ across the jump; `window.CONFIG` is boot-time so flag flips need restarts (partial rollout impossible without restart).
- **API surface parity:** the anonymous `/mxd/public/data/*` and `/mxd/public/forms/*` endpoints go live (dark) — throttle + scope enforcement are the blast-radius controls verified in Units 8/11.
- **Unchanged invariants:** upstream `kysely_migration` ledger is never written by the fork; a pure upstream image must still boot after each fork migration (falsification, Units 4 & 8); existing pages/attachments/users/shares/comments are read-compatible throughout.

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upstream `0.90→0.95` migration fails/corrupts on real data | Med | High | Rehearse on a prod dump (Unit 4); backup+snapshot before Window 1; boot-watch gate; snapshot-restore rollback |
| "Deploy replaces my articles" fear realized | Low | High | Stateless swap + additive-only fork migrations + separate ledger + falsification test; row-count integrity checks pre/post |
| `EXPECTED_VERSION` / image pin drift (gotcha G6) | Med | Med | Coupled edits reviewed in Unit 5/9; explicit check that Window 2 does **not** move it |
| Feature bug surfaces coupled with upgrade | Med | Med | Dark launch — flags OFF on deploy, enabled/verified separately (Units 7, 11) |
| No restore-tested backup exists | Med | High | Unit 3 gates on a *restored* backup, not just a dump |
| Attachment storage regresses across jump | Low | High | Upload-then-restart check in every smoke gate |
| Ops repo / SSH key unavailable at execution | Med | High | Unit 3 hard prerequisite before any window is scheduled |
| Boot-time flags misunderstood as runtime | Low | Med | Documented: enabling a flag = a restart (a mini-deploy), not a hot edit |

## Phased Delivery

- **Phase 0 (no prod change):** Units 1–3 — review, merge+tag+image, baseline. Can run now, in parallel.
- **Phase 1 (Window 1):** Units 4–7 — the fork cutover + upstream jump, then sharing flags. The high-risk window.
- **Phase 2 (Window 2):** Units 8–11 — the data platform, then its flag. Only after Phase 1 has soaked.

## Documentation / Operational Notes

- Record the deployed digests, migration durations, and the falsification results in the ops repo alongside `08-upgrade-rollback.md` — the next rebase/deploy re-uses them.
- Update `MXD-FORK.md` if the upstream `0.90→0.95` notes surface a new required env key or a deploy step worth institutionalizing.
- Comms: schedule both windows with the ops owner; name the rollback-trigger holder per window; keep the maintenance page ready.

## Sources & References

- **Deploy model / rollback eras / staging / migration design:** `MXD-FORK.md`
- **Origin (feature) plan:** [docs/plans/2026-08-09-001-feat-mxd-data-platform-plan.md](docs/plans/2026-08-09-001-feat-mxd-data-platform-plan.md)
- **CI promote pipeline:** `.github/workflows/mxd-image.yml`
- **Migrators:** `apps/server/src/database/migrate-mxd.ts`, `apps/server/src/database/services/migration.service.ts`, `apps/server/src/database/database.module.ts`
- **Flags + config injection:** `apps/server/src/integrations/environment/environment.service.ts:220-234`, `apps/server/src/integrations/static/static.module.ts:31-57`
- **Ops repo:** `mxdgroup/mxdcompass_mostdocs` — `ops:docker-compose.yml`, `ops:migration/docmost_import.py`, `ops:docs/plans/08-upgrade-rollback.md`
- **Prod:** `docs.mxd.digital`, Hetzner `65.108.254.137`, `deploy@` (SSH key not on the planning machine)
