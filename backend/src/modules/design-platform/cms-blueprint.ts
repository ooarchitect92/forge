import type { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { authorizeWebsiteDocumentWrite } from "../../services/websites/save-document.js";
import { workspaceCommand } from "../../services/workspaces/command.js";
import { normalizeCmsBlueprint, type CmsBlueprint } from "./contracts.js";

export type CmsBlueprintPlanAction = {
  collection: string;
  kind: "CREATE_COLLECTION" | "UPDATE_COLLECTION" | "KEEP_COLLECTION" | "CREATE_FIELD" | "UPDATE_FIELD" | "KEEP_FIELD" | "CONFLICT_FIELD_TYPE" | "CREATE_ITEM" | "UPDATE_ITEM";
  target: string;
  detail?: string;
};

type ExistingCollection = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  supports: unknown;
  fields: Array<{ id: string; name: string; slug: string; type: string; order: number; config: unknown }>;
  entries: Array<{ id: string; slug: string | null }>;
};

type CollectionMetadata = {
  singular: string;
  plural: string;
  isPublic: boolean;
  hasArchive: boolean;
};

type FieldMetadata = {
  required: boolean;
  options: Record<string, unknown>;
};

const DEFAULT_SUPPORTS = ["title", "editor", "thumbnail"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 20)
    : [];
}

function collectionMetadata(value: unknown, fallbackName: string): CollectionMetadata {
  const root = record(value);
  const metadata = record(root.forgeCms);
  return {
    singular: typeof metadata.singular === "string" && metadata.singular.trim() ? metadata.singular : fallbackName,
    plural: typeof metadata.plural === "string" && metadata.plural.trim() ? metadata.plural : fallbackName,
    isPublic: typeof metadata.isPublic === "boolean" ? metadata.isPublic : true,
    hasArchive: typeof metadata.hasArchive === "boolean" ? metadata.hasArchive : true,
  };
}

function collectionSupports(
  existing: unknown,
  desired: CmsBlueprint["collections"][number],
): Prisma.InputJsonValue {
  const root = record(existing);
  const capabilities = stringArray(Array.isArray(existing) ? existing : root.capabilities);
  return {
    capabilities: capabilities.length ? capabilities : DEFAULT_SUPPORTS,
    forgeCms: {
      version: 1,
      singular: desired.singular,
      plural: desired.plural,
      isPublic: desired.isPublic,
      hasArchive: desired.hasArchive,
    },
  };
}

function fieldMetadata(value: unknown): FieldMetadata {
  const root = record(value);
  return {
    required: root.required === true,
    options: record(root.options),
  };
}

function fieldConfig(field: CmsBlueprint["collections"][number]["fields"][number]): Prisma.InputJsonValue {
  return { required: field.required, options: field.options };
}

function collectionMetadataChanged(existing: ExistingCollection, desired: CmsBlueprint["collections"][number]): boolean {
  const metadata = collectionMetadata(existing.supports, existing.name);
  return existing.name !== desired.name || metadata.singular !== desired.singular || metadata.plural !== desired.plural ||
    (existing.description ?? "") !== desired.description || metadata.isPublic !== desired.isPublic || metadata.hasArchive !== desired.hasArchive;
}

function buildPreview(blueprint: CmsBlueprint, existing: ExistingCollection[]) {
  const collections = new Map(existing.map((collection) => [collection.slug, collection]));
  const actions: CmsBlueprintPlanAction[] = [];
  let conflicts = 0;

  for (const collection of blueprint.collections) {
    const current = collections.get(collection.slug);
    actions.push({
      collection: collection.slug,
      kind: !current ? "CREATE_COLLECTION" : collectionMetadataChanged(current, collection) ? "UPDATE_COLLECTION" : "KEEP_COLLECTION",
      target: collection.slug,
    });
    const fields = new Map((current?.fields ?? []).map((field) => [field.slug, field]));
    for (const [order, field] of collection.fields.entries()) {
      const present = fields.get(field.key);
      const metadata = present ? fieldMetadata(present.config) : null;
      let kind: CmsBlueprintPlanAction["kind"];
      let detail: string | undefined;
      if (!present) kind = "CREATE_FIELD";
      else if (present.type !== field.type) {
        kind = "CONFLICT_FIELD_TYPE";
        detail = `Existing type ${present.type}; requested type ${field.type}`;
        conflicts += 1;
      } else if (present.name !== field.name || metadata?.required !== field.required || present.order !== order ||
        JSON.stringify(metadata?.options ?? {}) !== JSON.stringify(field.options)) kind = "UPDATE_FIELD";
      else kind = "KEEP_FIELD";
      actions.push({ collection: collection.slug, kind, target: field.key, ...(detail ? { detail } : {}) });
    }
    const items = new Set((current?.entries ?? []).flatMap((entry) => typeof entry.slug === "string" ? [entry.slug] : []));
    for (const item of collection.items) {
      actions.push({ collection: collection.slug, kind: items.has(item.slug) ? "UPDATE_ITEM" : "CREATE_ITEM", target: item.slug });
    }
  }

  const summary = actions.reduce<Record<string, number>>((result, action) => {
    result[action.kind] = (result[action.kind] ?? 0) + 1;
    return result;
  }, {});
  return { blueprint, actions, summary, canApply: conflicts === 0, conflictCount: conflicts };
}

