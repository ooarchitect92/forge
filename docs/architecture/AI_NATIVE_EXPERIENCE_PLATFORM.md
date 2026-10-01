# ForgeStudio — AI-Native Experience Platform Target Architecture

Status: architecture baseline for implementation
Branch: `architecture/ai-native-experience-platform`
Date: 2026-10-02

## 1. Product direction

ForgeStudio should evolve from a visual website builder into an AI-native experience platform that combines:

- Webflow-class visual site building and publishing
- native structured CMS and dynamic content binding
- Google Stitch-driven generative design and rapid exploration
- Figma round-trip design, design-system sync, component mapping and handoff
- multi-model AI orchestration with governance, budgets and provider failover
- localization, SEO/AEO, analytics, experimentation and personalization
- collaboration, approvals, agency workflows and reusable libraries
- developer APIs, SDKs, MCP/agent actions and safe automation
- modular deployment modes: local/native, Docker Compose and production cloud

The key architectural rule is that every workflow writes to the same canonical, versioned site model rather than creating disconnected "AI", "CMS", "Figma" or "publish" representations.

## 2. Existing Forge foundation to preserve

The current repository already provides useful production foundations and should be extended instead of replaced:

- React/Vite visual editor
- Node/TypeScript backend
- PostgreSQL + Prisma
- tenant/workspace/organization authorization boundaries
- website document versions, revisions and conflict-aware saves
- durable AI execution records and changesets
- Google Stitch integration through `@google/stitch-sdk`
- Claude-based planning/repair workflow
- custom post types, custom fields and content entries
- forms, media, custom code, static/SFTP/WordPress publishing
- collaboration/presence foundations
- capability registry and operational hardening
- Docker and native startup paths

## 3. Current gaps that this architecture closes

### AI design
- AI edits are limited mainly to text/style mutation.
- insertion, deletion, reorder, responsive restructuring and shared-component edits need typed commands.
- images/SVG/richer content, mobile-specific Stitch screens and full visual parity are incomplete.
- provider usage is reserved in abstract units rather than reconciled against actual cost.
- provider reconciliation, artifact lifecycle and distributed circuit-breaker controls remain incomplete.

### CMS
- backend custom post types exist, but AI generation is not yet orchestrated with CMS creation.
- editor loop widgets still use sample CMS data paths in places.
- CMS templates, field bindings, references, locale variants, scheduling and preview need a unified domain model.
- content editor permissions and content workflows need to become first-class.

### Figma
- no production Figma integration layer exists today.
- no file/node mapping, variables/tokens sync, component binding, Code Connect metadata or round-trip synchronization exists.
- Figma should be an editable design surface connected to the Forge design system, not a one-way screenshot export.

### Localization / experimentation / optimization
- localization is not a first-class capability in the current repo.
- experiment variants, targeting, personalization and measurement need canonical models.
- SEO/AEO should operate as analyzers and changesets, not direct uncontrolled edits.

## 4. Target logical architecture

```text
Browser / Desktop / SDK / Agents
        |
        v
API Gateway + BFF + Realtime Gateway
        |
        +-----------------------------+
        |                             |
        v                             v
Identity / Authorization        Site Command Bus
                                      |
                                      +--> Document Service
                                      +--> CMS Service
                                      +--> Asset Service
                                      +--> Design System Service
                                      +--> Localization Service
                                      +--> Collaboration Service
                                      +--> Experiment Service
                                      +--> Publishing Service
                                      +--> AI Orchestrator
                                      +--> Integration Service
                                      |
                                      v
                              Durable Job/Event Layer
                                      |
          +---------------------------+-----------------------------+
          |                           |                             |
          v                           v                             v
     Google Stitch                 Figma                    AI model providers
     generation/MCP             REST/Plugin/MCP          OpenAI/Anthropic/Gemini
          |
          v
 Design Proposal / Design Patch / Component Proposal
          |
          v
 Versioned Changeset -> Review -> Apply -> Revision -> Publish
```

## 5. Canonical site model

The current `Website.editorData` should gradually become a strict, versioned document contract.

Recommended top-level shape:

```ts
type SiteDocument = {
  schemaVersion: number;
  site: SiteSettings;
  pages: PageNode[];
  components: ComponentDefinition[];
  styles: StyleRule[];
  tokens: DesignTokenSet;
  assets: AssetReference[];
  cmsBindings: CmsBinding[];
  interactions: InteractionDefinition[];
  forms: FormDefinition[];
  locales: LocaleOverlay[];
  experiments: ExperimentBinding[];
  integrations: IntegrationBinding[];
};
```

No external system should become the source of truth for Forge. Stitch and Figma produce proposals/mappings. Publishing compiles the canonical document. CMS provides typed data into bindings.

## 6. Command model

