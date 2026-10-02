import type { RequestHandler } from "express";
import { pgPool } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { getCapability } from "./capability-registry.js";

export type RuntimeCapabilityState = "ENABLED" | "DISABLED" | "DEGRADED" | "LOCKED" | "UNVERIFIED";

export async function runtimeCapabilityState(id: string): Promise<RuntimeCapabilityState> {
  const definition = getCapability(id);
  if (!definition) throw new AppError("Capability not found", 404, "CAPABILITY_NOT_FOUND");
  try {
    const result = await pgPool.query<{ desiredState: string; observedState: string }>(
      `SELECT "desiredState","observedState" FROM platform_capabilities WHERE id=$1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return definition.desiredState;
    const observed = String(row.observedState || "");
    if (["ENABLED", "DISABLED", "DEGRADED", "LOCKED"].includes(observed)) return observed as RuntimeCapabilityState;
    const desired = String(row.desiredState || "");
    if (["ENABLED", "DISABLED", "DEGRADED", "LOCKED"].includes(desired)) return desired as RuntimeCapabilityState;
    return "UNVERIFIED";
  } catch (error) {
    if (process.env.NODE_ENV !== "production") return definition.desiredState;
    throw new AppError("Capability control plane is unavailable", 503, "CAPABILITY_STATE_UNAVAILABLE");
  }
}

export function requireRuntimeCapability(id: string, options?: { allowDegraded?: boolean }): RequestHandler {
  return async (_req, _res, next) => {
    try {
      const state = await runtimeCapabilityState(id);
      if (state === "DISABLED" || state === "UNVERIFIED" || (state === "DEGRADED" && !options?.allowDegraded)) {
        throw new AppError(`Capability ${id} is not available`, 503, "CAPABILITY_DISABLED");
      }
      next();
    } catch (error) { next(error); }
  };
}
