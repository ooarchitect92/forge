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
  let body:any={}; try{body=await res.json();}catch{}
  if(!res.ok||body?.success===false) throw new SiteDocumentApiError(body?.error?.message||body?.message||"SiteDocument request failed",res.status,body?.error?.code||body?.code);
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
      return response<{success:boolean;baseRevision:number;fileName:string;version:string;warnings:string[];commands:SiteCommand[]}>(
        await fetch(`${base}/figma/preview`,{method:"POST",credentials:"include",headers:headers(),body:JSON.stringify({fileKey})})
      );
    },
    async figmaSync(fileKey:string,expectedRevision:number,key=crypto.randomUUID()){
      return response<{success:boolean;revision:number;figmaVersion:string;fileName:string;warnings:string[];mappingCount:number}>(
        await fetch(`${base}/figma/sync`,{method:"POST",credentials:"include",headers:headers(key),body:JSON.stringify({fileKey,expectedRevision})})
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
