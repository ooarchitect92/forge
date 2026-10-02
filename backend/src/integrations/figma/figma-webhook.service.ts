import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { prisma } from "../../config/prisma.js";
import { getScopedWebsite } from "../../services/websites/scoped-access.js";
import { canUserAccessResource } from "../../services/permission.service.js";
import { getFigmaAccessContext } from "./figma-sync.service.js";

function fileKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{6,255}$/.test(value)) {
    throw new AppError("Invalid Figma file key", 400, "FIGMA_FILE_KEY_INVALID");
  }
  return value;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function publicBase(): string {
  const raw = String(process.env.FIGMA_WEBHOOK_PUBLIC_URL || "").trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError("Figma webhook public URL is not configured", 503, "FIGMA_WEBHOOK_NOT_CONFIGURED"); }
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new AppError("Figma webhook public URL is invalid", 503, "FIGMA_WEBHOOK_NOT_CONFIGURED");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new AppError("Figma webhook public URL must use HTTPS", 503, "FIGMA_WEBHOOK_NOT_CONFIGURED");
  }
  return url.toString().replace(/\/+$/, "");
}
async function figmaWebhookRequest(
  path: string,
  token: string,
  init: { method: "POST" | "DELETE"; body?: unknown },
): Promise<Record<string, unknown>> {
  const serialized = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (serialized && Buffer.byteLength(serialized) > 128 * 1024) {
    throw new AppError("Figma webhook request is too large", 413, "FIGMA_WEBHOOK_REQUEST_TOO_LARGE");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.figma.com${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(serialized ? { "Content-Type": "application/json" } : {}),
      },
      body: serialized,
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 256 * 1024) throw new AppError("Figma webhook response is too large", 502, "FIGMA_WEBHOOK_UPSTREAM_INVALID");
    if (init.method === "DELETE" && response.status === 404) return {};
    if (!response.ok) throw new AppError("Figma rejected the webhook request", 502, "FIGMA_WEBHOOK_REJECTED");
    if (!text.trim()) return {};
    try { return JSON.parse(text) as Record<string, unknown>; }
    catch { throw new AppError("Figma returned an invalid webhook response", 502, "FIGMA_WEBHOOK_UPSTREAM_INVALID"); }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Figma webhook outcome is unknown and requires reconciliation", 503, "FIGMA_WEBHOOK_OUTCOME_UNKNOWN");
  } finally {
    clearTimeout(timer);
  }
}

export async function createFigmaFileWebhook(input: { websiteId: string; actorId: string; fileKey: unknown }) {
  const key = fileKey(input.fileKey);
  const website = await getScopedWebsite(input.websiteId, input.actorId);
  if (!website.organizationId || !website.workspaceId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  if (!await canUserAccessResource(input.actorId, input.websiteId, "*", "MANAGE_INTEGRATIONS")) {
    throw new AppError("Integration management is not permitted", 403, "FORBIDDEN");
  }
  const access = await getFigmaAccessContext(input.websiteId, input.actorId);
  const existing = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    return tx.figmaWebhookSubscription.findUnique({
      where: { websiteId_fileKey_eventType: { websiteId: input.websiteId, fileKey: key, eventType: "FILE_UPDATE" } },
    });
  });
  if (existing?.status === "ACTIVE") return existing;
  if (existing?.status === "RECONCILIATION_REQUIRED") {
    throw new AppError("This Figma webhook requires reconciliation before another registration attempt", 409, "FIGMA_WEBHOOK_RECONCILIATION_REQUIRED");
  }

  const id = existing?.id ?? randomUUID();
  const passcode = randomBytes(32).toString("base64url");
  const passcodeHash = digest(passcode);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    await tx.figmaWebhookSubscription.upsert({
      where: { websiteId_fileKey_eventType: { websiteId: input.websiteId, fileKey: key, eventType: "FILE_UPDATE" } },
      update: { status: "CREATING", passcodeHash, figmaWebhookId: null, actorId: input.actorId, workspaceId: website.workspaceId },
      create: {
        id, websiteId: input.websiteId, organizationId: website.organizationId!, workspaceId: website.workspaceId,
        actorId: input.actorId, fileKey: key, eventType: "FILE_UPDATE", passcodeHash, status: "CREATING",
      },
    });
  });

  const endpoint = `${publicBase()}/api/v1/integrations/figma/webhooks/${website.organizationId}/${id}`;
  try {
    const remote = await figmaWebhookRequest("/v2/webhooks", access.token, {
      method: "POST",
      body: {
        event_type: "FILE_UPDATE",
        context: "file",
        context_id: key,
        endpoint,
        passcode,
        description: `Forge SiteDocument sync for ${input.websiteId}`,
      },
    });
    const figmaWebhookId = typeof remote.id === "string" || typeof remote.id === "number" ? String(remote.id) : "";
    if (!figmaWebhookId) throw new AppError("Figma did not return a webhook identifier", 502, "FIGMA_WEBHOOK_UPSTREAM_INVALID");
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      const row = await tx.figmaWebhookSubscription.update({
        where: { id }, data: { figmaWebhookId, status: "ACTIVE" },
      });
      await tx.auditLog.create({ data: {
        userId: input.actorId, action: "FIGMA_WEBHOOK_CONNECTED", targetResource: `website:${input.websiteId}`,
        details: { fileKey: key, subscriptionId: id, figmaWebhookId },
      } });
      return row;
    });
  } catch (error) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      await tx.figmaWebhookSubscription.updateMany({
        where: { id },
        data: { status: error instanceof AppError && error.code === "FIGMA_WEBHOOK_REJECTED" ? "REVOKED" : "RECONCILIATION_REQUIRED" },
      });
    }).catch(() => undefined);
    throw error;
  }
}

