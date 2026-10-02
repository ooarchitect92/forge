import "dotenv/config";
import { prisma, pgPool } from "../src/config/prisma.js";
import { ensureSiteDocumentState } from "../src/services/websites/site-document-storage.js";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find(value => value.startsWith("--limit="));
const limit = Math.max(1, Math.min(10_000, Number(limitArg?.split("=")[1] || 500)));
const batchArg = process.argv.find(value => value.startsWith("--batch="));
const batchSize = Math.max(1, Math.min(100, Number(batchArg?.split("=")[1] || 25)));

type Candidate = {
  id:string; name:string; slug:string; editorData:unknown; documentVersion:number;
  organizationId:string|null; workspaceId:string|null;
};

async function candidates():Promise<Candidate[]> {
  return prisma.website.findMany({
    where:{
      organizationId:{not:null},
      workspaceId:{not:null},
      siteDocumentState:null,
    },
    orderBy:{createdAt:"asc"},
    take:limit,
    select:{
      id:true,name:true,slug:true,editorData:true,documentVersion:true,organizationId:true,workspaceId:true,
    },
  });
}

async function main(){
  if(apply && process.env.FORGE_SITE_DOCUMENT_MIGRATION!=="1"){
    throw new Error("Refusing to mutate data. Set FORGE_SITE_DOCUMENT_MIGRATION=1 and pass --apply after reviewing the dry run.");
  }

  const rows=await candidates();
  const unresolved=await prisma.website.count({where:{OR:[{organizationId:null},{workspaceId:null}]}});
  console.log(JSON.stringify({
    mode:apply?"apply":"dry-run",
    candidates:rows.length,
    unresolvedTenantOwnership:unresolved,
    limit,batchSize,
  }));

  if(!apply){
    for(const row of rows.slice(0,50)) console.log(JSON.stringify({
      websiteId:row.id,documentVersion:row.documentVersion,organizationId:row.organizationId,workspaceId:row.workspaceId,
    }));
    if(rows.length>50) console.log(JSON.stringify({remainingPreviewRows:rows.length-50}));
    return;
  }

  let migrated=0;
  const failures:Array<{websiteId:string;code:string;message:string}>=[];
  for(let offset=0;offset<rows.length;offset+=batchSize){
    const batch=rows.slice(offset,offset+batchSize);
    for(const row of batch){
      try{
        await prisma.$transaction(async tx=>{
          const locked=await tx.website.findUnique({where:{id:row.id},select:{
            id:true,name:true,slug:true,editorData:true,documentVersion:true,organizationId:true,workspaceId:true,
          }});
          if(!locked?.organizationId||!locked.workspaceId) throw new Error("Tenant ownership became unresolved during migration");
          await ensureSiteDocumentState(tx,locked,null);
        },{isolationLevel:"Serializable"});
        migrated++;
        console.log(JSON.stringify({event:"site_document.migrated",websiteId:row.id,documentVersion:row.documentVersion}));
      }catch(error){
        const code=typeof error==="object"&&error&&"code" in error?String((error as {code?:unknown}).code||"UNKNOWN"):"UNKNOWN";
        const message=error instanceof Error?error.message:"Migration failed";
        failures.push({websiteId:row.id,code,message:message.slice(0,500)});
        console.error(JSON.stringify({event:"site_document.migration_failed",websiteId:row.id,code,message:message.slice(0,500)}));
      }
    }
  }

  console.log(JSON.stringify({event:"site_document.migration_complete",migrated,failed:failures.length,total:rows.length}));
  if(failures.length) process.exitCode=2;
}

main()
  .catch(error=>{console.error(error);process.exitCode=1;})
  .finally(async()=>{await prisma.$disconnect().catch(()=>undefined);await pgPool.end().catch(()=>undefined);});
