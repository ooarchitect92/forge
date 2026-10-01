# Forge Design Platform 2026

**Status:** Target architecture with Phase 0 implementation landed in `feature/design-platform-foundation-20261001`  
**Audience:** Product, architecture, frontend, backend, security, platform engineering and design systems  
**Decision:** Forge will be a provider-neutral, reversible design operating system rather than a clone of any single website builder.

## 1. Product thesis

Forge should let a team move safely between four representations of the same digital product:

1. **Intent** — a human brief, industry template or structured requirements.
2. **Design** — Stitch screens, Figma files, native Forge canvas nodes and design-system tokens.
3. **Content/data** — CMS collections, typed fields, localized entries and commerce data.
4. **Runtime** — staged releases, production sites, code components, analytics and experiments.

The differentiated workflow is not “prompt and hope.” Every generated or imported change is converted into a native intermediate representation, previewed as a changeset, checked against permissions and document versions, and explicitly approved. Provider responses are inputs; Forge remains the system of record.

## 2. Non-negotiable principles

- **Native and editable:** AI and Figma output must become native Forge pages and elements, not opaque screenshots or permanent HTML blobs.
- **Review before mutation:** External design generation and imports create proposals. They do not replace the website automatically.
- **Merge before delete:** CMS automation may create or update compatible structures. Field deletion and type changes require a separate migration workflow.
- **Provider-neutral:** Stitch, Figma, Claude, Gemini and future providers sit behind capability contracts. No provider owns the canonical document.
- **Tenant-scoped:** All writes re-evaluate organization, workspace, website and actor permissions inside the database transaction.
- **Reversible:** Applied changes produce revision provenance and can participate in rollback/release workflows.
- **Truthful entitlements:** Forge starter units are internal safety quotas. Third-party plans, seats, rate limits and billing are never represented as free Forge credits.
- **Bounded input:** Remote payload size, nesting, node count, response time and supported vocabulary are limited before database admission.
- **Accessible by default:** Templates and generated UI must preserve semantic structure, keyboard operation, responsive behavior and sufficient contrast.

## 3. System context

```text
Designers / Developers / Content teams / Clients
                       |
                       v
              Forge Web Application
     +-----------------+------------------+
     | Native editor   | AI workspace     |
     | CMS workspace   | Review/approval  |
     +-----------------+------------------+
                       |
                       v
                 Forge API Layer
     +-----------------+------------------+
     | Identity/RBAC   | Capability API   |
     | Changesets      | CMS blueprints   |
     | Connector refs  | Publish/release  |
     +-----------------+------------------+
                       |
       +---------------+--------------------+
       |               |                    |
       v               v                    v
 Google Stitch      Figma API        Model providers
 design provider   governed import    planning/copy/code
       |               |                    |
       +---------------+--------------------+
                       |
                       v
              Canonical Forge IR
    Pages + native nodes + tokens + bindings + CMS
                       |
                       v
        PostgreSQL / object storage / job system
                       |
                       v
       Preview, staging, production and export
```

## 4. Bounded contexts

### 4.1 Design orchestration

Responsibilities:

- Choose a workflow from capabilities rather than hard-coded provider names.
- Persist an execution with provider/model/version snapshot.
- Reserve internal usage units before external calls.
- Run external stages through durable jobs where outcomes can be uncertain.
- Convert provider output to the canonical document vocabulary.
- Store a reviewable changeset with provenance and warnings.

Existing Stitch + Claude execution remains the primary prompt-to-site workflow. The target provider contract adds optional capabilities for screen edits, variants, screenshots and design-system extraction after a pinned SDK qualification.

### 4.2 Figma interoperability

Phase 0 supports:

- Figma file URLs or keys.
- Optional selected node IDs.
- Governed website-scoped connector secrets.
- Fixed-origin REST access with timeout and response-size limits.
- Inventory of components, component sets and styles.
- Conversion of supported frames, auto layout and text into native Forge elements.
- Reviewable append-page changesets.
- Placeholders and explicit warnings for unsupported image/vector layers.

Target capabilities:

- OAuth installation and per-workspace connection lifecycle.
- Variable collection and mode mapping.
- component/property/variant mapping.
- Figma Dev Resources links and Code Connect metadata.
- Forge-to-Figma write-back using a separately authorized write capability.
- Change detection through webhooks and reconciliation rather than blind polling.

### 4.3 CMS and dynamic experience

Phase 0 introduces a versioned CMS blueprint:

```json
{
  "version": 1,
  "name": "Academy content model",
  "collections": [
    {
      "name": "Programs",
      "singular": "Program",
      "plural": "Programs",
      "slug": "programs",
      "fields": [
        { "name": "Summary", "key": "summary", "type": "text", "required": true }
      ],
      "items": []
    }
  ]
}
```

Rules:

