import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { canonicalDocumentJson, documentObject, validateDocumentTree } from "../../services/websites/document-policy.js";
import { authorizeWebsiteDocumentWrite, type DocumentWriteContext } from "../../services/websites/save-document.js";
import { workspaceCommand } from "../../services/workspaces/command.js";
import { figmaImportRequestSchema } from "./contracts.js";
import { fetchFigmaFile } from "./figma-client.js";
import { appendFigmaPages, compileFigmaSnapshot } from "./figma-compiler.js";

async function authorizedSnapshot(websiteId: string, actorId: string, expectedVersion?: number) {
  return prisma.$transaction(async (tx) => {
    const scope = await authorizeWebsiteDocumentWrite(tx, websiteId, actorId);
    if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "DOCUMENT_EDIT_FORBIDDEN");
    if (expectedVersion !== undefined && scope.website.documentVersion !== expectedVersion) {
      throw new AppError("The website changed; reload before importing Figma", 412, "DOCUMENT_VERSION_CONFLICT");
    }
    return {
      organizationId: scope.organizationId,
      workspaceId: scope.website.workspaceId,
      documentVersion: scope.website.documentVersion,
      editorData: documentObject(typeof scope.website.editorData === "string" ? JSON.parse(scope.website.editorData) : scope.website.editorData),
    };
  });
}

export async function previewFigmaImport(websiteId: string, actorId: string, raw: unknown) {
  const request = figmaImportRequestSchema.parse(raw);
  const website = await authorizedSnapshot(websiteId, actorId);
  const snapshot = await fetchFigmaFile({ request, organizationId: website.organizationId, websiteId });
  const compilation = compileFigmaSnapshot(snapshot, request.pageNamePrefix);
  return {
    source: {
      provider: "figma",
      fileName: snapshot.fileName,
      fileKeyHint: snapshot.fileKey.slice(-6),
      lastModified: snapshot.lastModified,
      version: snapshot.version,
    },
    import: {
      pageCount: compilation.pages.length,
      pageNames: compilation.pages.map((page) => page.name),
      nodeCount: compilation.nodeCount,
      warnings: compilation.warnings,
      sourceTypeCounts: compilation.sourceTypeCounts,
      manifest: compilation.manifest,
    },
    nativePreview: compilation.pages.map((page) => ({
      name: page.name,
      suggestedSlug: `/${page.suggestedSlug}`,
      sourceNodeId: page.sourceNodeId,
      elements: page.elements,
    })),
    currentDocumentVersion: website.documentVersion,
  };
}

export async function createFigmaImportChangeset(
  websiteId: string,
  actorId: string,
  raw: unknown,
  write: DocumentWriteContext,
) {
  const request = figmaImportRequestSchema.parse(raw);
  const website = await authorizedSnapshot(websiteId, actorId, write.expectedVersion);
  const snapshot = await fetchFigmaFile({ request, organizationId: website.organizationId, websiteId });
  const compilation = compileFigmaSnapshot(snapshot, request.pageNamePrefix);
  if (!compilation.pages.length) throw new AppError("No supported Figma frames could be converted", 422, "FIGMA_EMPTY_SELECTION");

  const merged = appendFigmaPages(website.editorData, compilation);
  validateDocumentTree(merged.document);
  canonicalDocumentJson(merged.document);
  const sourceHash = createHash("sha256").update(snapshot.fileKey).digest("hex");
  const documentHash = createHash("sha256").update(canonicalDocumentJson(merged.document)).digest("hex");

  return workspaceCommand({
    actorId,
    operation: "FIGMA_IMPORT_PROPOSED",
    key: write.key,
    payload: {
      websiteId,
      expectedVersion: write.expectedVersion,
      sourceHash,
      requestedNodeIds: snapshot.requestedNodeIds,
      documentHash,
      pageCount: merged.pageNames.length,
    },
    authorize: async (tx) => {
      const scope = await authorizeWebsiteDocumentWrite(tx, websiteId, actorId);
      if (!scope.can("EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "DOCUMENT_EDIT_FORBIDDEN");
      return scope;
    },
    execute: async (tx, { website: current }) => {
      if (current.documentVersion !== write.expectedVersion) {
        throw new AppError("The website changed; generate a new Figma proposal", 412, "DOCUMENT_VERSION_CONFLICT");
      }
      const executionId = randomUUID();
      const execution = await tx.aiExecution.create({
        data: {
          id: executionId,
          websiteId,
          workspaceId: current.workspaceId,
          organizationId: current.organizationId,
          actorId,
          operation: "FIGMA_IMPORT",
          promptVersion: "figma-native-import-v1",
          provider: "figma-rest",
          model: "api-v1",
          status: "COMPLETED",
          stage: "COMPLETED",
          expectedDocumentVersion: write.expectedVersion,
          inputSummary: {
            selectedNodeCount: snapshot.requestedNodeIds.length,
            depth: request.depth,
            sourceHash,
          },
          outputSummary: {
            pageCount: merged.pageNames.length,
            nodeCount: compilation.nodeCount,
            warningCount: compilation.warnings.length,
          },
          completedAt: new Date(),
        },
      });
      const changeset = await tx.aiChangeset.create({
        data: {
          executionId: execution.id,
          websiteId,
          workspaceId: current.workspaceId,
          organizationId: current.organizationId,
          actorId,
          expectedDocumentVersion: write.expectedVersion,
          proposedDocument: merged.document as Prisma.InputJsonValue,
          summary: {
            provider: "figma",
            importMode: "append-pages",
            fileName: snapshot.fileName,
            pageNames: merged.pageNames,
            pageCount: merged.pageNames.length,
            nodeCount: compilation.nodeCount,
            warnings: compilation.warnings,
            setupRequired: compilation.warnings,
          },
        },
      });
      return { resourceId: websiteId, executionId: execution.id, changesetId: changeset.id };
    },
  });
}
