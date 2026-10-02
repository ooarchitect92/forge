import { createHash } from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { canonicalDocumentJson } from "../../services/websites/document-policy.js";
import { getSiteDocument } from "../../services/websites/site-document.service.js";
import type { JsonValue, SiteElement } from "../../domain/site-document.js";

export type FigmaPluginNode = {
  id:string;
  type:string;
  name?:string;
  content?:JsonValue;
  props:Record<string,JsonValue>;
  styles:Record<string,JsonValue>;
  responsiveStyles?:Record<string,JsonValue>;
  componentId?:string;
  children:FigmaPluginNode[];
};

function mapElement(element:SiteElement):FigmaPluginNode {
  return {
    id:element.id,
    type:element.type,
    ...(element.name?{name:element.name}:{}),
    ...(element.content!==undefined?{content:element.content}:{}),
    props:element.props,
    styles:element.styles,
    ...(element.responsiveStyles?{responsiveStyles:element.responsiveStyles}:{}),
    ...(element.componentId?{componentId:element.componentId}:{}),
    children:element.children.map(mapElement),
  };
}

function selectedPageIds(value:unknown):Set<string>|null {
  if(value===undefined||value===null) return null;
  if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=="string"||!id||id.length>200)){
    throw new AppError("Figma plugin page selection is invalid",400,"FIGMA_PLUGIN_EXPORT_INVALID");
  }
  return new Set(value);
}

export async function createFigmaPluginExport(input:{websiteId:string;actorId:string;pageIds?:unknown}){
  const current=await getSiteDocument(input.websiteId,input.actorId);
  const selected=selectedPageIds(input.pageIds);
  const pages=current.document.pages
    .filter(page=>!selected||selected.has(page.id))
    .map(page=>({
      id:page.id,name:page.name,slug:page.slug,title:page.title??page.name,
      elements:page.elements.map(mapElement),
      settings:page.settings,
    }));
  if(selected&&pages.length!==selected.size) throw new AppError("One or more selected pages were not found",404,"FIGMA_PLUGIN_PAGE_NOT_FOUND");
  if(!pages.length) throw new AppError("The SiteDocument has no pages to export",422,"FIGMA_PLUGIN_EXPORT_EMPTY");

  const payload={
    kind:"forge-site-document-figma-plugin" as const,
    exportVersion:1,
    websiteId:current.websiteId,
    revision:current.revision,
    schemaVersion:current.schemaVersion,
    site:{title:current.document.site.title,defaultLocale:current.document.site.defaultLocale},
    pages,
    components:current.document.components.map(component=>({
      id:component.id,name:component.name,root:mapElement(component.root),
      variants:component.variants,slots:component.slots,
    })),
    tokens:current.document.tokens,
    styles:current.document.styles,
  };
  const canonical=canonicalDocumentJson(payload);
  if(Buffer.byteLength(canonical)>4*1024*1024) throw new AppError("Figma plugin export exceeds four MiB; select fewer pages",413,"FIGMA_PLUGIN_EXPORT_TOO_LARGE");
  const digest=createHash("sha256").update(canonical).digest("hex");
  return {...payload,digest};
}
