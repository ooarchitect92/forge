import test from "node:test";
import assert from "node:assert/strict";
import { applySiteCommands } from "../domain/site-commands.js";
import { diffVisualSiteDocuments } from "../domain/site-document-diff.js";
import { legacyWebsiteToSiteDocument, siteDocumentToLegacy } from "../domain/site-document-legacy.js";
import { validateSiteDocument, type SiteDocument } from "../domain/site-document.js";
import { figmaToSiteCommands } from "../integrations/figma/site-document-figma.js";
import { resolveCmsBindings } from "../domain/site-document-cms.js";
import { siteDocumentToPublishableLegacy } from "../domain/site-document-publish.js";

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
    cms: { collections: [], items: [], bindings: [] },
    interactions: [],
    forms: [],
    locales: [],
    experiments: [],
    integrations: [],
    extensions: {},
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
    { type: "element.updateStyles", pageId: "home", elementId: "hero", styles: { display: "grid" } },
    { type: "token.set", token: { id: "color-primary", name: "Primary", category: "color", value: "#102A43" } },
  ]);
  assert.equal(source.pages[0]?.elements.length, 0);
  assert.equal(next.pages[0]?.elements[0]?.id, "hero");
  assert.equal(next.pages[0]?.elements[0]?.props.role, "banner");
  assert.equal(next.pages[0]?.elements[0]?.styles.display, "grid");
  assert.equal(next.tokens[0]?.value, "#102A43");
});

test("commands reject missing targets instead of silently drifting", () => {
  assert.throws(() => applySiteCommands(document(), [
    { type: "element.delete", pageId: "home", elementId: "missing" },
  ]), /Element was not found/);
});

test("element.move cannot create a parent cycle", () => {
  const source = applySiteCommands(document(), [
    { type: "element.insert", pageId: "home", element: {
      id: "parent", type: "container", props: {}, styles: {}, children: [
        { id: "child", type: "container", props: {}, styles: {}, children: [] },
      ],
    } },
  ]);
  assert.throws(() => applySiteCommands(source, [
    { type: "element.move", pageId: "home", elementId: "parent", newParentId: "child" },
  ]), /Parent element was not found|inside itself/);
});

test("CMS commands create collection, field, item and binding with referential integrity", () => {
  const withElement = applySiteCommands(document(), [
    { type: "element.insert", pageId: "home", element: { id: "title", type: "text", props: {}, styles: {}, children: [] } },
  ]);
  const next = applySiteCommands(withElement, [
    { type: "cms.collection.create", collection: { id: "posts", name: "Posts", slug: "posts", fields: [] } },
    { type: "cms.field.add", collectionId: "posts", field: { id: "post-title", name: "Title", key: "title", type: "text", required: true, config: {} } },
    { type: "cms.item.create", item: { id: "post-1", collectionId: "posts", title: "Hello", slug: "hello", status: "DRAFT", values: { title: "Hello" } } },
    { type: "cms.field.bind", binding: { id: "binding-1", elementId: "title", property: "content", collectionId: "posts", fieldId: "post-title" } },
  ]);
  assert.equal(next.cms.collections[0]?.fields[0]?.key, "title");
  assert.equal(next.cms.items[0]?.values.title, "Hello");
  assert.equal(next.cms.bindings[0]?.elementId, "title");
});

test("invalid CMS references are rejected by the canonical validator", () => {
  const value = document();
  value.cms.items.push({ id: "bad", collectionId: "missing", status: "DRAFT", values: {} });
  assert.throws(() => validateSiteDocument(value), /unknown collection/);
});

