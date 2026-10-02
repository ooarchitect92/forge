import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { getScopedWebsiteInTransaction } from "./scoped-access.js";

export type SiteDocumentMetricInput = {
  websiteId:string;
  actorId:string;
  operation:string;
  source?:string;
  durationMs:number;
  commandCount?:number;
  status:"SUCCESS"|"ERROR";
  errorCode?:string|null;
  idempotencyKey?:string|null;
};

function bounded(value:string,max:number,label:string){
  const v=String(value||"").trim();
  if(!v||v.length>max) throw new AppError(`${label} is invalid`,500,"SITE_DOCUMENT_METRIC_INVALID");
  return v;
}

export async function recordSiteDocumentMetric(input:SiteDocumentMetricInput){
  const operation=bounded(input.operation,60,"Metric operation");
  const source=bounded(input.source||"USER",30,"Metric source");
  const durationMs=Math.max(0,Math.min(2_147_483_647,Math.round(Number(input.durationMs)||0)));
  const commandCount=Math.max(0,Math.min(1_000_000,Math.round(Number(input.commandCount)||0)));
  const idempotencyKey=input.idempotencyKey?bounded(input.idempotencyKey,128,"Metric idempotency key"):null;
  try{
    return await prisma.$transaction(async tx=>{
      const website=await getScopedWebsiteInTransaction(tx,input.websiteId,input.actorId);
      if(!website.organizationId) return null;
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
      return tx.siteDocumentMetric.create({data:{
        websiteId:input.websiteId,organizationId:website.organizationId,workspaceId:website.workspaceId,actorId:input.actorId,
        operation,source,durationMs,commandCount,status:input.status,errorCode:input.errorCode?.slice(0,100)||null,idempotencyKey,
      }});
    });
  }catch(error){
    // Metrics must never turn a successfully committed document command into a failed API call.
    console.error(JSON.stringify({event:"site_document.metric_persist_failed",websiteId:input.websiteId,operation,errorCode:(error as {code?:string})?.code??"UNKNOWN"}));
    return null;
  }
}

export async function getSiteDocumentMetrics(websiteId:string,actorId:string){
  return prisma.$transaction(async tx=>{
    const website=await getScopedWebsiteInTransaction(tx,websiteId,actorId);
    if(!website.organizationId) throw new AppError("Website ownership migration is required",503,"TENANT_MIGRATION_REQUIRED");
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${website.organizationId}, true)`;
    const [summary,sources,errors,recent]=await Promise.all([
      tx.$queryRaw<Array<{operations:bigint;errors:bigint;avgMs:number|null;p95Ms:number|null;commands:bigint}>>`
        SELECT count(*)::bigint operations,
               count(*) FILTER (WHERE status='ERROR')::bigint errors,
               avg("durationMs")::float8 AS "avgMs",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")::float8 AS "p95Ms",
               coalesce(sum("commandCount"),0)::bigint commands
          FROM site_document_metrics
         WHERE "websiteId"=${websiteId}::uuid AND "createdAt">now()-interval '24 hours'`,
      tx.$queryRaw<Array<{source:string;count:bigint}>>`
        SELECT source,count(*)::bigint count FROM site_document_metrics
         WHERE "websiteId"=${websiteId}::uuid AND "createdAt">now()-interval '24 hours'
         GROUP BY source ORDER BY count DESC,source ASC`,
      tx.$queryRaw<Array<{errorCode:string;count:bigint}>>`
        SELECT coalesce("errorCode",'UNKNOWN') AS "errorCode",count(*)::bigint count FROM site_document_metrics
         WHERE "websiteId"=${websiteId}::uuid AND status='ERROR' AND "createdAt">now()-interval '24 hours'
         GROUP BY coalesce("errorCode",'UNKNOWN') ORDER BY count DESC,"errorCode" ASC LIMIT 20`,
      tx.siteDocumentMetric.findMany({where:{websiteId},orderBy:{createdAt:"desc"},take:50,select:{operation:true,source:true,durationMs:true,commandCount:true,status:true,errorCode:true,createdAt:true}}),
    ]);
    const row=summary[0]??{operations:0n,errors:0n,avgMs:null,p95Ms:null,commands:0n};
    return {
      window:"24h",
      operations:Number(row.operations),
      errors:Number(row.errors),
      errorRate:Number(row.operations)?Number(row.errors)/Number(row.operations):0,
      averageDurationMs:row.avgMs??0,
      p95DurationMs:row.p95Ms??0,
      commandCount:Number(row.commands),
      bySource:sources.map(value=>({source:value.source,count:Number(value.count)})),
      errorCodes:errors.map(value=>({errorCode:value.errorCode,count:Number(value.count)})),
      recent,
    };
  });
}
