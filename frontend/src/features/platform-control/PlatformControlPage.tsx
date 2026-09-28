import { useEffect, useState } from "react";

type Capability={id:string;owner:string;criticality:string;changeClass:string;desiredState:string;actualState:string;provider?:string;dependencies?:unknown;offBehavior?:unknown};
type Change={id:string;capabilityId:string;desiredState:string;status:string;requestedBy:string;approvedBy?:string|null;createdAt:string;planDigest?:string};
type Overview={capabilities:Capability[];recentChanges:Change[];tenantBackfillIssues:Array<{resource_type:string;count:number}>};

const API=import.meta.env.VITE_API_URL||"http://localhost:5000";

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(API+path,{credentials:"include",...init,headers:{"Content-Type":"application/json",...((init?.headers as Record<string,string>|undefined)||{})}});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw Object.assign(new Error(data?.error?.message||data?.message||"Request failed"),{status:response.status,code:data?.error?.code});
  return data.data as T;
}

export default function PlatformControlPage(){
  const [data,setData]=useState<Overview|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [reason,setReason]=useState("Planned production configuration change");
  const load=()=>request<Overview>("/platform/v1/overview").then(setData).catch((e:any)=>{setData(null);setError(e.message);});
  useEffect(()=>{load();},[]);
  async function signIn(){
    setBusy(true);setError("");
    try{const result=await request<{authorizationUrl:string}>("/api/v1/auth/oidc/platform/start",{method:"POST",body:"{}"});window.location.assign(result.authorizationUrl);}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  async function createChange(capability:Capability,next:string){
    setBusy(true);setError("");
    try{await request("/platform/v1/changes",{method:"POST",body:JSON.stringify({capabilityId:capability.id,desiredState:next,reason})});await load();}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  async function mutate(changeId:string,action:"approve"|"apply",planDigest:string){
    setBusy(true);setError("");
    try{await request(`/platform/v1/changes/${changeId}/${action}`,{method:"POST",body:JSON.stringify({planDigest})});await load();}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  if(!data)return <main className="min-h-screen bg-slate-950 text-slate-100 p-8"><div className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-8"><h1 className="text-2xl font-bold">Forge Platform Control Center</h1><p className="mt-3 text-sm text-slate-400">This surface uses a separate platform session and requires phishing-resistant managed authentication.</p>{error&&<p role="alert" className="mt-4 text-red-400">{error}</p>}<button disabled={busy} onClick={signIn} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 font-semibold">Sign in to platform control</button></div></main>;
  return <main className="min-h-screen bg-slate-950 text-slate-100 p-6"><div className="mx-auto max-w-7xl space-y-6">
    <header><p className="text-xs uppercase tracking-widest text-blue-400">Privileged control plane</p><h1 className="text-3xl font-black">Forge Platform Control Center</h1><p className="mt-2 text-sm text-slate-400">Desired and observed state are shown separately. Locked controls cannot be changed here.</p></header>
    {error&&<p role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-red-300">{error}</p>}
    {data.tenantBackfillIssues.length>0&&<section className="rounded-xl border border-amber-700 bg-amber-950/30 p-4"><h2 className="font-bold text-amber-300">Tenant backfill requires attention</h2><ul className="mt-2 text-sm">{data.tenantBackfillIssues.map(x=><li key={x.resource_type}>{x.resource_type}: {x.count} unresolved rows</li>)}</ul></section>}
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Capabilities</h2><label className="mt-3 block text-sm">Change reason<input value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"/></label><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-400"><th>Capability</th><th>Class</th><th>Provider</th><th>Desired</th><th>Observed</th><th>Action</th></tr></thead><tbody>{data.capabilities.map(cap=><tr key={cap.id} className="border-t border-slate-800"><td className="py-3 font-semibold">{cap.id}<div className="text-xs text-slate-500">{cap.owner}</div></td><td>{cap.criticality==="LOCKED"?"🔒 ":""}{cap.changeClass}</td><td>{cap.provider||"—"}</td><td>{cap.desiredState}</td><td>{cap.actualState}</td><td>{cap.criticality==="LOCKED"?<span className="text-slate-500">Locked</span>:<button disabled={busy} className="rounded border border-slate-700 px-2 py-1" onClick={()=>createChange(cap,cap.desiredState==="ENABLED"?"DISABLED":"ENABLED")}>Request {cap.desiredState==="ENABLED"?"off":"on"}</button>}</td></tr>)}</tbody></table></div></section>
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Recent changes</h2><div className="mt-3 space-y-3">{data.recentChanges.length===0?<p className="text-slate-500">No changes yet.</p>:data.recentChanges.map(ch=><article key={ch.id} className="rounded border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{ch.capabilityId} → {ch.desiredState}</span><span>{ch.status}</span></div><p className="mt-1 text-xs text-slate-500">{ch.id}</p>{ch.planDigest&&<div className="mt-3 flex gap-2"><button disabled={busy||ch.status!=="AWAITING_APPROVAL"} onClick={()=>mutate(ch.id,"approve",ch.planDigest!)} className="rounded border px-2 py-1 disabled:opacity-40">Approve</button><button disabled={busy||ch.status!=="APPROVED"} onClick={()=>mutate(ch.id,"apply",ch.planDigest!)} className="rounded border px-2 py-1 disabled:opacity-40">Apply</button></div>}</article>)}</div></section>
  </div></main>;
}
