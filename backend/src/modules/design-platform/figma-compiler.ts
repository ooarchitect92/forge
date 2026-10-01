import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "../../services/websites/document-policy.js";
import type { FigmaFileSnapshot, FigmaNode } from "./figma-client.js";

const FRAME_TYPES = new Set(["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION", "CANVAS"]);
const PLACEHOLDER_TYPES = new Set(["RECTANGLE", "ELLIPSE", "VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "SLICE"]);
const MAX_IMPORTED_NODES = 2_000;
const MAX_IMPORT_DEPTH = 20;
const MAX_IMPORTED_PAGES = 20;

type CompileState = {
  nodes: number;
  warnings: Set<string>;
  sourceTypes: Map<string, number>;
};

export type FigmaImportedPage = {
  sourceNodeId: string | null;
  name: string;
  suggestedSlug: string;
  elements: JsonObject[];
};

export type FigmaCompilation = {
  pages: FigmaImportedPage[];
  nodeCount: number;
  warnings: string[];
  sourceTypeCounts: Record<string, number>;
  manifest: {
    componentCount: number;
    componentSetCount: number;
    styleCount: number;
    requestedNodeIds: string[];
  };
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function bool(value: unknown): boolean { return value === true; }
function px(value: unknown, max = 10_000): string | null {
  const candidate = number(value);
  return candidate === null || candidate < 0 || candidate > max ? null : `${Math.round(candidate * 100) / 100}px`;
}
function boundedText(value: unknown, max: number): string {
  const candidate = string(value).replace(/\u0000/g, "").trim();
  return candidate.slice(0, max);
}
function nodeId(node: FigmaNode): string | null {
  const value = string(node.id);
  return value && value.length <= 100 ? value : null;
}
function nodeName(node: FigmaNode, fallback: string): string {
  return boundedText(node.name, 100) || fallback;
}
function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return normalized || "imported-design";
}
function children(node: FigmaNode): FigmaNode[] {
  return array(node.children).flatMap((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate) ? [candidate as FigmaNode] : []);
}

function rgbaFromPaint(value: unknown): string | null {
  const paint = object(value);
  if (paint.visible === false || paint.type !== "SOLID") return null;
  const color = object(paint.color);
  const red = number(color.r), green = number(color.g), blue = number(color.b);
  if (red === null || green === null || blue === null) return null;
  const alpha = Math.max(0, Math.min(1, number(paint.opacity) ?? 1));
  const channels = [red, green, blue].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
  return alpha >= 0.999 ? `rgb(${channels.join(", ")})` : `rgba(${channels.join(", ")}, ${Math.round(alpha * 1000) / 1000})`;
}
function firstColor(value: unknown): string | null {
  for (const paint of array(value)) {
    const color = rgbaFromPaint(paint);
    if (color) return color;
  }
  return null;
}
function hasImageFill(value: unknown): boolean {
  return array(value).some((paint) => object(paint).type === "IMAGE" && object(paint).visible !== false);
}

function alignment(value: unknown, axis: "primary" | "counter"): string | null {
  const item = string(value);
  if (axis === "primary") return ({ MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" } as Record<string, string>)[item] ?? null;
  return ({ MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" } as Record<string, string>)[item] ?? null;
}

function baseStyles(node: FigmaNode, root: boolean, state: CompileState): JsonObject {
  const styles: JsonObject = { boxSizing: "border-box" };
  const fill = firstColor(node.fills);
  if (fill) styles.backgroundColor = fill;
  if (hasImageFill(node.fills)) {
    styles.backgroundColor = fill ?? "#eef1f4";
    state.warnings.add("Image fills are represented as native placeholders; connect them to Forge media before publishing.");
  }
  const opacity = number(node.opacity);
  if (opacity !== null && opacity >= 0 && opacity < 1) styles.opacity = String(opacity);
  const radius = px(node.cornerRadius, 1_000);
  if (radius) styles.borderRadius = radius;
  else if (Array.isArray(node.rectangleCornerRadii)) {
    const radii = node.rectangleCornerRadii.map((item) => px(item, 1_000)).filter((item): item is string => !!item);
    if (radii.length === 4) styles.borderRadius = radii.join(" ");
  }
  const stroke = firstColor(node.strokes);
  const strokeWidth = px(node.strokeWeight, 100);
  if (stroke) styles.borderColor = stroke;
  if (strokeWidth) { styles.borderWidth = strokeWidth; styles.borderStyle = "solid"; }
  if (bool(node.clipsContent)) styles.overflow = "hidden";

  const box = object(node.absoluteBoundingBox);
  const width = px(box.width, 8_000), height = px(box.height, 8_000);
  if (root) {
    styles.width = "100%";
    if (width) styles.maxWidth = width;
    if (height) styles.minHeight = height;
    styles.margin = "0 auto";
  } else {
    if (node.layoutSizingHorizontal === "FILL" || node.layoutGrow === 1) styles.flex = "1 1 0";
    else if (width) styles.maxWidth = width;
    if (height && node.layoutSizingVertical === "FIXED") styles.minHeight = height;
  }
  return styles;
}

function layout(node: FigmaNode, state: CompileState): JsonObject {
  const mode = string(node.layoutMode);
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL") {
    if (children(node).length > 1) state.warnings.add("Some Figma free-positioned layers were converted to responsive stacked layouts.");
    return { layoutType: "flex", direction: "column", gap: "16px", alignItems: "stretch" };
  }
  const result: JsonObject = {
    layoutType: "flex",
    direction: mode === "HORIZONTAL" ? "row" : "column",
    gap: px(node.itemSpacing, 2_000) ?? "0px",
    alignItems: alignment(node.counterAxisAlignItems, "counter") ?? "stretch",
    justifyContent: alignment(node.primaryAxisAlignItems, "primary") ?? "flex-start",
  };
  if (node.layoutWrap === "WRAP") result.flexWrap = "wrap";
  const padding = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map((item) => px(item, 2_000) ?? "0px");
  if (padding.some((item) => item !== "0px")) result.padding = padding.join(" ");
  return result;
}

function textStyles(node: FigmaNode): JsonObject {
  const source = object(node.style);
  const styles: JsonObject = { boxSizing: "border-box", whiteSpace: "pre-wrap" };
  const fontSize = px(source.fontSize, 500); if (fontSize) styles.fontSize = fontSize;
  const weight = number(source.fontWeight); if (weight !== null && weight >= 100 && weight <= 1_000) styles.fontWeight = String(Math.round(weight));
  const lineHeight = px(source.lineHeightPx, 1_000); if (lineHeight) styles.lineHeight = lineHeight;
  const letterSpacing = px(source.letterSpacing, 100); if (letterSpacing) styles.letterSpacing = letterSpacing;
  const color = firstColor(node.fills); if (color) styles.color = color;
  const align = ({ LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" } as Record<string, string>)[string(source.textAlignHorizontal)];
  if (align) styles.textAlign = align;
  const opacity = number(node.opacity); if (opacity !== null && opacity >= 0 && opacity < 1) styles.opacity = String(opacity);
  return styles;
}

function compileText(node: FigmaNode): JsonObject | null {
  const content = boundedText(node.characters, 20_000);
  if (!content) return null;
  const style = object(node.style);
  const fontSize = number(style.fontSize) ?? 16;
  const fontWeight = number(style.fontWeight) ?? 400;
  const isHeading = fontSize >= 24 || (fontSize >= 18 && fontWeight >= 600);
  let headingLevel: "h1" | "h2" | "h3" | "h4" = "h4";
  if (fontSize >= 48) headingLevel = "h1";
  else if (fontSize >= 34) headingLevel = "h2";
  else if (fontSize >= 24) headingLevel = "h3";
  return {
    id: randomUUID(),
    type: isHeading ? "heading" : "text",
    content,
    ...(isHeading ? { headingLevel } : {}),
    styles: textStyles(node),
  };
}

function placeholder(node: FigmaNode, state: CompileState): JsonObject {
  const styles = baseStyles(node, false, state);
  if (!styles.minHeight) styles.minHeight = "120px";
  if (!styles.backgroundColor) styles.backgroundColor = "#eef1f4";
  styles.display = "flex";
  styles.alignItems = "center";
  styles.justifyContent = "center";
  styles.padding = "16px";
  styles.color = "#52606d";
  state.warnings.add("Vector and unsupported visual layers were converted to editable placeholders.");
  return { id: randomUUID(), type: "container", content: nodeName(node, "Visual layer"), styles, children: [
    { id: randomUUID(), type: "text", content: nodeName(node, "Visual layer"), styles: { fontSize: "0.875rem", color: "#52606d" } },
  ] };
}

function compileNode(node: FigmaNode, state: CompileState, depth: number, root = false): JsonObject | null {
  if (node.visible === false) return null;
  if (depth > MAX_IMPORT_DEPTH || ++state.nodes > MAX_IMPORTED_NODES) {
    state.warnings.add("The import was bounded to 2,000 layers and 20 levels of nesting.");
    return null;
  }
  const type = string(node.type, "UNKNOWN");
  state.sourceTypes.set(type, (state.sourceTypes.get(type) ?? 0) + 1);
  if (type === "TEXT") return compileText(node);
  if (PLACEHOLDER_TYPES.has(type)) return placeholder(node, state);
  if (!FRAME_TYPES.has(type) && !children(node).length) {
    state.warnings.add(`Unsupported Figma layer type ${type} was skipped.`);
    return null;
  }

  const compiledChildren = children(node).map((child) => compileNode(child, state, depth + 1)).filter((item): item is JsonObject => !!item);
  const styles = baseStyles(node, root, state);
  const layoutValue = layout(node, state);
  if (layoutValue.padding) {
    styles.padding = layoutValue.padding;
    delete layoutValue.padding;
  }
  return {
    id: randomUUID(),
    type: "container",
    content: nodeName(node, "Imported frame"),
    layout: layoutValue,
    styles,
    children: compiledChildren,
  };
}

function importRoots(snapshot: FigmaFileSnapshot): FigmaNode[] {
  const result: FigmaNode[] = [];
  for (const root of snapshot.roots) {
    const type = string(root.type);
    if (type === "DOCUMENT") {
      for (const canvas of children(root)) {
        const candidates = children(canvas).filter((candidate) => candidate.visible !== false);
        if (candidates.length) result.push(...candidates);
        else result.push(canvas);
      }
    } else if (type === "CANVAS") {
      const candidates = children(root).filter((candidate) => candidate.visible !== false);
      result.push(...(candidates.length ? candidates : [root]));
    } else result.push(root);
  }
  return result.slice(0, MAX_IMPORTED_PAGES);
}

export function compileFigmaSnapshot(snapshot: FigmaFileSnapshot, pageNamePrefix?: string): FigmaCompilation {
  const state: CompileState = { nodes: 0, warnings: new Set(), sourceTypes: new Map() };
  const names = new Map<string, number>();
  const pages: FigmaImportedPage[] = [];
  for (const root of importRoots(snapshot)) {
    const base = `${pageNamePrefix ? `${pageNamePrefix} ` : ""}${nodeName(root, "Imported design")}`.trim().slice(0, 100);
    const count = (names.get(base) ?? 0) + 1; names.set(base, count);
    const name = count === 1 ? base : `${base} ${count}`.slice(0, 100);
    const compiled = compileNode(root, state, 0, true);
    if (compiled) pages.push({ sourceNodeId: nodeId(root), name, suggestedSlug: `figma-${slug(name)}`, elements: [compiled] });
  }
  if (importRoots(snapshot).length > MAX_IMPORTED_PAGES) state.warnings.add(`Only the first ${MAX_IMPORTED_PAGES} top-level Figma frames were imported.`);
  if (!pages.length) state.warnings.add("No supported native layers were found in the selected Figma nodes.");
  return {
    pages,
    nodeCount: state.nodes,
    warnings: [...state.warnings].slice(0, 50),
    sourceTypeCounts: Object.fromEntries([...state.sourceTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
    manifest: {
      componentCount: Object.keys(snapshot.components).length,
      componentSetCount: Object.keys(snapshot.componentSets).length,
      styleCount: Object.keys(snapshot.styles).length,
      requestedNodeIds: snapshot.requestedNodeIds,
    },
  };
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function asArray(value: JsonValue | undefined): JsonValue[] { return Array.isArray(value) ? value : []; }
function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base.startsWith("/") ? base : `/${base}`;
  if (!used.has(candidate)) { used.add(candidate); return candidate; }
  for (let index = 2; index < 10_000; index++) {
    candidate = `/${base.replace(/^\//, "")}-${index}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  return `/${randomUUID()}`;
}

/** Add imported Figma frames as new native pages; existing pages and publishing
 * authority remain untouched. The existing home page continues to back the
 * legacy root mirror used by older renderer paths. */
export function appendFigmaPages(current: JsonObject, compilation: FigmaCompilation): { document: JsonObject; pageNames: string[] } {
  let pages = asArray(current.pages).map((page) => asObject(page)).filter((page): page is JsonObject => !!page);
  if (!pages.length) {
    const homeId = randomUUID();
    pages = [{
      id: homeId,
      name: "Home",
      slug: "/",
      isHome: true,
      elements: asArray(current.elements),
      pageSettings: asObject(current.pageSettings) ?? { title: "Home", path: "/" },
    }];
  }
  const used = new Set(pages.map((page) => typeof page.slug === "string" ? page.slug : "").filter(Boolean));
  const imported = compilation.pages.map((page) => {
    const path = uniqueSlug(page.suggestedSlug, used);
    return {
      id: randomUUID(), name: page.name, slug: path, isHome: false,
      elements: page.elements,
      pageSettings: { title: page.name, path, backgroundColor: "#ffffff" },
    } satisfies JsonObject;
  });
  pages = [...pages, ...imported];
  const currentHomeId = typeof current.homePageId === "string" ? current.homePageId : null;
  const home = pages.find((page) => page.id === currentHomeId) ?? pages.find((page) => page.isHome === true) ?? pages[0]!;
  const document: JsonObject = {
    ...current,
    version: typeof current.version === "number" ? current.version : 1,
    homePageId: String(home.id),
    pages,
    elements: asArray(home.elements),
    pageSettings: asObject(home.pageSettings) ?? { title: "Home", path: "/" },
  };
  return { document, pageNames: imported.map((page) => String(page.name)) };
}