export async function deleteFigmaFileWebhook(input: { websiteId: string; actorId: string; subscriptionId: string }) {
  const website = await getScopedWebsite(input.websiteId, input.actorId);
  if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  if (!await canUserAccessResource(input.actorId, input.websiteId, "*", "MANAGE_INTEGRATIONS")) {
    throw new AppError("Integration management is not permitted", 403, "FORBIDDEN");
  }
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    return tx.figmaWebhookSubscription.findFirst({ where: { id: input.subscriptionId, websiteId: input.websiteId } });
  });
  if (!row) throw new AppError("Figma webhook subscription was not found", 404, "NOT_FOUND");
  if (row.status === "REVOKED") return row;
  const access = await getFigmaAccessContext(input.websiteId, input.actorId);
  if (row.figmaWebhookId) await figmaWebhookRequest(`/v2/webhooks/${encodeURIComponent(row.figmaWebhookId)}`, access.token, { method: "DELETE" });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    const revoked = await tx.figmaWebhookSubscription.update({ where: { id: row.id }, data: { status: "REVOKED" } });
    await tx.auditLog.create({ data: {
      userId: input.actorId, action: "FIGMA_WEBHOOK_REVOKED", targetResource: `website:${input.websiteId}`,
      details: { subscriptionId: row.id, fileKey: row.fileKey },
    } });
    return revoked;
  });
}

export async function listFigmaFileWebhooks(websiteId: string, actorId: string) {
  const website = await getScopedWebsite(websiteId, actorId);
  if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    return tx.figmaWebhookSubscription.findMany({
      where: { websiteId, status: { not: "REVOKED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileKey: true, eventType: true, status: true, lastEventAt: true, createdAt: true },
    });
  });
}

