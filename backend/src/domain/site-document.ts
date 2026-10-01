import { z } from "zod";
import { AppError } from "../utils/app-error.js";

const id = z.string().min(1).max(200);
const jsonScalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof jsonScalar> | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonScalar,
  z.array(jsonValue),
  z.record(z.string(), jsonValue),
]));

export const siteElementSchema: z.ZodType<any> = z.lazy(() => z.object({
  id,
  type: z.string().min(1).max(120),
  name: z.string().max(255).optional(),
  props: z.record(z.string(), jsonValue).default({}),
  styles: z.record(z.string(), jsonValue).default({}),
  content: jsonValue.optional(),
  children: z.array(siteElementSchema).default([]),
  componentId: id.optional(),
  isProtected: z.boolean().optional(),
}).strict());

export const pageNodeSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(512),
  title: z.string().max(255).optional(),
  elements: z.array(siteElementSchema).max(10_000).default([]),
  settings: z.record(z.string(), jsonValue).default({}),
}).strict();

export const componentDefSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  root: siteElementSchema,
  variants: z.array(z.object({
    id,
    name: z.string().min(1).max(255),
    props: z.record(z.string(), jsonValue).default({}),
  }).strict()).max(500).default([]),
}).strict();

export const styleRuleSchema = z.object({
  id,
  selector: z.string().min(1).max(500),
  properties: z.record(z.string(), jsonValue),
  breakpoint: z.string().max(120).optional(),
}).strict();

export const designTokenSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  category: z.enum(["color", "typography", "spacing", "radius", "shadow", "size", "other"]),
  value: jsonValue,
  description: z.string().max(1000).optional(),
}).strict();

export const assetSchema = z.object({
  id,
  kind: z.enum(["image", "video", "file", "font", "other"]),
  url: z.string().min(1).max(4096),
  name: z.string().max(500).optional(),
  metadata: z.record(z.string(), jsonValue).default({}),
}).strict();

export const collectionFieldSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  key: z.string().min(1).max(255),
  type: z.enum(["text", "richText", "number", "boolean", "date", "image", "file", "reference", "multiReference", "json"]),
  required: z.boolean().default(false),
  referenceCollectionId: id.optional(),
}).strict();

export const collectionDefSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  fields: z.array(collectionFieldSchema).max(500).default([]),
}).strict();

export const cmsBindingSchema = z.object({
  id,
  elementId: id,
  property: z.string().min(1).max(255),
  collectionId: id,
  fieldId: id,
}).strict();

export const siteDocumentSchema = z.object({
  id,
  schemaVersion: z.number().int().min(1),
  site: z.object({
    title: z.string().min(1).max(255),
    defaultLocale: z.string().min(2).max(32).default("en"),
    metadata: z.record(z.string(), jsonValue).default({}),
  }).strict(),
  pages: z.array(pageNodeSchema).max(500).default([]),
  components: z.array(componentDefSchema).max(5_000).default([]),
  styles: z.array(styleRuleSchema).max(20_000).default([]),
  tokens: z.array(designTokenSchema).max(10_000).default([]),
  assets: z.array(assetSchema).max(20_000).default([]),
  cms: z.object({
    collections: z.array(collectionDefSchema).max(2_000).default([]),
    bindings: z.array(cmsBindingSchema).max(20_000).default([]),
  }).strict().default({ collections: [], bindings: [] }),
  interactions: z.array(z.record(z.string(), jsonValue)).max(10_000).default([]),
  forms: z.array(z.record(z.string(), jsonValue)).max(2_000).default([]),
  locales: z.array(z.record(z.string(), jsonValue)).max(500).default([]),
  experiments: z.array(z.record(z.string(), jsonValue)).max(2_000).default([]),
  integrations: z.array(z.record(z.string(), jsonValue)).max(2_000).default([]),
}).strict();

export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export type SiteElement = z.infer<typeof siteElementSchema>;

function unique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new AppError(`${label} identifiers must be unique`, 422, "SITE_DOCUMENT_INVALID");
    seen.add(value);
  }
}

function collectElementIds(elements: SiteElement[], ids: string[]): void {
  for (const element of elements) {
    ids.push(element.id);
    collectElementIds(element.children ?? [], ids);
  }
}

export function validateSiteDocument(input: unknown): SiteDocument {
  const parsed = siteDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? ` at ${issue.path.join(".")}` : "";
    throw new AppError(`Invalid SiteDocument${path}: ${issue?.message ?? "schema violation"}`, 422, "SITE_DOCUMENT_INVALID");
  }

  const document = parsed.data;
  unique(document.pages.map(page => page.id), "Page");
  unique(document.components.map(component => component.id), "Component");
  unique(document.styles.map(style => style.id), "Style");
  unique(document.tokens.map(token => token.id), "Token");
  unique(document.assets.map(asset => asset.id), "Asset");
  unique(document.cms.collections.map(collection => collection.id), "Collection");
  unique(document.cms.bindings.map(binding => binding.id), "CMS binding");

  const elementIds: string[] = [];
  for (const page of document.pages) collectElementIds(page.elements, elementIds);
  for (const component of document.components) collectElementIds([component.root], elementIds);
  unique(elementIds, "Element");

  const collectionIds = new Set(document.cms.collections.map(collection => collection.id));
  const fieldIds = new Set(document.cms.collections.flatMap(collection => collection.fields.map(field => field.id)));
  const knownElementIds = new Set(elementIds);
  for (const binding of document.cms.bindings) {
    if (!collectionIds.has(binding.collectionId) || !fieldIds.has(binding.fieldId) || !knownElementIds.has(binding.elementId)) {
      throw new AppError("CMS binding references an unknown collection, field, or element", 422, "SITE_DOCUMENT_INVALID");
    }
  }

  return document;
}

export function isCanonicalSiteDocument(input: unknown): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input) && "schemaVersion" in input && "site" in input;
}
