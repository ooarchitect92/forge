import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeCmsBlueprint } from "../modules/design-platform/contracts.js";
import { getIndustryTemplate, listIndustryTemplates } from "../modules/design-platform/template-catalog.js";

const valid = {
  version: 1,
  name: "Knowledge base",
  description: "Structured content",
  collections: [{
    name: "Articles", singular: "Article", plural: "Articles", slug: "articles",
    description: "Help articles", isPublic: true, hasArchive: true,
    fields: [
      { name: "Body", key: "body", type: "rich-text", required: true, options: {} },
      { name: "Featured", key: "featured", type: "boolean", required: false, options: {} },
    ],
    items: [{ title: "Getting Started", slug: "getting-started", status: "DRAFT", values: { body: "Start here", featured: true } }],
  }],
};

test("CMS blueprint validates typed seed values", () => {
  const blueprint = normalizeCmsBlueprint(valid);
  assert.equal(blueprint.collections[0]?.fields[0]?.type, "rich-text");
  assert.equal(blueprint.collections[0]?.items[0]?.values.featured, true);
});

test("CMS blueprint rejects duplicate fields and type mismatches", () => {
  assert.throws(() => normalizeCmsBlueprint({
    ...valid,
    collections: [{ ...valid.collections[0], fields: [...valid.collections[0].fields, valid.collections[0].fields[0]] }],
  }), (error) => {
    assert.equal((error as { code: string }).code, "CMS_BLUEPRINT_INVALID");
    return true;
  });
  assert.throws(() => normalizeCmsBlueprint({
    ...valid,
    collections: [{ ...valid.collections[0], items: [{ ...valid.collections[0].items[0], values: { body: "Text", featured: "yes" } }] }],
  }), (error) => {
    assert.equal((error as { code: string }).code, "CMS_BLUEPRINT_INVALID");
    return true;
  });
});

test("industry templates expose a grounded AI brief and a valid CMS blueprint", () => {
  const templates = listIndustryTemplates();
  assert.ok(templates.length >= 4);
  const academy = getIndustryTemplate("academy-editorial");
  assert.match(academy.aiBrief, /Do not invent/i);
  assert.doesNotThrow(() => normalizeCmsBlueprint(academy.cms));
});
