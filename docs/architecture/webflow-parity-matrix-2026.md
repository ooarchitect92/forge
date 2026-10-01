# Forge capability matrix — October 2026

This matrix separates verified implementation from architectural intent. “Foundation” means a safe contract exists; it does not mean complete product parity.

| Capability area | Existing Forge baseline | Added in this branch | Remaining qualification for Webflow-class maturity |
|---|---|---|---|
| Visual canvas | Native pages/elements, responsive styles, preview and document history | Figma layers compile to the same native vocabulary | richer grid/absolute layout fidelity, accessibility tooling, design lint, full component slot/variant authoring |
| Prompt-to-site | Claude planning + Stitch generation + native converter + reviewable changeset | surfaced through unified capability/usage workspace and industry briefs | multi-provider routing, design-system-aware generation, provider reconciliation dashboard, evaluation corpus |
| AI templates | user templates and sample prompts | versioned industry manifests with page plan + CMS blueprint | signed marketplace packages, visual thumbnails, ratings/review, dependency/version migration, localization packs |
| Google Stitch | pinned SDK generation and HTML retrieval | explicit capability reporting and truthful advanced-feature flags | qualify pinned upgrade for edits, variants, screenshots and project design systems; visual regression tests |
| Figma | no first-class runtime integration | governed read connector, file/node preview, component/style inventory, native append-page proposal | OAuth lifecycle, variables/modes/aliases, component variants, Code Connect, webhooks, write-back, higher-fidelity assets/layout |
| CMS schema | basic custom post types, fields and entries | strict versioned blueprint, diff preview, merge-only transactional apply, typed seed validation | references, dates/options/files, migration engine, schema versions, API pagination and bulk operations |
| Dynamic pages | partial/basic layouts | architecture contract only | native collection page templates, bindings, filters, sorting, pagination, conditional visibility and empty/error states |
| Staged/live content | partial publication models | no false parity claim | staged/live item APIs, scheduling, release snapshots, locale-aware publication and rollback |
| Localization | planned/partial | architecture and data-boundary definition | locale routes, field variants, fallback, hreflang, translation review, provider integrations |
| Components/design systems | design tokens and component access foundations | Figma inventory and target canonical model | token aliases/modes, variants, slots, protected properties, cross-site libraries and update governance |
| Interactions/animation | partial/basic | architecture contract only | native timeline, scroll/mouse/state triggers, GSAP execution boundary, accessibility/reduced-motion qualification |
| Collaboration | collaborators, notes, approvals foundations | branch/CRDT target architecture | presence, operations log, branches, conflict-aware merges, protected production workflow |
| Forms | existing form routes/submissions | no change | visual logic, spam/rate protection, workflow actions, file uploads, locale and data-retention controls |
| Commerce | existing commerce foundations | no change | production catalog variants/inventory/tax/shipping/checkout/order/refund/provider verification |
| Analytics/experiments | metrics and experiment foundations | release-oriented target architecture | first-party event model, consent, attribution, experiment statistics, optimization governance |
| Publishing/hosting | staging, deployment and export foundations | provider changes remain proposals; no publish shortcut | immutable release manifest, multi-environment promotion, domain/DNS automation, edge rollback and SLO qualification |
| Code components | custom code/export foundations | design IR boundary defined | sandbox, package allowlist, secret/data capabilities, build provenance, DevLink/Code Connect workflow |
| API/agents | broad REST surface and AI routes | design-platform API for templates/Figma/CMS/capabilities | stable public schemas, SDKs, webhooks, MCP/agent permissions, service accounts and granular rate plans |
| Security/governance | tenant scope, command journal, audit/outbox, secret refs | same controls reused for Figma and CMS; remote inputs bounded | provider OAuth governance, policy packs, DLP, enterprise audit export, data residency and penetration qualification |

## Claim policy

Marketing and README language must use one of these states:

- **Production:** backed by persistence, authorization, recovery, tests and operational evidence.
- **Beta:** end-to-end but still under explicit limits with known gaps.
- **Foundation:** safe internal/API contract exists; UX or runtime breadth is incomplete.
- **Planned:** architecture only; no customer-facing promise.

No capability should be described as “complete parity” solely because an endpoint or UI placeholder exists.
