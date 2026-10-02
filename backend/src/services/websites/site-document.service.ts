import type { Prisma } from "../../generated/prisma/index.js";
import { AppError } from "../../utils/app-error.js";
import { applySiteCommands, parseSiteCommands, type SiteCommand } from "../../domain/site-commands.js";
import { siteDocumentToLegacy } from "../../domain/site-document-legacy.js";
import { validateSiteDocument, type SiteDocument } from "../../domain/site-document.js";
import { prisma } from "../../config/prisma.js";
import { workspaceCommand } from "../workspaces/command.js";
import { getScopedWebsiteInTransaction } from "./scoped-access.js";
import { authorizeWebsiteDocumentWrite } from "./save-document.js";
import { authorizeDocumentEdit, documentObject } from "./document-policy.js";
import {
  ensureSiteDocumentState, legacyMirror, setSiteDocumentTenant, siteDocumentFromLegacy,
  syncCmsProjection, syncSiteDocumentAfterLegacySave,
} from "./site-document-storage.js";
import { recordSiteDocumentMetric } from "./site-document-metrics.js";
import { notifyWebsiteDocumentRevision } from "../collaboration/presence.service.js";

export type SiteDocumentSource = "USER" | "AI" | "FIGMA" | "STITCH" | "RESTORE" | "MIGRATION";

function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value >= 2_147_483_647) {
    throw new AppError("Load the current SiteDocument revision and retry", 428, "SITE_DOCUMENT_PRECONDITION_REQUIRED");
  }
  return value;
}

function authorizeCommands(commands: SiteCommand[], can: (capability: string, resourceId?: string) => boolean): void {
  for (const command of commands) {
    if (command.type.startsWith("cms.item.") || command.type.startsWith("cms.collection.") || command.type.startsWith("cms.field.add") || command.type.startsWith("cms.field.update") || command.type.startsWith("cms.field.delete")) {
      if (!can("EDIT_CONTENT") && !can("EDIT_DESIGN")) throw new AppError("CMS editing is not permitted", 403, "SITE_COMMAND_FORBIDDEN");
      continue;
    }
    if (command.type === "integration.set" || command.type === "integration.delete") {
      if (!can("MANAGE_INTEGRATIONS")) throw new AppError("Integration management is not permitted", 403, "SITE_COMMAND_FORBIDDEN");
      continue;
    }
    if (command.type === "site.setMetadata") {
      if (!can("MANAGE_SETTINGS") && !can("EDIT_DESIGN")) throw new AppError("Site settings editing is not permitted", 403, "SITE_COMMAND_FORBIDDEN");
      continue;
    }
    if (!can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "SITE_COMMAND_FORBIDDEN");
  }
}

async function enforceLegacyDocumentPolicy(tx: any, website: any, actorId: string, next: SiteDocument, can: (capability: string, resourceId?: string) => boolean): Promise<void> {
  const currentLegacy = documentObject(typeof website.editorData === "string" ? JSON.parse(website.editorData) : website.editorData);
  const nextLegacy = documentObject(siteDocumentToLegacy(next));
  const accesses = await tx.componentAccess.findMany({ where: { websiteId: website.id, userId: actorId, permission: "EDIT" }, take: 1001 });
  if (accesses.length > 1000) throw new AppError("Component policy exceeds the supported budget", 503, "POLICY_BUDGET_EXCEEDED");
  const editableProtectedIds = new Set<string>(accesses.filter((access: any) => can("EDIT", access.componentId)).map((access: any) => access.componentId));
  authorizeDocumentEdit(currentLegacy, nextLegacy, {
    canDesign: can("EDIT_DESIGN"), canContent: can("EDIT_CONTENT"), canManage: can("MANAGE_PERMISSIONS"), canSeo: can("EDIT_SEO"), editableProtectedIds,
  });
}

