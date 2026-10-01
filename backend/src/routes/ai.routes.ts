import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeCapability } from "../services/permission.service.js";
import { applyAiChangesetHandler, cancelAiChangesetHandler, generateSiteHandler, getAiChangesetHandler, retryAiChangesetHandler } from "../controllers/ai.controller.js";
import { createDesignHandler, getDesignHandler, cancelDesignHandler, retryDesignHandler, designCapabilitiesHandler } from "../controllers/ai-design.controller.js";
import designPlatformRoutes from "./design-platform.routes.js";

const router = Router();
router.get("/capabilities", requireAuth, designCapabilitiesHandler);
router.post("/websites/:id/executions", requireAuth, createDesignHandler);
router.get("/executions/:executionId", requireAuth, getDesignHandler);
router.post("/executions/:executionId/cancel", requireAuth, cancelDesignHandler);
router.post("/executions/:executionId/retry", requireAuth, retryDesignHandler);
router.post("/websites/:id/generate", requireAuth, authorizeCapability("EDIT_DESIGN"), generateSiteHandler);
router.get("/changesets/:changesetId", requireAuth, getAiChangesetHandler);
router.post("/changesets/:changesetId/apply", requireAuth, applyAiChangesetHandler);
router.post("/changesets/:changesetId/cancel", requireAuth, cancelAiChangesetHandler);
router.post("/changesets/:changesetId/retry", requireAuth, retryAiChangesetHandler);

// Provider-neutral design platform surface: curated AI templates, governed
// Figma imports and merge-only CMS blueprints. It stays under /api[/v1]/ai so
// the existing application router and authentication boundary remain stable.
router.use("/design-platform", designPlatformRoutes);

export default router;
