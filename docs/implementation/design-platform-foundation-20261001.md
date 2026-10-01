# Design Platform foundation — implementation record

## Delivered

This change introduces a production-oriented first slice for AI templates, Figma interoperability and CMS generation while preserving the existing Stitch/Claude approval flow.

### Backend

- `modules/design-platform/contracts.ts`
  - strict Figma import and CMS blueprint schemas
  - bounded collection/field/item budgets
  - uniqueness and typed seed-item validation
- `modules/design-platform/template-catalog.ts`
  - curated education, SaaS, care-services and professional-practice manifests
  - each manifest contains a grounded AI brief, page plan and CMS blueprint
- `modules/design-platform/figma-client.ts`
  - figma.com URL/key parsing and node-ID normalization
  - website-scoped connector secret resolution
  - fixed `api.figma.com` origin, no redirects, timeout and 8 MiB response limit
  - development-only `FIGMA_ACCESS_TOKEN` fallback
- `modules/design-platform/figma-compiler.ts`
  - frame/component/group to native container
  - auto layout to responsive flex metadata
  - text to editable heading/text
  - image/vector layers to explicit native placeholders and warnings
  - append-page document merge without altering the current home page
- `modules/design-platform/figma-import.ts`
  - read-only preview
  - Figma proposal creation as an existing `AiExecution` + `AiChangeset`
  - pre- and post-network authorization/version checks
  - no raw provider payload or token persistence
- `modules/design-platform/cms-blueprint.ts`
  - diff preview with create/update/keep/type-conflict actions
  - serializable, idempotent, audited, outbox-backed apply
  - merge-only collection/field/item behavior
- `modules/design-platform/capabilities.ts`
  - single provider/CMS/template capability response
  - internal starter-unit disclosure separated from vendor quota/billing
- `routes/design-platform.routes.ts`
  - authenticated API surface and Figma rate limiting
- `routes/ai.routes.ts`
  - mounts the platform below the existing `/api[/v1]/ai` boundary

### Frontend

- `features/ai/DesignPlatformWorkspace.tsx`
  - capability and usage cards
  - AI industry template selection
  - Figma preview and native proposal creation
  - CMS blueprint preview and merge-only apply
- `features/ai/AiSiteAssistant.tsx`
  - launches the Design Platform workspace
  - loads selected template briefs into the existing AI prompt
  - receives Figma changesets into the existing review/apply UX

### Qualification

- `design-platform-figma.test.ts`
  - URL/key parsing, node normalization, native compilation, home preservation and secret image-ref exclusion
- `design-platform-cms.test.ts`
  - typed values, duplicates, conflict rejection and template validity
- CI compiles the backend before running these pure contract tests and lints the new UI.

## API examples

### Register a Figma connector

Use the existing organization connector endpoint with provider `figma`, website scope and a secret-manager reference. The resolved secret may be a raw personal access token or JSON such as:

```json
{
  "authType": "oauth",
  "accessToken": "resolved-by-secret-manager"
}
```

The token value itself must not be sent as `secretRef`.

### Preview a Figma selection

```http
POST /api/v1/ai/design-platform/websites/{websiteId}/figma/preview
Content-Type: application/json

{
  "source": "https://www.figma.com/design/{fileKey}/Name?node-id=12-34",
  "depth": 6
}
```

### Create a reviewable Figma changeset

```http
POST /api/v1/ai/design-platform/websites/{websiteId}/figma/changesets
X-Forge-Intent: document-command
Idempotency-Key: 3f08a369-4be9-4238-b6a9-5e8850c9880a
If-Match: "{websiteId}:document:{version}"
Content-Type: application/json

{
  "source": "{fileKey}",
  "nodeIds": ["12:34"],
  "depth": 6
}
```

The response contains `executionId` and `changesetId`. Review/apply uses the existing AI changeset endpoints.

### Preview and apply a CMS blueprint

Preview is read-only:

```http
POST /api/v1/ai/design-platform/websites/{websiteId}/cms/blueprints/preview
Content-Type: application/json

{ "version": 1, "name": "...", "collections": [ ... ] }
```

Apply requires explicit command intent and idempotency:

```http
POST /api/v1/ai/design-platform/websites/{websiteId}/cms/blueprints/apply
X-Forge-Intent: document-command
Idempotency-Key: 46b0dbd8-ef65-45a5-bec1-b066ce74aacb
Content-Type: application/json

{ "version": 1, "name": "...", "collections": [ ... ] }
```

## Environment

```dotenv
# Local development fallback only; ignored in production.
FIGMA_ACCESS_TOKEN=
FIGMA_API_TIMEOUT_MS=20000
```

Production should use a website-scoped `figma` connector and an AWS Secrets Manager reference supported by the existing secret provider.

## Deliberate limits

- Figma import is read-only and append-page only.
- Remote Figma images are not copied automatically; placeholders require media review.
- Free-positioned Figma layers may become responsive stacks.
- Figma variables, variants, Code Connect and write-back are not yet enabled.
- CMS field deletion and type conversion are blocked.
- CMS reference/date/option/file fields and dynamic page bindings remain Phase 1.
- Existing Stitch SDK remains pinned; advanced screen edit/variant/design-system methods are not enabled until adapter qualification.
- Forge starter units are internal admission controls, not free third-party credits.

## Rollback

The new routes are isolated under `/ai/design-platform`. Rolling back the branch removes the surface without changing database schema. CMS changes already approved by a user are ordinary existing CMS rows and are intentionally not auto-deleted. Figma proposals are normal pending changesets and can be discarded through the existing flow.
