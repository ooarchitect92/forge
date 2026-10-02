import { z } from "zod";
import { AppError } from "../utils/app-error.js";
import {
  assetSchema, cmsBindingSchema, collectionDefSchema, collectionFieldSchema, collectionItemSchema,
  componentDefSchema, componentVariantSchema, designTokenSchema, experimentSchema, formSchema, integrationSchema, interactionSchema, jsonObjectSchema,
  jsonValueSchema, localeOverlaySchema, pageNodeSchema, siteElementSchema, styleRuleSchema,
  validateSiteDocument, type SiteDocument, type SiteElement,
} from "./site-document.js";

const id = z.string().min(1).max(200);

export const siteCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page.create"), page: pageNodeSchema }).strict(),
  z.object({ type: z.literal("page.update"), pageId: id, patch: z.object({ name: z.string().min(1).max(255).optional(), slug: z.string().min(1).max(512).optional(), title: z.string().max(255).optional(), settings: jsonObjectSchema.optional(), seo: jsonObjectSchema.optional() }).strict() }).strict(),
  z.object({ type: z.literal("page.delete"), pageId: id }).strict(),

  z.object({ type: z.literal("element.insert"), pageId: id, parentId: id.optional(), index: z.number().int().min(0).optional(), element: siteElementSchema }).strict(),
  z.object({ type: z.literal("element.delete"), pageId: id, elementId: id }).strict(),
  z.object({ type: z.literal("element.move"), pageId: id, elementId: id, newParentId: id.optional(), index: z.number().int().min(0).optional() }).strict(),
  z.object({ type: z.literal("element.updateProperties"), pageId: id, elementId: id, props: jsonObjectSchema }).strict(),
  z.object({ type: z.literal("element.updateStyles"), pageId: id, elementId: id, styles: jsonObjectSchema, responsiveStyles: jsonObjectSchema.optional() }).strict(),

  z.object({ type: z.literal("component.create"), component: componentDefSchema }).strict(),
  z.object({ type: z.literal("component.delete"), componentId: id }).strict(),
  z.object({ type: z.literal("component.update"), componentId: id, patch: z.object({ name: z.string().min(1).max(255).optional(), root: siteElementSchema.optional(), slots: componentDefSchema.shape.slots.optional() }).strict() }).strict(),
  z.object({ type: z.literal("component.variant.set"), componentId: id, variant: componentVariantSchema }).strict(),
  z.object({ type: z.literal("component.variant.delete"), componentId: id, variantId: id }).strict(),
  z.object({ type: z.literal("component.extract"), pageId: id, elementId: id, componentId: id, name: z.string().min(1).max(255) }).strict(),

  z.object({ type: z.literal("token.set"), token: designTokenSchema }).strict(),
  z.object({ type: z.literal("token.delete"), tokenId: id }).strict(),
  z.object({ type: z.literal("style.updateRule"), rule: styleRuleSchema }).strict(),
  z.object({ type: z.literal("style.deleteRule"), ruleId: id }).strict(),
  z.object({ type: z.literal("asset.add"), asset: assetSchema }).strict(),
  z.object({ type: z.literal("asset.delete"), assetId: id }).strict(),

  z.object({ type: z.literal("cms.collection.create"), collection: collectionDefSchema }).strict(),
  z.object({ type: z.literal("cms.collection.update"), collectionId: id, patch: z.object({ name: z.string().min(1).max(255).optional(), slug: z.string().min(1).max(255).optional(), description: z.string().max(2000).optional() }).strict() }).strict(),
  z.object({ type: z.literal("cms.collection.delete"), collectionId: id }).strict(),
  z.object({ type: z.literal("cms.field.add"), collectionId: id, field: collectionFieldSchema }).strict(),
  z.object({ type: z.literal("cms.field.update"), collectionId: id, fieldId: id, field: collectionFieldSchema }).strict(),
  z.object({ type: z.literal("cms.field.delete"), collectionId: id, fieldId: id }).strict(),
  z.object({ type: z.literal("cms.item.create"), item: collectionItemSchema }).strict(),
  z.object({ type: z.literal("cms.item.update"), itemId: id, patch: z.object({ title: z.string().max(500).optional(), slug: z.string().max(500).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), values: jsonObjectSchema.optional() }).strict() }).strict(),
  z.object({ type: z.literal("cms.item.delete"), itemId: id }).strict(),
  z.object({ type: z.literal("cms.field.bind"), binding: cmsBindingSchema }).strict(),
  z.object({ type: z.literal("cms.field.unbind"), bindingId: id }).strict(),

  z.object({ type: z.literal("interaction.set"), interaction: interactionSchema }).strict(),
  z.object({ type: z.literal("interaction.delete"), interactionId: id }).strict(),
  z.object({ type: z.literal("form.set"), form: formSchema }).strict(),
  z.object({ type: z.literal("form.delete"), formId: id }).strict(),

  z.object({ type: z.literal("locale.add"), locale: localeOverlaySchema }).strict(),
  z.object({ type: z.literal("locale.update"), localeId: id, values: jsonObjectSchema }).strict(),
  z.object({ type: z.literal("locale.delete"), localeId: id }).strict(),
  z.object({ type: z.literal("experiment.createVariant"), experiment: experimentSchema }).strict(),
  z.object({ type: z.literal("experiment.update"), experimentId: id, patch: jsonObjectSchema }).strict(),
  z.object({ type: z.literal("experiment.delete"), experimentId: id }).strict(),
  z.object({ type: z.literal("integration.set"), integration: integrationSchema }).strict(),
  z.object({ type: z.literal("integration.delete"), integrationId: id }).strict(),
  z.object({ type: z.literal("site.setMetadata"), metadata: jsonObjectSchema }).strict(),
  z.object({ type: z.literal("extension.set"), key: z.string().min(1).max(200), value: jsonValueSchema }).strict(),
]);