All editor, AI and integration edits should become typed commands.

Examples:

- `element.insert`
- `element.delete`
- `element.move`
- `element.wrap`
- `element.setText`
- `element.setStyle`
- `element.bindCmsField`
- `page.create`
- `page.reorder`
- `component.extract`
- `component.update`
- `token.set`
- `asset.attach`
- `cms.collection.create`
- `cms.field.create`
- `cms.item.create`
- `locale.translate`
- `experiment.createVariant`
- `publish.request`

Commands must contain actor, tenant/workspace/site scope, idempotency key, expected document/resource version and audit metadata.

## 7. AI orchestration architecture

Introduce an AI provider router rather than coupling workflows directly to a single provider.

### Core interfaces

```ts
interface AiCapability {
  id: string;
  task: "plan" | "design" | "copy" | "code" | "image" | "translate" | "analyze";
  inputSchema: unknown;
  outputSchema: unknown;
}

interface AiProviderAdapter {
  provider: string;
  supports(capability: AiCapability): boolean;
  estimate(input: unknown): Promise<UsageEstimate>;
  execute(input: unknown, ctx: ExecutionContext): Promise<ProviderResult>;
}
```

### Router responsibilities

- capability-based provider selection
- workspace/provider allowlists
- model policy and pinned model versions
- per-request budget reservation
- actual-cost reconciliation
- retries only for safe/idempotent states
- circuit breakers
- audit records
- redaction/prompt privacy
- latency/quality telemetry
- optional customer-managed provider keys

### Recommended task routing

- site planning / structured reasoning: Claude or GPT-class reasoning model
- Stitch generation: Google Stitch / Gemini-backed design generation
- copy/content transforms: fast low-cost model tier
- code components: strong coding model
- translation/localization: translation-optimized model or provider
- image generation: pluggable image provider
- visual QA: multimodal model + deterministic screenshot diff

Provider names and models must be configuration, not business logic.

## 8. Google Stitch integration

Keep the existing Stitch adapter, but elevate it into a complete `DesignProvider` implementation.

Required features:

1. project lifecycle
2. page/screen generation
3. desktop/tablet/mobile variants
4. prompt + image/wireframe context
5. DESIGN.md import/export
6. design-system extraction from a URL or Forge tokens
7. screen iteration and variant generation
8. HTML/CSS/code export ingestion
9. artifact and screenshot retention
10. deterministic conversion into Forge native elements
11. pixel-diff qualification at target breakpoints
12. resumable checkpoints and operator reconciliation
13. optional Stitch MCP/SDK path when available

A Stitch result never writes directly to the live document. It produces a versioned proposal that the user can review and apply.

## 9. Figma integration

Create a new backend module:

```text
backend/src/modules/integrations/figma/
  figma.client.ts
  figma.oauth.ts
  figma.sync.service.ts
  figma.mapping.service.ts
  figma.webhooks.ts
  figma.import.ts
  figma.export.ts
  figma.tokens.ts
  figma.components.ts
```

### Capabilities

- connect Figma account through OAuth
- browse permitted teams/projects/files
- import selected frames/pages
- export Forge pages/components into an existing Figma file
- maintain `ForgeNode <-> FigmaNode` mappings
- synchronize variables/design tokens
- synchronize component names/variants/properties
- generate Code Connect metadata for mapped code components
- preserve links to the originating Forge revision
- detect drift in either direction
- show an explicit diff before applying a sync
- support one-way modes (Forge -> Figma, Figma -> Forge) and reviewed two-way sync
- store remote IDs, hashes and last synchronized versions

### New models

- `FigmaConnection`
- `FigmaFileMapping`
- `FigmaNodeMapping`
- `FigmaTokenMapping`
- `FigmaComponentMapping`
- `FigmaSyncRun`
- `FigmaSyncConflict`

Secrets must use the platform credential vault, never browser storage.

## 10. Native CMS 2.0

Use the existing CustomPostType/CustomField/CustomEntry foundation as a migration source, but expose a neutral product model called Collections.

### Core concepts

- Collection
- Field
- Item
- Reference / Multi-reference
- Asset
- Rich text
- Slug
- Status: draft/scheduled/published/archived
- Locale value overlay
- Editor permissions
- validation rules
- computed fields
- API access
- bulk import/export

### Dynamic editor binding

Every editor element property should support either:

- static value
- component prop
- page variable
- CMS binding
- locale override
- experiment override

Dynamic collections must render identically in:
- visual canvas
- preview
- published runtime
- static compiler where supported

## 11. AI-generated CMS

The AI site builder must be able to propose:

- collections and schemas
- content relationships
- collection templates
- navigation derived from content
- initial draft items
- SEO metadata
- image requirements
- content governance rules

