import test from "node:test";
import assert from "node:assert/strict";
import { applySiteCommands } from "../domain/site-commands.js";
import { validateSiteDocument, type SiteDocument } from "../domain/site-document.js";

function document(): SiteDocument {
  return validateSiteDocument({
    id: "site-1",
    schemaVersion: 1,
    site: { title: "Forge", defaultLocale: "en", metadata: {} },
    pages: [{ id: "home", name: "Home", slug: "/", settings: {}, elements: [] }],
    components: [],
    styles: [],
    tokens: [],
    assets: [],
    cms: { collections: [], bindings: [] },
    interactions: [],
    forms: [],
    locales: [],
    experiments: [],
    integrations: [],
  });
}

test("canonical SiteDocument accepts a minimal valid site", () => {
  const value = document();
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.pages[0]?.id, "home");
});

test("typed commands mutate a cloned document and preserve the source", () => {
  const source = document();
  const next = applySiteCommands(source, [
    { type: "element.insert", pageId: "home", element: { id: "hero", type: "section", props: {}, styles: {}, children: [] } },
    { type: "element.updateProperties", pageId: "home", elementId: "hero", props: { role: "banner" } },
    { type: "token.set", token: { id: "color-primary", name: "Primary", category: "color", value: "#102A43" } },
  ]);
  assert.equal(source.pages[0]?.elements.length, 0);
  assert.equal(next.pages[0]?.elements[0]?.id, "hero");
  assert.equal(next.pages[0]?.elements[0]?.props.role, "banner");
  assert.equal(next.tokens[0]?.value, "#102A43");
});

test("commands reject missing targets instead of silently drifting", () => {
  assert.throws(() => applySiteCommands(document(), [
    { type: "element.delete", pageId: "home", elementId: "missing" },
  ]), /Element was not found/);
});