- Collection slugs, field keys and item slugs are unique in their scope.
- Seed item values are checked against declared field types.
- Existing compatible fields are updated in place.
- Existing content is never deleted.
- A field type conflict blocks the entire transaction.
- Writes are idempotent, audited and emitted to the workspace outbox.

Target capabilities:

- Collection references and multi-references.
- Date/time, option, color, file and location fields.
- Dynamic collection pages and nested route templates.
- Canvas bindings with empty/loading/error states.
- Conditional visibility and filtering/sorting/pagination.
- Draft/live item semantics and scheduled publication.
- Locale-aware fields, slugs, fallback and hreflang generation.
- Schema migration plans with impact preview, backfill and rollback.

### 4.4 Industry template system

An industry template is a signed/versioned manifest, not only a page snapshot. It includes:

- A grounded AI brief.
- Recommended pages and content hierarchy.
- A CMS blueprint.
- Design tokens and component requirements in a later version.
- Required integrations and data-source declarations.
- Claims that must be supplied or verified by the customer.

Phase 0 ships education, SaaS, care-services and professional-practice manifests. The catalog is intentionally conservative: it does not fabricate prices, clients, claims, credentials or outcomes.

### 4.5 Design systems and components

Target canonical structure:

```text
DesignSystem
  TokenCollection
    Mode
      Token(alias-aware)
  Component
    Property
    VariantAxis
    Slot
  Binding
    CMS | variable | locale | runtime data
  Provenance
    Forge | Figma | Stitch | code component
```

Token aliases must be preserved rather than flattened. Components need stable semantic IDs independent of provider node IDs. Code components must execute in a sandbox with an allowlisted package registry and explicit data/secret capabilities.

### 4.6 Collaboration and branching

Target collaboration model:

- CRDT/operation-log editing for presence, selections and low-latency canvas changes.
- Branches reference a base release and contain operations, not full uncontrolled copies.
- Merge preview classifies conflicts by page, component, token, CMS schema and content.
- Protected production branches require approval and passing qualification gates.
- Provider-generated changes always land on a branch or changeset.

### 4.7 Publishing, analytics and optimization

A release is immutable and references:

- Canonical document revision.
- CMS staged snapshot.
- Asset manifest.
- code-component bundle hashes.
- locale bundle.
- environment configuration references.
- qualification results.

Analytics and experiments must operate on release IDs and consent state. AI optimization can propose variants but cannot publish a winner without configured governance.

## 5. New Phase 0 API surface

Mounted under both existing AI prefixes through `ai.routes.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/ai/design-platform/templates` | List curated industry manifests without exposing full briefs/CMS payloads. |
| GET | `/api/v1/ai/design-platform/templates/:templateId` | Retrieve one complete AI brief and CMS blueprint. |
| GET | `/api/v1/ai/design-platform/websites/:websiteId/capabilities` | Report provider configuration, conditional features and internal usage units. |
| POST | `/api/v1/ai/design-platform/websites/:websiteId/figma/preview` | Fetch and compile a bounded Figma selection without creating a mutation. |
| POST | `/api/v1/ai/design-platform/websites/:websiteId/figma/changesets` | Create a native append-page proposal using document preconditions and idempotency. |
| POST | `/api/v1/ai/design-platform/websites/:websiteId/cms/blueprints/preview` | Compare a blueprint with the current CMS schema. |
| POST | `/api/v1/ai/design-platform/websites/:websiteId/cms/blueprints/apply` | Apply a merge-only CMS command transactionally. |

Mutating endpoints require `X-Forge-Intent: document-command` and an `Idempotency-Key`. Figma proposal creation additionally requires the current document ETag in `If-Match`.

## 6. Figma import flow

```text
User submits Figma URL/key
        |
        v
Authorize website + EDIT_DESIGN
        |
        v
Resolve website-scoped `figma` secret reference
        |
        v
GET fixed api.figma.com endpoint
  - no redirects
  - bounded timeout
  - 8 MiB maximum response
        |
        v
Normalize selected roots
        |
        v
Compile to native Forge nodes
  - auto layout -> flex layout
  - text -> heading/text
  - frame/component -> container
  - image/vector -> placeholder + warning
        |
        v
Append imported frames as new pages in a proposed document
        |
        v
Validate node IDs, depth, size and document policy
        |
        v
Serializable workspace command
  - reauthorize
  - recheck document version
  - create completed execution
  - create PENDING_REVIEW changeset
  - audit + outbox + idempotency journal
        |
        v
User compares, applies or discards through existing AI changeset workflow
```

No Figma token, raw Figma payload or remote image reference is persisted in the changeset or audit record.

## 7. CMS blueprint flow

```text
Blueprint JSON
   |
   v
Strict schema + uniqueness + typed seed validation
   |
   +--> Preview current collections/fields/items
   |        |
   |        +--> Report create/update/keep/type-conflict actions
   |
   v
Explicit apply command
   |
   v
Serializable transaction + website lock
   |
   +--> Upsert collection metadata
   +--> Create/update compatible fields
   +--> Reject field type changes
   +--> Create/update optional seed items
   +--> Never delete unrelated schema/content
   |
   v
Audit + outbox + replay-safe acknowledgement
```

