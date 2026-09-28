import { useEffect, useRef, useState } from "react";

type Plan={id:string;name:string;slug:string;price:number;currency:string;websiteLimit:number;storageLimitMb:number;aiCreditLimit:number};
type Summary={subscription:any;seatsUsed:number;usage:Array<{metric:string;quantity:string|number}>;invoices:any[]};
type Caps={role:string;subscriptionStatus:string;plan:string|null;actions:{billingManage:boolean};limits:any;features:unknown};
const key=()=>crypto.randomUUID();

export function OrganizationBillingPanel({apiUrl,organizationId}:{apiUrl:string;organizationId:string}){
  const [summary,setSummary]=useState<Summary|null>(null);const[plans,setPlans]=useState<Plan[]>([]);const[caps,setCaps]=useState<Caps|null>(null);
  const[error,setError]=useState("");const[busy,setBusy]=useState(false);const keys=useRef(new Map<string,string>());
  async function json(path:string,init?:RequestInit){
    const r=await fetch(apiUrl+path,{credentials:"include",...init,headers:{"Content-Type":"application/json",...((init?.headers as Record<string,string>|undefined)||{})}});
    const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.error?.message||d?.message||"Request failed");return d?.data??d;
  }
  async function load(){
    setError("");
    try{
      const [s,p,c]=await Promise.all([
        json(`/api/v1/organizations/${organizationId}/billing`),
        json("/api/v1/subscriptions/plans"),
        json(`/api/v1/organizations/${organizationId}/capabilities`),
      ]);
      setSummary(s);setPlans(Array.isArray(p?.plans)?p.plans:[]);setCaps(c);
    }catch(e:any){setError(e.message);}
  }
  useEffect(()=>{void load();},[organizationId]);
  async function checkout(plan:Plan){
    const identity=plan.id;if(!keys.current.has(identity))keys.current.set(identity,key());
    setBusy(true);setError("");
    try{
      const result=await json(`/api/v1/organizations/${organizationId}/billing/checkout`,{
        method:"POST",headers:{"Idempotency-Key":keys.current.get(identity)!},body:JSON.stringify({planSlug:plan.slug})
      });
      if(result.checkoutUrl){window.location.assign(result.checkoutUrl);return;}
      keys.current.delete(identity);await load();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="rounded-xl border bg-white p-5 space-y-4" aria-labelledby="org-billing-title">
    <header><h3 id="org-billing-title" className="font-bold text-lg">Organization billing & entitlements</h3><p className="text-sm text-slate-500">Provider-verified commercial state for this organization. Workspace roles do not grant billing authority automatically.</p></header>
    {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {!summary&&!error&&<p role="status">Loading billing status…</p>}
    {summary&&<div className="grid gap-3 sm:grid-cols-3"><div className="rounded border p-3"><div className="text-xs text-slate-500">Plan</div><div className="font-bold">{summary.subscription?.planName||"Not provisioned"}</div><div className="text-xs">{summary.subscription?.status||"UNPROVISIONED"}</div></div><div className="rounded border p-3"><div className="text-xs text-slate-500">Seats</div><div className="font-bold">{summary.seatsUsed} / {summary.subscription?.seatLimit??"—"}</div></div><div className="rounded border p-3"><div className="text-xs text-slate-500">Usage metrics</div><div className="font-bold">{summary.usage.length}</div></div></div>}
    {caps?.actions.billingManage&&<div><h4 className="font-semibold">Plans</h4><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{plans.map(plan=><button type="button" disabled={busy||caps.plan===plan.slug} onClick={()=>void checkout(plan)} key={plan.id} className="rounded border p-3 text-left disabled:opacity-50"><div className="font-semibold">{plan.name}</div><div className="text-xs text-slate-500">{plan.currency} {plan.price} · {plan.websiteLimit} sites</div><div className="mt-2 text-xs font-semibold">{caps.plan===plan.slug?"Current":"Select / checkout"}</div></button>)}</div></div>}
    {summary&&summary.invoices.length>0&&<div><h4 className="font-semibold">Recent provider invoices</h4><ul className="mt-2 space-y-1 text-sm">{summary.invoices.slice(0,10).map((invoice:any)=><li key={invoice.id} className="flex justify-between rounded border p-2"><span>{invoice.providerInvoiceId}</span><span>{invoice.currency} {(Number(invoice.amount)/100).toFixed(2)} · {invoice.status}</span></li>)}</ul></div>}
  </section>;
}
