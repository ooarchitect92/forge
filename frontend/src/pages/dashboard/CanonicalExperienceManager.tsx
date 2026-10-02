import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createSiteDocumentClient, SiteDocumentApiError } from "../../features/site-document/client";
import type { JsonValue, SiteCommand, SiteDocumentEnvelope } from "../../features/site-document/types";

const apiUrl=import.meta.env.VITE_API_URL||"http://localhost:5000";
function errorMessage(error:unknown){
  if(error instanceof SiteDocumentApiError)return error.code?`${error.message} (${error.code})`:error.message;
  return error instanceof Error?error.message:"Request failed";
}
function object(value:string,label:string):Record<string,JsonValue>{
  let parsed:unknown;
  try{parsed=JSON.parse(value||"{}");}catch{throw new Error(`${label} must be valid JSON.`);}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string,JsonValue>;
}
function list(value:string,label:string):Array<Record<string,JsonValue>>{
  let parsed:unknown;
  try{parsed=JSON.parse(value||"[]");}catch{throw new Error(`${label} must be valid JSON.`);}
  if(!Array.isArray(parsed)||parsed.some(item=>!item||typeof item!=="object"||Array.isArray(item)))throw new Error(`${label} must be an array of JSON objects.`);
  return parsed as Array<Record<string,JsonValue>>;
}

