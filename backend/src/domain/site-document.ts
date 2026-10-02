import { z } from "zod";
import { AppError } from "../utils/app-error.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const RESERVED_JSON_KEYS=new Set(["__proto__","prototype","constructor"]);
export function assertSafeJsonKeys(value:unknown,path="document",seen=new WeakSet<object>()):void{
  if(value===null||typeof value!=="object")return;
  if(seen.has(value as object))throw new AppError(`Circular value is not allowed at ${path}`,422,"SITE_DOCUMENT_INVALID");
  seen.add(value as object);
  if(Array.isArray(value)){
    if(value.length>20_000)throw new AppError(`JSON array is too large at ${path}`,422,"SITE_DOCUMENT_INVALID");
    value.forEach((item,index)=>assertSafeJsonKeys(item,`${path}[${index}]`,seen));
    return;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)throw new AppError(`Only plain JSON objects are accepted at ${path}`,422,"SITE_DOCUMENT_INVALID");
  for(const key of Object.keys(value)){
    if(RESERVED_JSON_KEYS.has(key))throw new AppError(`Reserved JSON key is not allowed at ${path}.${key}`,422,"SITE_DOCUMENT_INVALID");
    assertSafeJsonKeys((value as Record<string,unknown>)[key],`${path}.${key}`,seen);
  }
}
const jsonKeySchema=z.string().max(500).refine(value=>!RESERVED_JSON_KEYS.has(value),"Reserved JSON key is not allowed");
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonValueSchema).max(20_000),
  z.record(jsonKeySchema, jsonValueSchema),
]));
export const jsonObjectSchema = z.record(jsonKeySchema, jsonValueSchema);
const id = z.string().min(1).max(200);

export const siteElementSchema: z.ZodType<any> = z.lazy(() => z.object({
  id,
  type: z.string().min(1).max(120),
  name: z.string().max(255).optional(),
  props: jsonObjectSchema.default({}),
  styles: jsonObjectSchema.default({}),
  responsiveStyles: jsonObjectSchema.optional(),
  content: jsonValueSchema.optional(),
  children: z.array(siteElementSchema).max(10_000).default([]),
  componentId: id.optional(),
  isProtected: z.boolean().optional(),
  bindings: jsonObjectSchema.optional(),
}).strict());

export const pageNodeSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(512),
  title: z.string().max(255).optional(),
  elements: z.array(siteElementSchema).max(10_000).default([]),
  settings: jsonObjectSchema.default({}),
  seo: jsonObjectSchema.optional(),
}).strict();

export const componentVariantSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  props: jsonObjectSchema.default({}),
  styles: jsonObjectSchema.default({}),
}).strict();

export const componentDefSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  root: siteElementSchema,
  variants: z.array(componentVariantSchema).max(500).default([]),
  slots: z.array(z.object({ id, name: z.string().min(1).max(255), accepts: z.array(z.string().max(120)).max(100).default([]) }).strict()).max(100).default([]),
}).strict();

export const styleRuleSchema = z.object({
  id,
  selector: z.string().min(1).max(500),
  properties: jsonObjectSchema,
  breakpoint: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
}).strict();

export const designTokenSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  category: z.enum(["color", "typography", "spacing", "radius", "shadow", "size", "other"]),
  value: jsonValueSchema,
  description: z.string().max(1000).optional(),
  source: z.enum(["forge", "figma", "stitch", "import"]).optional(),
}).strict();

const persistedAssetUrl = z.string().min(1).max(4096).refine(value => {
  if (value.startsWith("/") && !value.startsWith("//")) return !/[\u0000-\u001f\\]/.test(value);
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}, "Asset URL must be an HTTP(S) URL or a root-relative path");

export const assetSchema = z.object({
  id,
  kind: z.enum(["image", "video", "file", "font", "other"]),
  url: persistedAssetUrl,
  name: z.string().max(500).optional(),
  metadata: jsonObjectSchema.default({}),
}).strict();

export const collectionFieldSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  key: z.string().min(1).max(255),
  type: z.enum(["text", "richText", "number", "boolean", "date", "image", "file", "reference", "multiReference", "json"]),
  required: z.boolean().default(false),
  referenceCollectionId: id.optional(),
  config: jsonObjectSchema.default({}),
}).strict();

export const collectionDefSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  fields: z.array(collectionFieldSchema).max(500).default([]),
}).strict();

export const collectionItemSchema = z.object({
  id,
  collectionId: id,
  title: z.string().max(500).optional(),
  slug: z.string().max(500).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  values: jsonObjectSchema.default({}),
}).strict();

export const cmsBindingSchema = z.object({
  id,
  elementId: id,
  property: z.string().min(1).max(255),
  collectionId: id,
  fieldId: id,
}).strict();

export const interactionSchema = z.object({
  id,
  elementId: id.optional(),
  trigger: z.string().min(1).max(120),
  action: z.string().min(1).max(120),
  config: jsonObjectSchema.default({}),
}).strict();

export const formSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  fields: z.array(jsonObjectSchema).max(500).default([]),
  actions: z.array(jsonObjectSchema).max(100).default([]),
  settings: jsonObjectSchema.default({}),
}).strict();

export const localeOverlaySchema = z.object({
  id,
  locale: z.string().min(2).max(32),
  values: jsonObjectSchema.default({}),
}).strict();

export const experimentSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  status: z.enum(["DRAFT", "RUNNING", "PAUSED", "ENDED"]).default("DRAFT"),
  variants: z.array(jsonObjectSchema).max(100).default([]),
  allocation: jsonObjectSchema.default({}),
}).strict();