CMS creation must be a separate resource changeset from visual-document changes so the user can review data-model changes before applying them.

## 12. Figma + Stitch + Forge design loop

Preferred experience:

```text
Prompt / Brand brief
      |
      v
AI planner
      |
      +--> Forge token proposal
      +--> Stitch exploration
      +--> optional reference URLs/images
      |
      v
Forge visual proposal
      |
      +--> Apply to Forge
      +--> Send to Figma
      +--> Create alternate Stitch directions
      |
      v
Figma refinement
      |
      v
Reviewed sync diff
      |
      v
Forge component/token/page update
```

This creates a differentiated product: AI exploration can happen in Stitch, professional refinement can happen in Figma, and production remains governed by Forge.

## 13. AI credits and free-token model

Do not directly expose provider tokens. Use an internal credit wallet.

Models:

- `AiCreditAccount`
- `AiCreditGrant`
- `AiCreditReservation`
- `AiCreditUsage`
- `AiProviderCost`
- `AiCreditPolicy`

Rules:

- free monthly grant per eligible workspace
- optional onboarding grant
- credit cost varies by capability, not raw provider token count
- reserve before execution, reconcile after provider response
- refund unused reservation
- hard spend limit per workspace
- optional BYOK mode where users pay provider directly
- abuse/rate controls
- transparent usage dashboard
- no silent negative balances

Existing `OptimizationCreditLedger` can remain for optimization operations but should not be overloaded as the universal AI accounting system.

## 14. Template platform

Templates should become first-class versioned packages:

```text
TemplatePackage
  manifest
  site document fragment
  required collections
  sample content
  tokens/theme
  components
  interactions
  assets/licenses
  required capabilities
  migration version
```

Add:

- template marketplace
- private workspace templates
- team libraries
- AI-created templates
- remix/fork lineage
- template updates with safe diff
- industry starter kits
- CMS-backed templates
- localized variants

## 15. Design system platform

Add a formal design-system domain:

- tokens: color, spacing, radius, typography, shadow, motion
- themes and modes
- shared components
- variants and component properties
- component slots
- style inheritance
- accessibility constraints
- design linting
- token aliases
- Figma variable mappings
- DESIGN.md export/import

The editor must consume tokens rather than copying raw values whenever possible.

## 16. Interactions and motion

Support a reusable interaction graph:

- trigger: load, scroll, click, hover, viewport, CMS state
- timeline
- target selector
- easing
- GSAP-compatible compiler
- reduced-motion fallback
- reusable interaction presets
- AI-generated interaction proposal with preview

## 17. Localization

Add first-class localization models:

- `Locale`
- `SiteLocale`
- `LocalizedValue`
- `LocalizedAsset`
- `LocalizedRoute`
- `TranslationJob`

Support:

- locale inheritance
- translated CMS values
- localized slugs
- localized assets
- per-locale visibility
- hreflang generation
- fallback locale rules
- machine translation proposal + human review
- glossary/brand terms
- translation memory

## 18. SEO / AEO / GEO

Create analyzer and changeset workflows:

- technical SEO audit
- metadata suggestions
- Open Graph
- structured data/schema
- sitemap
- robots controls
- canonical URLs
- alt text
- heading hierarchy
- internal-link suggestions
- AEO content structure
- sitewide issues dashboard

AI suggestions should be reviewable changesets rather than immediate mutations.

## 19. Experimentation and personalization

Models:

- `Experiment`
- `ExperimentVariant`
- `Audience`
- `Assignment`
- `ConversionEvent`

Capabilities:

- visual variant creation
- AI-generated copy/design alternatives
- deterministic visitor assignment
- server/edge targeting where supported
- client fallback
- conversion goals
- confidence reporting
- variant winner application as an explicit user action

## 20. Collaboration

Expand current presence/notes foundation to:

- multiplayer cursors
- selection presence
- comments/threads
- mentions
- role-aware edit access
- page/component locks where necessary
- approval workflows
- publishing approvals
- content approvals
- activity history
- branch/merge for large site changes

Do not rely on in-memory presence for horizontally scaled production. Introduce a shared realtime backplane when multi-instance deployment is enabled.

## 21. Publishing platform

Publishing should become adapter based.

```ts
interface Publisher {
  validate(target: DeploymentTarget): Promise<ValidationResult>;
  stage(input: CompiledSite): Promise<StageResult>;
  publish(stage: StageResult): Promise<PublishResult>;
  verify(result: PublishResult): Promise<VerificationResult>;
  rollback(revision: DeploymentRevision): Promise<RollbackResult>;
}
```

Targets:

- Forge managed hosting
- static ZIP
- SFTP
- WordPress
- object storage/CDN
- future Cloudflare/Vercel/Netlify adapters

Every publish creates an immutable deployment revision and post-publish verification record.