export async function getSiteDocument(websiteId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const website = await getScopedWebsiteInTransaction(tx, websiteId, actorId);
    if (!website.organizationId) throw new AppError("Website ownership migration is required before SiteDocument use", 503, "TENANT_MIGRATION_REQUIRED");
    await setSiteDocumentTenant(tx, website.organizationId);
    let state = await tx.siteDocumentState.findUnique({ where: { websiteId } });
    if (state && state.revision !== website.documentVersion) {
      await syncSiteDocumentAfterLegacySave(tx, website, actorId);
      state = await tx.siteDocumentState.findUnique({ where: { websiteId } });
    }
    const document = state ? validateSiteDocument(state.document) : await siteDocumentFromLegacy(tx, website);
    return {
      websiteId,
      revision: state?.revision ?? website.documentVersion,
      schemaVersion: document.schemaVersion,
      persisted: Boolean(state),
      document,
    };
  });
}

export async function initializeSiteDocument(websiteId: string, actorId: string, key: string) {
  const result = await workspaceCommand({
    actorId, operation: "SITE_DOCUMENT_INITIALIZED", key, payload: { websiteId },
    authorize: async tx => authorizeWebsiteDocumentWrite(tx, websiteId, actorId),
    execute: async (tx, { website }) => {
      const state = await ensureSiteDocumentState(tx, website, actorId);
      return { resourceId: websiteId, websiteId, revision: state.revision, schemaVersion: state.document.schemaVersion, persisted: true, document: state.document };
    },
  });
  notifyWebsiteDocumentRevision(websiteId,{revision:result.revision,source:"MIGRATION",actorId});
  return result;
}

export async function previewSiteDocumentCommands(websiteId: string, actorId: string, commandsInput: unknown) {
  const started = Date.now();
  const commands = parseSiteCommands(commandsInput);
  try {
    const result = await prisma.$transaction(async tx => {
      const scope = await authorizeWebsiteDocumentWrite(tx, websiteId, actorId);
      authorizeCommands(commands, scope.can);
      const state = await ensureSiteDocumentState(tx, scope.website, actorId);
      if (state.revision !== scope.website.documentVersion) {
        await syncSiteDocumentAfterLegacySave(tx, scope.website, actorId);
      }
      const currentRow = await tx.siteDocumentState.findUniqueOrThrow({ where: { websiteId } });
      const current = validateSiteDocument(currentRow.document);
      const proposed = applySiteCommands(current, commands);
      await enforceLegacyDocumentPolicy(tx, scope.website, actorId, proposed, scope.can);
      return { websiteId, baseRevision: currentRow.revision, schemaVersion: proposed.schemaVersion, commands, proposed };
    });
    await recordSiteDocumentMetric({websiteId,actorId,operation:"COMMAND_PREVIEW",source:"USER",durationMs:Date.now()-started,commandCount:commands.length,status:"SUCCESS"});
    return result;
  } catch (error) {
    await recordSiteDocumentMetric({websiteId,actorId,operation:"COMMAND_PREVIEW",source:"USER",durationMs:Date.now()-started,commandCount:commands.length,status:"ERROR",errorCode:(error as {code?:string})?.code??"UNKNOWN"});
    throw error;
  }
}

