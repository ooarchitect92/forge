import { z } from "zod";
import { AppError } from "../../utils/app-error.js";

const slugSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const fieldKeySchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);
const scalarValueSchema = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const figmaImportRequestSchema = z.object({
  source: z.string().trim().min(8).max(2_000),
  nodeIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  depth: z.number().int().min(1).max(8).default(6),
  pageNamePrefix: z.string().trim().min(1).max(60).optional(),
}).strict();
export type FigmaImportRequest = z.infer<typeof figmaImportRequestSchema>;

export const cmsFieldTypeSchema = z.enum(["text", "rich-text", "image", "number", "boolean"]);
export type CmsFieldType = z.infer<typeof cmsFieldTypeSchema>;

const cmsFieldSchema = z.object({
  name: z.string().trim().min(1).max(100),
  key: fieldKeySchema,
  type: cmsFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.record(z.string().min(1).max(64), scalarValueSchema).default({}),
}).strict();

const cmsEntrySchema = z.object({
  title: z.string().trim().min(1).max(255),
  slug: slugSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).default("DRAFT"),
  values: z.record(fieldKeySchema, scalarValueSchema).default({}),
}).strict();

const cmsCollectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  singular: z.string().trim().min(1).max(100),
  plural: z.string().trim().min(1).max(100),
  slug: slugSchema,
  description: z.string().trim().max(1_000).default(""),
  isPublic: z.boolean().default(true),
  hasArchive: z.boolean().default(true),
  fields: z.array(cmsFieldSchema).min(1).max(50),
  items: z.array(cmsEntrySchema).max(50).default([]),
}).strict();

export const cmsBlueprintSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(""),
  collections: z.array(cmsCollectionSchema).min(1).max(10),
}).strict();
export type CmsBlueprint = z.infer<typeof cmsBlueprintSchema>;

function expectedValue(type: CmsFieldType, value: unknown): boolean {
  if (value === null) return true;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

/**
 * The schema is intentionally merge-only. Destructive field changes need a
 * separately reviewed migration, so an AI/template import can never silently
 * erase production content.
 */
export function normalizeCmsBlueprint(input: unknown): CmsBlueprint {
  const parsed = cmsBlueprintSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("CMS blueprint is invalid", 422, "CMS_BLUEPRINT_INVALID");
  }

  const collectionSlugs = new Set<string>();
  let totalFields = 0;
  let totalItems = 0;
  for (const collection of parsed.data.collections) {
    if (collectionSlugs.has(collection.slug)) {
      throw new AppError("CMS collection slugs must be unique", 422, "CMS_BLUEPRINT_INVALID");
    }
    collectionSlugs.add(collection.slug);

    const fields = new Map<string, CmsFieldType>();
    for (const field of collection.fields) {
      if (fields.has(field.key)) {
        throw new AppError("CMS field keys must be unique inside a collection", 422, "CMS_BLUEPRINT_INVALID");
      }
      fields.set(field.key, field.type);
      totalFields += 1;
    }

    const entrySlugs = new Set<string>();
    for (const entry of collection.items) {
      if (entrySlugs.has(entry.slug)) {
        throw new AppError("CMS item slugs must be unique inside a collection", 422, "CMS_BLUEPRINT_INVALID");
      }
      entrySlugs.add(entry.slug);
      for (const [key, value] of Object.entries(entry.values)) {
        const type = fields.get(key);
        if (!type || !expectedValue(type, value)) {
          throw new AppError("CMS item values do not match the declared fields", 422, "CMS_BLUEPRINT_INVALID");
        }
      }
      for (const field of collection.fields) {
        if (field.required && (!Object.hasOwn(entry.values, field.key) || entry.values[field.key] === null || entry.values[field.key] === "")) {
          throw new AppError("A required CMS value is missing", 422, "CMS_BLUEPRINT_INVALID");
        }
      }
      totalItems += 1;
    }
  }

  if (totalFields + totalItems > 200) {
    throw new AppError("CMS blueprint exceeds the supported change budget", 413, "CMS_BLUEPRINT_TOO_LARGE");
  }
  return parsed.data;
}

export const industryTemplateIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const industryTemplateSchema = z.object({
  id: industryTemplateIdSchema,
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  aiBrief: z.string().min(50).max(12_000),
  pages: z.array(z.string().min(1).max(100)).min(1).max(12),
  cms: cmsBlueprintSchema,
}).strict();
export type IndustryTemplate = z.infer<typeof industryTemplateSchema>;
