import { canonicalDocumentJson } from "../services/websites/document-policy.js";
import type { SiteCommand } from "./site-commands.js";
import type { SiteDocument } from "./site-document.js";

function same(left: unknown, right: unknown): boolean {
  return canonicalDocumentJson(left) === canonicalDocumentJson(right);
}

/**
 * Deterministic typed-command diff for imported/generated visual state.
 * Dynamic CMS data, integrations and experiments are intentionally not removed
 * by a visual proposal unless their own explicit commands are supplied.
 */
export function diffVisualSiteDocuments(current: SiteDocument, target: SiteDocument): SiteCommand[] {
  const commands: SiteCommand[] = [];
  const targetPageIds = new Set(target.pages.map(page => page.id));
  for (const page of current.pages) if (!targetPageIds.has(page.id)) commands.push({ type: "page.delete", pageId: page.id });
  for (const page of target.pages) {
    const existing = current.pages.find(value => value.id === page.id);
    if (!existing) commands.push({ type: "page.create", page });
    else if (!same(existing, page)) {
      commands.push({ type: "page.delete", pageId: page.id });
      commands.push({ type: "page.create", page });
    }
  }

  const targetTokens = new Map(target.tokens.map(token => [token.id, token]));
  for (const token of current.tokens) {
    if ((token.source === "figma" || token.source === "stitch" || token.source === "import") && !targetTokens.has(token.id)) {
      commands.push({ type: "token.delete", tokenId: token.id });
    }
  }
  for (const token of target.tokens) {
    const existing = current.tokens.find(value => value.id === token.id);
    if (!existing || !same(existing, token)) commands.push({ type: "token.set", token });
  }

  const targetStyles = new Map(target.styles.map(rule => [rule.id, rule]));
  for (const rule of current.styles) if (!targetStyles.has(rule.id)) commands.push({ type: "style.deleteRule", ruleId: rule.id });
  for (const rule of target.styles) {
    const existing = current.styles.find(value => value.id === rule.id);
    if (!existing || !same(existing, rule)) commands.push({ type: "style.updateRule", rule });
  }

  if (!same(current.site.metadata, target.site.metadata)) commands.push({ type: "site.setMetadata", metadata: target.site.metadata });
  return commands;
}