export async function applySiteDocumentCommands(input: {
  websiteId: string; actorId: string; expectedRevision: number; key: string; commands: unknown; source?: SiteDocumentSource;
}) {
  const revision = expectedRevision(input.expectedRevision);
  const commands = parseSiteCommands(input.commands);
  const source = input.source ?? "USER";
  const started = Date.now();
  try {
    const result = await workspaceCommand({
    actorId: input.actorId, operation: "SITE_DOCUMENT_COMMANDS_APPLIED", key: input.key,
    payload: { websiteId: input.websiteId, expectedRevision: revision, source, commands },
    authorize: async tx => {
      const scope = await authorizeWebsiteDocumentWrite(tx, input.websiteId, input.actorId);
      authorizeCommands(commands, scope.can);
      return scope;
    },
    execute: async (tx, scope) => {
      let state = await ensureSiteDocumentState(tx, scope.website, input.actorId);
      if (state.revision !== scope.website.documentVersion) {
        await syncSiteDocumentAfterLegacySave(tx, scope.website, input.actorId);
        const reconciled = await tx.siteDocumentState.findUniqueOrThrow({ where: { websiteId: input.websiteId } });
        state = { document: validateSiteDocument(reconciled.document), revision: reconciled.revision, created: false };
      }
      if (state.revision !== revision) throw new AppError("The SiteDocument changed after you loaded it", 412, "SITE_DOCUMENT_REVISION_CONFLICT");
      const proposed = applySiteCommands(state.document, commands);
      await enforceLegacyDocumentPolicy(tx, scope.website, input.actorId, proposed, scope.can);

      const saved = await tx.website.update({
        where: { id: input.websiteId, documentVersion: scope.website.documentVersion },
        data: { editorData: legacyMirror(proposed) },
        select: { id: true, documentVersion: true, updatedAt: true, organizationId: true, workspaceId: true, name: true, slug: true, editorData: true },
      });
      await tx.siteDocumentState.update({ where: { websiteId: input.websiteId }, data: {
        revision: saved.documentVersion, schemaVersion: proposed.schemaVersion, document: proposed as Prisma.InputJsonValue, updatedBy: input.actorId,
      }});
      await tx.siteDocumentRevision.create({ data: {
        websiteId: input.websiteId, organizationId: scope.organizationId, workspaceId: scope.website.workspaceId,
        revision: saved.documentVersion, schemaVersion: proposed.schemaVersion, document: proposed as Prisma.InputJsonValue,
        commands: commands as unknown as Prisma.InputJsonValue, source, actorId: input.actorId,
      }});
      if (commands.length) await tx.siteDocumentCommand.createMany({ data: commands.map((command, sequence) => ({
        websiteId: input.websiteId, organizationId: scope.organizationId, workspaceId: scope.website.workspaceId,
        revision: saved.documentVersion, sequence, actorId: input.actorId, source,
        commandType: command.type, payload: command as unknown as Prisma.InputJsonValue,
      }))});
      await syncCmsProjection(tx, saved, proposed, input.actorId);
      return {
        resourceId: input.websiteId, websiteId: input.websiteId, revision: saved.documentVersion,
        documentVersion: saved.documentVersion, schemaVersion: proposed.schemaVersion, updatedAt: saved.updatedAt.toISOString(),
      };
    },
  });
    await recordSiteDocumentMetric({
      websiteId:input.websiteId,actorId:input.actorId,operation:"COMMAND_APPLY",source,
      durationMs:Date.now()-started,commandCount:commands.length,status:"SUCCESS",idempotencyKey:input.key,
    });
    notifyWebsiteDocumentRevision(input.websiteId,{revision:result.revision,source,actorId:input.actorId});
    return result;
  } catch (error) {
    await recordSiteDocumentMetric({
      websiteId:input.websiteId,actorId:input.actorId,operation:"COMMAND_APPLY",source,
      durationMs:Date.now()-started,commandCount:commands.length,status:"ERROR",
      errorCode:(error as {code?:string})?.code??"UNKNOWN",idempotencyKey:input.key,
    });
    throw error;
  }
}

export async function listSiteDocumentRevisions(websiteId: string, actorId: string, limit = 50) {
  return prisma.$transaction(async tx => {
    const website = await getScopedWebsiteInTransaction(tx, websiteId, actorId);
    if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
    await setSiteDocumentTenant(tx, website.organizationId);
    const rows = await tx.siteDocumentRevision.findMany({
      where: { websiteId }, orderBy: { revision: "desc" }, take: Math.max(1, Math.min(200, limit)),
      select: { id: true, revision: true, schemaVersion: true, source: true, actorId: true, createdAt: true, commands: true },
    });
    return rows;
  });
}

export async function getSiteDocumentRevision(websiteId: string, revisionInput: number, actorId: string) {
  const revision = expectedRevision(revisionInput);
  return prisma.$transaction(async tx => {
    const website = await getScopedWebsiteInTransaction(tx, websiteId, actorId);
    if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
    await setSiteDocumentTenant(tx, website.organizationId);
    const row = await tx.siteDocumentRevision.findUnique({ where: { websiteId_revision: { websiteId, revision } } });
    if (!row) throw new AppError("SiteDocument revision was not found", 404, "SITE_DOCUMENT_REVISION_NOT_FOUND");
    return { ...row, document: validateSiteDocument(row.document) };
  });
}

