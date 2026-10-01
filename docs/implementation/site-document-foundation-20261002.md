# Canonical SiteDocument implementation — 2026-10-02

Branch: `feature/site-document-foundation`  
Draft PR: #3  
Status: additive migration; `main` remains unchanged.

## Purpose

Forge now has a versioned canonical website model that can become the shared contract for editor actions, AI proposals, Figma imports, CMS data and publishing without breaking the current `Website.editorData` runtime. The migration strategy deliberately keeps the proven editor/public/static paths alive while the canonical model is adopted feature-by-feature.

## Architecture

```
React/Vite editor + Control Center
            |
            v
      /api/websites/:id
            |
   Permissioned command API
            |
            +--------------------+
            |                    |
            v                    v
   SiteDocumentState       SiteDocumentRevision
   current canonical       immutable history
            |
            +--> SiteDocumentCommand audit
            +--> CMS v2 projection
            +--> legacy editorData compatibility mirror
            +--> publish compiler
            +--> Figma importer
            +--> AI/Stitch reviewed command proposals
```

### Source of truth rules

1. A persisted `SiteDocumentState` is canonical for new command-based features.
2. Existing `Website.editorData` remains the compatibility representation consumed by the current visual editor and mature runtime.
3. Canonical command commits update the legacy mirror in the same database transaction.
4. Legacy editor saves reconcile back into canonical visual state when a canonical state exists.
5. Canonical-only data (CMS 2.0, components, integrations, experiments) is preserved during legacy reconciliation.
6. Publishing uses the exact canonical revision when it is synchronized to the current website `documentVersion`; otherwise it safely falls back to the proven legacy snapshot.
7. AI and external design tools do not write production document JSON directly. They create reviewable typed command proposals.

## Canonical schema

`backend/src/domain/site-document.ts`

The strict Zod model includes:

- site settings and metadata
- pages and recursive element trees
- reusable components, variants and slots
- style rules and responsive state
- design tokens with provenance (`forge`, `figma`, `stitch`, `import`)
- assets
- CMS collections, fields, items and element bindings
- interactions
- forms
- locale overlays
- experiments
- integrations
- extension storage for forward/backward compatibility

Validation enforces bounded collections, unique identifiers and CMS referential integrity.

## Typed command processor

`backend/src/domain/site-commands.ts`

Supported commands now include:

- `page.create`, `page.update`, `page.delete`
- `element.insert`, `element.delete`, `element.move`
- `element.updateProperties`, `element.updateStyles`
- `component.create`, `component.delete`, `component.extract`
- `token.set`, `token.delete`
- `style.updateRule`, `style.deleteRule`
- `asset.add`, `asset.delete`
- `cms.collection.create/update/delete`
- `cms.field.add/update/delete`
- `cms.item.create/update/delete`
- `cms.field.bind/unbind`
- `locale.add/update/delete`
- `experiment.createVariant/update/delete`
- `integration.set/delete`
- `site.setMetadata`
- `extension.set`

Command batches are bounded to 500 operations, applied to a clone, target checked and validated as a complete SiteDocument before commit.

## Persistence and migrations

Migration directories:

- `20261002020000_site_document_v1`
- `20261002023000_ai_site_commands`

New tables:

- `site_document_states`
- `site_document_revisions`
- `site_document_commands`
- `cms_collections_v2`
- `cms_fields_v2`
- `cms_items_v2`
- `cms_bindings_v2`
- `figma_node_mappings`

`ai_changesets.proposedCommands` stores the exact reviewed typed proposal alongside the legacy visual proposal for compatibility.

SiteDocument/CMS/Figma tables carry `organizationId` and enable + force PostgreSQL RLS using the existing `app.tenant_id` session boundary.

## Compatibility adapter

`backend/src/domain/site-document-legacy.ts`

- Converts current `CanonicalWebsiteData` to SiteDocument v1.
- Imports existing CustomPostType/CustomField/CustomEntry records into CMS 2.0 at initialization.
- Maps existing global colors/typography into design tokens.
- Preserves unknown future legacy top-level fields inside `extensions.legacyTopLevel`.
- Converts canonical pages/elements back to existing editor data so the current renderer remains functional.

The adapter makes migration additive rather than requiring a destructive editor rewrite.

## Revision lifecycle

`backend/src/services/websites/site-document.service.ts`

- optimistic revision preconditions
- idempotency via the existing workspace command journal
- preview without mutation
- transactional command apply
- immutable revision records
- per-command audit rows
- safe restoration by creating a new head revision
- automatic reconciliation after publish/legacy saves
- existing protected-component and granular permission checks are reused before commit

### HTTP API

