import { AppError } from "../utils/app-error.js";
import { validateSiteDocument, type CollectionItem, type JsonValue, type SiteDocument, type SiteElement } from "./site-document.js";

const blocked = new Set(["__proto__", "prototype", "constructor"]);

function clone<T>(value:T):T { return structuredClone(value); }
function object(value:JsonValue|undefined):Record<string,JsonValue>{
  return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,JsonValue> : {};
}
function bindingValue(document:SiteDocument,item:CollectionItem,fieldId:string):JsonValue {
  const collection=document.cms.collections.find(value=>value.id===item.collectionId);
  const field=collection?.fields.find(value=>value.id===fieldId);
  if(!collection||!field) throw new AppError("CMS binding field was not found",422,"CMS_BINDING_INVALID");
  return item.values[field.key] ?? null;
}
function assignPath(element:SiteElement,path:string,value:JsonValue):void {
  const segments=path.split(".").filter(Boolean);
  if(!segments.length||segments.some(segment=>blocked.has(segment))) throw new AppError("CMS binding property is invalid",422,"CMS_BINDING_INVALID");
  if(segments.length===1){
    if(segments[0]==="content") element.content=clone(value);
    else element.props={...element.props,[segments[0]!]:clone(value)};
    return;
  }
  const root=segments[0];
  if(!["props","styles","responsiveStyles","bindings"].includes(root!)) throw new AppError("CMS binding can target content, props or style data only",422,"CMS_BINDING_INVALID");
  const target = root==="props" ? element.props :
    root==="styles" ? element.styles :
    root==="responsiveStyles" ? (element.responsiveStyles ??= {}) :
    (element.bindings ??= {});
  let cursor:Record<string,JsonValue>=target;
  for(let index=1;index<segments.length-1;index++){
    const key=segments[index]!;
    const child=object(cursor[key]);
    cursor[key]=child;
    cursor=child;
  }
  cursor[segments.at(-1)!]=clone(value);
}
function walk(elements:SiteElement[],apply:(element:SiteElement)=>void):void{
  for(const element of elements){apply(element);walk(element.children,apply);}
}

export function resolveCmsBindings(documentInput:SiteDocument,pageId:string,itemId:string):SiteDocument["pages"][number] {
  const document=validateSiteDocument(documentInput);
  const page=document.pages.find(value=>value.id===pageId);
  if(!page) throw new AppError("Page was not found",404,"CMS_TEMPLATE_PAGE_NOT_FOUND");
  const item=document.cms.items.find(value=>value.id===itemId);
  if(!item) throw new AppError("CMS item was not found",404,"CMS_ITEM_NOT_FOUND");
  const result=clone(page);
  const bindings=document.cms.bindings.filter(binding=>binding.collectionId===item.collectionId);
  const byElement=new Map<string,typeof bindings>();
  for(const binding of bindings){const list=byElement.get(binding.elementId)??[];list.push(binding);byElement.set(binding.elementId,list);}
  walk(result.elements,element=>{
    for(const binding of byElement.get(element.id)??[]) assignPath(element,binding.property,bindingValue(document,item,binding.fieldId));
  });
  return result;
}

export function cmsTemplatePages(documentInput:SiteDocument):Array<{pageId:string;collectionId:string;pattern:string}>{
  const document=validateSiteDocument(documentInput);
  const templates:Array<{pageId:string;collectionId:string;pattern:string}>=[];
  for(const page of document.pages){
    const collectionId=typeof page.settings.cmsCollectionId==="string"?page.settings.cmsCollectionId:null;
    if(!collectionId) continue;
    if(!document.cms.collections.some(collection=>collection.id===collectionId)) throw new AppError("CMS template references an unknown collection",422,"CMS_TEMPLATE_INVALID");
    const pattern=typeof page.settings.cmsPathPattern==="string"&&page.settings.cmsPathPattern.trim()?page.settings.cmsPathPattern:`${page.slug.replace(/\/$/,"")}/{slug}`;
    templates.push({pageId:page.id,collectionId,pattern});
  }
  return templates;
}

export function renderCmsPath(pattern:string,item:CollectionItem):string{
  const slug=String(item.slug||item.id).replace(/^\/+|\/+$/g,"");
  const path=pattern.replaceAll("{slug}",slug).replaceAll("{id}",item.id);
  return path.startsWith("/")?path:`/${path}`;
}