test("legacy CanonicalWebsiteData round-trips visual state without discarding unknown top-level fields", () => {
  const legacy = {
    version: 9,
    homePageId: "home",
    pages: [{ id: "home", name: "Home", slug: "/", elements: [{ id: "hero", type: "heading", content: "Hello", customAttribute: "keep-me", styles: { color: "#123456" } }] }],
    elements: [{ id: "hero", type: "heading", content: "Hello", customAttribute: "keep-me", styles: { color: "#123456" } }],
    siteSettings: { siteName: "Legacy Forge", siteLanguage: "en" },
    globalStyles: { colors: { primary: "#123456" }, typography: { fontFamily: "Inter" } },
    siteParts: {},
    navigation: [],
    publishing: { status: "DRAFT" },
    deployment: { provider: "none" },
    unknownFutureFeature: { enabled: true },
  };
  const canonical = legacyWebsiteToSiteDocument({ websiteId: "site-legacy", name: "Legacy Forge", slug: "legacy-forge", editorData: legacy });
  assert.equal(canonical.pages[0]?.elements[0]?.props.customAttribute, "keep-me");
  assert.equal(canonical.tokens.some(token => token.name === "colors.primary"), true);
  const restored = siteDocumentToLegacy(canonical);
  assert.deepEqual(restored.unknownFutureFeature, { enabled: true });
  assert.equal(restored.pages[0]?.elements[0]?.customAttribute, "keep-me");
});

test("legacy CPT definitions and entries are imported into CMS 2.0", () => {
  const canonical = legacyWebsiteToSiteDocument({
    websiteId: "site-cms",
    name: "CMS site",
    editorData: { version: 1, elements: [] },
    cmsTypes: [{
      id: "articles",
      name: "Articles",
      slug: "articles",
      fields: [{ id: "headline", name: "Headline", slug: "headline", type: "text", required: true }],
      entries: [{ id: "article-1", title: "First", slug: "first", status: "PUBLISHED", data: { headline: "First" } }],
    }],
  });
  assert.equal(canonical.cms.collections[0]?.id, "articles");
  assert.equal(canonical.cms.collections[0]?.fields[0]?.key, "headline");
  assert.equal(canonical.cms.items[0]?.values.headline, "First");
});

test("visual diff emits typed commands and preserves dynamic CMS state", () => {
  const current = applySiteCommands(document(), [
    { type: "cms.collection.create", collection: { id: "posts", name: "Posts", slug: "posts", fields: [] } },
    { type: "cms.item.create", item: { id: "post-1", collectionId: "posts", status: "DRAFT", values: { title: "Keep" } } },
  ]);
  const target = validateSiteDocument({
    ...current,
    pages: [{ id: "new-home", name: "Home", slug: "/", settings: {}, elements: [] }],
    tokens: [{ id: "stitch-primary", name: "Primary", category: "color", value: "#111111", source: "stitch" }],
  });
  const commands = diffVisualSiteDocuments(current, target);
  const next = applySiteCommands(current, commands);
  assert.equal(next.pages[0]?.id, "new-home");
  assert.equal(next.cms.items[0]?.id, "post-1");
  assert.equal(next.tokens[0]?.id, "stitch-primary");
});

