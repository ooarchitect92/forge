export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SiteElement {
  id: string;
  type: string;
  name?: string;
  props: Record<string, JsonValue>;
  styles: Record<string, JsonValue>;
  responsiveStyles?: Record<string, JsonValue>;
  content?: JsonValue;
  children: SiteElement[];
  componentId?: string;
  isProtected?: boolean;
  bindings?: Record<string, JsonValue>;
}
export interface SitePage {
  id: string; name: string; slug: string; title?: string;
  elements: SiteElement[]; settings: Record<string, JsonValue>; seo?: Record<string, JsonValue>;
}
export interface DesignToken {
  id: string; name: string; category: "color"|"typography"|"spacing"|"radius"|"shadow"|"size"|"other";
  value: JsonValue; description?: string; source?: "forge"|"figma"|"stitch"|"import";
}
export interface CmsField {
  id:string; name:string; key:string;
  type:"text"|"richText"|"number"|"boolean"|"date"|"image"|"file"|"reference"|"multiReference"|"json";
  required:boolean; referenceCollectionId?:string; config:Record<string,JsonValue>;
}
export interface CmsCollection { id:string; name:string; slug:string; description?:string; fields:CmsField[]; }
export interface CmsItem { id:string; collectionId:string; title?:string; slug?:string; status:"DRAFT"|"PUBLISHED"|"ARCHIVED"; values:Record<string,JsonValue>; }
export interface CmsBinding { id:string; elementId:string; property:string; collectionId:string; fieldId:string; }

export interface SiteDocument {
  id:string; schemaVersion:number;
  site:{title:string;slug?:string;defaultLocale:string;metadata:Record<string,JsonValue>};
  pages:SitePage[];
  components:Array<{id:string;name:string;root:SiteElement;variants:unknown[];slots:unknown[]}>;
  styles:Array<{id:string;selector:string;properties:Record<string,JsonValue>;breakpoint?:string;state?:string}>;
  tokens:DesignToken[];
  assets:Array<{id:string;kind:string;url:string;name?:string;metadata:Record<string,JsonValue>}>;
  cms:{collections:CmsCollection[];items:CmsItem[];bindings:CmsBinding[]};
  interactions:unknown[];forms:unknown[];locales:unknown[];experiments:unknown[];integrations:unknown[];
  extensions:Record<string,JsonValue>;
}
export type SiteCommand = { type:string; [key:string]:unknown };
export interface SiteDocumentEnvelope {
  websiteId:string; revision:number; schemaVersion:number; persisted:boolean; document:SiteDocument;
}
export interface SiteDocumentRevisionSummary {
  id:string;revision:number;schemaVersion:number;source:string;actorId?:string|null;createdAt:string;commands:unknown;
}
