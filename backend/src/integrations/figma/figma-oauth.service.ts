import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { prisma } from "../../config/prisma.js";
import { getScopedWebsite } from "../../services/websites/scoped-access.js";
import { canUserAccessResource } from "../../services/permission.service.js";
import { registerConnectorCredential, getActiveConnectorCredential, updateConnectorCredential } from "../../platform/integrations/connector-credentials.js";
import { storeSecretJson } from "../../platform/secrets/secret-provider.js";
import { encryptFigmaOAuthState, decryptFigmaOAuthState } from "./figma-oauth-vault.js";

const DEFAULT_SCOPES = [
  "current_user:read",
  "file_content:read",
  "library_content:read",
  "file_variables:read",
  "file_variables:write",
  "webhooks:read",
  "webhooks:write",
] as const;
const ALLOWED_SCOPES = new Set<string>(DEFAULT_SCOPES);

function config() {
  const clientId = String(process.env.FIGMA_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.FIGMA_OAUTH_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.FIGMA_OAUTH_REDIRECT_URI || "").trim();
  if (!clientId || !clientSecret || !/^https?:\/\//i.test(redirectUri)) {
    throw new AppError("Figma OAuth is not configured", 503, "FIGMA_OAUTH_NOT_CONFIGURED");
  }
  const requested = String(process.env.FIGMA_OAUTH_SCOPES || DEFAULT_SCOPES.join(","))
    .split(",").map(value => value.trim()).filter(Boolean);
  if (!requested.length || requested.some(scope => !ALLOWED_SCOPES.has(scope))) {
    throw new AppError("Figma OAuth scopes are invalid", 503, "FIGMA_OAUTH_NOT_CONFIGURED");
  }
  const secretPrefix = String(process.env.FIGMA_CONNECTOR_SECRET_PREFIX || "forge/connectors/figma")
    .replace(/^\/+|\/+$/g, "");
  if (!secretPrefix || secretPrefix.length > 200 || /\s/.test(secretPrefix)) {
    throw new AppError("Figma connector secret prefix is invalid", 503, "FIGMA_OAUTH_NOT_CONFIGURED");
  }
  return { clientId, clientSecret, redirectUri, scopes: [...new Set(requested)], secretPrefix };
}

function b64url(buffer: Buffer) { return buffer.toString("base64url"); }
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }

function validateCode(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4096 || /[\u0000-\u001f]/.test(value)) {
    throw new AppError("Figma authorization code is invalid", 400, "FIGMA_OAUTH_CODE_INVALID");
  }
  return value;
}
function validateState(value: unknown) {
  if (typeof value !== "string" || value.length < 40 || value.length > 500 ||
      !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/i.test(value)) {
    throw new AppError("Figma OAuth state is invalid", 400, "FIGMA_OAUTH_STATE_INVALID");
  }
  return value;
}
function organizationFromState(state: string) {
  const organizationId = state.split(".", 1)[0]!;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    throw new AppError("Figma OAuth state is invalid", 400, "FIGMA_OAUTH_STATE_INVALID");
  }
  return organizationId;
}

async function exchange(body: URLSearchParams) {
  const cfg = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.figma.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 256 * 1024) {
      throw new AppError("Figma OAuth response is too large", 502, "FIGMA_OAUTH_UPSTREAM_INVALID");
    }
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch {}
    if (!response.ok) throw new AppError("Figma OAuth token exchange failed", 502, "FIGMA_OAUTH_EXCHANGE_FAILED");
    const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
    const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    const expiresIn = Number(parsed.expires_in);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new AppError("Figma OAuth token response is invalid", 502, "FIGMA_OAUTH_UPSTREAM_INVALID");
    }
    return {
      accessToken,
      refreshToken: refreshToken || undefined,
      expiresAt: new Date(Date.now() + Math.min(expiresIn, 31_536_000) * 1000).toISOString(),
      figmaUserId: typeof parsed.user_id_string === "string" ? parsed.user_id_string : undefined,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Figma OAuth request failed", 502, "FIGMA_OAUTH_EXCHANGE_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

async function me(accessToken: string) {
  const response = await fetch("https://api.figma.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AppError("Figma account verification failed", 502, "FIGMA_OAUTH_VERIFY_FAILED");
  const json = await response.json() as Record<string, unknown>;
  return {
    id: typeof json.id === "string" ? json.id : undefined,
    handle: typeof json.handle === "string" ? json.handle : undefined,
    email: typeof json.email === "string" ? json.email : undefined,
  };
}

export async function startFigmaOAuth(websiteId: string, actorId: string) {
  const cfg = config();
  const website = await getScopedWebsite(websiteId, actorId);
  if (!website.organizationId || !website.workspaceId) {
    throw new AppError("Website ownership migration is required", 503, "TENANT_MIGRATION_REQUIRED");
  }
  if (!await canUserAccessResource(actorId, websiteId, "*", "MANAGE_INTEGRATIONS")) {
    throw new AppError("Integration management is not permitted", 403, "FORBIDDEN");
  }
  const state = `${website.organizationId}.${b64url(randomBytes(32))}`;
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    await tx.figmaOAuthState.deleteMany({ where: { websiteId, expiresAt: { lt: new Date() } } });
    await tx.figmaOAuthState.create({ data: {
      organizationId: website.organizationId!,
      workspaceId: website.workspaceId,
      websiteId,
      actorId,
      stateHash: sha(state),
      verifierCiphertext: encryptFigmaOAuthState(verifier),
      scopes: cfg.scopes,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    } });
  });
  const url = new URL("https://www.figma.com/oauth");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", cfg.scopes.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), expiresInSeconds: 600, scopes: cfg.scopes };
}

