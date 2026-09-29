import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { capabilityRegistry, validateCapabilityRegistry } from "./capability-registry.js";
import { pgPool } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  try {
    const session = res.locals.session;
    if (!session || session.audience !== "PLATFORM") {
      throw new AppError("A platform-control session is required", 403, "PLATFORM_SESSION_REQUIRED");
    }
    next();
  } catch (error) { next(error); }
});
router.use(requireRole(["PLATFORM_ADMIN","SUPER_ADMIN"]));

router.get("/capabilities", async (_req, res, next) => {
  try {
    validateCapabilityRegistry();
    const persisted = await pgPool.query(
      `SELECT id,provider,"desiredState","observedState",version,"updatedAt" FROM platform_capabilities ORDER BY id`,
    ).catch(() => ({ rows: [] as any[] }));
    const live = new Map(persisted.rows.map((row: any) => [row.id, row]));
    res.json({
      success: true,
      capabilities: capabilityRegistry.map((definition) => ({
        ...definition,
        observedState: live.get(definition.id)?.observedState || "UNVERIFIED",
        persistedProvider: live.get(definition.id)?.provider || null,
        version: live.get(definition.id)?.version || null,
        lastObservedAt: live.get(definition.id)?.updatedAt || null,
      })),
    });
  } catch (error) { next(error); }
});

router.get("/overview", async (_req, res, next) => {
  try {
    validateCapabilityRegistry();
    const [changes, jobs, conflicts] = await Promise.all([
      pgPool.query(`SELECT count(*)::int AS count FROM platform_change_requests WHERE status NOT IN ('COMPLETED','ROLLED_BACK','REJECTED')`).catch(() => ({ rows: [{count:0}] })),
      pgPool.query(`SELECT status,count(*)::int AS count FROM platform_jobs GROUP BY status`).catch(() => ({ rows: [] })),
      pgPool.query(`SELECT "resourceType",count(*)::int AS count FROM tenant_backfill_conflicts GROUP BY "resourceType"`).catch(() => ({ rows: [] })),
    ]);
    res.json({
      success: true,
      tier: process.env.FORGE_PLATFORM_TIER || "T0",
      referenceTarget: { registeredUsers: 70000, dynamicRps: 10000, qualificationRps: 15000, qualified: false },
      openChanges: changes.rows[0]?.count || 0,
      jobStates: jobs.rows,
      unresolvedTenantBackfill: conflicts.rows,
      note: "Capacity targets are architecture contracts until deployment qualification evidence exists.",
    });
  } catch (error) { next(error); }
});

export default router;
