import { randomUUID } from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { prisma } from "../../config/prisma.js";
import { authorizeWebsiteDocumentWrite, saveWebsiteDocument, type DocumentWriteContext } from "../../services/websites/save-document.js";
import { getScopedWebsiteInTransaction } from "../../services/websites/scoped-access.js";
import { workspaceCommand } from "../../services/workspaces/command.js";
import { siteGenerationProvider, siteGenerationProviderFromSnapshot } from "./provider-routing.js";
import { canonicalSiteFromBlueprint } from "./site-blueprint.js";
import { decryptPrompt, encryptPrompt, promptRetentionEnabled, retentionExpiry } from "./prompt-vault.js";
import { validateSiteBrief } from "./site-brief.js";
import { generateValidatedSiteBlueprint } from "./generate-site-blueprint.js";
import { diffVisualSiteDocuments } from "../../domain/site-document-diff.js";
import { legacyWebsiteToSiteDocument } from "../../domain/site-document-legacy.js";
import { validateSiteDocument } from "../../domain/site-document.js";
import { ensureSiteDocumentState } from "../../services/websites/site-document-storage.js";
import { reserveAiCredits, settleAiCredits } from "../../services/ai/credit-wallet.js";

export async function generateSiteDraft(input: { websiteId: string; actorId: string; prompt: string; expectedVersion: number }, providerSnapshot?: { provider: string; model: string }) {
  validateSiteBrief(input.prompt);
  const website = await prisma.$transaction(async tx => {
    const scope = await authorizeWebsiteDocumentWrite(tx, input.websiteId, input.actorId);
    if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "DOCUMENT_EDIT_FORBIDDEN");
    return scope.website;
  });
  if (website.documentVersion !== input.expectedVersion) throw new AppError("Reload before generating a changeset", 412, "DOCUMENT_VERSION_CONFLICT");
  const provider = providerSnapshot ? siteGenerationProviderFromSnapshot(providerSnapshot) : siteGenerationProvider();
  const retention = promptRetentionEnabled();
  const executionId = randomUUID();
  const execution = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    await reserveAiCredits(tx, { organizationId: website.organizationId!, actorId: input.actorId, executionId, units: 1 });
    return tx.aiExecution.create({ data: { id: executionId, websiteId: website.id, workspaceId: website.workspaceId, organizationId: website.organizationId, actorId: input.actorId, operation: "SITE_GENERATION", provider: provider.name, model: provider.model, inputSummary: { promptLength: input.prompt.trim().length, retryAvailable: retention }, promptCiphertext: retention ? encryptPrompt(input.prompt.trim()) : null, promptExpiresAt: retention ? retentionExpiry() : null, reservedUnits: 1 } });
  });
  let result: Awaited<ReturnType<typeof provider.generate>>;
  let draft: ReturnType<typeof canonicalSiteFromBlueprint>;
  try {
    ({ result, draft } = await generateValidatedSiteBlueprint(provider, input.prompt.trim(), website.name));
  } catch (error) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      await tx.aiExecution.update({ where: { id: execution.id }, data: { status: "FAILED", errorCode: error instanceof AppError ? error.code : "AI_PROVIDER_UNAVAILABLE", completedAt: new Date() } });
      await settleAiCredits(tx, { organizationId: website.organizationId!, actorId: input.actorId, executionId: execution.id, action: "release", reason: "site-generation-provider-failed" });
    });
    throw error;
  }
  const { editorData, pageNames, sectionCount } = draft;
  try {
    const changeset = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      const canonical = await ensureSiteDocumentState(tx, website, input.actorId);
      if (canonical.revision !== input.expectedVersion) throw new AppError("The canonical SiteDocument changed before the proposal was created", 412, "SITE_DOCUMENT_REVISION_CONFLICT");
      const generatedVisual = legacyWebsiteToSiteDocument({ websiteId: website.id, name: website.name, slug: website.slug, editorData, cmsTypes: [] });
      const targetCanonical = validateSiteDocument({
        ...canonical.document,
        site: { ...canonical.document.site, title: generatedVisual.site.title || canonical.document.site.title, slug: canonical.document.site.slug, defaultLocale: canonical.document.site.defaultLocale, metadata: canonical.document.site.metadata },
        pages: generatedVisual.pages,
        tokens: [
          ...canonical.document.tokens.filter(token => token.source !== "import"),
          ...generatedVisual.tokens.map(token => ({ ...token, source: "import" as const })),
        ],
        extensions: { ...canonical.document.extensions, ...generatedVisual.extensions },
      });
      const proposedCommands = diffVisualSiteDocuments(canonical.document, targetCanonical);
      if (!proposedCommands.length) throw new AppError("The generated proposal does not change the current site", 422, "AI_NO_CHANGES");
      await tx.aiExecution.update({ where: { id: execution.id }, data: { status: "COMPLETED", outputSummary: { requestId: result.requestId ?? null, pageCount: pageNames.length, sectionCount, commandCount: proposedCommands.length }, completedAt: new Date() } });
      await settleAiCredits(tx, { organizationId: website.organizationId!, actorId: input.actorId, executionId: execution.id, action: "consume", reason: "site-generation-proposal-completed" });
      return tx.aiChangeset.create({ data: {
        executionId: execution.id, websiteId: website.id, workspaceId: website.workspaceId, organizationId: website.organizationId,
        actorId: input.actorId, expectedDocumentVersion: input.expectedVersion, proposedDocument: editorData,
        proposedCommands: proposedCommands as unknown as import("../../generated/prisma/index.js").Prisma.InputJsonValue,
        summary: { provider: result.provider, model: result.model, pageNames, pageCount: pageNames.length, sectionCount, commandCount: proposedCommands.length },
      } });
    });
    return { changeset };
  } catch (error) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      await tx.aiExecution.updateMany({ where: { id: execution.id, status: { not: "COMPLETED" } }, data: { status: "FAILED", errorCode: error instanceof AppError ? error.code : "AI_PROPOSAL_FAILED", completedAt: new Date() } });
      await settleAiCredits(tx, { organizationId: website.organizationId!, actorId: input.actorId, executionId: execution.id, action: "consume", reason: "provider-completed-local-proposal-failed" });
    });
    throw error;
  }
}