export async function completeFigmaOAuth(input: { state: unknown; code: unknown; actorId: string }) {
  const cfg = config();
  const state = validateState(input.state);
  const code = validateCode(input.code);
  const organizationId = organizationFromState(state);
  const pending = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${organizationId}, true)`;
    const row = await tx.figmaOAuthState.findUnique({ where: { stateHash: sha(state) } });
    if (!row || row.organizationId !== organizationId || row.actorId !== input.actorId ||
        row.consumedAt || row.expiresAt <= new Date()) {
      throw new AppError("Figma OAuth state expired or was already used", 409, "FIGMA_OAUTH_STATE_INVALID");
    }
    const website = await tx.website.findUnique({
      where: { id: row.websiteId },
      select: { id: true, organizationId: true, workspaceId: true },
    });
    if (!website || website.organizationId !== organizationId || website.workspaceId !== row.workspaceId) {
      throw new AppError("Figma OAuth website scope changed", 409, "FIGMA_OAUTH_SCOPE_CHANGED");
    }
    const claimed = await tx.figmaOAuthState.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError("Figma OAuth state was already used", 409, "FIGMA_OAUTH_STATE_INVALID");
    return { row, verifier: decryptFigmaOAuthState(row.verifierCiphertext) };
  });
  if (!await canUserAccessResource(input.actorId, pending.row.websiteId, "*", "MANAGE_INTEGRATIONS")) {
    throw new AppError("Integration management is not permitted", 403, "FORBIDDEN");
  }
  const tokens = await exchange(new URLSearchParams({
    redirect_uri: cfg.redirectUri,
    code,
    grant_type: "authorization_code",
    code_verifier: pending.verifier,
  }));
  const account = await me(tokens.accessToken);
  const secretId = `${cfg.secretPrefix}/${organizationId}/${pending.row.websiteId}`;
  const secretRef = await storeSecretJson(secretId, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? "",
    expiresAt: tokens.expiresAt,
    figmaUserId: tokens.figmaUserId ?? account.id ?? "",
    figmaHandle: account.handle ?? "",
    figmaEmail: account.email ?? "",
  });
  const existing = await getActiveConnectorCredential({
    organizationId,
    websiteId: pending.row.websiteId,
    provider: "figma",
  });
  let credentialId = existing?.id;
  const scopes=(pending.row.scopes as string[])||cfg.scopes;
  if (!existing) {
    const created = await registerConnectorCredential({
      organizationId,
      workspaceId: pending.row.workspaceId,
      websiteId: pending.row.websiteId,
      actorId: input.actorId,
      provider: "figma",
      secretRef,
      scopes,
      metadata: {},
    });
    credentialId = created.id;
  } else {
    await updateConnectorCredential({
      organizationId,actorId:input.actorId,credentialId:existing.id,secretRef,scopes,
      metadata:{figmaUserId:tokens.figmaUserId??account.id??""},
    });
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${organizationId}, true)`;
    await tx.auditLog.create({ data: {
      userId: input.actorId,
      action: "FIGMA_OAUTH_CONNECTED",
      targetResource: `website:${pending.row.websiteId}`,
      details: {
        organizationId,
        credentialId,
        figmaUserId: tokens.figmaUserId ?? account.id ?? null,
        scopes: pending.row.scopes,
      },
    } });
  });
  return {
    websiteId: pending.row.websiteId,
    credentialId,
    account: {
      id: tokens.figmaUserId ?? account.id ?? null,
      handle: account.handle ?? null,
      email: account.email ?? null,
    },
    scopes: pending.row.scopes,
  };
}

export async function refreshFigmaOAuthToken(refreshToken: string) {
  if (typeof refreshToken !== "string" || refreshToken.length < 8 || refreshToken.length > 4096) {
    throw new AppError("Figma refresh token is invalid", 503, "FIGMA_OAUTH_REFRESH_FAILED");
  }
  try {
    return await exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
  } catch {
    throw new AppError("Figma authorization expired; reconnect Figma", 401, "FIGMA_OAUTH_REFRESH_FAILED");
  }
}