export type SiteCommand = z.infer<typeof siteCommandSchema>;
type ElementCommand = Extract<SiteCommand, { type:
  "element.insert" | "element.delete" | "element.move" | "element.updateProperties" | "element.updateStyles"
}>;

function clone<T>(value: T): T { return structuredClone(value); }

function findElement(elements: SiteElement[], idValue: string): SiteElement | undefined {
  for (const element of elements) {
    if (element.id === idValue) return element;
    const nested = findElement(element.children ?? [], idValue);
    if (nested) return nested;
  }
  return undefined;
}

function takeElement(elements: SiteElement[], idValue: string): SiteElement | undefined {
  const index = elements.findIndex(element => element.id === idValue);
  if (index >= 0) return elements.splice(index, 1)[0];
  for (const element of elements) {
    const nested = takeElement(element.children ?? [], idValue);
    if (nested) return nested;
  }
  return undefined;
}

function placeElement(elements: SiteElement[], parentId: string | undefined, element: SiteElement, index?: number): void {
  const parent = parentId ? findElement(elements, parentId) : undefined;
  if (parentId && !parent) throw new AppError("Parent element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
  if (parent && findElement(element.children ?? [], parent.id)) throw new AppError("An element cannot be moved inside itself", 409, "SITE_COMMAND_CYCLE");
  const target = parent ? parent.children : elements;
  const at = index === undefined ? target.length : Math.min(index, target.length);
  target.splice(at, 0, element);
}

function updateById<T extends { id: string }>(items: T[], value: T): void {
  const index = items.findIndex(item => item.id === value.id);
  if (index >= 0) items[index] = clone(value); else items.push(clone(value));
}

function deleteById<T extends { id: string }>(items: T[], value: string, label: string): void {
  const index = items.findIndex(item => item.id === value);
  if (index < 0) throw new AppError(`${label} was not found`, 422, "SITE_COMMAND_TARGET_NOT_FOUND");
  items.splice(index, 1);
}

export function parseSiteCommands(input: unknown): SiteCommand[] {
  const parsed = z.array(siteCommandSchema).min(1).max(500).safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(`Invalid SiteDocument command batch${issue?.path?.length ? ` at ${issue.path.join(".")}` : ""}`, 422, "SITE_COMMAND_INVALID");
  }
  return parsed.data;
}

