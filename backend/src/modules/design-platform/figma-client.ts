import { AppError } from "../../utils/app-error.js";
import { getActiveConnectorCredential } from "../../platform/integrations/connector-credentials.js";
import { resolveSecretReference } from "../../platform/secrets/secret-provider.js";
import type { FigmaImportRequest } from "./contracts.js";

const FIGMA_API_ORIGIN = "https://api.figma.com";
const MAX_FIGMA_RESPONSE_BYTES = 8 * 1024 * 1024;

export type FigmaNode = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  visible?: unknown;
  children?: unknown;
  characters?: unknown;
  style?: unknown;
  fills?: unknown;
  strokes?: unknown;
  strokeWeight?: unknown;
  effects?: unknown;
  opacity?: unknown;
  blendMode?: unknown;
  layoutMode?: unknown;
  layoutWrap?: unknown;
  itemSpacing?: unknown;
  counterAxisSpacing?: unknown;
  paddingTop?: unknown;
  paddingRight?: unknown;
  paddingBottom?: unknown;
  paddingLeft?: unknown;
  primaryAxisAlignItems?: unknown;
  counterAxisAlignItems?: unknown;
  layoutSizingHorizontal?: unknown;
  layoutSizingVertical?: unknown;
  layoutGrow?: unknown;
  cornerRadius?: unknown;
  rectangleCornerRadii?: unknown;
  clipsContent?: unknown;
  absoluteBoundingBox?: unknown;
};

export type FigmaSource = {
  fileKey: string;
  nodeIds: string[];
};

export type FigmaFileSnapshot = {
  fileKey: string;
  fileName: string;
  lastModified: string | null;
  version: string | null;
  requestedNodeIds: string[];
  roots: FigmaNode[];
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  styles: Record<string, unknown>;
};

function normalizeNodeId(value: string): string {
  const trimmed = decodeURIComponent(value).trim();
  if (/^[A-Za-z0-9_-]{1,100}$/.test(trimmed) && trimmed.includes("-")) return trimmed.replace(/-/g, ":");
  if (!/^[A-Za-z0-9_:.-]{1,100}$/.test(trimmed)) throw new AppError("Figma node identifier is invalid", 422, "FIGMA_SOURCE_INVALID");
  return trimmed;
}

export function parseFigmaSource(source: string, explicitNodeIds: string[] = []): FigmaSource {
  const value = source.trim();
  let fileKey = "";
  let urlNodeId: string | null = null;

  if (/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    fileKey = value;
  } else {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new AppError("Provide a Figma file URL or file key", 422, "FIGMA_SOURCE_INVALID"); }
    if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.hostname.toLowerCase())) {
      throw new AppError("Only figma.com file links are supported", 422, "FIGMA_SOURCE_INVALID");
    }
    const match = /^\/(?:file|design|proto|board)\/([A-Za-z0-9_-]{8,128})(?:\/|$)/.exec(url.pathname);
    if (!match) throw new AppError("Figma link does not contain a supported file key", 422, "FIGMA_SOURCE_INVALID");
    fileKey = match[1]!;
    urlNodeId = url.searchParams.get("node-id");
  }

  const nodeIds = [...explicitNodeIds, ...(urlNodeId ? [urlNodeId] : [])].map(normalizeNodeId);
  return { fileKey, nodeIds: [...new Set(nodeIds)].slice(0, 20) };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function node(value: unknown): FigmaNode | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as FigmaNode : null;
}

