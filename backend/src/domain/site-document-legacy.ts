import { randomUUID } from "node:crypto";
import { validateSiteDocument, type JsonValue, type SiteDocument, type SiteElement } from "./site-document.js";

type LegacyObject = Record<string, any>;
export type LegacyCmsType = {
  id: string; name: string; slug: string; description?: string | null;
  fields?: Array<{ id: string; name: string; slug?: string; key?: string; type?: string; config?: unknown; required?: boolean }>;
  entries?: Array<{ id: string; title?: string; slug?: string | null; status?: string; data?: unknown; values?: unknown }>;
};

function object(value: unknown): LegacyObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LegacyObject : {};
}
function json(value: unknown, fallback: JsonValue = null): JsonValue {
  if (value === undefined) return fallback;
  try { return JSON.parse(JSON.stringify(value)) as JsonValue; } catch { return fallback; }
}
function id(value: unknown, prefix: string): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : `${prefix}-${randomUUID()}`;
  return text.slice(0, 200);
}
function slug(value: unknown, fallback: string): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.startsWith("/") ? text : `/${text.replace(/^\/+/, "")}`;
}
const elementStructural = new Set(["id", "type", "name", "styles", "responsiveStyles", "content", "children", "elements", "componentId", "isProtected", "bindings"]);

export function legacyElementToSiteElement(input: unknown): SiteElement {
  const source = object(input);
  const props: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!elementStructural.has(key) && value !== undefined) props[key] = json(value);
  }
  const rawChildren = Array.isArray(source.children) ? source.children : Array.isArray(source.elements) ? source.elements : [];
  return {
    id: id(source.id, "element"),
    type: typeof source.type === "string" && source.type ? source.type.slice(0, 120) : "container",
    ...(typeof source.name === "string" ? { name: source.name.slice(0, 255) } : {}),
    props,
    styles: object(json(source.styles, {})) as Record<string, JsonValue>,
    ...(source.responsiveStyles && typeof source.responsiveStyles === "object" ? { responsiveStyles: object(json(source.responsiveStyles, {})) as Record<string, JsonValue> } : {}),
    ...(source.content !== undefined ? { content: json(source.content) } : {}),
    children: rawChildren.map(legacyElementToSiteElement),
    ...(typeof source.componentId === "string" ? { componentId: source.componentId.slice(0, 200) } : {}),
    ...(typeof source.isProtected === "boolean" ? { isProtected: source.isProtected } : {}),
    ...(source.bindings && typeof source.bindings === "object" ? { bindings: object(json(source.bindings, {})) as Record<string, JsonValue> } : {}),
  };
}

export function siteElementToLegacy(element: SiteElement): LegacyObject {
  return {
    ...object(json(element.props, {})),
    id: element.id,
    type: element.type,
    ...(element.name ? { name: element.name } : {}),
    ...(element.content !== undefined ? { content: element.content } : {}),
    styles: element.styles ?? {},
    ...(element.responsiveStyles ? { responsiveStyles: element.responsiveStyles } : {}),
    ...(element.componentId ? { componentId: element.componentId } : {}),
    ...(element.isProtected !== undefined ? { isProtected: element.isProtected } : {}),
    ...(element.bindings ? { bindings: element.bindings } : {}),
    children: (element.children ?? []).map(siteElementToLegacy),
  };
}