test("Figma import converts frames, nodes and variables into typed commands", () => {
  const proposal = figmaToSiteCommands({
    fileKey: "AbCdEf123",
    current: document(),
    file: {
      name: "Marketing",
      version: "42",
      document: {
        id: "0:0", type: "DOCUMENT", children: [{
          id: "0:1", type: "CANVAS", name: "Pages", children: [{
            id: "1:1", type: "FRAME", name: "Landing", layoutMode: "VERTICAL", children: [
              { id: "1:2", type: "TEXT", name: "Hero", characters: "Build faster", style: { fontFamily: "Inter", fontSize: 48 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
            ],
          }],
        }],
      },
    },
    variables: { meta: { variables: {
      "VariableID:1": { id: "VariableID:1", name: "Brand/Primary", resolvedType: "COLOR", valuesByMode: { "mode:1": { r: 0.1, g: 0.2, b: 0.3, a: 1 } } },
    } } },
  });
  assert.equal(proposal.version, "42");
  assert.equal(proposal.commands.some(command => command.type === "page.create"), true);
  assert.equal(proposal.commands.some(command => command.type === "token.set"), true);
  const page = proposal.commands.find(command => command.type === "page.create");
  assert.ok(page && page.type === "page.create");
  assert.equal(page.page.elements[0]?.content, "Build faster");
  assert.equal(proposal.mappings.some(mapping => mapping.kind === "NODE" && mapping.externalId === "1:2"), true);
});


test("Figma component sets, instances and named styles become canonical components and rules", () => {
  const proposal=figmaToSiteCommands({
    fileKey:"ComponentFile123",current:document(),
    file:{
      name:"Design System",version:"9",
      document:{id:"0:0",type:"DOCUMENT",children:[{id:"0:1",type:"CANVAS",name:"Library",children:[
        {id:"10:1",type:"COMPONENT_SET",name:"Button",children:[
          {id:"10:2",type:"COMPONENT",name:"Size=Small,State=Default",fills:[{type:"SOLID",color:{r:0.1,g:0.2,b:0.3}}],children:[]},
          {id:"10:3",type:"COMPONENT",name:"Size=Large,State=Default",children:[]},
        ]},
        {id:"20:1",type:"FRAME",name:"Home",children:[
          {id:"20:2",type:"INSTANCE",name:"Primary button",componentId:"10:2",styles:{fill:"style:primary"},children:[]},
        ]},
      ]}]},
      styles:{"style:primary":{name:"Primary Fill",node_id:"20:2",styleType:"FILL"}},
    },
    variables:null,
  });
  const next=applySiteCommands(document(),proposal.commands);
  assert.equal(next.components.length,1);
  assert.equal(next.components[0]?.name,"Button");
  assert.equal(next.components[0]?.variants.length,2);
  assert.equal(next.components[0]?.variants[0]?.props.Size,"Small");
  assert.equal(next.pages[0]?.elements[0]?.componentId,next.components[0]?.id);
  assert.equal(next.styles.length,1);
  assert.match(next.styles[0]?.selector??"",/^\.figma-style-/);
  assert.equal(proposal.mappings.some(mapping=>mapping.kind==="COMPONENT"),true);
  assert.equal(proposal.mappings.some(mapping=>mapping.kind==="STYLE"),true);
});

test("CMS bindings resolve only the selected item and publish expands template pages", () => {
  let value = applySiteCommands(document(), [
    { type: "element.insert", pageId: "home", element: { id: "article-title", type: "heading", props: {}, styles: {}, children: [] } },
    { type: "page.update", pageId: "home", patch: { settings: { cmsCollectionId: "posts", cmsPathPattern: "/blog/{slug}" } } },
    { type: "cms.collection.create", collection: { id: "posts", name: "Posts", slug: "posts", fields: [] } },
    { type: "cms.field.add", collectionId: "posts", field: { id: "title-field", name: "Title", key: "title", type: "text", required: true, config: {} } },
    { type: "cms.item.create", item: { id: "post-a", collectionId: "posts", title: "A", slug: "a", status: "PUBLISHED", values: { title: "Article A" } } },
    { type: "cms.item.create", item: { id: "post-b", collectionId: "posts", title: "B", slug: "b", status: "DRAFT", values: { title: "Article B" } } },
    { type: "cms.field.bind", binding: { id: "title-binding", elementId: "article-title", property: "content", collectionId: "posts", fieldId: "title-field" } },
  ]);
  const resolved = resolveCmsBindings(value, "home", "post-a");
  assert.equal(resolved.elements[0]?.content, "Article A");
  const published = siteDocumentToPublishableLegacy(value);
  assert.equal(published.pages.length, 1);
  assert.equal(published.pages[0]?.slug, "/blog/a");
  assert.equal(published.pages[0]?.elements[0]?.content, "Article A");
  assert.equal(published.canonicalCms.items.length, 2);
});


test("command processor covers component variants, interactions and forms", () => {
  const value=applySiteCommands(document(),[
    {type:"element.insert",pageId:"home",element:{id:"hero",type:"section",props:{},styles:{},children:[]}},
    {type:"component.create",component:{id:"card",name:"Card",root:{id:"card-root",type:"container",props:{},styles:{},children:[]},variants:[],slots:[]}},
    {type:"component.variant.set",componentId:"card",variant:{id:"featured",name:"Featured",props:{featured:true},styles:{borderWidth:2}}},
    {type:"interaction.set",interaction:{id:"reveal",elementId:"hero",trigger:"scroll",action:"animate",config:{preset:"fade-up"}}},
    {type:"form.set",form:{id:"lead-form",name:"Lead form",fields:[{name:"email",type:"email"}],actions:[{type:"store"}],settings:{}}},
  ]);
  assert.equal(value.components[0]?.variants[0]?.id,"featured");
  assert.equal(value.interactions[0]?.action,"animate");
  assert.equal(value.forms[0]?.name,"Lead form");
  const cleaned=applySiteCommands(value,[
    {type:"component.variant.delete",componentId:"card",variantId:"featured"},
    {type:"interaction.delete",interactionId:"reveal"},
    {type:"form.delete",formId:"lead-form"},
  ]);
  assert.equal(cleaned.components[0]?.variants.length,0);
  assert.equal(cleaned.interactions.length,0);
  assert.equal(cleaned.forms.length,0);
});


test("canonical assets reject script and credential-bearing URLs",()=>{
  assert.throws(()=>applySiteCommands(document(),[
    {type:"asset.add",asset:{id:"bad-script",kind:"image",url:"javascript:alert(1)",metadata:{}}},
  ]),/Asset URL/);
  assert.throws(()=>applySiteCommands(document(),[
    {type:"asset.add",asset:{id:"bad-credentials",kind:"image",url:"https://user:secret@example.com/a.png",metadata:{}}},
  ]),/Asset URL/);
  const safe=applySiteCommands(document(),[
    {type:"asset.add",asset:{id:"safe",kind:"image",url:"/uploads/a.png",metadata:{}}},
  ]);
  assert.equal(safe.assets[0]?.url,"/uploads/a.png");
});

test("Figma import replaces an existing page occupying the same route",()=>{
  const proposal=figmaToSiteCommands({
    fileKey:"Route123",
    current:document(),
    file:{name:"Route collision",version:"1",document:{id:"0:0",type:"DOCUMENT",children:[{
      id:"0:1",type:"CANVAS",children:[{id:"1:1",type:"FRAME",name:"Landing",children:[]}],
    }]}},
  });
  const next=applySiteCommands(document(),proposal.commands);
  assert.equal(next.pages.length,1);
  assert.equal(next.pages[0]?.slug,"/");
  assert.match(next.pages[0]?.id??"",/^figma-page-/);
});


test("locale.translate merges reviewed translation overlays",()=>{
  const withLocale=applySiteCommands(document(),[
    {type:"locale.add",locale:{id:"fr",locale:"fr",values:{headline:"Bonjour"}}},
  ]);
  const translated=applySiteCommands(withLocale,[
    {type:"locale.translate",localeId:"fr",values:{cta:"Commencer"}},
  ]);
  assert.deepEqual(translated.locales[0]?.values,{headline:"Bonjour",cta:"Commencer"});
});


test("Figma import rejects pathological tree depth before canonical conversion",()=>{
  let node:any={id:"leaf",type:"FRAME",children:[]};
  for(let depth=0;depth<55;depth++) node={id:`deep-${depth}`,type:"FRAME",children:[node]};
  assert.throws(()=>figmaToSiteCommands({
    fileKey:"DeepTree123",
    current:document(),
    file:{name:"Deep",version:"1",document:{id:"root",type:"DOCUMENT",children:[node]}},
  }),/supported complexity/);
});


test("canonical JSON rejects prototype-polluting keys before command application",()=>{
  const props=JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(()=>applySiteCommands(document(),[
    {type:"element.insert",pageId:"home",element:{id:"unsafe",type:"text",props,styles:{},children:[]}},
  ]),/Reserved JSON key|SITE_COMMAND_INVALID/);
  assert.equal(({} as {polluted?:boolean}).polluted,undefined);
});
