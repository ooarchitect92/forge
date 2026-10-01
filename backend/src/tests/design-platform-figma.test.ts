import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseFigmaSource, type FigmaFileSnapshot } from "../modules/design-platform/figma-client.js";
import { appendFigmaPages, compileFigmaSnapshot } from "../modules/design-platform/figma-compiler.js";

test("Figma source parser accepts supported links and normalizes node ids", () => {
  assert.deepEqual(
    parseFigmaSource("https://www.figma.com/design/AbCdEf123456/Forge?node-id=12-34"),
    { fileKey: "AbCdEf123456", nodeIds: ["12:34"] },
  );
  assert.deepEqual(parseFigmaSource("AbCdEf123456", ["4:5", "4:5"]), { fileKey: "AbCdEf123456", nodeIds: ["4:5"] });
  assert.throws(() => parseFigmaSource("https://example.com/design/AbCdEf123456/Forge"), (error) => {
    assert.equal((error as { code: string }).code, "FIGMA_SOURCE_INVALID");
    return true;
  });
});

test("Figma compiler creates bounded native pages and preserves a current home page", () => {
  const snapshot: FigmaFileSnapshot = {
    fileKey: "AbCdEf123456",
    fileName: "Forge concept",
    lastModified: null,
    version: "1",
    requestedNodeIds: [],
    components: { component: {} },
    componentSets: {},
    styles: { style: {} },
    roots: [{
      id: "0:0", name: "Document", type: "DOCUMENT", children: [{
        id: "1:0", name: "Website", type: "CANVAS", children: [{
          id: "1:1", name: "Landing", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 24,
          paddingTop: 32, paddingRight: 32, paddingBottom: 32, paddingLeft: 32,
          absoluteBoundingBox: { width: 1440, height: 900 },
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
          children: [
            { id: "1:2", name: "Hero heading", type: "TEXT", characters: "Build the next web", style: { fontSize: 56, fontWeight: 700 }, fills: [{ type: "SOLID", color: { r: 0.1, g: 0.12, b: 0.18 } }] },
            { id: "1:3", name: "Body", type: "TEXT", characters: "A native editable design.", style: { fontSize: 18, fontWeight: 400 } },
          ],
        }],
      }],
    }],
  };
  const compilation = compileFigmaSnapshot(snapshot);
  assert.equal(compilation.pages.length, 1);
  assert.equal(compilation.pages[0]?.name, "Landing");
  assert.equal(compilation.manifest.componentCount, 1);
  assert.ok(compilation.nodeCount >= 3);
  const merged = appendFigmaPages({ version: 1, elements: [{ id: "existing", type: "text", content: "Home" }] }, compilation);
  assert.equal((merged.document.pages as unknown[]).length, 2);
  assert.deepEqual(merged.document.elements, [{ id: "existing", type: "text", content: "Home" }]);
  assert.deepEqual(merged.pageNames, ["Landing"]);
});

test("Figma compiler represents unsupported vector/image layers without remote assets", () => {
  const snapshot: FigmaFileSnapshot = {
    fileKey: "AbCdEf123456", fileName: "Visual", lastModified: null, version: null,
    requestedNodeIds: ["1:1"], components: {}, componentSets: {}, styles: {},
    roots: [{ id: "1:1", name: "Image card", type: "FRAME", children: [
      { id: "1:2", name: "Photo", type: "RECTANGLE", fills: [{ type: "IMAGE", imageRef: "secret-ref" }], absoluteBoundingBox: { width: 400, height: 240 } },
    ] }],
  };
  const compilation = compileFigmaSnapshot(snapshot);
  assert.equal(compilation.pages.length, 1);
  assert.ok(compilation.warnings.some((warning) => /placeholder/i.test(warning)));
  assert.doesNotMatch(JSON.stringify(compilation), /secret-ref/);
});
