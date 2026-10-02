import type { SiteCommand, SiteDocumentEnvelope, SiteDocumentRevisionSummary } from "./types";

export class SiteDocumentApiError extends Error {
  status: number;
  code?: string;
  constructor(message:string,status:number,code?:string){
    super(message);
    this.status=status;
    this.code=code;
  }
}
async function response<T>(res:Response):Promise<T>{
  let body:unknown={}; try{body=await res.json();}catch{}
  const object=body&&typeof body==="object"&&!Array.isArray(body)?body as Record<string,unknown>:{};
  const error=object.error&&typeof object.error==="object"&&!Array.isArray(object.error)?object.error as Record<string,unknown>:{};
  if(!res.ok||object.success===false) throw new SiteDocumentApiError(
    typeof error.message==="string"?error.message:typeof object.message==="string"?object.message:"SiteDocument request failed",
    res.status,
    typeof error.code==="string"?error.code:typeof object.code==="string"?object.code:undefined
  );
  return body as T;
}
function headers(key?:string):HeadersInit{
  return {"Content-Type":"application/json",...(key?{"Idempotency-Key":key}: {})};
}
export function createSiteDocumentClient(apiUrl:string,websiteId:string){
  const base=`${apiUrl}/api/websites/${encodeURIComponent(websiteId)}/site-document`;
  return {
    async get(signal?:AbortSignal):Promise<SiteDocumentEnvelope>{
      return response<SiteDocumentEnvelope & {success:boolean}>(await fetch(base,{credentials:"include",signal}));
    },
    async initialize(key=crypto.randomUUID()):Promise<SiteDocumentEnvelope>{
      return response<SiteDocumentEnvelope & {success:boolean}>(await fetch(`${base}/initialize`,{method:"POST",credentials:"include",headers:headers(key),body:"{}"}));
    },
    async preview(commands:SiteCommand[],signal?:AbortSignal){
      return response<{success:boolean;websiteId:string;baseRevision:number;schemaVersion:number;commands:SiteCommand[];proposed:SiteDocumentEnvelope["document"]}>(
        await fetch(`${base}/commands/preview`,{method:"POST",credentials:"include",headers:headers(),body:JSON.stringify({commands}),signal})
      );
    },
    async apply(commands:SiteCommand[],expectedRevision:number,key=crypto.randomUUID()){
      return response<{success:boolean;websiteId:string;revision:number;documentVersion:number;schemaVersion:number;updatedAt:string}>(
        await fetch(`${base}/commands`,{method:"POST",credentials:"include",headers:headers(key),body:JSON.stringify({commands,expectedRevision})})
      );
    },
    async revisions(limit=50):Promise<SiteDocumentRevisionSummary[]>{
      const body=await response<{success:boolean;revisions:SiteDocumentRevisionSummary[]}>(await fetch(`${base}/revisions?limit=${Math.min(200,Math.max(1,limit))}`,{credentials:"include"}));
      return body.revisions;
    },
    async restore(targetRevision:number,expectedRevision:number,key=crypto.randomUUID()){
      return response<{success:boolean;revision:number;documentVersion:number;restoredFrom:number}>(
        await fetch(`${base}/revisions/${targetRevision}/restore`,{method:"POST",credentials:"include",headers:headers(key),body:JSON.stringify({expectedRevision})})
      );
    },
    async cms(){
      return response<{success:boolean;revision:number;collections:SiteDocumentEnvelope["document"]["cms"]["collections"];items:SiteDocumentEnvelope["document"]["cms"]["items"];bindings:SiteDocumentEnvelope["document"]["cms"]["bindings"]}>(
        await fetch(`${base}/cms`,{credentials:"include"})
      );
    },
    async figmaPreview(fileKey:string){
      return response<{success:boolean;baseRevision:number;fileName:string;version:string;warnings:string[];commands:SiteCommand[];conflicts:Array<{kind:string;externalId:string;localId:string;reason:string}>}>(
        await fetch(`${base}/figma/preview`,{method:"POST",credentials:"include",headers:headers(),body:JSON.stringify({fileKey})})
      );
    },
    async figmaSync(fileKey:string,expectedRevision:number,conflictPolicy:"abort"|"prefer-figma"="abort",key=crypto.randomUUID()){
      return response<{success:boolean;revision:number;figmaVersion:string;fileName:string;warnings:string[];conflicts:Array<{kind:string;externalId:string;localId:string;reason:string}>;mappingCount:number}>(
        await fetch(`${base}/figma/sync`,{method:"POST",credentials:"include",headers:headers(key),body:JSON.stringify({fileKey,expectedRevision,conflictPolicy})})
      );
    },
    async figmaTokenPushPreview(fileKey:string){
      return response<{success:boolean;baseRevision:number;fileKey:string;createCount:number;updateCount:number;skipCount:number;warnings:string[];actions:Array<{tokenId:string;tokenName:string;action:"CREATE"|"UPDATE"|"SKIP";reason?:string}>}>(
        await fetch(`${base}/figma/tokens/push/preview`,{method:"POST",credentials:"include",headers:headers(),body:JSON.stringify({fileKey})})
      );
    },
    async figmaTokenPush(fileKey:string,expectedRevision:number){
      return response<{success:boolean;baseRevision:number;fileKey:string;createCount:number;updateCount:number;skipCount:number;warnings:string[];mappingCount:number;noChanges:boolean}>(
        await fetch(`${base}/figma/tokens/push`,{method:"POST",credentials:"include",headers:headers(),body:JSON.stringify({fileKey,expectedRevision})})
      );
    },
  };
}