export function applySiteCommands(current: SiteDocument, commandsInput: unknown): SiteDocument {
  const commands = parseSiteCommands(commandsInput);
  const next = clone(validateSiteDocument(current));

  for (const command of commands) {
    if (command.type === "page.create") {
      if (next.pages.some(page => page.id === command.page.id || page.slug === command.page.slug)) throw new AppError("Page already exists", 409, "SITE_COMMAND_CONFLICT");
      next.pages.push(clone(command.page));
      continue;
    }
    if (command.type === "page.update") {
      const page = next.pages.find(candidate => candidate.id === command.pageId);
      if (!page) throw new AppError("Page was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      Object.assign(page, clone(command.patch));
      continue;
    }
    if (command.type === "page.delete") {
      deleteById(next.pages, command.pageId, "Page");
      continue;
    }

    if (
      command.type === "element.insert" || command.type === "element.delete" || command.type === "element.move" ||
      command.type === "element.updateProperties" || command.type === "element.updateStyles"
    ) {
      const elementCommand = command as ElementCommand;
      const page = next.pages.find(candidate => candidate.id === elementCommand.pageId);
      if (!page) throw new AppError("Command references an unknown page", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      if (elementCommand.type === "element.insert") {
        if (findElement(page.elements, elementCommand.element.id)) throw new AppError("Element already exists", 409, "SITE_COMMAND_CONFLICT");
        placeElement(page.elements, elementCommand.parentId, clone(elementCommand.element), elementCommand.index);
      } else if (elementCommand.type === "element.delete") {
        if (!takeElement(page.elements, elementCommand.elementId)) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      } else if (elementCommand.type === "element.move") {
        const moving = takeElement(page.elements, elementCommand.elementId);
        if (!moving) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
        try { placeElement(page.elements, elementCommand.newParentId, moving, elementCommand.index); }
        catch (error) { placeElement(page.elements, undefined, moving); throw error; }
      } else if (elementCommand.type === "element.updateProperties") {
        const element = findElement(page.elements, elementCommand.elementId);
        if (!element) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
        element.props = { ...element.props, ...clone(elementCommand.props) };
      } else {
        const element = findElement(page.elements, elementCommand.elementId);
        if (!element) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
        element.styles = { ...element.styles, ...clone(elementCommand.styles) };
        if (elementCommand.responsiveStyles) element.responsiveStyles = { ...(element.responsiveStyles ?? {}), ...clone(elementCommand.responsiveStyles) };
      }
      continue;
    }

    if (command.type === "component.create") {
      if (next.components.some(component => component.id === command.component.id)) throw new AppError("Component already exists", 409, "SITE_COMMAND_CONFLICT");
      next.components.push(clone(command.component)); continue;
    }
    if (command.type === "component.delete") {
      deleteById(next.components, command.componentId, "Component"); continue;
    }
    if (command.type === "component.update") {
      const component=next.components.find(value=>value.id===command.componentId);
      if(!component) throw new AppError("Component was not found",422,"SITE_COMMAND_TARGET_NOT_FOUND");
      Object.assign(component,clone(command.patch)); continue;
    }
    if (command.type === "component.variant.set") {
      const component=next.components.find(value=>value.id===command.componentId);
      if(!component) throw new AppError("Component was not found",422,"SITE_COMMAND_TARGET_NOT_FOUND");
      updateById(component.variants,command.variant); continue;
    }
    if (command.type === "component.variant.delete") {
      const component=next.components.find(value=>value.id===command.componentId);
      if(!component) throw new AppError("Component was not found",422,"SITE_COMMAND_TARGET_NOT_FOUND");
      deleteById(component.variants,command.variantId,"Component variant"); continue;
    }
    if (command.type === "component.extract") {
      const page = next.pages.find(candidate => candidate.id === command.pageId);
      const element = page ? findElement(page.elements, command.elementId) : undefined;
      if (!page || !element) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      if (next.components.some(component => component.id === command.componentId)) throw new AppError("Component already exists", 409, "SITE_COMMAND_CONFLICT");
      next.components.push({ id: command.componentId, name: command.name, root: clone(element), variants: [], slots: [] });
      element.componentId = command.componentId;
      continue;
    }

    if (command.type === "token.set") { updateById(next.tokens, command.token); continue; }
    if (command.type === "token.delete") { deleteById(next.tokens, command.tokenId, "Token"); continue; }
    if (command.type === "style.updateRule") { updateById(next.styles, command.rule); continue; }
    if (command.type === "style.deleteRule") { deleteById(next.styles, command.ruleId, "Style rule"); continue; }
    if (command.type === "asset.add") { updateById(next.assets, command.asset); continue; }
    if (command.type === "asset.delete") { deleteById(next.assets, command.assetId, "Asset"); continue; }

    if (command.type === "cms.collection.create") {
      if (next.cms.collections.some(collection => collection.id === command.collection.id || collection.slug === command.collection.slug)) throw new AppError("Collection already exists", 409, "SITE_COMMAND_CONFLICT");
      next.cms.collections.push(clone(command.collection)); continue;
    }
    if (command.type === "cms.collection.update") {
      const collection = next.cms.collections.find(value => value.id === command.collectionId);
      if (!collection) throw new AppError("Collection was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      Object.assign(collection, clone(command.patch)); continue;
    }
    if (command.type === "cms.collection.delete") {
      deleteById(next.cms.collections, command.collectionId, "Collection");
      next.cms.items = next.cms.items.filter(item => item.collectionId !== command.collectionId);
      next.cms.bindings = next.cms.bindings.filter(binding => binding.collectionId !== command.collectionId);
      continue;
    }
    if (command.type === "cms.field.add") {
      const collection = next.cms.collections.find(value => value.id === command.collectionId);
      if (!collection) throw new AppError("Collection was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      if (collection.fields.some(field => field.id === command.field.id || field.key === command.field.key)) throw new AppError("Collection field already exists", 409, "SITE_COMMAND_CONFLICT");
      collection.fields.push(clone(command.field)); continue;
    }
    if (command.type === "cms.field.update") {
      const collection = next.cms.collections.find(value => value.id === command.collectionId);
      const index = collection?.fields.findIndex(field => field.id === command.fieldId) ?? -1;
      if (!collection || index < 0) throw new AppError("Collection field was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      collection.fields[index] = clone(command.field); continue;
    }
    if (command.type === "cms.field.delete") {
      const collection = next.cms.collections.find(value => value.id === command.collectionId);
      if (!collection) throw new AppError("Collection was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      deleteById(collection.fields, command.fieldId, "Collection field");
      next.cms.bindings = next.cms.bindings.filter(binding => binding.fieldId !== command.fieldId);
      continue;
    }
    if (command.type === "cms.item.create") {
      if (next.cms.items.some(item => item.id === command.item.id)) throw new AppError("CMS item already exists", 409, "SITE_COMMAND_CONFLICT");
      next.cms.items.push(clone(command.item)); continue;
    }
    if (command.type === "cms.item.update") {
      const item = next.cms.items.find(value => value.id === command.itemId);
      if (!item) throw new AppError("CMS item was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      Object.assign(item, clone(command.patch)); continue;
    }
    if (command.type === "cms.item.delete") { deleteById(next.cms.items, command.itemId, "CMS item"); continue; }
    if (command.type === "cms.field.bind") { updateById(next.cms.bindings, command.binding); continue; }
    if (command.type === "cms.field.unbind") { deleteById(next.cms.bindings, command.bindingId, "CMS binding"); continue; }

    if (command.type === "interaction.set") { updateById(next.interactions,command.interaction); continue; }
    if (command.type === "interaction.delete") { deleteById(next.interactions,command.interactionId,"Interaction"); continue; }
    if (command.type === "form.set") { updateById(next.forms,command.form); continue; }
    if (command.type === "form.delete") { deleteById(next.forms,command.formId,"Form"); continue; }

    if (command.type === "locale.add") { updateById(next.locales, command.locale); continue; }
    if (command.type === "locale.update") {
      const locale = next.locales.find(value => value.id === command.localeId);
      if (!locale) throw new AppError("Locale overlay was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      locale.values = { ...locale.values, ...clone(command.values) }; continue;
    }
    if (command.type === "locale.delete") { deleteById(next.locales, command.localeId, "Locale overlay"); continue; }
    if (command.type === "experiment.createVariant") { updateById(next.experiments, command.experiment); continue; }
    if (command.type === "experiment.update") {
      const experiment = next.experiments.find(value => value.id === command.experimentId);
      if (!experiment) throw new AppError("Experiment was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      Object.assign(experiment, clone(command.patch)); continue;
    }
    if (command.type === "experiment.delete") { deleteById(next.experiments, command.experimentId, "Experiment"); continue; }
    if (command.type === "integration.set") { updateById(next.integrations, command.integration); continue; }
    if (command.type === "integration.delete") { deleteById(next.integrations, command.integrationId, "Integration"); continue; }
    if (command.type === "site.setMetadata") { next.site.metadata = { ...next.site.metadata, ...clone(command.metadata) }; continue; }
    if (command.type === "extension.set") { next.extensions[command.key] = clone(command.value); continue; }
  }

  return validateSiteDocument(next);
}