export async function receiveFigmaWebhook(input: { organizationId: string; subscriptionId: string; body: unknown }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.organizationId) || !/^[0-9a-f-]{36}$/i.test(input.subscriptionId)) {
    throw new AppError("Webhook target is invalid", 404, "NOT_FOUND");
  }
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) throw new AppError("Webhook payload is invalid", 400, "FIGMA_WEBHOOK_INVALID");
  const raw = input.body as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(raw)) > 256 * 1024) throw new AppError("Webhook payload is too large", 413, "FIGMA_WEBHOOK_TOO_LARGE");
  const passcode = typeof raw.passcode === "string" ? raw.passcode : "";
  if (!passcode || passcode.length > 500) throw new AppError("Webhook passcode is invalid", 400, "FIGMA_WEBHOOK_INVALID");
  const eventType = typeof raw.event_type === "string" ? raw.event_type : "";
  const receivedFileKey = typeof raw.file_key === "string" ? raw.file_key : "";
  if (eventType !== "FILE_UPDATE") return { accepted: true, ignored: true };

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${input.organizationId}, true)`;
    const subscription = await tx.figmaWebhookSubscription.findFirst({
      where: { id: input.subscriptionId, organizationId: input.organizationId, status: "ACTIVE" },
    });
    if (!subscription) throw new AppError("Webhook subscription was not found", 404, "NOT_FOUND");
    const actual = Buffer.from(digest(passcode), "hex");
    const expected = Buffer.from(subscription.passcodeHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError("Webhook passcode is invalid", 400, "FIGMA_WEBHOOK_INVALID");
    if (receivedFileKey !== subscription.fileKey) throw new AppError("Webhook file scope is invalid", 400, "FIGMA_WEBHOOK_INVALID");

    const timestamp = typeof raw.timestamp === "string" || typeof raw.timestamp === "number" ? String(raw.timestamp) : "";
    const webhookId = typeof raw.webhook_id === "string" || typeof raw.webhook_id === "number" ? String(raw.webhook_id) : subscription.figmaWebhookId ?? "";
    const eventKey = digest([webhookId, eventType, receivedFileKey, timestamp].join("|"));
    const summary = {
      fileName: typeof raw.file_name === "string" ? raw.file_name.slice(0, 500) : null,
      timestamp: timestamp.slice(0, 100),
      webhookId: webhookId.slice(0, 255),
    };
    const encoded = JSON.stringify(summary);
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO figma_webhook_events
        (id,"subscriptionId","websiteId","organizationId","eventKey","eventType","fileKey",summary,status,"receivedAt")
      VALUES
        (gen_random_uuid(),${subscription.id}::uuid,${subscription.websiteId}::uuid,${subscription.organizationId}::uuid,
         ${eventKey},${eventType},${subscription.fileKey},${encoded}::jsonb,'PENDING',now())
      ON CONFLICT ("subscriptionId","eventKey") DO NOTHING
      RETURNING id
    `;
    await tx.figmaWebhookSubscription.update({ where: { id: subscription.id }, data: { lastEventAt: new Date() } });
    if (inserted[0]) {
      await tx.auditLog.create({ data: {
        userId: subscription.actorId, action: "FIGMA_FILE_UPDATE_RECEIVED", targetResource: `website:${subscription.websiteId}`,
        details: { subscriptionId: subscription.id, fileKey: subscription.fileKey, eventId: inserted[0].id },
      } });
      if (subscription.actorId) {
        await tx.$executeRaw`
          INSERT INTO workspace_outbox ("organizationId","actorId",operation,"resourceId")
          VALUES (${subscription.organizationId}::uuid,${subscription.actorId}::uuid,'FIGMA_FILE_UPDATED',${subscription.websiteId}::uuid)
        `;
      }
    }
    return { accepted: true, duplicate: !inserted[0], eventId: inserted[0]?.id ?? null, websiteId: subscription.websiteId };
  });
}

export async function listFigmaWebhookEvents(websiteId: string, actorId: string) {
  const website = await getScopedWebsite(websiteId, actorId);
  if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    return tx.figmaWebhookEvent.findMany({
      where: { websiteId, status: "PENDING" },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: { id: true, subscriptionId: true, eventType: true, fileKey: true, summary: true, receivedAt: true },
    });
  });
}

export async function dismissFigmaWebhookEvent(input: { websiteId: string; actorId: string; eventId: string }) {
  const website = await getScopedWebsite(input.websiteId, input.actorId);
  if (!website.organizationId) throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  if (!await canUserAccessResource(input.actorId, input.websiteId, "*", "EDIT_DESIGN")) throw new AppError("Design editing is not permitted", 403, "FORBIDDEN");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    const changed = await tx.figmaWebhookEvent.updateMany({
      where: { id: input.eventId, websiteId: input.websiteId, status: "PENDING" },
      data: { status: "DISMISSED", dismissedAt: new Date() },
    });
    if (changed.count !== 1) throw new AppError("Figma update event was not found", 404, "NOT_FOUND");
    return { id: input.eventId, status: "DISMISSED" };
  });
}