export async function restoreSiteDocumentRevision(input: { websiteId: string; actorId: string; targetRevision: number; expectedRevision: number; key: string }) {
  const targetRevision = expectedRevision(input.targetRevision);
  const baseRevision = expectedRevision(input.expectedRevision);
  const result = await workspaceCommand({
    actorId: input.actorId, operation: "SITE_DOCUMENT_RESTORED", key: input.key,
    payload: { websiteId: input.websiteId, targetRevision, expectedRevision: baseRevision },
    authorize: async tx => {
      const scope = await authorizeWebsiteDocumentWrite(tx, input.websiteId, input.actorId);
      if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "SITE_COMMAND_FORBIDDEN");
      return scope;
    },
    execute: async (tx, scope) => {
      let state = await ensureSiteDocumentState(tx, scope.website, input.actorId);
      if (state.revision !== scope.website.documentVersion) {
        await syncSiteDocumentAfterLegacySave(tx, scope.website, input.actorId);
        const current = await tx.siteDocumentState.findUniqueOrThrow({ where: { websiteId: input.websiteId } });
        state = { document: validateSiteDocument(current.document), revision: current.revision, created: false };
      }
      if (state.revision !== baseRevision) throw new AppError("The SiteDocument changed after you loaded it", 412, "SITE_DOCUMENT_REVISION_CONFLICT");
      const target = await tx.siteDocumentRevision.findUnique({ where: { websiteId_revision: { websiteId: input.websiteId, revision: targetRevision } } });
      if (!target) throw new AppError("SiteDocument revision was not found", 404, "SITE_DOCUMENT_REVISION_NOT_FOUND");
      const document = validateSiteDocument(target.document);
      await enforceLegacyDocumentPolicy(tx, scope.website, input.actorId, document, scope.can);
      const saved = await tx.website.update({
        where: { id: input.websiteId, documentVersion: scope.website.documentVersion },
        data: { editorData: legacyMirror(document) },
        select: { documentVersion: true, updatedAt: true, organizationId: true, workspaceId: true, id: true },
      });
      await tx.siteDocumentState.update({ where: { websiteId: input.websiteId }, data: { revision: saved.documentVersion, document: document as Prisma.InputJsonValue, schemaVersion: document.schemaVersion, updatedBy: input.actorId } });
      await tx.siteDocumentRevision.create({ data: {
        websiteId: input.websiteId, organizationId: scope.organizationId, workspaceId: scope.website.workspaceId,
        revision: saved.documentVersion, schemaVersion: document.schemaVersion, document: document as Prisma.InputJsonValue,
        commands: [{ type: "revision.restore", targetRevision }] as Prisma.InputJsonValue, source: "RESTORE", actorId: input.actorId,
      }});
      await syncCmsProjection(tx, saved, document, input.actorId);
      return { resourceId: input.websiteId, websiteId: input.websiteId, revision: saved.documentVersion, documentVersion: saved.documentVersion, restoredFrom: targetRevision, updatedAt: saved.updatedAt.toISOString() };
    },
  });
  notifyWebsiteDocumentRevision(input.websiteId,{revision:result.revision,source:"RESTORE",actorId:input.actorId});
  return result;
}

export async function getCmsV2Snapshot(websiteId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const website = await getScopedWebsiteInTransaction(tx, websiteId, actorId);
    if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
    await setSiteDocumentTenant(tx, website.organizationId);
    let state = await tx.siteDocumentState.findUnique({ where: { websiteId } });
    if (state && state.revision !== website.documentVersion) {
      await syncSiteDocumentAfterLegacySave(tx, website, actorId);
      state = await tx.siteDocumentState.findUnique({ where: { websiteId } });
    }
    const document = state ? validateSiteDocument(state.document) : await siteDocumentFromLegacy(tx, website);
    return { collections: document.cms.collections, items: document.cms.items, bindings: document.cms.bindings, revision: state?.revision ?? website.documentVersion };
  });
}
