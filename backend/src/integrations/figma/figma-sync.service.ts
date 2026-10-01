import { AppError } from "../../utils/app-error.js";
import { getActiveConnectorCredential } from "../../platform/integrations/connector-credentials.js";
import { parseSecretJson } from "../../platform/secrets/secret-provider.js";
import { getScopedWebsite } from "../../services/websites/scoped-access.js";
import { applySiteDocumentCommands, getSiteDocument } from "../../services/websites/site-document.service.js";
import { prisma } from "../../config/prisma.js";
import { figmaToSiteCommands, type FigmaFileSnapshot, type FigmaVariablesSnapshot } from "./site-document-figma.js";

function fileKey(value:unknown):string {
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{6,255}$/.test(value)) throw new AppError("Invalid Figma file key",400,"FIGMA_FILE_KEY_INVALID");
  return value;
}
async function requestJson(url:string,token:string):Promise<any>{
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:controller.signal,redirect:"error"});
    const text=await response.text();
    if(Buffer.byteLength(text)>12*1024*1024) throw new AppError("Figma response exceeds supported size",413,"FIGMA_RESPONSE_TOO_LARGE");
    if(!response.ok) throw new AppError(response.status===403?"Figma access was denied":"Figma request failed",response.status===404?404:502,response.status===403?"FIGMA_ACCESS_DENIED":"FIGMA_UPSTREAM_FAILED");
    try{return JSON.parse(text);}catch{throw new AppError("Figma returned invalid JSON",502,"FIGMA_UPSTREAM_INVALID");}
  }catch(error){
    if(error instanceof AppError) throw error;
    throw new AppError("Figma request failed",502,"FIGMA_UPSTREAM_FAILED");
  }finally{clearTimeout(timer);}
}
async function credential(websiteId:string,actorId:string){
  const website=await getScopedWebsite(websiteId,actorId);
  if(!website.organizationId) throw new AppError("Website ownership migration is required",503,"TENANT_MIGRATION_REQUIRED");
  const row=await getActiveConnectorCredential({organizationId:website.organizationId,websiteId,provider:"figma"});
  if(!row) throw new AppError("Connect a governed Figma credential to this website",503,"FIGMA_NOT_CONFIGURED");
  const secret=await parseSecretJson(row.secretRef);
  const token=secret.accessToken||secret.token;
  if(!token) throw new AppError("Figma credential does not contain an access token",503,"FIGMA_NOT_CONFIGURED");
  return {website,token};
}
export async function previewFigmaSync(input:{websiteId:string;actorId:string;fileKey:string}){
  const key=fileKey(input.fileKey);
  const [{token},current]=await Promise.all([credential(input.websiteId,input.actorId),getSiteDocument(input.websiteId,input.actorId)]);
  const file=await requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}`,token) as FigmaFileSnapshot;
  let variables:FigmaVariablesSnapshot|null=null; const warnings:string[]=[];
  try{variables=await requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}/variables/local`,token) as FigmaVariablesSnapshot;}
  catch(error){if(error instanceof AppError&&["FIGMA_ACCESS_DENIED","FIGMA_UPSTREAM_FAILED"].includes(error.code||"")) warnings.push("Figma Variables were unavailable; layout import can still continue."); else throw error;}
  const proposal=figmaToSiteCommands({fileKey:key,file,variables,current:current.document});
  return {...proposal,warnings,baseRevision:current.revision};
}
export async function applyFigmaSync(input:{websiteId:string;actorId:string;fileKey:string;expectedRevision:number;key:string}){
  const proposal=await previewFigmaSync(input);
  if(proposal.baseRevision!==input.expectedRevision) throw new AppError("The SiteDocument changed while Figma was loading",412,"SITE_DOCUMENT_REVISION_CONFLICT");
  const applied=await applySiteDocumentCommands({websiteId:input.websiteId,actorId:input.actorId,expectedRevision:input.expectedRevision,key:input.key,commands:proposal.commands,source:"FIGMA"});
  const website=await getScopedWebsite(input.websiteId,input.actorId);
  if(website.organizationId){
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      for(const mapping of proposal.mappings){
        await tx.figmaNodeMapping.upsert({
          where:{websiteId_fileKey_kind_externalId:{websiteId:input.websiteId,fileKey:input.fileKey,kind:mapping.kind,externalId:mapping.externalId}},
          update:{localId:mapping.localId,externalVersion:proposal.version,lastSyncedAt:new Date()},
          create:{websiteId:input.websiteId,organizationId:website.organizationId!,workspaceId:website.workspaceId,fileKey:input.fileKey,kind:mapping.kind,externalId:mapping.externalId,localId:mapping.localId,externalVersion:proposal.version},
        });
      }
    });
  }
  return {...applied,fileName:proposal.fileName,figmaVersion:proposal.version,warnings:proposal.warnings,mappingCount:proposal.mappings.length};
}
