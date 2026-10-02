import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createSiteDocumentClient, SiteDocumentApiError } from "../../features/site-document/client";
import type { JsonValue, SiteCommand, SiteDocumentEnvelope } from "../../features/site-document/types";

const apiUrl=import.meta.env.VITE_API_URL||"http://localhost:5000";
const categories=["color","typography","spacing","radius","shadow","size","other"] as const;

function errorMessage(error:unknown){
  if(error instanceof SiteDocumentApiError) return error.code?`${error.message} (${error.code})`:error.message;
  return error instanceof Error?error.message:"Request failed";
}
function parseValue(input:string):JsonValue{
  const trimmed=input.trim();
  if(!trimmed)return "";
  try{return JSON.parse(trimmed) as JsonValue;}catch{return trimmed;}
}
function parseObject(input:string):Record<string,JsonValue>{
  const value=JSON.parse(input||"{}");
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Expected a JSON object");
  return value;
}

export default function CanonicalDesignSystemManager(){
  const {websiteId=""}=useParams<{websiteId:string}>();
  const client=useMemo(()=>createSiteDocumentClient(apiUrl,websiteId),[websiteId]);
  const [model,setModel]=useState<SiteDocumentEnvelope|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [tokenName,setTokenName]=useState("");
  const [tokenCategory,setTokenCategory]=useState<typeof categories[number]>("color");
  const [tokenValue,setTokenValue]=useState("#111827");
  const [selector,setSelector]=useState(".class");
  const [styleJson,setStyleJson]=useState("{}");
  const [componentId,setComponentId]=useState("");
  const [variantName,setVariantName]=useState("");
  const [variantProps,setVariantProps]=useState("{}");

  const refresh=useCallback(async()=>setModel(await client.get()),[client]);
  useEffect(()=>{let active=true;client.get().then(value=>active&&setModel(value)).catch(failure=>active&&setError(errorMessage(failure)));return()=>{active=false;};},[client]);

  async function apply(commands:SiteCommand[]){
    if(!model)return;
    setBusy(true);setError("");
    try{
      let revision=model.revision;
      if(!model.persisted){revision=(await client.initialize()).revision;}
      await client.apply(commands,revision);
      await refresh();
    }catch(failure){setError(errorMessage(failure));}
    finally{setBusy(false);}
  }

  async function saveToken(){
    if(!tokenName.trim())return;
    const existing=model?.document.tokens.find(token=>token.name===tokenName.trim());
    await apply([{type:"token.set",token:{id:existing?.id||crypto.randomUUID(),name:tokenName.trim(),category:tokenCategory,value:parseValue(tokenValue),description:existing?.description,source:"forge"}}]);
    setTokenName("");
  }
  async function saveRule(){
    try{
      const properties=parseObject(styleJson);
      const existing=model?.document.styles.find(rule=>rule.selector===selector.trim());
      await apply([{type:"style.updateRule",rule:{id:existing?.id||crypto.randomUUID(),selector:selector.trim(),properties}}]);
    }catch(failure){setError(errorMessage(failure));}
  }
  async function addVariant(){
    if(!componentId||!variantName.trim())return;
    try{
      await apply([{type:"component.variant.set",componentId,variant:{id:crypto.randomUUID(),name:variantName.trim(),props:parseObject(variantProps),styles:{}}}]);
      setVariantName("");setVariantProps("{}");
    }catch(failure){setError(errorMessage(failure));}
  }

  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">SiteDocument · Design System</div><h1 className="mt-2 text-3xl font-bold">Tokens, styles & components</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Manage canonical visual primitives through typed commands so editor, AI, Figma and publishing share the same design-system state.</p></div>
        <div className="flex gap-2"><Link to={`/dashboard/site-document/${websiteId}`} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold">Canonical model</Link><Link to={`/editor/${websiteId}`} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold">Open editor</Link></div>
      </header>
      {error&&<div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-bold">Design tokens</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px]"><input value={tokenName} onChange={e=>setTokenName(e.target.value)} placeholder="Token name" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><select value={tokenCategory} onChange={e=>setTokenCategory(e.target.value as typeof tokenCategory)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{categories.map(value=><option key={value}>{value}</option>)}</select></div>
          <div className="mt-2 flex gap-2"><input value={tokenValue} onChange={e=>setTokenValue(e.target.value)} placeholder="#112233 or JSON" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"/><button disabled={busy||!tokenName.trim()} onClick={saveToken} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold disabled:opacity-40">Set token</button></div>
          <div className="mt-5 max-h-80 overflow-auto divide-y divide-slate-800">{model?.document.tokens.map(token=><div key={token.id} className="flex items-center justify-between gap-3 py-3 text-sm"><button className="min-w-0 text-left" onClick={()=>{setTokenName(token.name);setTokenCategory(token.category);setTokenValue(typeof token.value==="string"?token.value:JSON.stringify(token.value));}}><strong className="block truncate">{token.name}</strong><span className="text-xs text-slate-500">{token.category} · {typeof token.value==="string"?token.value:JSON.stringify(token.value)}</span></button><button disabled={busy} onClick={()=>apply([{type:"token.delete",tokenId:token.id}])} className="text-xs font-bold text-red-300">Delete</button></div>)}</div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-bold">Style rules</h2>
          <div className="mt-4 grid gap-2"><input value={selector} onChange={e=>setSelector(e.target.value)} placeholder=".hero-title" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"/><textarea value={styleJson} onChange={e=>setStyleJson(e.target.value)} rows={5} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs" aria-label="Style JSON"/><button disabled={busy||!selector.trim()} onClick={saveRule} className="w-fit rounded-lg border border-cyan-500/50 px-4 py-2 text-sm font-bold text-cyan-200">Set rule</button></div>
          <div className="mt-5 max-h-72 overflow-auto divide-y divide-slate-800">{model?.document.styles.map(rule=><div key={rule.id} className="flex items-center justify-between gap-3 py-3 text-sm"><button onClick={()=>{setSelector(rule.selector);setStyleJson(JSON.stringify(rule.properties,null,2));}} className="min-w-0 text-left"><strong className="font-mono">{rule.selector}</strong><div className="truncate text-xs text-slate-500">{JSON.stringify(rule.properties)}</div></button><button disabled={busy} onClick={()=>apply([{type:"style.deleteRule",ruleId:rule.id}])} className="text-xs font-bold text-red-300">Delete</button></div>)}</div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-lg font-bold">Reusable components & variants</h2>
        <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]"><select value={componentId} onChange={e=>setComponentId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Select component</option>{model?.document.components.map(component=><option key={component.id} value={component.id}>{component.name}</option>)}</select><input value={variantName} onChange={e=>setVariantName(e.target.value)} placeholder="Variant name" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input value={variantProps} onChange={e=>setVariantProps(e.target.value)} placeholder='{"size":"lg"}' className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"/><button disabled={busy||!componentId||!variantName.trim()} onClick={addVariant} className="rounded-lg border border-cyan-500/50 px-4 py-2 text-sm font-bold text-cyan-200">Add variant</button></div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{model?.document.components.map(component=><article key={component.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="font-semibold">{component.name}</div><div className="mt-1 text-xs text-slate-500">{component.variants.length} variants · {component.slots.length} slots</div><div className="mt-3 flex flex-wrap gap-2">{component.variants.map(variant=><span key={variant.id} className="rounded-full bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">{variant.name}<button className="ml-2 text-red-300" disabled={busy} onClick={()=>apply([{type:"component.variant.delete",componentId:component.id,variantId:variant.id}])}>×</button></span>)}</div></article>)}</div>
      </section>
    </div>
  </main>;
}
