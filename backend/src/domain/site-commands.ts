import { z } from "zod";
import { AppError } from "../utils/app-error.js";
import { designTokenSchema, siteElementSchema, styleRuleSchema, validateSiteDocument, type SiteDocument, type SiteElement } from "./site-document.js";

const id = z.string().min(1).max(200);
const jsonValue: z.ZodType<any> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValue),
  z.record(z.string(), jsonValue),
]));

export const siteCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element.insert"), pageId: id, parentId: id.optional(), index: z.number().int().min(0).optional(), element: siteElementSchema }).strict(),
  z.object({ type: z.literal("element.delete"), pageId: id, elementId: id }).strict(),
  z.object({ type: z.literal("element.updateProperties"), pageId: id, elementId: id, props: z.record(z.string(), jsonValue) }).strict(),
  z.object({ type: z.literal("token.set"), token: designTokenSchema }).strict(),
  z.object({ type: z.literal("token.delete"), tokenId: id }).strict(),
  z.object({ type: z.literal("style.updateRule"), rule: styleRuleSchema }).strict(),
]);

export type SiteCommand = z.infer<typeof siteCommandSchema>;

function findElement(elements: SiteElement[], idValue: string): SiteElement | undefined {
  for (const element of elements) {
    if (element.id === idValue) return element;
    const nested = findElement(element.children ?? [], idValue);
    if (nested) return nested;
  }
  return undefined;
}

function removeElement(elements: SiteElement[], idValue: string): boolean {
  const index = elements.findIndex(element => element.id === idValue);
  if (index >= 0) {
    elements.splice(index, 1);
    return true;
  }
  for (const element of elements) if (removeElement(element.children ?? [], idValue)) return true;
  return false;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function parseSiteCommands(input: unknown): SiteCommand[] {
  const parsed = z.array(siteCommandSchema).min(1).max(500).safeParse(input);
  if (!parsed.success) throw new AppError("Invalid SiteDocument command batch", 422, "SITE_COMMAND_INVALID");
  return parsed.data;
}

export function applySiteCommands(current: SiteDocument, commandsInput: unknown): SiteDocument {
  const commands = parseSiteCommands(commandsInput);
  const next = clone(validateSiteDocument(current));

  for (const command of commands) {
    if (command.type.startsWith("element.")) {
      const page = next.pages.find(candidate => candidate.id === command.pageId);
      if (!page) throw new AppError("Command references an unknown page", 422, "SITE_COMMAND_TARGET_NOT_FOUND");

      if (command.type === "element.insert") {
        if (findElement(page.elements, command.element.id)) throw new AppError("Element already exists", 409, "SITE_COMMAND_CONFLICT");
        const target = command.parentId ? findElement(page.elements, command.parentId) : undefined;
        if (command.parentId && !target) throw new AppError("Parent element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
        const children = target ? target.children : page.elements;
        const index = command.index === undefined ? children.length : Math.min(command.index, children.length);
        children.splice(index, 0, clone(command.element));
      } else if (command.type === "element.delete") {
        if (!removeElement(page.elements, command.elementId)) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      } else {
        const element = findElement(page.elements, command.elementId);
        if (!element) throw new AppError("Element was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
        element.props = { ...element.props, ...clone(command.props) };
      }
      continue;
    }

    if (command.type === "token.set") {
      const index = next.tokens.findIndex(token => token.id === command.token.id);
      if (index >= 0) next.tokens[index] = clone(command.token); else next.tokens.push(clone(command.token));
    } else if (command.type === "token.delete") {
      const index = next.tokens.findIndex(token => token.id === command.tokenId);
      if (index < 0) throw new AppError("Token was not found", 422, "SITE_COMMAND_TARGET_NOT_FOUND");
      next.tokens.splice(index, 1);
    } else if (command.type === "style.updateRule") {
      const index = next.styles.findIndex(rule => rule.id === command.rule.id);
      if (index >= 0) next.styles[index] = clone(command.rule); else next.styles.push(clone(command.rule));
    }
  }

  return validateSiteDocument(next);
}
