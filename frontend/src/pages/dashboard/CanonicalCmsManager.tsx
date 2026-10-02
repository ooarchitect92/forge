import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createSiteDocumentClient, SiteDocumentApiError } from "../../features/site-document/client";
import type { CmsCollection, CmsItem, SiteCommand, SiteDocumentEnvelope, SiteElement } from "../../features/site-document/types";

const apiUrl=import.meta.env.VITE_API_URL||"http://localhost:5000";

function errorMessage(error:unknown){
  if(error instanceof SiteDocumentApiError) return error.code?`${error.message} (${error.code})`:error.message;
  return error instanceof Error?error.message:"Request failed";
}
function slug(value:string){return value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,255);}
function elementOptions(document:SiteDocumentEnvelope["document"]|undefined){
  const result:Array<{id:string;label:string}>=[];
  const walk=(elements:SiteElement[],pageName:string,path:string)=>{
    elements.forEach((element,index)=>{
      const label=`${pageName} / ${path}${element.name||element.type} [${element.id}]`;
      result.push({id:element.id,label});
      walk(element.children,pageName,`${path}${element.name||element.type} ${index+1} / `);
    });
  };
  document?.pages.forEach(page=>walk(page.elements,page.name,""));
  return result;
}

export default function CanonicalCmsManager(){
  const {websiteId=""}=useParams<{websiteId:string}>();
  const client=useMemo(()=>createSiteDocumentClient(apiUrl,websiteId),[websiteId]);
  const [model,setModel]=useState<SiteDocumentEnvelope|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [collectionName,setCollectionName]=useState("");
  const [selectedCollection,setSelectedCollection]=useState("");
  const [fieldName,setFieldName]=useState("");
  const [fieldType,setFieldType]=useState("text");
  const [itemTitle,setItemTitle]=useState("");
  const [itemValues,setItemValues]=useState("{}");
  const [bindingElement,setBindingElement]=useState("");
  const [bindingField,setBindingField]=useState("");
  const [bindingProperty,setBindingProperty]=useState("content");

  const refresh=useCallback(async()=>{
    const next=await client.get();setModel(next);
    if(!selectedCollection&&next.document.cms.collections[0]) setSelectedCollection(next.document.cms.collections[0].id);
  },[client,selectedCollection]);

  useEffect(()=>{let active=true;client.get().then(value=>{if(active){setModel(value);if(value.document.cms.collections[0])setSelectedCollection(value.document.cms.collections[0].id);}}).catch(failure=>active&&setError(errorMessage(failure)));return()=>{active=false;};},[client]);

  const collection=model?.document.cms.collections.find(value=>value.id===selectedCollection);
  const items=model?.document.cms.items.filter(value=>value.collectionId===selectedCollection)??[];
  const elements=elementOptions(model?.document);

  async function apply(commands:SiteCommand[]){
    if(!model) return;
    setBusy(true);setError("");
    try{
      let revision=model.revision;
      if(!model.persisted){const initialized=await client.initialize();revision=initialized.revision;}
      await client.apply(commands,revision);
      await refresh();
    }catch(failure){setError(errorMessage(failure));}
    finally{setBusy(false);}
  }

  async function createCollection(){
    const name=collectionName.trim();if(!name)return;
    const id=crypto.randomUUID();
    await apply([{type:"cms.collection.create",collection:{id,name,slug:slug(name)||id,description:"",fields:[]}}]);
    setSelectedCollection(id);setCollectionName("");
  }
  async function addField(){
    if(!collection||!fieldName.trim())return;
    const key=slug(fieldName).replace(/-/g,"_")||`field_${Date.now()}`;
    await apply([{type:"cms.field.add",collectionId:collection.id,field:{id:crypto.randomUUID(),name:fieldName.trim(),key,type:fieldType,required:false,config:{}}}]);
    setFieldName("");
  }
  async function createItem(){
    if(!collection||!itemTitle.trim())return;
    let values:Record<string,unknown>;
    try{const parsed=JSON.parse(itemValues||"{}");if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error();values=parsed;}
    catch{setError("Item values must be a JSON object.");return;}
    await apply([{type:"cms.item.create",item:{id:crypto.randomUUID(),collectionId:collection.id,title:itemTitle.trim(),slug:slug(itemTitle),status:"DRAFT",values}}]);
    setItemTitle("");setItemValues("{}");
  }
  async function publishItem(item:CmsItem){
    await apply([{type:"cms.item.update",itemId:item.id,patch:{status:item.status==="PUBLISHED"?"DRAFT":"PUBLISHED"}}]);
  }
  async function bindField(){
    if(!collection||!bindingElement||!bindingField||!bindingProperty.trim())return;
    await apply([{type:"cms.field.bind",binding:{id:crypto.randomUUID(),elementId:bindingElement,property:bindingProperty.trim(),collectionId:collection.id,fieldId:bindingField}}]);
  }

  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-xs font-bold uppercase tracking-[.18em] text-violet-300">SiteDocument · CMS 2.0</div><h1 className="mt-2 text-3xl font-bold">Canonical Collections</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Collections, items and canvas bindings are committed through the same typed command processor and revision stream as visual edits.</p></div>
        <div className="flex gap-2"><Link className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold" to={`/dashboard/site-document/${websiteId}`}>Canonical model</Link><Link className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold" to={`/editor/${websiteId}`}>Open editor</Link></div>
      </header>
      {error&&<div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      <div className="grid gap-6 lg:grid-cols-[.75fr_1.25fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="font-bold">Collections</h2>
          <div className="mt-4 flex gap-2"><input value={collectionName} onChange={e=>setCollectionName(e.target.value)} placeholder="Blog Posts" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><button disabled={busy||!collectionName.trim()} onClick={createCollection} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold disabled:opacity-40">Create</button></div>
          <div className="mt-4 space-y-2">{model?.document.cms.collections.map(value=><button key={value.id} onClick={()=>{setSelectedCollection(value.id);setBindingField("");}} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedCollection===value.id?"border-violet-500 bg-violet-500/10":"border-slate-800 bg-slate-950/50"}`}><div className="font-semibold">{value.name}</div><div className="text-xs text-slate-500">/{value.slug} · {value.fields.length} fields</div></button>)}</div>
          {collection&&<button disabled={busy} onClick={()=>window.confirm(`Delete collection "${collection.name}" and its canonical items/bindings?`)&&apply([{type:"cms.collection.delete",collectionId:collection.id}])} className="mt-5 text-xs font-bold text-red-300">Delete selected collection</button>}
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="font-bold">Schema {collection&&<span className="font-normal text-slate-500">· {collection.name}</span>}</h2>
            {!collection?<p className="mt-3 text-sm text-slate-500">Create or select a collection.</p>:<>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]"><input value={fieldName} onChange={e=>setFieldName(e.target.value)} placeholder="Field name" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><select value={fieldType} onChange={e=>setFieldType(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{["text","richText","number","boolean","date","image","file","reference","multiReference","json"].map(type=><option key={type}>{type}</option>)}</select><button disabled={busy||!fieldName.trim()} onClick={addField} className="rounded-lg border border-violet-500/50 px-3 py-2 text-sm font-bold text-violet-200">Add field</button></div>
              <div className="mt-4 divide-y divide-slate-800">{collection.fields.map(field=><div key={field.id} className="flex items-center justify-between py-3 text-sm"><div><strong>{field.name}</strong><div className="text-xs text-slate-500">{field.key} · {field.type}</div></div><button disabled={busy} onClick={()=>apply([{type:"cms.field.delete",collectionId:collection.id,fieldId:field.id}])} className="text-xs font-bold text-red-300">Remove</button></div>)}</div>
            </>}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="font-bold">Entries</h2>
            {collection&&<><div className="mt-4 grid gap-3"><input value={itemTitle} onChange={e=>setItemTitle(e.target.value)} placeholder="Entry title" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><textarea value={itemValues} onChange={e=>setItemValues(e.target.value)} rows={4} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs" aria-label="CMS item JSON values"/><button disabled={busy||!itemTitle.trim()} onClick={createItem} className="w-fit rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold">Create draft</button></div>
              <div className="mt-5 divide-y divide-slate-800">{items.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{item.title||item.slug||item.id}</strong><div className="text-xs text-slate-500">{item.status} · /{item.slug}</div></div><div className="flex gap-3"><button disabled={busy} onClick={()=>publishItem(item)} className="text-xs font-bold text-emerald-300">{item.status==="PUBLISHED"?"Unpublish":"Publish"}</button><button disabled={busy} onClick={()=>apply([{type:"cms.item.delete",itemId:item.id}])} className="text-xs font-bold text-red-300">Delete</button></div></div>)}</div>
            </>}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="font-bold">Canvas bindings</h2><p className="mt-1 text-sm text-slate-400">Bind an existing canonical canvas element property to a field. Use <code>content</code>, <code>props.href</code>, <code>props.src</code>, or another allowed property path.</p>
            {collection&&<div className="mt-4 grid gap-2 lg:grid-cols-[1fr_1fr_180px_auto]"><select value={bindingElement} onChange={e=>setBindingElement(e.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Select element</option>{elements.map(element=><option key={element.id} value={element.id}>{element.label}</option>)}</select><select value={bindingField} onChange={e=>setBindingField(e.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Select field</option>{collection.fields.map(field=><option key={field.id} value={field.id}>{field.name}</option>)}</select><input value={bindingProperty} onChange={e=>setBindingProperty(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><button disabled={busy||!bindingElement||!bindingField} onClick={bindField} className="rounded-lg border border-violet-500/50 px-3 py-2 text-sm font-bold text-violet-200">Bind</button></div>}
            <div className="mt-4 divide-y divide-slate-800">{model?.document.cms.bindings.filter(binding=>!collection||binding.collectionId===collection.id).map(binding=><div key={binding.id} className="flex items-center justify-between py-3 text-xs"><span className="font-mono text-slate-400">{binding.elementId} → {binding.property}</span><button disabled={busy} onClick={()=>apply([{type:"cms.field.unbind",bindingId:binding.id}])} className="font-bold text-red-300">Unbind</button></div>)}</div>
          </section>
        </div>
      </div>
    </div>
  </main>;
}