export default function CanonicalExperienceManager(){
  const {websiteId=""}=useParams<{websiteId:string}>();
  const client=useMemo(()=>createSiteDocumentClient(apiUrl,websiteId),[websiteId]);
  const [model,setModel]=useState<SiteDocumentEnvelope|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const [interactionElement,setInteractionElement]=useState("");
  const [trigger,setTrigger]=useState("click");
  const [action,setAction]=useState("toggle");
  const [interactionConfig,setInteractionConfig]=useState("{}");

  const [formName,setFormName]=useState("");
  const [formFields,setFormFields]=useState('[{"name":"email","type":"email","required":true}]');
  const [formActions,setFormActions]=useState('[{"type":"store"}]');

  const [locale,setLocale]=useState("en-US");
  const [localeValues,setLocaleValues]=useState("{}");

  const [experimentName,setExperimentName]=useState("");
  const [experimentVariants,setExperimentVariants]=useState('[{"id":"control","weight":50},{"id":"variant-a","weight":50}]');
  const [allocation,setAllocation]=useState('{"trafficPercent":100}');

  const [integrationProvider,setIntegrationProvider]=useState("");
  const [integrationConfig,setIntegrationConfig]=useState("{}");

  const refresh=useCallback(async()=>setModel(await client.get()),[client]);
  useEffect(()=>{let active=true;client.get().then(value=>active&&setModel(value)).catch(failure=>active&&setError(errorMessage(failure)));return()=>{active=false;};},[client]);

  async function apply(commands:SiteCommand[]){
    if(!model)return;
    setBusy(true);setError("");
    try{
      let revision=model.revision;
      if(!model.persisted)revision=(await client.initialize()).revision;
      await client.apply(commands,revision);
      await refresh();
    }catch(failure){setError(errorMessage(failure));}
    finally{setBusy(false);}
  }

  async function addInteraction(){
    if(!interactionElement)return;
    try{await apply([{type:"interaction.set",interaction:{id:crypto.randomUUID(),elementId:interactionElement,trigger:trigger.trim(),action:action.trim(),config:object(interactionConfig,"Interaction config")}}]);}
    catch(failure){setError(errorMessage(failure));}
  }
  async function addForm(){
    if(!formName.trim())return;
    try{await apply([{type:"form.set",form:{id:crypto.randomUUID(),name:formName.trim(),fields:list(formFields,"Form fields"),actions:list(formActions,"Form actions"),settings:{}}}]);setFormName("");}
    catch(failure){setError(errorMessage(failure));}
  }
  async function addLocale(){
    if(!locale.trim())return;
    try{await apply([{type:"locale.add",locale:{id:crypto.randomUUID(),locale:locale.trim(),values:object(localeValues,"Locale values")}}]);}
    catch(failure){setError(errorMessage(failure));}
  }
  async function addExperiment(){
    if(!experimentName.trim())return;
    try{await apply([{type:"experiment.createVariant",experiment:{id:crypto.randomUUID(),name:experimentName.trim(),status:"DRAFT",variants:list(experimentVariants,"Experiment variants"),allocation:object(allocation,"Experiment allocation")}}]);setExperimentName("");}
    catch(failure){setError(errorMessage(failure));}
  }
  async function addIntegration(){
    if(!integrationProvider.trim())return;
    try{await apply([{type:"integration.set",integration:{id:crypto.randomUUID(),provider:integrationProvider.trim(),enabled:true,config:object(integrationConfig,"Integration config")}}]);setIntegrationProvider("");}
    catch(failure){setError(errorMessage(failure));}
  }

  const elements=useMemo(()=>{
    const result:Array<{id:string;label:string}>=[];
    const walk=(nodes:SiteDocumentEnvelope["document"]["pages"][number]["elements"],page:string,path="")=>{
      for(const node of nodes){result.push({id:node.id,label:`${page} / ${path}${node.name||node.type}`});walk(node.children,page,`${path}${node.name||node.type} / `);}
    };
    model?.document.pages.forEach(page=>walk(page.elements,page.name));
    return result;
  },[model]);

  return <main className="min-h-screen bg-slate-950 text-slate-100"><div className="mx-auto max-w-7xl px-6 py-8">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="text-xs font-bold uppercase tracking-[.18em] text-fuchsia-300">SiteDocument · Experience Logic</div><h1 className="mt-2 text-3xl font-bold">Interactions, forms, locales & experiments</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Manage the remaining canonical experience domains through the same typed-command and revision pipeline used by design and CMS.</p></div>
      <div className="flex gap-2"><Link to={`/dashboard/site-document/${websiteId}`} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold">Canonical model</Link><Link to={`/editor/${websiteId}`} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold">Open editor</Link></div>
    </header>
    {error&&<div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="font-bold">Interactions</h2>
        <div className="mt-4 grid gap-2"><select value={interactionElement} onChange={e=>setInteractionElement(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Select element</option>{elements.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><div className="grid grid-cols-2 gap-2"><input value={trigger} onChange={e=>setTrigger(e.target.value)} placeholder="click" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input value={action} onChange={e=>setAction(e.target.value)} placeholder="animate" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></div><textarea value={interactionConfig} onChange={e=>setInteractionConfig(e.target.value)} rows={3} className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><button disabled={busy||!interactionElement} onClick={addInteraction} className="w-fit rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm font-bold text-fuchsia-200">Add interaction</button></div>
        <div className="mt-4 divide-y divide-slate-800">{model?.document.interactions.map(item=><div key={item.id} className="flex items-center justify-between py-3 text-sm"><div><strong>{item.trigger} → {item.action}</strong><div className="text-xs text-slate-500">{item.elementId||"site"}</div></div><button disabled={busy} onClick={()=>apply([{type:"interaction.delete",interactionId:item.id}])} className="text-xs font-bold text-red-300">Delete</button></div>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="font-bold">Forms</h2>
        <div className="mt-4 grid gap-2"><input value={formName} onChange={e=>setFormName(e.target.value)} placeholder="Lead capture" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><textarea value={formFields} onChange={e=>setFormFields(e.target.value)} rows={4} className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><textarea value={formActions} onChange={e=>setFormActions(e.target.value)} rows={3} className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><button disabled={busy||!formName.trim()} onClick={addForm} className="w-fit rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm font-bold text-fuchsia-200">Add form</button></div>
        <div className="mt-4 divide-y divide-slate-800">{model?.document.forms.map(item=><div key={item.id} className="flex items-center justify-between py-3 text-sm"><div><strong>{item.name}</strong><div className="text-xs text-slate-500">{item.fields.length} fields · {item.actions.length} actions</div></div><button disabled={busy} onClick={()=>apply([{type:"form.delete",formId:item.id}])} className="text-xs font-bold text-red-300">Delete</button></div>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="font-bold">Localization overlays</h2>
        <div className="mt-4 grid gap-2"><input value={locale} onChange={e=>setLocale(e.target.value)} placeholder="fr-FR" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><textarea value={localeValues} onChange={e=>setLocaleValues(e.target.value)} rows={4} placeholder='{"hero.title":"Bonjour"}' className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><button disabled={busy||!locale.trim()} onClick={addLocale} className="w-fit rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm font-bold text-fuchsia-200">Add locale</button></div>
        <div className="mt-4 divide-y divide-slate-800">{model?.document.locales.map(item=><div key={item.id} className="flex items-center justify-between py-3 text-sm"><strong>{item.locale}</strong><button disabled={busy} onClick={()=>apply([{type:"locale.delete",localeId:item.id}])} className="text-xs font-bold text-red-300">Delete</button></div>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="font-bold">Experiments</h2>
        <div className="mt-4 grid gap-2"><input value={experimentName} onChange={e=>setExperimentName(e.target.value)} placeholder="Hero CTA test" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><textarea value={experimentVariants} onChange={e=>setExperimentVariants(e.target.value)} rows={3} className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><textarea value={allocation} onChange={e=>setAllocation(e.target.value)} rows={2} className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"/><button disabled={busy||!experimentName.trim()} onClick={addExperiment} className="w-fit rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm font-bold text-fuchsia-200">Create experiment</button></div>
        <div className="mt-4 divide-y divide-slate-800">{model?.document.experiments.map(item=><div key={item.id} className="flex items-center justify-between py-3 text-sm"><div><strong>{item.name}</strong><div className="text-xs text-slate-500">{item.status} · {item.variants.length} variants</div></div><div className="flex gap-3">{item.status!=="RUNNING"&&<button disabled={busy} onClick={()=>apply([{type:"experiment.update",experimentId:item.id,patch:{status:"RUNNING"}}])} className="text-xs font-bold text-emerald-300">Start</button>}<button disabled={busy} onClick={()=>apply([{type:"experiment.delete",experimentId:item.id}])} className="text-xs font-bold text-red-300">Delete</button></div></div>)}</div>
      </section>
    </div>

    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="font-bold">Canonical integrations metadata</h2><p className="mt-1 text-sm text-slate-400">This stores public/non-secret integration configuration only. Provider credentials stay in governed connector secret storage.</p>
      <div className="mt-4 grid gap-2 lg:grid-cols-[240px_1fr_auto]"><input value={integrationProvider} onChange={e=>setIntegrationProvider(e.target.value)} placeholder="analytics" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input value={integrationConfig} onChange={e=>setIntegrationConfig(e.target.value)} placeholder='{"measurementId":"..."}' className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"/><button disabled={busy||!integrationProvider.trim()} onClick={addIntegration} className="rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm font-bold text-fuchsia-200">Add integration</button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{model?.document.integrations.map(item=><div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center justify-between"><strong>{item.provider}</strong><span className={item.enabled?"text-emerald-300":"text-slate-500"}>{item.enabled?"Enabled":"Disabled"}</span></div><button disabled={busy} onClick={()=>apply([{type:"integration.delete",integrationId:item.id}])} className="mt-3 text-xs font-bold text-red-300">Remove</button></div>)}</div>
    </section>
  </div></main>;
}