## 8. Connector and secret model

- UI and API store a secret-manager reference, never a provider token.
- Production resolves AWS Secrets Manager references using workload identity.
- `env:` references and `FIGMA_ACCESS_TOKEN` are development-only.
- Figma is registered with provider key `figma` and scoped to the website.
- Read and write capabilities will use different connector grants in a later phase.
- OAuth refresh, revocation and webhook ownership must be centralized in the connector control plane.

## 9. Starter usage and “free tokens”

Forge can grant internal starter units to improve onboarding, but the product must communicate them precisely:

- Unit: reserved provider-call unit, not a universal token or currency.
- Window: UTC day in Phase 0.
- Admission: reserved before design execution.
- Display: configured limit, reserved and remaining.
- Disclosure: third-party rate limits, plan eligibility and billing remain with the provider.

Target ledger:

```text
CreditGrant -> Reservation -> ProviderUsage -> Reconciliation -> Release/Expiry
```

The future ledger should support promotional grants, plan allowances, BYOK, hard spending caps, per-provider pricing snapshots and reconciliation of failed/unknown outcomes.

## 10. Security model

| Threat | Control |
|---|---|
| Cross-tenant access | Scoped website lookup plus reauthorization inside every write transaction. |
| Stale overwrite | Document ETag and version check before and after external I/O. |
| Duplicate mutation | Idempotency journal keyed by organization, actor, operation and request key. |
| Provider timeout after success | External outcome reconciliation; never blindly repeat an uncertain write. |
| SSRF | Fixed Figma API origin; Stitch exports restricted to approved Google hosts. |
| Oversized provider response | Streamed byte limit, bounded JSON and canonical document budget. |
| Malicious node structure | Plain JSON admission, max depth, max node count and supported native vocabulary. |
| Secret disclosure | Secret references only; tokens excluded from responses, logs, audit and changesets. |
| CMS data loss | Merge-only automation; field type conflicts block; no automated delete. |
| AI fabrication | Industry briefs explicitly identify claims requiring source data; no fabricated evidence. |

## 11. Reliability and observability

Initial objectives:

- Capability endpoint p95 below 400 ms excluding cold database startup.
- CMS preview p95 below 1 s for the supported 200-field/200-item budget.
- Figma preview hard timeout 20 s and response maximum 8 MiB.
- Changeset creation is atomic after remote conversion.
- No unbounded retry of external provider operations.
- Every write has actor, tenant, operation, resource, request hash and outbox event.

Metrics to add:

- `design_platform_requests_total{operation,outcome}`
- `figma_import_bytes`, `figma_import_nodes`, `figma_import_warnings`
- `cms_blueprint_actions{kind}` and `cms_blueprint_conflicts_total`
- `ai_reserved_units{workspace,provider}`
- changeset approval, rejection, stale-conflict and time-to-apply rates
- conversion fidelity feedback by source layer type

## 12. Delivery roadmap

### Phase 0 — governed foundation (implemented in this branch)

- Curated industry AI template manifests.
- Unified capability and starter-usage API.
- Governed Figma read/import path.
- Native append-page Figma changesets.
- Merge-only typed CMS blueprints.
- UI workspace integrated with the existing AI assistant.
- Contract tests and CI qualification.

### Phase 1 — native dynamic site system

- Collection/dynamic page templates.
- Visual data bindings and conditional visibility.
- references, date, option, file and locale-aware fields.
- staged/live CMS semantics and scheduled publishing.
- template manifest signing/versioning and marketplace review.

### Phase 2 — design-system round trip

- Figma OAuth installer, variable modes and aliases.
- component/variant/property import.
- Code Connect and Dev Resource links.
- separately authorized Forge-to-Figma write-back.
- Stitch SDK upgrade qualification for edits, variants, screenshots and project design systems.

### Phase 3 — collaboration and interaction engine

- CRDT presence and operation log.
- branch/merge/review lifecycle.
- native timeline and GSAP-capable interaction graph.
- reusable components with slots, variants and protected properties.

### Phase 4 — enterprise runtime

- localization workflows and translation review.
- commerce catalog/cart/checkout/order APIs.
- analytics, experimentation and AI optimization governance.
- enterprise SSO/SCIM, policy packs, data residency and audit export.
- multi-region publishing, release promotion and disaster recovery.

## 13. Definition of “Webflow-class” for Forge

Forge should not claim parity from a long feature checklist. A capability is complete only when it has:

1. Native editor UX.
2. Backend contract and persistence.
3. tenant authorization and audit.
4. versioning/recovery semantics.
5. failure handling and reconciliation.
6. accessibility and responsive behavior.
7. API/automation support.
8. production qualification and observability.

The parity matrix in `webflow-parity-matrix-2026.md` applies this definition area by area.