All routes are under `/api/websites/:id/site-document`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/` | load/reconcile canonical document |
| POST | `/initialize` | persist compatibility-derived canonical state |
| POST | `/commands/preview` | validate + preview command batch |
| POST | `/commands` | apply command batch |
| GET | `/revisions` | revision history |
| GET | `/revisions/:revision` | read immutable revision |
| POST | `/revisions/:revision/restore` | restore by creating a new revision |
| GET | `/cms` | canonical CMS snapshot |
| POST | `/figma/preview` | import Figma file as a reviewable command batch |
| POST | `/figma/sync` | apply reviewed Figma commands |

Mutations require `Idempotency-Key` and command commits require an expected revision.

## CMS 2.0

CMS is now part of SiteDocument instead of an unrelated content island.

`backend/src/domain/site-document-cms.ts`:

- validates collection/item relationships
- resolves an item into bound page elements
- supports bindings to `content`, props and safe style paths
- blocks prototype pollution paths
- supports CMS template metadata:
  - `page.settings.cmsCollectionId`
  - `page.settings.cmsPathPattern`

`backend/src/domain/site-document-publish.ts` expands published CMS items into deterministic static/public pages while leaving draft items unpublished.

Normalized CMS v2 tables are maintained as a query projection of the canonical model. Existing CPT data is imported for migration compatibility.

## Publishing integration

When a SiteDocument state exists and its revision exactly matches the current `Website.documentVersion`, `publishing.service.ts` compiles from that canonical revision.

CMS template expansion occurs only in the immutable published snapshot. Generated CMS pages are never written back over editable template pages.

If canonical state is absent or stale, publishing falls back to the existing validated legacy pipeline instead of guessing.

Existing destinations remain in place:

- internal hosting
- static bundle/ZIP
- SFTP
- WordPress

## AI and Google Stitch

The existing durable Stitch + Claude design pipeline remains the provider execution layer. This branch changes its mutation boundary:

```
prompt
  -> durable AI execution
  -> Stitch/Claude output
  -> native editable legacy proposal
  -> SiteDocument conversion
  -> deterministic typed command diff
  -> human review
  -> atomic typed-command apply
  -> SiteDocument revision + legacy mirror
```

Both the Stitch/Claude workflow and the generic site generation workflow now store `proposedCommands`.

Approved AI changesets with typed commands are applied from the server-stored proposal; the client cannot substitute a different command batch during approval. Older changesets without typed commands keep the legacy safe path.

## Figma integration

`backend/src/integrations/figma/site-document-figma.ts` and `figma-sync.service.ts` implement a governed one-way import foundation:

- organization/website scoped connector credential
- no raw access token accepted from the browser
- Figma Files REST import
- Variables import when available
- frame/section -> page conversion
- node -> native editable element conversion
- common text/layout/fill geometry mapping
- Figma Variables -> Forge design tokens
- deterministic external/local identities
- mapping persistence for future reconciliation
- preview before apply
- typed commands for the final mutation

The backend bounds request time and response size and treats Variables access as optional when layout import can continue.

### Deliberate boundary

Structural Forge -> Figma node mutation is **not claimed as production complete in this branch**. A safe two-way implementation needs an explicitly supported write surface (for example a governed Figma plugin/approved Variables write API) and conflict semantics. The current code does not fabricate a write API or silently overwrite a Figma file.

## Frontend

New files:

- `frontend/src/features/site-document/types.ts`
- `frontend/src/features/site-document/client.ts`
- `frontend/src/pages/dashboard/SiteDocumentControlCenter.tsx`

Route:

- `/dashboard/site-document/:websiteId`

The control center shows:

- schema/revision state
- page/element/component/CMS counts
- design token/style/asset/binding counts
- revision history and safe restore
- Figma preview with command count
- explicit apply after review
- warnings when Figma Variables are unavailable

The existing Custom Post Types screen links into the canonical control center.

## Security invariants

- existing role/capability authorization remains authoritative
- SiteDocument service re-authorizes inside the transaction even when route middleware already ran
- optimistic revisions prevent stale overwrites
- idempotency keys prevent duplicate commits
- protected components reuse current document-policy enforcement
- AI proposals are server persisted before approval
- tenant data is protected by PostgreSQL RLS
- Figma secrets are read from governed connector secret references
- remote Figma responses are timeout/size bounded
- CMS binding paths reject prototype-related keys
- publish-generated CMS pages cannot replace editable templates

## Qualification

`backend/src/tests/site-document-foundation.test.ts` covers:

- canonical validation
- immutable typed command execution
- missing-target rejection
- move/cycle safety
- CMS creation and referential integrity
- legacy round-trip preservation
- legacy CPT -> CMS 2.0 migration
- deterministic visual diff
- Figma frame/node/variable conversion
- CMS binding resolution
- CMS template publish expansion

The AI qualification workflow now executes this suite after building the backend.

A draft PR is intentionally open so the repository's full PR qualification matrix runs without merging into `main`.

## Rollout

Recommended rollout order:

1. deploy schema migrations
2. keep current editor save behavior enabled
3. enable SiteDocument initialization for internal/test workspaces
4. observe reconciliation and revision telemetry
5. move CMS management to canonical commands
6. enable Figma sync for opted-in workspaces
7. move more editor mutations from full-document save to typed commands
8. only after qualification, make SiteDocument mandatory for new sites
9. retain a read-compatible legacy mirror until every public/static/WordPress renderer has migrated

## Rollback

The migration is additive. To disable the new path without data loss:

- stop exposing the SiteDocument/Figma control-center routes
- stop initializing new `site_document_states`
- continue using `Website.editorData` and existing publishing paths

Do not drop the new tables during an incident rollback; they contain revision/audit history and can remain dormant while the old path continues.

## Known remaining production gates

These are intentionally explicit rather than represented as completed:

1. Forge -> Figma structural two-way node/component writes and conflict UI.
2. Live-provider acceptance against real customer Figma/Stitch accounts; automated tests use fixtures/mocks.
3. Full migration of every editor gesture from legacy whole-document saves to typed commands. Legacy saves are currently reconciled into SiteDocument safely.
4. Full deprecation/removal of the old CustomPostType UI/API. Existing data imports into CMS 2.0; the legacy API remains for backward compatibility.
5. Large-site performance qualification at production-scale page/CMS volumes.
6. Operational dashboards/SLO alerts specifically for SiteDocument command latency and reconciliation failures.

Nothing in this branch is presented as production-complete until the PR qualification matrix and the remaining live-provider gates pass.