## 22. Developer and agent platform

Add:

- stable API v1/v2
- typed TypeScript SDK
- webhooks
- service accounts
- scoped API keys
- automation recipes
- MCP server
- agent-safe actions
- dry-run mode
- explicit approval gates for destructive/publishing operations

Agents should call the same command layer as the UI.

## 23. Security architecture

Mandatory:

- organization/workspace/site authorization on every resource lookup
- PostgreSQL RLS for tenant-owned tables
- server-side secrets only
- encrypted integration credential vault
- OAuth PKCE where applicable
- signed webhook verification
- SSRF/egress policy for URL-based imports
- asset scanning/quarantine
- HTML/code sandboxing
- CSP and published-site isolation
- audit records for AI/provider/integration actions
- retention and deletion policies
- rate limits and abuse protection
- idempotency for side effects
- provider timeout + circuit-breaker policies
- dependency and container scanning in CI

## 24. Deployment profiles

Forge must remain easy to run with different infrastructure levels.

### Profile T0 — native developer
- Node.js processes
- PostgreSQL
- local filesystem artifacts
- optional local Redis replacement disabled

### Profile T1 — Docker Compose
- frontend
- API
- worker
- PostgreSQL
- optional Redis
- optional S3-compatible object store

### Profile T2 — production single-region
- managed PostgreSQL
- object storage
- shared Redis
- durable queue
- autoscaled API/workers
- CDN/WAF

### Profile T3 — enterprise
- multi-region read strategy
- tenant-specific controls
- SSO/SCIM
- audit export
- private networking
- customer-managed keys where required

Infrastructure features must degrade through the capability registry, not by code edits.

## 25. Frontend information architecture

Primary navigation:

- Home
- Sites
- CMS
- Assets
- Templates
- Libraries
- AI Studio
- Experiments
- Analytics
- Integrations
- Team
- Developer
- Settings

Editor shell:

- left: Pages / Navigator / Add / Components / CMS / Assets
- center: canvas
- right: Style / Layout / Content / Bindings / Interactions / Accessibility
- top: breakpoint / locale / branch / preview / AI / share / publish
- bottom: AI execution status / validation / console

## 26. Recommended implementation sequence

### Phase A — canonical document and command expansion
- typed insert/delete/move/component/token commands
- schema versioning
- migration framework
- command tests

### Phase B — CMS binding completion
- connect real collections to Loop Grid
- template pages
- field bindings
- content workflows
- AI CMS changesets

### Phase C — design system
- tokens
- components/variants/slots
- DESIGN.md
- Figma-ready mapping layer

### Phase D — Figma integration
- OAuth
- file import/export
- node/token/component mappings
- reviewed sync

### Phase E — Stitch parity
- mobile/tablet screen generation
- media
- richer conversion
- visual diffs
- provider reconciliation

### Phase F — AI platform
- provider router
- credit accounting
- usage dashboard
- policies/circuit breakers
- BYOK

### Phase G — localization + SEO/AEO
- locale overlays
- translation jobs
- localized routes
- SEO/AEO audit changesets

### Phase H — experiments + analytics
- variants
- targeting
- conversion events
- personalization

### Phase I — collaboration + approvals
- shared realtime backplane
- branches
- approvals
- audit UX

### Phase J — publishing/cloud hardening
- managed hosting adapter
- verification/rollback
- production IaC
- load/chaos/security qualification

## 27. Acceptance gates

A feature is not "complete" because a screen exists. Each major capability requires:

1. schema and migrations
2. authorization/tenant isolation
3. backend service
4. API contract
5. frontend flow
6. durable failure/retry behavior
7. audit events
8. automated tests
9. browser/E2E qualification
10. observability
11. rollback or recovery path
12. documentation

## 28. Differentiators

The intended differentiation is not "Webflow copied into Forge."

Forge can be meaningfully different by combining:

- multi-surface design loop: Forge + Stitch + Figma
- canonical production document shared by AI, CMS and visual editing
- governed AI changesets rather than opaque direct mutation
- provider-neutral AI orchestration
- AI credit wallet + BYOK
- design-system round trip through Figma variables/components and DESIGN.md
- CMS schema generation from the same site brief
- agent/MCP automation using the same permissioned command layer
- infrastructure profiles that can scale up or down without rewriting the product

## 29. Immediate code backlog

First implementation PRs should target:

1. canonical command expansion for structural element operations
2. real CMS bindings in Loop Grid
3. formal design-token domain
4. `backend/src/modules/integrations/figma` foundation
5. AI credit account/reservation/usage schema
6. provider-router abstraction
7. Stitch multi-breakpoint generation contract
8. localization domain models
9. visual regression harness at 320/390/768/1440
10. architecture/API documentation updates

