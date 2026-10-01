import type { Prisma } from "../../generated/prisma/index.js";
import { AppError } from "../../utils/app-error.js";
import type { WorkspaceTransaction } from "../workspaces/access.js";
import { legacyWebsiteToSiteDocument, siteDocumentToLegacy, type LegacyCmsType } from "../../domain/site-document-legacy.js";
import { validateSiteDocument, type SiteDocument } from "../../domain/site-document.js";

type WebsiteLike = {
  id: string; name: string; slug: string; editorData: unknown; documentVersion: number;
  organizationId: string | null; workspaceId: string | null;
};

export async function setSiteDocumentTenant(tx: WorkspaceTransaction, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${organizationId}, true)`;
}

async function legacyCms(tx: WorkspaceTransaction, websiteId: string): Promise<LegacyCmsType[]> {
  const rows = await tx.customPostType.findMany({
    where: { websiteId },
    include: { fields: { orderBy: { order: "asc" } }, entries: { orderBy: { updatedAt: "desc" }, take: 5000 } },
    take: 2000,
  });
  return rows.map(row => ({
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    fields: row.fields.map(field => ({ id: field.id, name: field.name, slug: field.slug, type: field.type, config: field.config })),
    entries: row.entries.map(entry => ({ id: entry.id, title: entry.title, slug: entry.slug, status: entry.status, data: entry.data })),
  }));
}

export async function siteDocumentFromLegacy(tx: WorkspaceTransaction, website: WebsiteLike): Promise<SiteDocument> {
  return legacyWebsiteToSiteDocument({
    websiteId: website.id,
    name: website.name,
    slug: website.slug,
    editorData: typeof website.editorData === "string" ? JSON.parse(website.editorData) : website.editorData,
    cmsTypes: await legacyCms(tx, website.id),
  });
}

function mergeLegacyVisualState(existing: SiteDocument, fromLegacy: SiteDocument): SiteDocument {
  const importedTokenIds = new Set(fromLegacy.tokens.map(token => token.id));
  return validateSiteDocument({
    ...existing,
    site: fromLegacy.site,
    pages: fromLegacy.pages,
    tokens: [
      ...existing.tokens.filter(token => token.source !== "import" && !importedTokenIds.has(token.id)),
      ...fromLegacy.tokens,
    ],
    extensions: { ...existing.extensions, ...fromLegacy.extensions },
  });
}

export async function ensureSiteDocumentState(tx: WorkspaceTransaction, website: WebsiteLike, actorId?: string | null): Promise<{ document: SiteDocument; revision: number; created: boolean }> {
  if (!website.organizationId) throw new AppError("Website ownership migration is required before SiteDocument use", 503, "TENANT_MIGRATION_REQUIRED");
  await setSiteDocumentTenant(tx, website.organizationId);
  const existing = await tx.siteDocumentState.findUnique({ where: { websiteId: website.id } });
  if (existing) return { document: validateSiteDocument(existing.document), revision: existing.revision, created: false };

  const document = await siteDocumentFromLegacy(tx, website);
  await tx.siteDocumentState.create({ data: {
    websiteId: website.id, organizationId: website.organizationId, workspaceId: website.workspaceId,
    schemaVersion: document.schemaVersion, revision: website.documentVersion,
    document: document as Prisma.InputJsonValue, updatedBy: actorId ?? null,
  } });
  await tx.siteDocumentRevision.create({ data: {
    websiteId: website.id, organizationId: website.organizationId, workspaceId: website.workspaceId,
    revision: website.documentVersion, schemaVersion: document.schemaVersion,
    document: document as Prisma.InputJsonValue, commands: [] as Prisma.InputJsonValue,
    source: "MIGRATION", actorId: actorId ?? null,
  } });
  await syncCmsProjection(tx, website, document, actorId ?? null);
  return { document, revision: website.documentVersion, created: true };
}

export async function syncCmsProjection(tx: WorkspaceTransaction, website: Pick<WebsiteLike, "id"|"organizationId"|"workspaceId">, document: SiteDocument, actorId?: string | null): Promise<void> {
  if (!website.organizationId) return;
  await tx.cmsBindingV2.deleteMany({ where: { websiteId: website.id } });
  await tx.cmsItemV2.deleteMany({ where: { websiteId: website.id } });
  await tx.cmsFieldV2.deleteMany({ where: { websiteId: website.id } });
  await tx.cmsCollectionV2.deleteMany({ where: { websiteId: website.id } });

  if (document.cms.collections.length) await tx.cmsCollectionV2.createMany({ data: document.cms.collections.map(collection => ({
    id: collection.id, websiteId: website.id, organizationId: website.organizationId!, workspaceId: website.workspaceId,
    name: collection.name, slug: collection.slug, description: collection.description ?? null,
  }))});
  const fields = document.cms.collections.flatMap(collection => collection.fields.map((field, position) => ({
    id: field.id, collectionId: collection.id, organizationId: website.organizationId!, websiteId: website.id,
    key: field.key, name: field.name, type: field.type, required: field.required, position,
    config: field.config as Prisma.InputJsonValue,
  })));
  if (fields.length) await tx.cmsFieldV2.createMany({ data: fields });
  if (document.cms.items.length) await tx.cmsItemV2.createMany({ data: document.cms.items.map(item => ({
    id: item.id, collectionId: item.collectionId, organizationId: website.organizationId!, websiteId: website.id,
    title: item.title ?? null, slug: item.slug ?? null, status: item.status,
    data: item.values as Prisma.InputJsonValue, actorId: actorId ?? null,
  }))});
  if (document.cms.bindings.length) await tx.cmsBindingV2.createMany({ data: document.cms.bindings.map(binding => ({
    id: binding.id, websiteId: website.id, organizationId: website.organizationId!, workspaceId: website.workspaceId,
    elementId: binding.elementId, property: binding.property, collectionId: binding.collectionId, fieldId: binding.fieldId,
  }))});
}

export async function syncSiteDocumentAfterLegacySave(tx: WorkspaceTransaction, website: WebsiteLike, actorId: string): Promise<void> {
  if (!website.organizationId) return;
  await setSiteDocumentTenant(tx, website.organizationId);
  const state = await tx.siteDocumentState.findUnique({ where: { websiteId: website.id } });
  if (!state) return;

  const current = validateSiteDocument(state.document);
  const converted = await siteDocumentFromLegacy(tx, website);
  const document = mergeLegacyVisualState(current, converted);
  await tx.siteDocumentState.update({ where: { websiteId: website.id }, data: {
    schemaVersion: document.schemaVersion, revision: website.documentVersion,
    document: document as Prisma.InputJsonValue, updatedBy: actorId,
  }});
  await tx.siteDocumentRevision.upsert({
    where: { websiteId_revision: { websiteId: website.id, revision: website.documentVersion } },
    update: { document: document as Prisma.InputJsonValue, schemaVersion: document.schemaVersion, commands: [{ type: "legacy.sync" }] as Prisma.InputJsonValue, source: "LEGACY_SAVE", actorId },
    create: {
      websiteId: website.id, organizationId: website.organizationId, workspaceId: website.workspaceId,
      revision: website.documentVersion, schemaVersion: document.schemaVersion,
      document: document as Prisma.InputJsonValue, commands: [{ type: "legacy.sync" }] as Prisma.InputJsonValue,
      source: "LEGACY_SAVE", actorId,
    },
  });
  await syncCmsProjection(tx, website, document, actorId);
}

export function legacyMirror(document: SiteDocument): Prisma.InputJsonValue {
  return siteDocumentToLegacy(document) as Prisma.InputJsonValue;
}


export async function persistCanonicalSiteDocumentRevision(
  tx: WorkspaceTransaction,
  website: Pick<WebsiteLike, "id"|"organizationId"|"workspaceId"|"documentVersion">,
  documentInput: SiteDocument,
  actorId: string | null,
  commands: Array<{ type: string; [key: string]: unknown }>,
  source: string,
): Promise<void> {
  if (!website.organizationId) return;
  const document = validateSiteDocument(documentInput);
  await setSiteDocumentTenant(tx, website.organizationId);
  await tx.siteDocumentState.upsert({
    where: { websiteId: website.id },
    update: { schemaVersion: document.schemaVersion, revision: website.documentVersion, document: document as Prisma.InputJsonValue, updatedBy: actorId },
    create: {
      websiteId: website.id, organizationId: website.organizationId, workspaceId: website.workspaceId,
      schemaVersion: document.schemaVersion, revision: website.documentVersion,
      document: document as Prisma.InputJsonValue, updatedBy: actorId,
    },
  });
  await tx.siteDocumentRevision.upsert({
    where: { websiteId_revision: { websiteId: website.id, revision: website.documentVersion } },
    update: { schemaVersion: document.schemaVersion, document: document as Prisma.InputJsonValue, commands: commands as unknown as Prisma.InputJsonValue, source, actorId },
    create: {
      websiteId: website.id, organizationId: website.organizationId, workspaceId: website.workspaceId,
      revision: website.documentVersion, schemaVersion: document.schemaVersion,
      document: document as Prisma.InputJsonValue, commands: commands as unknown as Prisma.InputJsonValue, source, actorId,
    },
  });
  if (commands.length) {
    await tx.siteDocumentCommand.deleteMany({ where: { websiteId: website.id, revision: website.documentVersion } });
    await tx.siteDocumentCommand.createMany({ data: commands.map((command, sequence) => ({
      websiteId: website.id, organizationId: website.organizationId!, workspaceId: website.workspaceId,
      revision: website.documentVersion, sequence, actorId, source,
      commandType: String(command.type).slice(0, 100), payload: command as unknown as Prisma.InputJsonValue,
    })) });
  }
  await syncCmsProjection(tx, website, document, actorId);
}