export async function getAiChangeset(id: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const row = await tx.aiChangeset.findUnique({ where: { id } });
    if (!row) throw new AppError("Changeset not found", 404, "AI_CHANGESET_NOT_FOUND");
    const website = await getScopedWebsiteInTransaction(tx, row.websiteId, actorId);
    if (row.workspaceId !== website.workspaceId || row.organizationId !== website.organizationId) throw new AppError("Changeset not found", 404, "AI_CHANGESET_NOT_FOUND");
    return row;
  });
}
export async function cancelAiChangeset(id: string, actorId: string) {
  const result = await workspaceCommand({
    actorId, operation: "AI_CHANGESET_CANCELLED", key: `cancel:${id}`, payload: { id },
    authorize: async tx => {
      const row = await tx.aiChangeset.findUnique({ where: { id } });
      if (!row) throw new AppError("Changeset not found", 404, "AI_CHANGESET_NOT_FOUND");
      const scope = await authorizeWebsiteDocumentWrite(tx, row.websiteId, actorId);
      if (row.workspaceId !== scope.website.workspaceId || row.organizationId !== scope.organizationId) throw new AppError("Changeset not found", 404, "AI_CHANGESET_NOT_FOUND");
      if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "DOCUMENT_EDIT_FORBIDDEN");
      return { ...scope, row };
    },
    execute: async (tx, { row }) => {
      const changed = await tx.aiChangeset.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      if (changed.count !== 1) throw new AppError("Changeset cannot be cancelled", 409, "AI_CHANGESET_STATE");
      // The journal never retains proposal content.
      return { resourceId: row.websiteId, changesetId: id };
    },
  });
  return getAiChangeset(result.changesetId, actorId);
}
export async function applyAiChangeset(id: string, actorId: string, write: DocumentWriteContext) {
  const row = await getAiChangeset(id, actorId);
  if (write.expectedVersion !== row.expectedDocumentVersion) throw new AppError("Changeset version does not match the reviewed document", 412, "DOCUMENT_VERSION_CONFLICT");
  // State/version checks belong after journal lookup, inside the document commit.
  // A lost acknowledgement can then replay after the first successful apply.
  return saveWebsiteDocument(row.websiteId, actorId, { editorData: row.proposedDocument }, write, { kind: "ai", changesetId: id });
}
export async function retryAiChangeset(id:string, actorId:string, expectedVersion:number) {
  const row=await getAiChangeset(id,actorId);
  await prisma.$transaction(async tx => {
    const scope = await authorizeWebsiteDocumentWrite(tx, row.websiteId, actorId);
    if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "DOCUMENT_EDIT_FORBIDDEN");
  });
  const execution=await prisma.aiExecution.findUnique({where:{id:row.executionId}});
  if(!execution?.promptCiphertext||!execution.promptExpiresAt||execution.promptExpiresAt<=new Date()) throw new AppError("This prompt has expired and cannot be retried",409,"AI_PROMPT_EXPIRED");
  return generateSiteDraft({websiteId:row.websiteId,actorId,prompt:decryptPrompt(execution.promptCiphertext),expectedVersion}, {provider:execution.provider,model:execution.model});
}