async function connectorToken(input: { organizationId: string | null; websiteId: string }): Promise<{ token: string; oauth: boolean }> {
  let reference: string | null = null;
  if (input.organizationId) {
    const connector = await getActiveConnectorCredential({ organizationId: input.organizationId, websiteId: input.websiteId, provider: "figma" });
    reference = connector?.secretRef ?? null;
  }
  if (!reference && process.env.NODE_ENV !== "production" && process.env.FIGMA_ACCESS_TOKEN) {
    const token = process.env.FIGMA_ACCESS_TOKEN.trim();
    if (token.length < 20 || token.length > 2_000 || /\s/.test(token)) throw new AppError("Development Figma token is invalid", 503, "FIGMA_NOT_CONFIGURED");
    return { token, oauth: false };
  }
  if (!reference) throw new AppError("Connect Figma to this website before importing a design", 503, "FIGMA_NOT_CONFIGURED");

  const raw = (await resolveSecretReference(reference)).trim();
  let token = raw;
  let oauth = false;
  if (raw.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new AppError("Figma connector secret is invalid", 503, "FIGMA_NOT_CONFIGURED"); }
    token = String(parsed.accessToken ?? parsed.personalAccessToken ?? parsed.token ?? "").trim();
    oauth = String(parsed.authType ?? "").toLowerCase() === "oauth" || Object.hasOwn(parsed, "accessToken");
  }
  if (token.length < 20 || token.length > 2_000 || /\s/.test(token)) {
    throw new AppError("Figma connector token is unavailable", 503, "FIGMA_NOT_CONFIGURED");
  }
  return { token, oauth };
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_FIGMA_RESPONSE_BYTES) throw new AppError("Figma file is too large to import safely", 413, "FIGMA_FILE_TOO_LARGE");
  if (!response.body) throw new AppError("Figma returned an empty response", 502, "FIGMA_UPSTREAM_ERROR");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_FIGMA_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AppError("Figma file is too large to import safely", 413, "FIGMA_FILE_TOO_LARGE");
    }
    parts.push(value);
  }
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new AppError("Figma returned invalid JSON", 502, "FIGMA_UPSTREAM_ERROR"); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new AppError("Figma returned an invalid document", 502, "FIGMA_UPSTREAM_ERROR");
  return decoded as Record<string, unknown>;
}

export async function fetchFigmaFile(input: {
  request: FigmaImportRequest;
  organizationId: string | null;
  websiteId: string;
}): Promise<FigmaFileSnapshot> {
  const source = parseFigmaSource(input.request.source, input.request.nodeIds ?? []);
  const auth = await connectorToken({ organizationId: input.organizationId, websiteId: input.websiteId });
  const path = source.nodeIds.length
    ? `/v1/files/${encodeURIComponent(source.fileKey)}/nodes`
    : `/v1/files/${encodeURIComponent(source.fileKey)}`;
  const url = new URL(path, FIGMA_API_ORIGIN);
  url.searchParams.set("depth", String(input.request.depth));
  if (source.nodeIds.length) url.searchParams.set("ids", source.nodeIds.join(","));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(Number(process.env.FIGMA_API_TIMEOUT_MS || 20_000)),
      headers: auth.oauth ? { Authorization: `Bearer ${auth.token}` } : { "X-Figma-Token": auth.token },
    });
  } catch {
    throw new AppError("Figma could not be reached", 503, "FIGMA_UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) throw new AppError("Figma access was rejected; reconnect the integration", 502, "FIGMA_ACCESS_REJECTED");
  if (response.status === 404) throw new AppError("Figma file or selected nodes were not found", 404, "FIGMA_FILE_NOT_FOUND");
  if (response.status === 429) throw new AppError("Figma rate limit reached", 429, "FIGMA_RATE_LIMITED");
  if (!response.ok) throw new AppError(`Figma request failed (HTTP ${response.status})`, 502, "FIGMA_UPSTREAM_ERROR");

  const body = await boundedJson(response);
  const roots: FigmaNode[] = [];
  if (source.nodeIds.length) {
    const nodes = jsonObject(body.nodes);
    for (const id of source.nodeIds) {
      const entry = jsonObject(nodes[id]);
      const selected = node(entry.document);
      if (selected) roots.push(selected);
    }
  } else {
    const document = node(body.document);
    if (document) roots.push(document);
  }
  if (!roots.length) throw new AppError("Figma response did not contain importable nodes", 422, "FIGMA_EMPTY_SELECTION");

  return {
    fileKey: source.fileKey,
    fileName: typeof body.name === "string" ? body.name.slice(0, 255) : "Figma design",
    lastModified: typeof body.lastModified === "string" ? body.lastModified : null,
    version: typeof body.version === "string" ? body.version : null,
    requestedNodeIds: source.nodeIds,
    roots,
    components: jsonObject(body.components),
    componentSets: jsonObject(body.componentSets),
    styles: jsonObject(body.styles),
  };
}
