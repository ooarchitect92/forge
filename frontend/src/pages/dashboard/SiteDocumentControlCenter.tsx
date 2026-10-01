import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createSiteDocumentClient, SiteDocumentApiError } from "../../features/site-document/client";
import type { SiteCommand, SiteDocumentEnvelope, SiteDocumentRevisionSummary } from "../../features/site-document/types";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

function countElements(elements: Array<{children?: any[]}>): number {
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
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [figmaKey,setFigmaKey] = useState("");
  const [figmaPreview,setFigmaPreview] = useState<{fileName:string;version:string;warnings:string[];commands:SiteCommand[]}|null>(null);

  const refresh = useCallback(async () => {
    setError("");
    const [document,revs] = await Promise.all([client.get(), client.revisions()]);
    setModel(document); setRevisions(revs);
  },[client]);

  useEffect(() => {
    const controller=new AbortController(); setLoading(true);
    Promise.all([client.get(controller.signal),client.revisions()])
      .then(([document,revs])=>{ if(!controller.signal.aborted){setModel(document);setRevisions(revs);} })
      .catch(failure=>{if(!controller.signal.aborted)setError(errorMessage(failure));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[client]);

  async function initialize() {
    setBusy(true);setError("");
    try{await client.initialize();await refresh();}catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function previewFigma() {
    if(!figmaKey.trim()) return;
    setBusy(true);setError("");setFigmaPreview(null);
    try{const proposal=await client.figmaPreview(figmaKey.trim());setFigmaPreview(proposal);}
    catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
  }
  async function applyFigma() {
    if(!model||!figmaKey.trim()) return;
    setBusy(true);setError("");
    try{await client.figmaSync(figmaKey.trim(),model.revision);setFigmaPreview(null);await refresh();}
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

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Figma sync</h2><p className="mt-1 text-sm text-slate-400">Preview a governed Figma import as typed commands before applying it.</p></div><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">Review first</span></div>
          <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Figma file key</label>
          <div className="mt-2 flex gap-2">
            <input value={figmaKey} onChange={event=>setFigmaKey(event.target.value)} placeholder="AbCdEf123…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-violet-500"/>
            <button disabled={busy||!figmaKey.trim()} onClick={previewFigma} className="rounded-lg border border-violet-500/50 px-4 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40">Preview</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">The backend expects an active organization-scoped Figma connector credential; raw tokens are not accepted by this screen.</p>
          {figmaPreview&&<div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">{figmaPreview.fileName}</div><div className="text-xs text-slate-500">Figma version {figmaPreview.version||"unknown"}</div></div><div className="text-sm font-bold text-violet-300">{figmaPreview.commands.length} commands</div></div>
            {figmaPreview.warnings.map(warning=><div key={warning} className="mt-3 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">{warning}</div>)}
            <div className="mt-4 max-h-44 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-slate-400">
              {figmaPreview.commands.slice(0,30).map((command,index)=><div key={index}>{String(index+1).padStart(2,"0")} · {command.type}</div>)}
              {figmaPreview.commands.length>30&&<div>… {figmaPreview.commands.length-30} more</div>}
            </div>
            <button disabled={busy||!model?.persisted} onClick={applyFigma} className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold hover:bg-violet-500 disabled:opacity-40">Apply reviewed commands</button>
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
