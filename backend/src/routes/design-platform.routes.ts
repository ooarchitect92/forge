import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { AppError } from "../utils/app-error.js";
import { documentWriteContext } from "../services/websites/document-request.js";
import { designPlatformCapabilities } from "../modules/design-platform/capabilities.js";
import { applyCmsBlueprint, previewCmsBlueprint } from "../modules/design-platform/cms-blueprint.js";
import { createFigmaImportChangeset, previewFigmaImport } from "../modules/design-platform/figma-import.js";
import { getIndustryTemplate, listIndustryTemplates } from "../modules/design-platform/template-catalog.js";

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const externalPreviewLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many design import requests; retry later." } },
});

function websiteId(req: Request): string { return String(req.params.websiteId || ""); }
function commandKey(req: Request): string {
  if (req.get("X-Forge-Intent") !== "document-command") {
    throw new AppError("An explicit document command header is required", 403, "DOCUMENT_INTENT_REQUIRED");
  }
  return req.get("Idempotency-Key") || "";
}

router.get("/templates", (_req, res) => {
  res.json({ success: true, templates: listIndustryTemplates() });
});
router.get("/templates/:templateId", (req, res, next) => {
  try { res.json({ success: true, template: getIndustryTemplate(String(req.params.templateId)) }); }
  catch (error) { next(error); }
});

router.get("/websites/:websiteId/capabilities", async (req, res, next) => {
  try { res.json({ success: true, platform: await designPlatformCapabilities(websiteId(req), res.locals.user.id) }); }
  catch (error) { next(error); }
});

router.post("/websites/:websiteId/figma/preview", externalPreviewLimit, async (req, res, next) => {
  try { res.json({ success: true, preview: await previewFigmaImport(websiteId(req), res.locals.user.id, req.body) }); }
  catch (error) { next(error); }
});
router.post("/websites/:websiteId/figma/changesets", externalPreviewLimit, async (req, res, next) => {
  try {
    const id = websiteId(req);
    const result = await createFigmaImportChangeset(id, res.locals.user.id, req.body, documentWriteContext(req, id));
    res.status(201).json({ success: true, ...result });
  } catch (error) { next(error); }
});

router.post("/websites/:websiteId/cms/blueprints/preview", async (req, res, next) => {
  try { res.json({ success: true, preview: await previewCmsBlueprint(websiteId(req), res.locals.user.id, req.body) }); }
  catch (error) { next(error); }
});
router.post("/websites/:websiteId/cms/blueprints/apply", async (req, res, next) => {
  try {
    const result = await applyCmsBlueprint(websiteId(req), res.locals.user.id, req.body, commandKey(req));
    res.json({ success: true, result });
  } catch (error) { next(error); }
});

export default router;