export async function previewCmsBlueprint(websiteId: string, actorId: string, raw: unknown) {
  const blueprint = normalizeCmsBlueprint(raw);
  return prisma.$transaction(async (tx) => {
    const scope = await authorizeWebsiteDocumentWrite(tx, websiteId, actorId);
    if (!scope.can("EDIT_CONTENT")) throw new AppError("CMS editing is not permitted", 403, "CMS_EDIT_FORBIDDEN");
    const existing = await tx.customPostType.findMany({
      where: { websiteId },
      include: {
        fields: { orderBy: { order: "asc" } },
        entries: { select: { id: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return buildPreview(blueprint, existing);
  });
}

export async function applyCmsBlueprint(
  websiteId: string,
  actorId: string,
  raw: unknown,
  idempotencyKey: string,
) {
  const blueprint = normalizeCmsBlueprint(raw);
  return workspaceCommand({
    actorId,
    operation: "CMS_BLUEPRINT_APPLIED",
    key: idempotencyKey,
    payload: { websiteId, blueprint },
    authorize: async (tx) => {
      const scope = await authorizeWebsiteDocumentWrite(tx, websiteId, actorId);
      if (!scope.can("EDIT_CONTENT")) throw new AppError("CMS editing is not permitted", 403, "CMS_EDIT_FORBIDDEN");
      return scope;
    },
    execute: async (tx) => {
      await tx.$queryRaw`SELECT id FROM websites WHERE id=${websiteId}::uuid FOR UPDATE`;
      const counts = { collectionsCreated: 0, collectionsUpdated: 0, fieldsCreated: 0, fieldsUpdated: 0, itemsCreated: 0, itemsUpdated: 0 };
      const collectionIds: Record<string, string> = {};

      for (const desired of blueprint.collections) {
        const existing = await tx.customPostType.findUnique({
          where: { websiteId_slug: { websiteId, slug: desired.slug } },
          include: { fields: true, entries: { select: { id: true, slug: true } } },
        });
        const supports = collectionSupports(existing?.supports, desired);
        const collection = existing
          ? await tx.customPostType.update({
              where: { id: existing.id },
              data: {
                name: desired.name,
                description: desired.description || null,
                supports,
              },
            })
          : await tx.customPostType.create({
              data: {
                websiteId,
                name: desired.name,
                slug: desired.slug,
                description: desired.description || null,
                supports,
              },
            });
        if (existing) counts.collectionsUpdated += 1; else counts.collectionsCreated += 1;
        collectionIds[desired.slug] = collection.id;
        const fields = new Map((existing?.fields ?? []).map((field) => [field.slug, field]));
        const entries = new Map((existing?.entries ?? []).flatMap((entry) => typeof entry.slug === "string" ? [[entry.slug, entry] as const] : []));

        for (const [order, field] of desired.fields.entries()) {
          const present = fields.get(field.key);
          if (present && present.type !== field.type) {
            throw new AppError(`Field ${desired.slug}.${field.key} requires a reviewed type migration`, 409, "CMS_FIELD_TYPE_CONFLICT");
          }
          const data = {
            name: field.name,
            type: field.type,
            order,
            config: fieldConfig(field),
          };
          if (present) {
            await tx.customField.update({ where: { id: present.id }, data });
            counts.fieldsUpdated += 1;
          } else {
            await tx.customField.create({ data: { postTypeId: collection.id, slug: field.key, ...data } });
            counts.fieldsCreated += 1;
          }
        }

        for (const item of desired.items) {
          const present = entries.get(item.slug);
          if (present) {
            await tx.customEntry.update({
              where: { id: present.id },
              data: { title: item.title, status: item.status, data: item.values as Prisma.InputJsonValue },
            });
            counts.itemsUpdated += 1;
          } else {
            await tx.customEntry.create({
              data: {
                postTypeId: collection.id,
                authorId: actorId,
                title: item.title,
                slug: item.slug,
                status: item.status,
                data: item.values as Prisma.InputJsonValue,
              },
            });
            counts.itemsCreated += 1;
          }
        }
      }
      return { resourceId: websiteId, websiteId, blueprintName: blueprint.name, collectionIds, counts };
    },
  });
}
