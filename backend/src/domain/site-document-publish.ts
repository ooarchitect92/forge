import { cmsTemplatePages, renderCmsPath, resolveCmsBindings } from "./site-document-cms.js";
import { siteDocumentToLegacy, siteElementToLegacy } from "./site-document-legacy.js";
import { validateSiteDocument, type SiteDocument } from "./site-document.js";

export function siteDocumentToPublishableLegacy(documentInput:SiteDocument): Record<string, any> {
  const document=validateSiteDocument(documentInput);
  const legacy=siteDocumentToLegacy(document);
  const templates=cmsTemplatePages(document);
  if(!templates.length) return {...legacy,canonicalCms:{collections:document.cms.collections,items:document.cms.items,bindings:document.cms.bindings}};
  const pages=Array.isArray(legacy.pages)?[...legacy.pages]:[];
  const templateIds=new Set(templates.map(template=>template.pageId));
  const staticPages=pages.filter((page:any)=>!templateIds.has(String(page.id)));
  const generated:any[]=[];
  for(const template of templates){
    for(const item of document.cms.items.filter(value=>value.collectionId===template.collectionId&&value.status==="PUBLISHED")){
      const resolved=resolveCmsBindings(document,template.pageId,item.id);
      generated.push({
        ...resolved.settings,
        id:`${template.pageId}--${item.id}`.slice(0,200),
        name:item.title||resolved.name,
        title:item.title||resolved.title||resolved.name,
        slug:renderCmsPath(template.pattern,item),
        elements:resolved.elements.map(siteElementToLegacy),
        ...(resolved.seo?{pageSettings:resolved.seo}:{}),
        cmsContext:{collectionId:template.collectionId,itemId:item.id},
      });
    }
  }
  const result: Record<string, any> = {...legacy,pages:[...staticPages,...generated],canonicalCms:{collections:document.cms.collections,items:document.cms.items,bindings:document.cms.bindings}};
  const currentHome=result.pages.find((page:any)=>page.id===result.homePageId);
  if(currentHome) result.elements=currentHome.elements;
  return result;
}
