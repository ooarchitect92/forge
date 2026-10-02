import { AppError } from "../../utils/app-error.js";
import type { WorkspaceTransaction } from "../workspaces/access.js";

const METRIC = "ai_credits";
const MAX_UNITS = 1_000_000;

function validUnits(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_UNITS) {
    throw new AppError("Invalid AI credit reservation", 500, "AI_CREDIT_ACCOUNTING_INVALID");
  }
  return value;
}
function reservationKey(executionId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(executionId)) {
    throw new AppError("Invalid AI execution identity", 500, "AI_CREDIT_ACCOUNTING_INVALID");
  }
  return `ai-execution:${executionId}`;
}

async function subscriptionWindow(tx: WorkspaceTransaction, organizationId: string, actorId: string) {
  const org = await tx.$queryRaw<Array<{ limit: number | string; periodStart: Date; periodEnd: Date | null }>>`
    SELECT p."aiCreditLimit" AS "limit", s."currentPeriodStart" AS "periodStart", s."currentPeriodEnd" AS "periodEnd"
      FROM organization_subscriptions s
      JOIN subscription_plans p ON p.id = s."planId"
     WHERE s."organizationId" = ${organizationId}::uuid
       AND s.status IN ('ACTIVE','TRIALING','GRACE')
     LIMIT 1`;
  if (org[0]) return { limit: Number(org[0].limit), periodStart: org[0].periodStart, periodEnd: org[0].periodEnd, source: "organization" as const };

  // Compatibility while legacy personal workspaces still use user subscriptions.
  const legacy = await tx.userSubscription.findUnique({ where: { userId: actorId }, include: { plan: true } });
  if (!legacy || !["ACTIVE", "TRIALING", "GRACE"].includes(legacy.status)) {
    throw new AppError("An active subscription is required for AI usage", 402, "AI_SUBSCRIPTION_REQUIRED");
  }
  return { limit: Number(legacy.plan.aiCreditLimit), periodStart: legacy.currentPeriodStart, periodEnd: legacy.currentPeriodEnd, source: "user" as const };
}

export async function reserveAiCredits(tx: WorkspaceTransaction, input: {
  organizationId: string; actorId: string; executionId: string; units: number; ttlSeconds?: number;
}) {
  const units = validUnits(input.units);
  const key = reservationKey(input.executionId);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId + ":" + METRIC}, 0))`;
  await tx.$executeRaw`UPDATE quota_reservations SET state='EXPIRED',"updatedAt"=now()
    WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC} AND state='RESERVED' AND "expiresAt"<=now()`;
  const existing = await tx.$queryRaw<Array<{ id: string; amount: bigint; state: string; expiresAt: Date }>>`
    SELECT id,amount,state,"expiresAt" FROM quota_reservations
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC} AND "idempotencyKey"=${key} LIMIT 1`;
  if (existing[0]) return existing[0];

  const window = await subscriptionWindow(tx, input.organizationId, input.actorId);
  if (!Number.isSafeInteger(window.limit) || window.limit <= 0) {
    throw new AppError("This subscription does not include AI credits", 402, "AI_CREDITS_UNAVAILABLE");
  }
  const consumedRows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT coalesce(sum(quantity),0)::bigint AS n FROM usage_events
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC}
       AND "occurredAt">=${window.periodStart}
       AND (${window.periodEnd}::timestamptz IS NULL OR "occurredAt"<${window.periodEnd}::timestamptz)`;
  const reservedRows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT coalesce(sum(amount),0)::bigint AS n FROM quota_reservations
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC}
       AND state='RESERVED' AND "expiresAt">now()`;
  const consumed = Number(consumedRows[0]?.n ?? 0);
  const reserved = Number(reservedRows[0]?.n ?? 0);
  if (consumed + reserved + units > window.limit) {
    throw new AppError("AI credit balance is exhausted for the current billing period", 429, "AI_CREDITS_EXHAUSTED");
  }
  const ttl = Math.min(86400, Math.max(300, input.ttlSeconds ?? 86400));
  const inserted = await tx.$queryRaw<Array<{ id: string; amount: bigint; state: string; expiresAt: Date }>>`
    INSERT INTO quota_reservations(id,"organizationId",metric,amount,state,"idempotencyKey","expiresAt")
    VALUES(gen_random_uuid(),${input.organizationId}::uuid,${METRIC},${units},'RESERVED',${key},now()+(${String(ttl)}||' seconds')::interval)
    RETURNING id,amount,state,"expiresAt"`;
  await tx.auditLog.create({ data: {
    userId: input.actorId, action: "AI_CREDITS_RESERVED", targetResource: `ai-execution:${input.executionId}`,
    details: { organizationId: input.organizationId, units, balanceLimit: window.limit, billingSource: window.source },
  } });
  return inserted[0]!;
}

export async function settleAiCredits(tx: WorkspaceTransaction, input: {
  organizationId: string; actorId: string; executionId: string; action: "consume" | "release"; reason: string;
}) {
  const key = reservationKey(input.executionId);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId + ":" + METRIC}, 0))`;
  const rows = await tx.$queryRaw<Array<{ id: string; amount: bigint; state: string }>>`
    SELECT id,amount,state FROM quota_reservations
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC} AND "idempotencyKey"=${key} FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  if (row.state !== "RESERVED") return row;
  if (input.action === "consume") {
    await tx.$executeRaw`INSERT INTO usage_events(id,"organizationId",metric,quantity,"idempotencyKey","reservationId","occurredAt")
      VALUES(gen_random_uuid(),${input.organizationId}::uuid,${METRIC},${row.amount},${"consume:" + key},${row.id}::uuid,now())
      ON CONFLICT("organizationId",metric,"idempotencyKey") DO NOTHING`;
  }
  const state = input.action === "consume" ? "CONSUMED" : "RELEASED";
  await tx.$executeRaw`UPDATE quota_reservations SET state=${state},"updatedAt"=now() WHERE id=${row.id}::uuid AND state='RESERVED'`;
  await tx.auditLog.create({ data: {
    userId: input.actorId, action: input.action === "consume" ? "AI_CREDITS_CONSUMED" : "AI_CREDITS_RELEASED",
    targetResource: `ai-execution:${input.executionId}`,
    details: { organizationId: input.organizationId, units: Number(row.amount), reason: input.reason },
  } });
  return { ...row, state };
}

export async function getAiCreditBalance(tx: WorkspaceTransaction, input: { organizationId: string; actorId: string }) {
  const window = await subscriptionWindow(tx, input.organizationId, input.actorId);
  const consumedRows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT coalesce(sum(quantity),0)::bigint AS n FROM usage_events
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC}
       AND "occurredAt">=${window.periodStart}
       AND (${window.periodEnd}::timestamptz IS NULL OR "occurredAt"<${window.periodEnd}::timestamptz)`;
  const reservedRows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT coalesce(sum(amount),0)::bigint AS n FROM quota_reservations
     WHERE "organizationId"=${input.organizationId}::uuid AND metric=${METRIC}
       AND state='RESERVED' AND "expiresAt">now()`;
  const used = Number(consumedRows[0]?.n ?? 0);
  const reserved = Number(reservedRows[0]?.n ?? 0);
  return {
    limit: window.limit, used, reserved, remaining: Math.max(0, window.limit - used - reserved),
    periodStart: window.periodStart, periodEnd: window.periodEnd, source: window.source,
  };
}
