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
  singular: string;
  plural: string;
  description: string | null;
  isPublic: boolean;
  hasArchive: boolean;
  slug: string;
  fields: Array<{ id: string; name: string; key: string; type: string; required: boolean; order: number }>;
  entries: Array<{ id: string; slug: string }>;
};

function collectionMetadataChanged(existing: ExistingCollection, desired: CmsBlueprint["collections"][number]): boolean {
  return existing.name !== desired.name || existing.singular !== desired.singular || existing.plural !== desired.plural ||
    (existing.description ?? "") !== desired.description || existing.isPublic !== desired.isPublic || existing.hasArchive !== desired.hasArchive;
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
    const fields = new Map((current?.fields ?? []).map((field) => [field.key, field]));
    for (const [order, field] of collection.fields.entries()) {
      const present = fields.get(field.key);
      let kind: CmsBlueprintPlanAction["kind"];
      let detail: string | undefined;
      if (!present) kind = "CREATE_FIELD";
      else if (present.type !== field.type) {
        kind = "CONFLICT_FIELD_TYPE";
        detail = `Existing type ${present.type}; requested type ${field.type}`;
        conflicts += 1;
      } else if (present.name !== field.name || present.required !== field.required || present.order !== order) kind = "UPDATE_FIELD";
      else kind = "KEEP_FIELD";
      actions.push({ collection: collection.slug, kind, target: field.key, ...(detail ? { detail } : {}) });
    }
    const items = new Set((current?.entries ?? []).map((entry) => entry.slug));
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
        const collection = existing
          ? await tx.customPostType.update({
              where: { id: existing.id },
              data: {
                name: desired.name,
                singular: desired.singular,
                plural: desired.plural,
                description: desired.description || null,
                isPublic: desired.isPublic,
                hasArchive: desired.hasArchive,
              },
            })
          : await tx.customPostType.create({
              data: {
                websiteId,
                name: desired.name,
                singular: desired.singular,
                plural: desired.plural,
                slug: desired.slug,
                description: desired.description || null,
                isPublic: desired.isPublic,
                hasArchive: desired.hasArchive,
              },
            });
        if (existing) counts.collectionsUpdated += 1; else counts.collectionsCreated += 1;
        collectionIds[desired.slug] = collection.id;
        const fields = new Map((existing?.fields ?? []).map((field) => [field.key, field]));
        const entries = new Map((existing?.entries ?? []).map((entry) => [entry.slug, entry]));

        for (const [order, field] of desired.fields.entries()) {
          const present = fields.get(field.key);
          if (present && present.type !== field.type) {
            throw new AppError(`Field ${desired.slug}.${field.key} requires a reviewed type migration`, 409, "CMS_FIELD_TYPE_CONFLICT");
          }
          const data = {
            name: field.name,
            type: field.type,
            required: field.required,
            order,
            options: field.options as Prisma.InputJsonValue,
          };
          if (present) {
            await tx.customField.update({ where: { id: present.id }, data });
            counts.fieldsUpdated += 1;
          } else {
            await tx.customField.create({ data: { postTypeId: collection.id, key: field.key, ...data } });
            counts.fieldsCreated += 1;
          }
        }

        for (const item of desired.items) {
          const present = entries.get(item.slug);
          if (present) {
            await tx.customEntry.update({
              where: { id: present.id },
              data: { title: item.title, status: item.status, values: item.values as Prisma.InputJsonValue },
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
                values: item.values as Prisma.InputJsonValue,
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
