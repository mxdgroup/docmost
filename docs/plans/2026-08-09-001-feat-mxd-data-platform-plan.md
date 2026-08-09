---
title: "feat: MXD data platform — Coda-style tables, views, relations, formulas, buttons, automations, cross-doc"
type: feat
status: active
date: 2026-08-09
origin: (ops repo) docs/plans/2026-08-08-001-feat-docmost-fork-coda-roadmap-plan.md  Phase 4 (items E–J)
supersedes: "Phase 4 (outline only)" — this is the execution ledger; Phase 4 is no longer deferred (operator decision 2026-08-09)
---

# feat: MXD data platform (roadmap Phase 4, now in execution)

This is the **execution ledger** for the data platform. The parent roadmap left
Phase 4 as an outline; that decision is superseded. Product direction is
approved: *a collaborative documentation + lightweight-application platform —
docs + public collaboration + relational tables + formulas + buttons +
automations.* Build it end to end, in dependency order, under the existing fork
invariants.

## Non-negotiable fork invariants (carried from the parent plan)

1. **Separate migrator.** All schema lives in `apps/server/src/database/migrations-mxd/`
   and runs through the `mxd_migration` ledger — never upstream's `kysely_migration`.
   Every schema change re-earns the falsification test: *fork-migrated DB → pure
   upstream `docmost/docmost:0.95.0` image → boots clean.*
2. **`mxd_*` namespace.** Every data-platform table is prefixed `mxd_` so it can
   never collide with upstream EE "Bases" (`base*`) tables, and an upstream image
   simply ignores it. This is the structural clean-room boundary — not attestation.
3. **Clean-room.** No read/copy/import from `apps/*/src/ee`, `packages/ee`,
   `packages/base-formula`. Independent AGPL implementation. The CI guard
   (`scripts/mxd-ee-clean-room-check.sh`) stays green.
4. **Server-first API parity.** Every capability is a plain HTTP endpoint before
   it is UI. Authorization is server-side; UI visibility is never security.
5. **Ship dark.** Each subsystem lands behind an env flag (default off), like
   `SHARE_EDIT_ENABLED`. New flag: `MXD_DATA_PLATFORM_ENABLED`.

## Storage model (locked)

Relational-but-pragmatic (Airtable/Baserow-lite), already expressed in migration
`20260809T120000-mxd-data-platform-core.ts`:

- `mxd_tables` — a table/database; optional `page_id` home; `primary_field_id`.
- `mxd_fields` — a column: `type` (string enum) + `config` jsonb (per-type
  options); unique `(table_id, name)`; fractional `position`.
- `mxd_records` — a row: cell values in `data` jsonb **keyed by field uuid**
  (stable key, not name → rename never rewrites records; no EAV explosion);
  `version` int for optimistic concurrency; guest attribution column.
- `mxd_views` — saved view (config-only, never a data copy).
- `mxd_record_links` — true relation edges (FK + cascade), unique
  `(field_id, from_record_id, to_record_id)`. Lookups/rollups read these.

Why jsonb cells (not a column-per-field or EAV): field renames/reorders are
metadata-only; a record is one row (no N-row reassembly); Postgres jsonb + GIN
covers filter/search. Integrity that matters (which fields exist, their types,
relations) is relational; only the *cell payload* is jsonb.

## Field types (item E/§6) — v1 set

text, long_text, number, currency, percent, checkbox, date, datetime, select,
multi_select, user, url, email, relation, lookup, rollup, formula, created_time,
updated_time, created_by, updated_by, autonumber, attachment (guest-safe subset
excludes attachment upload).

Each type declares: `parseInput`, `validate`, `serialize`, `filterOperators`,
`sortComparator`, and whether it is **computed** (lookup/rollup/formula/…-time)
— computed types are read-only cells derived by the compute service, never
written directly.

## Unit sequence (each = its own PR, tests + falsification-boot before merge)

### E — Relational tables (foundation)
- [~] **E1. Core schema migration** — `mxd_tables/fields/records/views/record_links`.
      DONE (migration written; pending falsification-boot test + type regen).
- [ ] **E2. DB types + repos.** Regenerate `db.d.ts` (kysely-codegen per repo
      convention) or hand-add interfaces; `MxdTableRepo`, `MxdFieldRepo`,
      `MxdRecordRepo`, `MxdViewRepo`, `MxdRecordLinkRepo` following
      `apps/server/src/database/repos/**` patterns.
- [ ] **E3. Field-type registry.** `apps/server/src/core/mxd-data/field-types/` —
      one module per type implementing the contract above. Pure, unit-tested.
- [ ] **E4. Table/field/record services + controller.** CRUD: create/rename/
      archive table; add/rename/reorder/reconfigure field (with safe type-change
      matrix); add/edit/duplicate/archive record; bulk select; version-checked
      updates (409 on stale). Guards: field-name collision, invalid type
      conversion, deleted relation targets, concurrent edits.
- [ ] **E5. Editor node.** `mxdTable` ProseMirror node holding ONLY
      `{tableId, viewId}` (row data never enters the Y.doc). Client feature
      `apps/client/src/features/mxd-data/` renders the grid via its own
      API/react-query, not collaborative doc state.

### F — Views
- [ ] **F1. View CRUD + config schema** (visibleFields, fieldOrder, sorts,
      filters, groupBy, displayFieldId, recordOrder).
