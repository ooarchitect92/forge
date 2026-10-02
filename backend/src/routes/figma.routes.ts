import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { requireRuntimeCapability } from "../platform/control/runtime-capability.js";
import { AppError } from "../utils/app-error.js";
import { startFigmaOAuth, completeFigmaOAuth } from "../integrations/figma/figma-oauth.service.js";
import { getScopedWebsite } from "../services/websites/scoped-access.js";
import { canUserAccessResource } from "../services/permission.service.js";
import { getActiveConnectorCredential } from "../platform/integrations/connector-credentials.js";
import { createFigmaFileWebhook, deleteFigmaFileWebhook, dismissFigmaWebhookEvent, listFigmaFileWebhooks, listFigmaWebhookEvents, receiveFigmaWebhook } from "../integrations/figma/figma-webhook.service.js";

const router=Router();

router.post("/webhooks/:organizationId/:subscriptionId",requireRuntimeCapability("figma-sync",{allowDegraded:true}),async(req,res,next)=>{
  try{res.json(await receiveFigmaWebhook({organizationId:String(req.params.organizationId),subscriptionId:String(req.params.subscriptionId),body:req.body}));}
  catch(error){next(error);}
});

function frontendRedirect(websiteId:string,status:"connected"|"error",code?:string){
  const raw=String(process.env.FRONTEND_URL||"").trim();
  if(!raw) return null;
  let origin:URL;
  try{origin=new URL(raw);}catch{return null;}
  if(!["http:","https:"].includes(origin.protocol)) return null;
  const target=new URL(`/dashboard/site-document/${encodeURIComponent(websiteId)}`,origin.origin);
  target.searchParams.set("figma",status);
  if(code) target.searchParams.set("code",code.slice(0,100));
  return target.toString();
}

router.use(requireAuth);

router.post("/websites/:websiteId/oauth/start",requireRuntimeCapability("figma-sync"),async(req,res,next)=>{
  try{
    const result=await startFigmaOAuth(String(req.params.websiteId),res.locals.user.id);
    res.setHeader("Cache-Control","no-store");
    res.json({success:true,...result});
  }catch(error){next(error);}
});

router.get("/oauth/callback",requireRuntimeCapability("figma-sync"),async(req,res,next)=>{
  try{
    if(req.query.error){
      throw new AppError("Figma authorization was not completed",400,"FIGMA_OAUTH_DENIED");
    }
    const result=await completeFigmaOAuth({state:req.query.state,code:req.query.code,actorId:res.locals.user.id});
    const redirect=frontendRedirect(result.websiteId,"connected");
    if(redirect) return res.redirect(303,redirect);
    res.setHeader("Cache-Control","no-store");
    return res.json({success:true,...result});
  }catch(error){
    const state=typeof req.query.state==="string"?req.query.state:"";
    const organizationId=/^[0-9a-f-]{36}./i.test(state)?state.slice(0,36):"";
    if(organizationId){
      // Do not derive a website ID from untrusted callback state. Error rendering
      // remains on the API when a verified callback could not complete.
    }
    next(error);
  }
});

router.post("/websites/:websiteId/webhooks",requireRuntimeCapability("figma-sync"),async(req,res,next)=>{
  try{res.status(201).json({success:true,subscription:await createFigmaFileWebhook({websiteId:String(req.params.websiteId),actorId:res.locals.user.id,fileKey:req.body?.fileKey})});}
  catch(error){next(error);}
});
router.get("/websites/:websiteId/webhooks",requireRuntimeCapability("figma-sync",{allowDegraded:true}),async(req,res,next)=>{
  try{res.json({success:true,subscriptions:await listFigmaFileWebhooks(String(req.params.websiteId),res.locals.user.id)});}
  catch(error){next(error);}
});
router.delete("/websites/:websiteId/webhooks/:subscriptionId",requireRuntimeCapability("figma-sync"),async(req,res,next)=>{
  try{res.json({success:true,subscription:await deleteFigmaFileWebhook({websiteId:String(req.params.websiteId),actorId:res.locals.user.id,subscriptionId:String(req.params.subscriptionId)})});}
  catch(error){next(error);}
});
router.get("/websites/:websiteId/webhook-events",requireRuntimeCapability("figma-sync",{allowDegraded:true}),async(req,res,next)=>{
  try{res.json({success:true,events:await listFigmaWebhookEvents(String(req.params.websiteId),res.locals.user.id)});}
  catch(error){next(error);}
});
router.post("/websites/:websiteId/webhook-events/:eventId/dismiss",requireRuntimeCapability("figma-sync",{allowDegraded:true}),async(req,res,next)=>{
  try{res.json({success:true,event:await dismissFigmaWebhookEvent({websiteId:String(req.params.websiteId),actorId:res.locals.user.id,eventId:String(req.params.eventId)})});}
  catch(error){next(error);}
});

router.get("/websites/:websiteId/status",requireRuntimeCapability("figma-sync",{allowDegraded:true}),async(req,res,next)=>{
  try{
    const websiteId=String(req.params.websiteId),actorId=res.locals.user.id;
    const website=await getScopedWebsite(websiteId,actorId);
    if(!website.organizationId) throw new AppError("Website ownership migration is required",503,"TENANT_MIGRATION_REQUIRED");
    if(!await canUserAccessResource(actorId,websiteId,"*","VIEW")) throw new AppError("Website not found",404,"NOT_FOUND");
    const credential=await getActiveConnectorCredential({organizationId:website.organizationId,websiteId,provider:"figma"});
    res.setHeader("Cache-Control","no-store");
    res.json({success:true,connected:Boolean(credential),credential:credential?{id:credential.id,scopes:credential.scopes,version:credential.version}:null});
  }catch(error){next(error);}
});

export default router;
