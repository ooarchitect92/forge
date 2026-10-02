import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createSiteDocumentClient, SiteDocumentApiError } from "../../features/site-document/client";
import type { SiteCommand, SiteDocumentEnvelope, SiteDocumentRevisionSummary } from "../../features/site-document/types";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

type CountableElement={children?:CountableElement[]};
function countElements(elements: CountableElement[]): number {
  return elements.reduce((total, element) => total + 1 + countElements(Array.isArray(element.children) ? element.children : []), 0);
}
function errorMessage(error: unknown): string {
  if (error instanceof SiteDocumentApiError) return error.code ? `${error.message} (${error.code})` : error.message;
  return error instanceof Error ? error.message : "Request failed";
}

export default function SiteDocumentControlCenter() {
  const { websiteId = "" } = useParams<{websiteId:string}>();
  const client = useMemo(() => createSiteDocumentClient(apiUrl, websiteId), [websiteId]);
  const [model,setModel] = useState<SiteDocumentEnvelope|null>(null);
  const [revisions,setRevisions] = useState<SiteDocumentRevisionSummary[]>([]);
  const [metrics,setMetrics] = useState<{operations:number;errors:number;errorRate:number;averageDurationMs:number;p95DurationMs:number;commandCount:number}|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [figmaKey,setFigmaKey] = useState("");
  const [figmaConnected,setFigmaConnected] = useState<boolean|null>(null);
  const [figmaSubscriptions,setFigmaSubscriptions] = useState<Array<{id:string;fileKey:string;eventType:string;status:string;lastEventAt?:string|null;createdAt:string}>>([]);
  const [figmaEvents,setFigmaEvents] = useState<Array<{id:string;subscriptionId:string;eventType:string;fileKey:string;summary:Record<string,unknown>;receivedAt:string}>>([]);
  const [figmaPreview,setFigmaPreview] = useState<{fileName:string;version:string;warnings:string[];commands:SiteCommand[];conflicts:Array<{kind:string;externalId:string;localId:string;reason:string}>}|null>(null);
  const [tokenPushPreview,setTokenPushPreview] = useState<{createCount:number;updateCount:number;skipCount:number;warnings:string[];actions:Array<{tokenId:string;tokenName:string;action:"CREATE"|"UPDATE"|"SKIP";reason?:string}>}|null>(null);

  const refresh = useCallback(async () => {
    setError("");
    const [document,revs,metricResult,figmaStatus,webhooks,events] = await Promise.all([client.get(), client.revisions(), client.metrics().catch(()=>null),client.figmaConnectionStatus().catch(()=>null),client.figmaWebhooks().catch(()=>null),client.figmaWebhookEvents().catch(()=>null)]);
    setModel(document); setRevisions(revs); if(metricResult)setMetrics(metricResult.metrics); if(figmaStatus)setFigmaConnected(figmaStatus.connected); if(webhooks)setFigmaSubscriptions(webhooks.subscriptions); if(events)setFigmaEvents(events.events);
  },[client]);

  useEffect(() => {
    const controller=new AbortController();
    Promise.all([client.get(controller.signal),client.revisions(),client.metrics().catch(()=>null),client.figmaConnectionStatus().catch(()=>null),client.figmaWebhooks().catch(()=>null),client.figmaWebhookEvents().catch(()=>null)])
      .then(([document,revs,metricResult,figmaStatus,webhooks,events])=>{ if(!controller.signal.aborted){setModel(document);setRevisions(revs);if(metricResult)setMetrics(metricResult.metrics);if(figmaStatus)setFigmaConnected(figmaStatus.connected);if(webhooks)setFigmaSubscriptions(webhooks.subscriptions);if(events)setFigmaEvents(events.events);} })
      .catch(failure=>{if(!controller.signal.aborted)setError(errorMessage(failure));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[client]);

  async function initialize() {
    setBusy(true);setError("");
    try{await client.initialize();await refresh();}catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function connectFigma(){
    setBusy(true);setError("");
    try{
      const result=await client.figmaOAuthStart();
      window.location.assign(result.authorizationUrl);
    }catch(failure){setError(errorMessage(failure));setBusy(false);}
  }
    async function previewFigma() {
    if(!figmaKey.trim()) return;
    setBusy(true);setError("");setFigmaPreview(null);
    try{const proposal=await client.figmaPreview(figmaKey.trim());setFigmaPreview(proposal);}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function applyFigma(conflictPolicy:"abort"|"prefer-figma"="abort") {
    if(!model||!figmaKey.trim()) return;
    if(conflictPolicy==="prefer-figma"&&!window.confirm("Conflicts exist. Apply the reviewed Figma version over the conflicting Forge mappings?")) return;
    setBusy(true);setError("");
    try{await client.figmaSync(figmaKey.trim(),model.revision,conflictPolicy);setFigmaPreview(null);await refresh();}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function watchFigmaFile(){
    if(!figmaKey.trim())return;
    setBusy(true);setError("");
    try{await client.createFigmaWebhook(figmaKey.trim());await refresh();}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function removeFigmaWatch(subscriptionId:string){
    if(!window.confirm("Stop watching this Figma file for updates?"))return;
    setBusy(true);setError("");
    try{await client.deleteFigmaWebhook(subscriptionId);await refresh();}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function dismissFigmaUpdate(eventId:string){
    setBusy(true);setError("");
    try{await client.dismissFigmaWebhookEvent(eventId);await refresh();}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function reviewFigmaUpdate(fileKey:string){
    setFigmaKey(fileKey);
    setBusy(true);setError("");setFigmaPreview(null);
    try{const proposal=await client.figmaPreview(fileKey);setFigmaPreview(proposal);}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
    async function previewTokenPush(){
    if(!figmaKey.trim()) return;
    setBusy(true);setError("");setTokenPushPreview(null);
    try{setTokenPushPreview(await client.figmaTokenPushPreview(figmaKey.trim()));}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function pushTokens(){
    if(!model||!figmaKey.trim()) return;
    if(!window.confirm("Push the reviewed canonical token changes to this Figma file?")) return;
    setBusy(true);setError("");
    try{await client.figmaTokenPush(figmaKey.trim(),model.revision);setTokenPushPreview(null);}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function restore(revision:number){
    if(!model||revision===model.revision) return;
    if(!window.confirm(`Restore revision ${revision}? This creates a new revision and does not erase history.`)) return;
    setBusy(true);setError("");
    try{await client.restore(revision,model.revision);await refresh();}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }

  if(loading) return <div className="min-h-screen bg-slate-950 text-slate-200 grid place-items-center">Loading canonical site model…</div>;
  const document=model?.document;
  const elementCount=document?.pages.reduce((total,page)=>total+countElements(page.elements),0)??0;

  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-300">
            <span>Forge canonical model</span><span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5">Schema v{model?.schemaVersion??1}</span>
          </div>
          <h1 className="text-3xl font-bold">{document?.site.title||"SiteDocument"}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Inspect versioned design data, CMS bindings, AI/Figma command proposals and safe revision history without bypassing the existing editor.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/dashboard" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800">Dashboard</Link>
          <Link to={`/dashboard/site-document/${websiteId}/cms`} className="rounded-lg border border-violet-500/50 px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/10">CMS 2.0</Link>
          <Link to={`/dashboard/site-document/${websiteId}/design-system`} className="rounded-lg border border-cyan-500/50 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/10">Design system</Link>
          <Link to={`/editor/${websiteId}`} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500">Open editor</Link>
        </div>
      </header>

      {error&&<div role="alert" className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      {!model?.persisted&&<section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
        <h2 className="font-semibold text-amber-100">Canonical state is running in compatibility mode</h2>
        <p className="mt-1 text-sm text-amber-200/80">The preview was derived from the existing editor document. Initialize persistent SiteDocument revision history when you are ready.</p>
        <button disabled={busy} onClick={initialize} className="mt-4 rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">Initialize canonical state</button>
      </section>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Revision",String(model?.revision??"—")],
          ["Pages",String(document?.pages.length??0)],
          ["Elements",String(elementCount)],
          ["Components",String(document?.components.length??0)],
          ["CMS",`${document?.cms.collections.length??0} collections`],
        ].map(([label,value])=><div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="text-xs uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-xl font-bold">{value}</div></div>)}
      </section>

      {metrics&&<section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><div className="text-xs uppercase tracking-wider text-slate-500">24h commands</div><div className="mt-1 text-lg font-bold">{metrics.commandCount}</div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Avg command latency</div><div className="mt-1 text-lg font-bold">{Math.round(metrics.averageDurationMs)} ms</div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><div className="text-xs uppercase tracking-wider text-slate-500">P95 latency</div><div className="mt-1 text-lg font-bold">{Math.round(metrics.p95DurationMs)} ms</div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Error rate</div><div className="mt-1 text-lg font-bold">{(metrics.errorRate*100).toFixed(1)}%</div></div>
      </section>}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Figma sync</h2><p className="mt-1 text-sm text-slate-400">Preview a governed Figma import as typed commands before applying it.</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${figmaConnected?"bg-emerald-400/10 text-emerald-300":"bg-amber-400/10 text-amber-200"}`}>{figmaConnected?"Connected":"Not connected"}</span>{figmaConnected!==true&&<button disabled={busy} onClick={connectFigma} className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs font-bold text-emerald-200 disabled:opacity-40">Connect Figma</button>}</div></div>
          <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Figma file key</label>
          <div className="mt-2 flex gap-2">
            <input value={figmaKey} onChange={event=>setFigmaKey(event.target.value)} placeholder="AbCdEf123…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-violet-500"/>
            <button disabled={busy||!figmaKey.trim()||figmaConnected!==true} onClick={previewFigma} className="rounded-lg border border-violet-500/50 px-4 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40">Import preview</button>
            <button disabled={busy||!figmaKey.trim()||!model?.persisted||figmaConnected!==true} onClick={previewTokenPush} className="rounded-lg border border-emerald-500/50 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-40">Token push preview</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">The backend expects an active organization-scoped Figma connector credential; raw tokens are not accepted by this screen.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button disabled={busy||figmaConnected!==true||!figmaKey.trim()||figmaSubscriptions.some(item=>item.fileKey===figmaKey.trim()&&item.status==="ACTIVE")} onClick={watchFigmaFile} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 disabled:opacity-40">Watch file updates</button>
            {figmaSubscriptions.filter(item=>item.status!=="REVOKED").map(item=><span key={item.id} className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300">{item.fileKey} · {item.status}<button disabled={busy} onClick={()=>removeFigmaWatch(item.id)} className="font-bold text-red-300">×</button></span>)}
          </div>
          {figmaEvents.length>0&&<div className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-200">Figma updates waiting for review</div>
            {figmaEvents.slice(0,10).map(event=><div key={event.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/60 p-2 text-xs"><div><strong>{typeof event.summary.fileName==="string"?event.summary.fileName:event.fileKey}</strong><span className="ml-2 text-slate-500">{new Date(event.receivedAt).toLocaleString()}</span></div><div className="flex gap-2"><button disabled={busy} onClick={()=>reviewFigmaUpdate(event.fileKey)} className="font-bold text-cyan-300">Review changes</button><button disabled={busy} onClick={()=>dismissFigmaUpdate(event.id)} className="font-bold text-slate-400">Dismiss</button></div></div>)}
          </div>}
          {tokenPushPreview&&<div className="mt-5 rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">Forge → Figma design tokens</div><div className="text-xs text-slate-500">Only values representable by Figma Variables are pushed.</div></div><div className="text-xs font-bold text-emerald-300">{tokenPushPreview.createCount} create · {tokenPushPreview.updateCount} update · {tokenPushPreview.skipCount} skip</div></div>
            {tokenPushPreview.warnings.slice(0,5).map(warning=><div key={warning} className="mt-2 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">{warning}</div>)}
            <div className="mt-4 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-slate-400">
              {tokenPushPreview.actions.slice(0,40).map(action=><div key={action.tokenId}>{action.action.padEnd(6," ")} · {action.tokenName}{action.reason?` · ${action.reason}`:""}</div>)}
              {tokenPushPreview.actions.length>40&&<div>… {tokenPushPreview.actions.length-40} more</div>}
            </div>
            <button disabled={busy||(!tokenPushPreview.createCount&&!tokenPushPreview.updateCount)} onClick={pushTokens} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500 disabled:opacity-40">Push reviewed tokens to Figma</button>
          </div>}
          {figmaPreview&&<div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">{figmaPreview.fileName}</div><div className="text-xs text-slate-500">Figma version {figmaPreview.version||"unknown"}</div></div><div className="text-sm font-bold text-violet-300">{figmaPreview.commands.length} commands</div></div>
            {figmaPreview.warnings.map(warning=><div key={warning} className="mt-3 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">{warning}</div>)}
            {figmaPreview.conflicts.length>0&&<div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"><div className="font-bold">{figmaPreview.conflicts.length} two-sided conflict(s)</div>{figmaPreview.conflicts.slice(0,10).map(conflict=><div key={`${conflict.kind}:${conflict.externalId}`} className="mt-1 font-mono">{conflict.kind} · {conflict.localId}</div>)}</div>}
            <div className="mt-4 max-h-44 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-slate-400">
              {figmaPreview.commands.slice(0,30).map((command,index)=><div key={index}>{String(index+1).padStart(2,"0")} · {command.type}</div>)}
              {figmaPreview.commands.length>30&&<div>… {figmaPreview.commands.length-30} more</div>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={busy||!model?.persisted||figmaPreview.conflicts.length>0} onClick={()=>applyFigma("abort")} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold hover:bg-violet-500 disabled:opacity-40">Apply reviewed commands</button>
              {figmaPreview.conflicts.length>0&&<button disabled={busy||!model?.persisted} onClick={()=>applyFigma("prefer-figma")} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40">Resolve using Figma</button>}
            </div>
          </div>}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-bold">Design system</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between rounded-lg bg-slate-950/60 p-3"><span className="text-slate-400">Tokens</span><strong>{document?.tokens.length??0}</strong></div>
            <div className="flex justify-between rounded-lg bg-slate-950/60 p-3"><span className="text-slate-400">Style rules</span><strong>{document?.styles.length??0}</strong></div>
            <div className="flex justify-between rounded-lg bg-slate-950/60 p-3"><span className="text-slate-400">Assets</span><strong>{document?.assets.length??0}</strong></div>
            <div className="flex justify-between rounded-lg bg-slate-950/60 p-3"><span className="text-slate-400">CMS bindings</span><strong>{document?.cms.bindings.length??0}</strong></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Link to={`/dashboard/site-document/${websiteId}/cms`} className="inline-flex rounded-lg border border-violet-500/40 px-3 py-2 text-xs font-bold text-violet-200">Manage canonical CMS</Link><Link to={`/dashboard/site-document/${websiteId}/design-system`} className="inline-flex rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-bold text-cyan-200">Manage design system</Link></div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Revision history</h2><p className="mt-1 text-sm text-slate-400">Every command batch is immutable. Restore produces a new head revision rather than deleting history.</p></div><button disabled={busy} onClick={()=>refresh().catch(f=>setError(errorMessage(f)))} className="text-sm font-semibold text-violet-300">Refresh</button></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Revision</th><th className="pb-3">Source</th><th className="pb-3">Created</th><th className="pb-3">Commands</th><th className="pb-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-800">
          {revisions.map(revision=><tr key={revision.id}><td className="py-3 font-mono">r{revision.revision}{revision.revision===model?.revision&&<span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">HEAD</span>}</td><td className="py-3">{revision.source}</td><td className="py-3 text-slate-400">{new Date(revision.createdAt).toLocaleString()}</td><td className="py-3 text-slate-400">{Array.isArray(revision.commands)?revision.commands.length:"—"}</td><td className="py-3 text-right"><button disabled={busy||revision.revision===model?.revision} onClick={()=>restore(revision.revision)} className="text-xs font-bold text-violet-300 disabled:text-slate-700">Restore</button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  </main>;
}
