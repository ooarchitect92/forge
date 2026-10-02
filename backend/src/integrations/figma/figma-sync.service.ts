import { createHash } from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { getActiveConnectorCredential } from "../../platform/integrations/connector-credentials.js";
import { parseSecretJson, storeSecretReference } from "../../platform/secrets/secret-provider.js";
import { refreshFigmaOAuthToken } from "./figma-oauth.service.js";
import { getScopedWebsite } from "../../services/websites/scoped-access.js";
import { applySiteDocumentCommands, getSiteDocument } from "../../services/websites/site-document.service.js";
import { prisma } from "../../config/prisma.js";
import { figmaToSiteCommands, type FigmaFileSnapshot, type FigmaVariablesSnapshot } from "./site-document-figma.js";
import type { SiteDocument, SiteElement } from "../../domain/site-document.js";
import { canonicalDocumentJson } from "../../services/websites/document-policy.js";
import { buildFigmaTokenPushPlan, type FigmaLocalVariablesSnapshot } from "./site-document-figma-push.js";

type FigmaSyncMapping={kind:string;externalId:string;localId:string;externalVersion:string|null;localHash:string|null};
function findElement(elements:SiteElement[],id:string):SiteElement|undefined{
  for(const element of elements){if(element.id===id)return element;const nested=findElement(element.children??[],id);if(nested)return nested;}
  return undefined;
}
function localValue(document:SiteDocument,mapping:Pick<FigmaSyncMapping,"kind"|"localId">):unknown{
  if(mapping.kind==="PAGE") return document.pages.find(page=>page.id===mapping.localId)??null;
  if(mapping.kind==="TOKEN") return document.tokens.find(token=>token.id===mapping.localId)??null;
  if(mapping.kind==="STYLE") return document.styles.find(rule=>rule.id===mapping.localId)??null;
  if(mapping.kind==="COMPONENT"||mapping.kind==="COMPONENT_VARIANT") return document.components.find(component=>component.id===mapping.localId)??null;
  if(mapping.kind==="NODE"){
    for(const page of document.pages){const found=findElement(page.elements,mapping.localId);if(found)return found;}
    for(const component of document.components){const found=findElement([component.root],mapping.localId);if(found)return found;}
  }
  return null;
}
function localHash(document:SiteDocument,mapping:Pick<FigmaSyncMapping,"kind"|"localId">):string{
  return createHash("sha256").update(canonicalDocumentJson(localValue(document,mapping))).digest("hex");
}
function fileKey(value:unknown):string {
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{6,255}$/.test(value)) throw new AppError("Invalid Figma file key",400,"FIGMA_FILE_KEY_INVALID");
  return value;
}
async function requestJson(url:string,token:string,init?:{method?:"GET"|"POST";body?:unknown}):Promise<any>{
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20_000);
  try{
    const serialized=init?.body===undefined?undefined:JSON.stringify(init.body);
    if(serialized&&Buffer.byteLength(serialized)>4*1024*1024) throw new AppError("Figma request exceeds supported size",413,"FIGMA_REQUEST_TOO_LARGE");
    const response=await fetch(url,{method:init?.method??"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json",...(serialized?{"Content-Type":"application/json"}:{})},body:serialized,signal:controller.signal,redirect:"error"});
    const text=await response.text();
    if(Buffer.byteLength(text)>12*1024*1024) throw new AppError("Figma response exceeds supported size",413,"FIGMA_RESPONSE_TOO_LARGE");
    if(!response.ok) throw new AppError(response.status===403?"Figma access was denied":"Figma request failed",response.status===404?404:502,response.status===403?"FIGMA_ACCESS_DENIED":"FIGMA_UPSTREAM_FAILED");
    try{return JSON.parse(text);}catch{throw new AppError("Figma returned invalid JSON",502,"FIGMA_UPSTREAM_INVALID");}
  }catch(error){
    if(error instanceof AppError) throw error;
    throw new AppError("Figma request failed",502,"FIGMA_UPSTREAM_FAILED");
  }finally{clearTimeout(timer);}
}
export async function getFigmaAccessContext(websiteId:string,actorId:string){
  const website=await getScopedWebsite(websiteId,actorId);
  if(!website.organizationId) throw new AppError("Website ownership migration is required",503,"TENANT_MIGRATION_REQUIRED");
  const row=await getActiveConnectorCredential({organizationId:website.organizationId,websiteId,provider:"figma"});
  if(!row) throw new AppError("Connect a governed Figma credential to this website",503,"FIGMA_NOT_CONFIGURED");
  let secret=await parseSecretJson(row.secretRef);
  let token=secret.accessToken||secret.token;
  const expiresAt=secret.expiresAt?Date.parse(secret.expiresAt):NaN;
  if(token&&Number.isFinite(expiresAt)&&expiresAt<=Date.now()+5*60_000){
    if(!secret.refreshToken) throw new AppError("Figma authorization expired; reconnect Figma",401,"FIGMA_OAUTH_REFRESH_FAILED");
    const refreshed=await refreshFigmaOAuthToken(secret.refreshToken);
    secret={...secret,accessToken:refreshed.accessToken,refreshToken:refreshed.refreshToken||secret.refreshToken,expiresAt:refreshed.expiresAt,figmaUserId:refreshed.figmaUserId||secret.figmaUserId||""};
    await storeSecretReference(row.secretRef,secret);
    token=refreshed.accessToken;
  }
  if(!token) throw new AppError("Figma credential does not contain an access token",503,"FIGMA_NOT_CONFIGURED");
  return {website,token};
}
export async function previewFigmaSync(input:{websiteId:string;actorId:string;fileKey:string}){
  const key=fileKey(input.fileKey);
  const [{website,token},current]=await Promise.all([getFigmaAccessContext(input.websiteId,input.actorId),getSiteDocument(input.websiteId,input.actorId)]);
  const file=await requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}`,token) as FigmaFileSnapshot;
  let variables:FigmaVariablesSnapshot|null=null; const warnings:string[]=[];
  try{variables=await requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}/variables/local`,token) as FigmaVariablesSnapshot;}
  catch(error){if(error instanceof AppError&&["FIGMA_ACCESS_DENIED","FIGMA_UPSTREAM_FAILED"].includes(error.code||"")) warnings.push("Figma Variables were unavailable; layout import can still continue."); else throw error;}
  const proposal=figmaToSiteCommands({fileKey:key,file,variables,current:current.document});
  let existing:FigmaSyncMapping[]=[];
  if(website.organizationId){
    existing=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      return tx.figmaNodeMapping.findMany({where:{websiteId:input.websiteId,fileKey:key},select:{kind:true,externalId:true,localId:true,externalVersion:true,localHash:true}});
    });
  }
  const conflicts=existing.filter(mapping=>
    !!mapping.localHash&&!!mapping.externalVersion&&mapping.externalVersion!==proposal.version&&localHash(current.document,mapping)!==mapping.localHash
  ).map(mapping=>({kind:mapping.kind,externalId:mapping.externalId,localId:mapping.localId,reason:"Both Forge and Figma changed since the last synchronized version"}));
  if(conflicts.length) warnings.push(`${conflicts.length} mapped item(s) changed on both sides. Review conflicts before applying Figma-preferred resolution.`);
  return {...proposal,warnings,conflicts,baseRevision:current.revision};
}
export async function applyFigmaSync(input:{websiteId:string;actorId:string;fileKey:string;expectedRevision:number;key:string;conflictPolicy?:"abort"|"prefer-figma";webhookEventId?:string}){
  if(input.webhookEventId&&!/^[0-9a-f-]{36}$/i.test(input.webhookEventId)) throw new AppError("Figma webhook event identity is invalid",400,"FIGMA_WEBHOOK_EVENT_INVALID");
  const proposal=await previewFigmaSync(input);
  if(proposal.conflicts.length&&input.conflictPolicy!=="prefer-figma") throw new AppError("Figma synchronization has conflicts that require explicit resolution",409,"FIGMA_SYNC_CONFLICT");
  if(proposal.baseRevision!==input.expectedRevision) throw new AppError("The SiteDocument changed while Figma was loading",412,"SITE_DOCUMENT_REVISION_CONFLICT");
  const applied=await applySiteDocumentCommands({websiteId:input.websiteId,actorId:input.actorId,expectedRevision:input.expectedRevision,key:input.key,commands:proposal.commands,source:"FIGMA"});
  const [website,canonical]=await Promise.all([getScopedWebsite(input.websiteId,input.actorId),getSiteDocument(input.websiteId,input.actorId)]);
  if(website.organizationId){
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      for(const mapping of proposal.mappings){
        const hash=localHash(canonical.document,mapping);
        await tx.figmaNodeMapping.upsert({
          where:{websiteId_fileKey_kind_externalId:{websiteId:input.websiteId,fileKey:input.fileKey,kind:mapping.kind,externalId:mapping.externalId}},
          update:{localId:mapping.localId,externalVersion:proposal.version,localHash:hash,lastSyncedAt:new Date()},
          create:{websiteId:input.websiteId,organizationId:website.organizationId!,workspaceId:website.workspaceId,fileKey:input.fileKey,kind:mapping.kind,externalId:mapping.externalId,localId:mapping.localId,externalVersion:proposal.version,localHash:hash},
        });
      }
      if(input.webhookEventId){
        const marked=await tx.figmaWebhookEvent.updateMany({
          where:{id:input.webhookEventId,websiteId:input.websiteId,fileKey:input.fileKey,status:"PENDING"},
          data:{status:"APPLIED",appliedAt:new Date(),appliedRevision:applied.revision},
        });
        if(marked.count!==1) throw new AppError("Figma webhook event is no longer pending",409,"FIGMA_WEBHOOK_EVENT_STATE");
      }
    });
  }
  return {...applied,fileName:proposal.fileName,figmaVersion:proposal.version,warnings:proposal.warnings,conflicts:proposal.conflicts,mappingCount:proposal.mappings.length};
}