function tokensFromGlobalStyles(globalStyles: LegacyObject) {
  const result: SiteDocument["tokens"] = [];
  const add = (name: string, category: SiteDocument["tokens"][number]["category"], value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    result.push({ id: `legacy-token-${name.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 200), name, category, value: json(value), source: "import" });
  };
  const colors = object(globalStyles.colors);
  for (const [key, value] of Object.entries(colors)) add(`colors.${key}`, "color", value);
  const typography = object(globalStyles.typography);
  for (const [key, value] of Object.entries(typography)) add(`typography.${key}`, "typography", value);
  for (const [key, category] of [["primaryColor", "color"], ["secondaryColor", "color"], ["accentColor", "color"], ["backgroundColor", "color"], ["textColor", "color"], ["borderRadius", "radius"], ["containerMaxWidth", "size"]] as const) {
    add(key, category, globalStyles[key]);
  }
  return result;
}

function cmsFromLegacy(types: LegacyCmsType[] = []): SiteDocument["cms"] {
  const collections = types.map(type => ({
    id: id(type.id, "collection"),
    name: String(type.name || type.slug || "Collection").slice(0, 255),
    slug: String(type.slug || type.name || "collection").slice(0, 255),
    ...(type.description ? { description: String(type.description).slice(0, 2000) } : {}),
    fields: (type.fields ?? []).map(field => ({
      id: id(field.id, "field"),
      name: String(field.name || field.key || field.slug || "Field").slice(0, 255),
      key: String(field.key || field.slug || field.name || "field").slice(0, 255),
      type: (["text","richText","number","boolean","date","image","file","reference","multiReference","json"].includes(String(field.type)) ? String(field.type) : "text") as any,
      required: Boolean(field.required),
      config: object(json(field.config, {})) as Record<string, JsonValue>,
    })),
  }));
  const items = types.flatMap(type => (type.entries ?? []).map(entry => ({
    id: id(entry.id, "item"),
    collectionId: id(type.id, "collection"),
    ...(entry.title ? { title: String(entry.title).slice(0, 500) } : {}),
    ...(entry.slug ? { slug: String(entry.slug).slice(0, 500) } : {}),
    status: (["DRAFT","PUBLISHED","ARCHIVED"].includes(String(entry.status).toUpperCase()) ? String(entry.status).toUpperCase() : "DRAFT") as "DRAFT"|"PUBLISHED"|"ARCHIVED",
    values: object(json(entry.values ?? entry.data ?? {}, {})) as Record<string, JsonValue>,
  })));
  return { collections, items, bindings: [] };
}

export function legacyWebsiteToSiteDocument(input: {
  websiteId: string; name: string; slug?: string | null; editorData: unknown; cmsTypes?: LegacyCmsType[];
}): SiteDocument {
  const legacy = object(input.editorData);
  const legacyPages = Array.isArray(legacy.pages) && legacy.pages.length ? legacy.pages : [{
    id: legacy.homePageId || "home",
    name: "Home",
    slug: "/",
    elements: Array.isArray(legacy.elements) ? legacy.elements : [],
    pageSettings: legacy.pageSettings ?? {},
  }];
  const pages = legacyPages.map((raw: unknown, index: number) => {
    const page = object(raw);
    const elements = Array.isArray(page.elements) ? page.elements : index === 0 && Array.isArray(legacy.elements) ? legacy.elements : [];
    const settings: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(page)) if (!["id","name","title","slug","elements"].includes(key) && value !== undefined) settings[key] = json(value);
    return {
      id: id(page.id, `page-${index + 1}`),
      name: String(page.name || page.title || `Page ${index + 1}`).slice(0, 255),
      slug: slug(page.slug, index === 0 ? "/" : `/page-${index + 1}`),
      ...(page.title ? { title: String(page.title).slice(0, 255) } : {}),
      elements: elements.map(legacyElementToSiteElement),
      settings,
      ...(page.pageSettings && typeof page.pageSettings === "object" ? { seo: object(json(page.pageSettings, {})) as Record<string, JsonValue> } : {}),
    };
  });
  const globalStyles = object(legacy.globalStyles);
  const metadata: Record<string, JsonValue> = {
    siteSettings: json(legacy.siteSettings ?? {}),
    globalStyles: json(globalStyles),
    siteParts: json(legacy.siteParts ?? {}),
    navigation: json(legacy.navigation ?? []),
    publishing: json(legacy.publishing ?? {}),
    deployment: json(legacy.deployment ?? {}),
    homePageId: json(legacy.homePageId ?? pages[0]?.id ?? "home"),
  };
  const core = new Set(["id","name","slug","version","homePageId","pages","siteSettings","globalStyles","siteParts","navigation","publishing","deployment","elements"]);
  const extras: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(legacy)) if (!core.has(key) && value !== undefined) extras[key] = json(value);

  const document: SiteDocument = {
    id: input.websiteId,
    schemaVersion: 1,
    site: {
      title: String(input.name || legacy.siteSettings?.siteName || "Untitled site").slice(0, 255),
      ...(input.slug ? { slug: input.slug.slice(0, 255) } : {}),
      defaultLocale: String(legacy.siteSettings?.siteLanguage || "en").slice(0, 32),
      metadata,
    },
    pages,
    components: [],
    styles: [],
    tokens: tokensFromGlobalStyles(globalStyles),
    assets: [],
    cms: cmsFromLegacy(input.cmsTypes),
    interactions: [],
    forms: [],
    locales: [],
    experiments: [],
    integrations: [],
    extensions: { legacyTopLevel: extras },
  };
  return validateSiteDocument(document);
}

export function siteDocumentToLegacy(documentInput: SiteDocument): LegacyObject {
  const document = validateSiteDocument(documentInput);
  const metadata = object(document.site.metadata);
  const extras = object(document.extensions.legacyTopLevel);
  const pages = document.pages.map(page => ({
    ...object(page.settings),
    id: page.id,
    name: page.name,
    ...(page.title ? { title: page.title } : {}),
    slug: page.slug,
    elements: page.elements.map(siteElementToLegacy),
    ...(page.seo ? { pageSettings: page.seo } : {}),
  }));
  const homePageId = typeof metadata.homePageId === "string" && pages.some(page => page.id === metadata.homePageId) ? metadata.homePageId : pages[0]?.id ?? "home";
  const home = pages.find(page => page.id === homePageId) ?? pages[0];
  return {
    ...extras,
    version: Math.max(1, Number(extras.version || 1)),
    homePageId,
    pages,
    siteSettings: { ...object(metadata.siteSettings), siteName: document.site.title, siteLanguage: document.site.defaultLocale },
    globalStyles: object(metadata.globalStyles),
    siteParts: object(metadata.siteParts),
    navigation: Array.isArray(metadata.navigation) ? metadata.navigation : [],
    publishing: object(metadata.publishing),
    deployment: object(metadata.deployment),
    elements: home?.elements ?? [],
  };
}
