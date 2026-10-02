import { AppError } from "../../utils/app-error.js";
import type { JsonValue, SiteDocument } from "../../domain/site-document.js";

export type FigmaVariablePushAction = {
  tokenId: string;
  tokenName: string;
  action: "CREATE" | "UPDATE" | "SKIP";
  externalId?: string;
  resolvedType?: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  reason?: string;
};

type ExistingMapping = { kind: string; externalId: string; localId: string };
type Variable = {
  id?: string; name?: string; variableCollectionId?: string; resolvedType?: string;
  remote?: boolean; valuesByMode?: Record<string, unknown>;
};
type Collection = {
  id?: string; name?: string; defaultModeId?: string; remote?: boolean;
  modes?: Array<{ modeId?: string; name?: string }>;
};
export type FigmaLocalVariablesSnapshot = {
  meta?: {
    variables?: Record<string, Variable>;
    variableCollections?: Record<string, Collection>;
  };
};

function safeName(name: string): string {
  const value = name.trim().replace(/[\u0000-\u001f]/g, " ").replace(/[.{}]/g, "-").replace(/\s+/g, " ").slice(0, 255);
  if (!value) throw new AppError("A Figma variable name is required", 422, "FIGMA_TOKEN_INVALID");
  return value;
}

function channel(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseHex(value: string): { r: number; g: number; b: number; a: number } | null {
  const input = value.trim();
  const short = /^#([0-9a-f]{3,4})$/i.exec(input);
  if (short) {
    const digits = short[1]!;
    const parts = digits.split("").map(char => parseInt(char + char, 16) / 255);
    return { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!), a: channel(parts[3] ?? 1) };
  }
  const full = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(input);
  if (!full) return null;
  return {
    r: parseInt(full[1]!.slice(0, 2), 16) / 255,
    g: parseInt(full[1]!.slice(2, 4), 16) / 255,
    b: parseInt(full[1]!.slice(4, 6), 16) / 255,
    a: full[2] ? parseInt(full[2], 16) / 255 : 1,
  };
}

function parseRgba(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(value.trim());
  if (!match) return null;
  return {
    r: channel(Number(match[1]) / 255),
    g: channel(Number(match[2]) / 255),
    b: channel(Number(match[3]) / 255),
    a: channel(match[4] === undefined ? 1 : Number(match[4])),
  };
}

function figmaValue(value: JsonValue, category: string): { resolvedType: "COLOR"|"FLOAT"|"STRING"|"BOOLEAN"; value: unknown } | null {
  if (category === "color" && typeof value === "string") {
    const color = parseHex(value) ?? parseRgba(value);
    if (color) return { resolvedType: "COLOR", value: color };
  }
  if (["size", "spacing", "radius"].includes(category)) {
    if (typeof value === "number") return { resolvedType: "FLOAT", value };
    if (typeof value === "string") {
      const match = /^(-?\d+(?:\.\d+)?)(?:px|rem|em)?$/i.exec(value.trim());
      if (match) return { resolvedType: "FLOAT", value: Number(match[1]) };
    }
  }
  if (typeof value === "boolean") return { resolvedType: "BOOLEAN", value };
  if (typeof value === "number" && Number.isFinite(value)) return { resolvedType: "FLOAT", value };
  if (typeof value === "string") return { resolvedType: "STRING", value };
  return null;
}

function defaultMode(collection: Collection | undefined): string | null {
  if (!collection) return null;
  if (typeof collection.defaultModeId === "string" && collection.defaultModeId) return collection.defaultModeId;
  const first = collection.modes?.find(mode => typeof mode.modeId === "string" && mode.modeId);
  return first?.modeId ?? null;
}