export const integrationSchema = z.object({
  id,
  provider: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  config: jsonObjectSchema.default({}),
}).strict();

export const siteDocumentSchema = z.object({
  id,
  schemaVersion: z.number().int().min(1).max(1000),
  site: z.object({
    title: z.string().min(1).max(255),
    slug: z.string().max(255).optional(),
    defaultLocale: z.string().min(2).max(32).default("en"),
    metadata: jsonObjectSchema.default({}),
  }).strict(),
  pages: z.array(pageNodeSchema).max(500).default([]),
  components: z.array(componentDefSchema).max(5_000).default([]),
  styles: z.array(styleRuleSchema).max(20_000).default([]),
  tokens: z.array(designTokenSchema).max(10_000).default([]),
  assets: z.array(assetSchema).max(20_000).default([]),
  cms: z.object({
    collections: z.array(collectionDefSchema).max(2_000).default([]),
    items: z.array(collectionItemSchema).max(50_000).default([]),
    bindings: z.array(cmsBindingSchema).max(20_000).default([]),
  }).strict().default({ collections: [], items: [], bindings: [] }),
  interactions: z.array(interactionSchema).max(10_000).default([]),
  forms: z.array(formSchema).max(2_000).default([]),
  locales: z.array(localeOverlaySchema).max(500).default([]),
  experiments: z.array(experimentSchema).max(2_000).default([]),
  integrations: z.array(integrationSchema).max(2_000).default([]),
  extensions: jsonObjectSchema.default({}),
}).strict();

export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export type SiteElement = z.infer<typeof siteElementSchema>;
export type CollectionDef = z.infer<typeof collectionDefSchema>;
export type CollectionItem = z.infer<typeof collectionItemSchema>;

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
  assertSafeJsonKeys(input);
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
  unique(document.cms.items.map(item => item.id), "CMS item");
  unique(document.cms.bindings.map(binding => binding.id), "CMS binding");
  unique(document.interactions.map(interaction => interaction.id), "Interaction");
  unique(document.forms.map(form => form.id), "Form");
  unique(document.locales.map(locale => locale.id), "Locale overlay");
  unique(document.experiments.map(experiment => experiment.id), "Experiment");
  unique(document.integrations.map(integration => integration.id), "Integration");

  const elementIds: string[] = [];
  for (const page of document.pages) collectElementIds(page.elements, elementIds);
  for (const component of document.components) collectElementIds([component.root], elementIds);
  unique(elementIds, "Element");

  const collectionIds = new Set(document.cms.collections.map(collection => collection.id));
  const fieldToCollection = new Map<string, string>();
  for (const collection of document.cms.collections) {
    unique(collection.fields.map(field => field.id), `Field in collection ${collection.id}`);
    unique(collection.fields.map(field => field.key), `Field key in collection ${collection.id}`);
    for (const field of collection.fields) {
      fieldToCollection.set(field.id, collection.id);
      if (field.referenceCollectionId && !collectionIds.has(field.referenceCollectionId)) {
        throw new AppError("CMS field references an unknown collection", 422, "SITE_DOCUMENT_INVALID");
      }
    }
  }

  const SECRET_CONFIG_KEYS=/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|private[_-]?key|secret|bearer)$/i;
  const rejectInlineSecrets=(value:JsonValue,path:string):void=>{
    if(Array.isArray(value)){value.forEach((item,index)=>rejectInlineSecrets(item,`${path}[${index}]`));return;}
    if(!value||typeof value!=="object")return;
    for(const [key,child] of Object.entries(value)){
      if(SECRET_CONFIG_KEYS.test(key)) throw new AppError(`Integration config may not persist secret material at ${path}.${key}`,422,"SITE_DOCUMENT_SECRET_FORBIDDEN");
      rejectInlineSecrets(child,`${path}.${key}`);
    }
  };
  for(const integration of document.integrations) rejectInlineSecrets(integration.config,`integrations.${integration.id}.config`);

  const knownElementIds = new Set(elementIds);
  const knownComponentIds = new Set(document.components.map(component => component.id));
  const validateElementRefs=(elements:SiteElement[]):void=>{
    for(const element of elements){
      if(element.componentId&&!knownComponentIds.has(element.componentId)) throw new AppError("Element references an unknown component",422,"SITE_DOCUMENT_INVALID");
      validateElementRefs(element.children??[]);
    }
  };
  for(const page of document.pages) validateElementRefs(page.elements);
  for(const component of document.components) validateElementRefs([component.root]);
  for(const interaction of document.interactions){
    if(interaction.elementId&&!knownElementIds.has(interaction.elementId)) throw new AppError("Interaction references an unknown element",422,"SITE_DOCUMENT_INVALID");
  }
  for (const item of document.cms.items) {
    if (!collectionIds.has(item.collectionId)) throw new AppError("CMS item references an unknown collection", 422, "SITE_DOCUMENT_INVALID");
  }
  for (const binding of document.cms.bindings) {
    if (!collectionIds.has(binding.collectionId) || fieldToCollection.get(binding.fieldId) !== binding.collectionId || !knownElementIds.has(binding.elementId)) {
      throw new AppError("CMS binding references an unknown collection, field, or element", 422, "SITE_DOCUMENT_INVALID");
    }
  }

  return document;
}

export function isCanonicalSiteDocument(input: unknown): input is SiteDocument {
  return !!input && typeof input === "object" && !Array.isArray(input) && "schemaVersion" in input && "site" in input && "cms" in input;
}
