import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error.js";
import {
  applySiteDocumentCommands, getCmsV2Snapshot, getSiteDocument, getSiteDocumentRevision,
  initializeSiteDocument, listSiteDocumentRevisions, previewSiteDocumentCommands, restoreSiteDocumentRevision,
} from "../services/websites/site-document.service.js";

function key(req: Request): string {
  const value = req.header("Idempotency-Key");
  if (!value) throw new AppError("Idempotency-Key is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  return value;
}
function int(value: unknown, name: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) throw new AppError(`${name} must be a positive integer`, 400, "INVALID_REQUEST");
  return number;
}

export async function getSiteDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getSiteDocument(req.params.id as string, res.locals.user.id);
    res.setHeader("ETag", `"${result.websiteId}:site-document:${result.revision}"`);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function initializeSiteDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await initializeSiteDocument(req.params.id as string, res.locals.user.id, key(req));
    res.status(201).json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function previewSiteDocumentCommandsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await previewSiteDocumentCommands(req.params.id as string, res.locals.user.id, req.body?.commands);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function applySiteDocumentCommandsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await applySiteDocumentCommands({
      websiteId: req.params.id as string,
      actorId: res.locals.user.id,
      expectedRevision: int(req.body?.expectedRevision, "expectedRevision"),
      key: key(req),
      commands: req.body?.commands,
      source: "USER",
    });
    res.setHeader("ETag", `"${result.websiteId}:site-document:${result.revision}"`);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function listSiteDocumentRevisionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 50;
    const revisions = await listSiteDocumentRevisions(req.params.id as string, res.locals.user.id, Number.isFinite(limit) ? limit : 50);
    res.json({ success: true, revisions });
  } catch (error) { next(error); }
}

export async function getSiteDocumentRevisionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const revision = await getSiteDocumentRevision(req.params.id as string, int(req.params.revision, "revision"), res.locals.user.id);
    res.json({ success: true, revision });
  } catch (error) { next(error); }
}

export async function restoreSiteDocumentRevisionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await restoreSiteDocumentRevision({
      websiteId: req.params.id as string,
      actorId: res.locals.user.id,
      targetRevision: int(req.params.revision, "revision"),
      expectedRevision: int(req.body?.expectedRevision, "expectedRevision"),
      key: key(req),
    });
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function getCmsV2SnapshotHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getCmsV2Snapshot(req.params.id as string, res.locals.user.id);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}
