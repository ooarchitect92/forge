import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createSiteDocumentClient, SiteDocumentApiError } from "./client";
import type { SiteCommand, SiteDocumentEnvelope } from "./types";

const apiUrl=import.meta.env.VITE_API_URL||"http://localhost:5000";

interface SiteDocumentContextValue {
  model:SiteDocumentEnvelope|null;
  loading:boolean;
  error:string;
  refresh:()=>Promise<SiteDocumentEnvelope>;
  preview:(commands:SiteCommand[])=>Promise<SiteDocumentEnvelope["document"]>;
  apply:(commands:SiteCommand[])=>Promise<void>;
}
const SiteDocumentContext=createContext<SiteDocumentContextValue|null>(null);

function message(error:unknown){
  if(error instanceof SiteDocumentApiError) return error.code?`${error.message} (${error.code})`:error.message;
  return error instanceof Error?error.message:"Canonical document request failed";
}

export function SiteDocumentProvider({websiteId,children}:{websiteId:string;children:ReactNode}){
  const client=useMemo(()=>createSiteDocumentClient(apiUrl,websiteId),[websiteId]);
  const [model,setModel]=useState<SiteDocumentEnvelope|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  const refresh=useCallback(async()=>{
    const next=await client.get();setModel(next);setError("");return next;
  },[client]);

  useEffect(()=>{
    let active=true;setLoading(true);
    client.get().then(value=>{if(active){setModel(value);setError("");}}).catch(failure=>{if(active)setError(message(failure));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[client]);

  const preview=useCallback(async(commands:SiteCommand[])=>{
    const result=await client.preview(commands);return result.proposed;
  },[client]);

  const apply=useCallback(async(commands:SiteCommand[])=>{
    let current=model??await client.get();
    if(!current.persisted) current=await client.initialize();
    try{
      await client.apply(commands,current.revision);
      await refresh();
    }catch(failure){
      if(failure instanceof SiteDocumentApiError&&failure.status===412) await refresh();
      throw failure;
    }
  },[client,model,refresh]);

  const value=useMemo<SiteDocumentContextValue>(()=>({model,loading,error,refresh,preview,apply}),[model,loading,error,refresh,preview,apply]);
  return <SiteDocumentContext.Provider value={value}>{children}</SiteDocumentContext.Provider>;
}

export function useSiteDocument(){
  const value=useContext(SiteDocumentContext);
  if(!value) throw new Error("useSiteDocument must be used inside SiteDocumentProvider");
  return value;
}