async function tokenPushContext(input:{websiteId:string;actorId:string;fileKey:string}){
  const key=fileKey(input.fileKey);
  const [{website,token},current]=await Promise.all([
    getFigmaAccessContext(input.websiteId,input.actorId),
    getSiteDocument(input.websiteId,input.actorId),
  ]);
  if(!website.organizationId) throw new AppError("Website ownership migration is required",503,"TENANT_MIGRATION_REQUIRED");
  const [variables,mappings]=await Promise.all([
    requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}/variables/local`,token) as Promise<FigmaLocalVariablesSnapshot>,
    prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      return tx.figmaNodeMapping.findMany({where:{websiteId:input.websiteId,fileKey:key,kind:"TOKEN"},select:{kind:true,externalId:true,localId:true}});
    }),
  ]);
  return {key,website,token,current,variables,mappings};
}

export async function previewFigmaTokenPush(input:{websiteId:string;actorId:string;fileKey:string}){
  const context=await tokenPushContext(input);
  const plan=buildFigmaTokenPushPlan({fileKey:context.key,document:context.current.document,variables:context.variables,mappings:context.mappings});
  return {
    fileKey:context.key,baseRevision:context.current.revision,
    actions:plan.actions,warnings:plan.warnings,
    createCount:plan.createCount,updateCount:plan.updateCount,skipCount:plan.skipCount,
  };
}

export async function pushFigmaTokens(input:{websiteId:string;actorId:string;fileKey:string;expectedRevision:number}){
  const context=await tokenPushContext(input);
  if(context.current.revision!==input.expectedRevision) throw new AppError("The SiteDocument changed while preparing the Figma token push",412,"SITE_DOCUMENT_REVISION_CONFLICT");
  const plan=buildFigmaTokenPushPlan({fileKey:context.key,document:context.current.document,variables:context.variables,mappings:context.mappings});
  if(!Object.keys(plan.body).length) return {
    fileKey:context.key,baseRevision:context.current.revision,createCount:0,updateCount:0,skipCount:plan.skipCount,
    warnings:plan.warnings,mappingCount:0,noChanges:true,
  };
  const result=await requestJson(`https://api.figma.com/v1/files/${encodeURIComponent(context.key)}/variables`,context.token,{method:"POST",body:plan.body}) as {
    meta?:{tempIdToRealId?:Record<string,string>};
  };
  const temp=result?.meta?.tempIdToRealId??{};
  let mappingCount=0;
  if(context.website.organizationId){
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${context.website.organizationId}, true)`;
      for(const mapping of plan.temporaryMappings){
        const externalId=temp[mapping.temporaryId];
        if(!externalId) continue;
        mappingCount++;
        await tx.figmaNodeMapping.upsert({
          where:{websiteId_fileKey_kind_externalId:{websiteId:input.websiteId,fileKey:context.key,kind:"TOKEN",externalId}},
          update:{localId:mapping.tokenId,lastSyncedAt:new Date()},
          create:{
            websiteId:input.websiteId,organizationId:context.website.organizationId!,workspaceId:context.website.workspaceId,
            fileKey:context.key,kind:"TOKEN",externalId,localId:mapping.tokenId,lastSyncedAt:new Date(),
          },
        });
      }
      await tx.auditLog.create({data:{
        userId:input.actorId,action:"FIGMA_TOKENS_PUSHED",targetResource:`website:${input.websiteId}`,
        details:{fileKey:context.key,revision:context.current.revision,created:plan.createCount,updated:plan.updateCount,skipped:plan.skipCount},
      }});
    });
  }
  return {
    fileKey:context.key,baseRevision:context.current.revision,
    createCount:plan.createCount,updateCount:plan.updateCount,skipCount:plan.skipCount,
    warnings:plan.warnings,mappingCount,noChanges:false,
  };
}