- [ ] **F2. Query engine.** Server-side filter/sort/group/paginate over
      `mxd_records` (jsonb operators per field type); cursor pagination; never
      ship a whole table to render 50 rows (§23).
- [ ] **F3. Renderers:** grid → board (kanban; card move = record group change,
      §9) → list. Then calendar + gallery if product needs them.

### Relations / Lookups / Rollups (§7–8)
- [ ] **R1. Relation field type** (one-to-one/one-to-many/many-to-many via
      `mxd_record_links`); reciprocal field display; intentional delete behavior;
      no orphans; survives renames (uuid keys).
- [ ] **R2. Lookup + rollup fields** (sum/avg/min/max/count/concat/earliest/
      latest across a relation). Recompute on source change; dependency-aware.

### G — Formulas (safe engine)
- [ ] **G1. Expression engine** — a **sandboxed, non-Turing-complete** evaluator
      (own parser/AST + evaluator, or an embedded safe library that is NOT
      `packages/base-formula`). No `eval`, no JS execution. Functions: arithmetic,
      boolean, comparison, string ops, IF/SWITCH, date fns, field refs,
      relation-derived values.
- [ ] **G2. Dependency graph + cycle detection.** Topological recompute; cycles
      rejected with a useful error state; a broken formula never crashes the
      table. Bounded evaluation (depth/steps/time). Recompute via existing BullMQ.
      Tests: cycles, invalid refs, deleted fields, div-by-zero, null, type
      mismatch, deep chains, large expressions.

### H — Buttons / actions (§12)
- [ ] **H1. Action definitions** (declarative): set field, set current date,
      create/duplicate/link record, open URL, run automation, configured webhook.
      No shell/JS. Every action permission-checked server-side.
- [ ] **H2. Capability split.** Content-edit capability ≠ automation/action
      capability. Anonymous/public editors NEVER inherit action/automation
      privilege just because they can edit a public doc (§12, §15).

### I — Automations (§13)
- [ ] **I1. Rule model + engine.** `mxd_automation_rules` (trigger → condition →
      action). Triggers: record created/updated/field-changed/enters-view/
      scheduled/button. Execution rows: `mxd_automation_runs` with execution id,
      idempotency key, retry policy (bounded), failure state, audit trail.
- [ ] **I2. Loop protection.** Explicit depth/execution limits; A→B→A cycles
      halted; per-run timeout; permission/context model for the acting principal.

### J — Cross-doc / cross-page (§14–15)
- [ ] **J1. Reference model.** Embed a table/view/filtered-view on another page
      by reference (no dataset duplication). Permissions follow the underlying
      data — embedding a private table in a public page does NOT expose it.
- [ ] **J2. Explicit exposure model** (the critical acceptance area, §15): a
      public-view share exposes only the fields/records the shared view selects;
      a public-edit share allows editing only visible+configured fields/records;
      hidden fields/records and the underlying table id stay inaccessible.
      IDOR test matrix: hidden record/field, other view id, other page, other
      workspace.

### Cross-cutting (interleaved, not last)
- [ ] **Forms (§16):** public/internal record-entry surface exposing only
      configured fields; ownership/table/workspace derived server-side from the
      form/share config, never from client-sent hidden fields.
- [ ] **Permissions (§17):** extend the existing page-permission model to
      table/view/record scope — one coherent framework, enforced on HTTP + ws +
      automation + cross-doc + embed paths. Not a parallel system.
- [ ] **Realtime (§18):** structured records use transactional versioned APIs
      (optimistic concurrency), NOT the doc CRDT — avoids last-write-loss and
      CRDT/relational impedance. Live view updates via existing ws broadcast of
      lightweight change events.
- [ ] **History/audit (§19):** who/what/before-after for record + field +
      automation + button + permission changes; guest actor attributed safely.
- [ ] **Import/export (§20):** CSV import (schema mapping, validation, preview,
      partial-error, dup strategy) + export. Never evaluate imported spreadsheet
      formulas as code; CSV-injection-safe export (neutralize leading =,+,-,@).
- [ ] **Search (§21):** structured data participates in search, permission-
      respecting; async index tolerates delete/permission-change (no stale leak).
- [ ] **Mobile/UX (§22):** grid horizontal overflow, frozen primary column,
      narrow-screen record editing, view switching — not desktop-only.
- [ ] **Security review (§26):** adversarial pass — SQLi, formula/expression
      injection, XSS, relation IDOR, hidden field/record access, cross-workspace
      relations, public-share escalation, automation abuse, webhook SSRF, formula
      DoS, deep dependency graphs, large-payload DoS, CSV injection, action
      privilege escalation, guest→member confusion. Every material finding →
      fix → regression test.
- [ ] **No-regression (§27):** the existing editor/lists/shares/public-view/
      public-comment/guest-edit/permissions/notifications/upstream-boot/flags/
      clean-room suites all stay green each increment.

## Acceptance for "done"
Every unit: server endpoints first, spec suite green, `mxd_migration`
falsification-boot passes (upstream image boots on the migrated DB), clean-room
CI green, and the feature works behind `MXD_DATA_PLATFORM_ENABLED` on a local
stack. Production enablement is a separate reversible flag flip, per fork policy.

## Progress log
- 2026-08-09: ledger created; core schema migration `20260809T120000-mxd-data-platform-core.ts`
  written (E1). Next: E2 (types + repos), then E3/E4 (field-type registry + services).