export function buildFigmaTokenPushPlan(input: {
  fileKey: string;
  document: SiteDocument;
  variables: FigmaLocalVariablesSnapshot;
  mappings: ExistingMapping[];
}) {
  const variables = input.variables.meta?.variables ?? {};
  const collections = input.variables.meta?.variableCollections ?? {};
  const mappingByLocal = new Map(
    input.mappings.filter(mapping => mapping.kind === "TOKEN").map(mapping => [mapping.localId, mapping.externalId] as const)
  );

  const actions: FigmaVariablePushAction[] = [];
  const variableUpdates: Array<Record<string, unknown>> = [];
  const variableModeValues: Array<Record<string, unknown>> = [];
  const variablesToCreate: Array<{ tokenId: string; name: string; resolvedType: "COLOR"|"FLOAT"|"STRING"|"BOOLEAN"; value: unknown }> = [];
  const warnings: string[] = [];

  for (const token of input.document.tokens) {
    const converted = figmaValue(token.value, token.category);
    if (!converted) {
      actions.push({ tokenId: token.id, tokenName: token.name, action: "SKIP", reason: "Token value cannot be represented by the Figma Variables API" });
      warnings.push(`Skipped token "${token.name}" because its value is not representable as a Figma variable.`);
      continue;
    }
    const externalId = mappingByLocal.get(token.id);
    if (!externalId) {
      variablesToCreate.push({ tokenId: token.id, name: safeName(token.name), ...converted });
      actions.push({ tokenId: token.id, tokenName: token.name, action: "CREATE", resolvedType: converted.resolvedType });
      continue;
    }
    const variable = variables[externalId];
    if (!variable || variable.remote) {
      variablesToCreate.push({ tokenId: token.id, name: safeName(token.name), ...converted });
      actions.push({ tokenId: token.id, tokenName: token.name, action: "CREATE", resolvedType: converted.resolvedType, reason: "Mapped Figma variable is no longer local/available" });
      warnings.push(`The previous mapping for "${token.name}" is unavailable; Forge will create a new local Figma variable.`);
      continue;
    }
    if (String(variable.resolvedType || "").toUpperCase() !== converted.resolvedType) {
      actions.push({ tokenId: token.id, tokenName: token.name, action: "SKIP", externalId, resolvedType: converted.resolvedType, reason: "Changing a Figma variable resolved type is not safe in-place" });
      warnings.push(`Skipped "${token.name}" because its mapped Figma variable has a different resolved type.`);
      continue;
    }
    const collection = variable.variableCollectionId ? collections[variable.variableCollectionId] : undefined;
    const modeId = defaultMode(collection);
    if (!modeId) {
      actions.push({ tokenId: token.id, tokenName: token.name, action: "SKIP", externalId, resolvedType: converted.resolvedType, reason: "Mapped collection has no writable mode" });
      warnings.push(`Skipped "${token.name}" because its Figma collection has no writable mode.`);
      continue;
    }
    const currentValue=variable.valuesByMode?.[modeId];
    const targetName=safeName(token.name);
    if(variable.name===targetName&&JSON.stringify(currentValue)===JSON.stringify(converted.value)){
      actions.push({ tokenId: token.id, tokenName: token.name, action: "SKIP", externalId, resolvedType: converted.resolvedType, reason: "Already synchronized" });
      continue;
    }
    variableUpdates.push({ action: "UPDATE", id: externalId, name: targetName });
    variableModeValues.push({ variableId: externalId, modeId, value: converted.value });
    actions.push({ tokenId: token.id, tokenName: token.name, action: "UPDATE", externalId, resolvedType: converted.resolvedType });
  }

  const temporaryMappings: Array<{ temporaryId: string; tokenId: string }> = [];
  const variableCollections: Array<Record<string, unknown>> = [];
  const variableCreates: Array<Record<string, unknown>> = [];
  if (variablesToCreate.length) {
    const existingForgeCollection=Object.values(collections).find(collection=>!collection.remote&&collection.name==="Forge Design Tokens"&&defaultMode(collection));
    const collectionId = existingForgeCollection?.id ?? "forge_collection";
    const modeId = defaultMode(existingForgeCollection) ?? "forge_mode";
    if(!existingForgeCollection) variableCollections.push({ action: "CREATE", id: collectionId, name: "Forge Design Tokens", initialModeId: modeId });
    variablesToCreate.forEach((entry, index) => {
      const temporaryId = `forge_token_${index + 1}`;
      variableCreates.push({
        action: "CREATE", id: temporaryId, name: entry.name,
        variableCollectionId: collectionId, resolvedType: entry.resolvedType,
      });
      variableModeValues.push({ variableId: temporaryId, modeId, value: entry.value });
      temporaryMappings.push({ temporaryId, tokenId: entry.tokenId });
    });
  }

  const body: Record<string, unknown> = {};
  if (variableCollections.length) body.variableCollections = variableCollections;
  if (variableCreates.length || variableUpdates.length) body.variables = [...variableCreates, ...variableUpdates];
  if (variableModeValues.length) body.variableModeValues = variableModeValues;

  return {
    fileKey: input.fileKey,
    body,
    actions,
    warnings,
    temporaryMappings,
    createCount: variablesToCreate.length,
    updateCount: variableUpdates.length,
    skipCount: actions.filter(action => action.action === "SKIP").length,
  };
}
