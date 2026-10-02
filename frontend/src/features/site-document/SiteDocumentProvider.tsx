import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createSiteDocumentClient, SiteDocumentApiError } from "./client";
import type { SiteCommand, SiteDocumentEnvelope } from "./types";
import { SiteDocumentContext, type SiteDocumentContextValue } from "./context";

const apiUrl=import.meta.env.VITE_API_URL||"http://localhost:5000";

function message(error:unknown){
  if(error instanceof SiteDocumentApiError) return error.code?`${error.message} (${error.code})`:error.message;
  return error instanceof Error?error.message:"Canonical document request failed";
}

export function SiteDocumentProvider({websiteId,children}:{websiteId:string;children:ReactNode}){
  const client=useMemo(()=>createSiteDocumentClient(apiUrl,websiteId),[websiteId]);
  const [model,setModel]=useState<SiteDocumentEnvelope|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const modelRef=useRef<SiteDocumentEnvelope|null>(null);

  const refresh=useCallback(async()=>{
    const next=await client.get();modelRef.current=next;setModel(next);setError("");return next;
  },[client]);

  useEffect(()=>{
    let active=true;
    client.get().then(value=>{if(active){modelRef.current=value;setModel(value);setError("");}}).catch(failure=>{if(active)setError(message(failure));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[client]);



  useEffect(()=>{
    let active=true;
    let socket:WebSocket|null=null;
    let reconnect:number|undefined;
    let heartbeat:number|undefined;
    const connect=()=>{
      if(!active)return;
      try{
        const parsed=new URL(apiUrl);
        const url=`${parsed.protocol==="https:"?"wss:":"ws:"}//${parsed.host}/ws/collaboration`;
        socket=new WebSocket(url);
        socket.onopen=()=>{
          if(!active||!socket)return;
          socket.send(JSON.stringify({type:"JOIN",websiteId}));
          heartbeat=window.setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"PING"}));},25000);
        };
        socket.onmessage=event=>{
          if(!active)return;
          try{
            const payload=JSON.parse(String(event.data)) as {type?:unknown;websiteId?:unknown;revision?:unknown};
            if(payload.type==="DOCUMENT_REVISION"&&payload.websiteId===websiteId&&typeof payload.revision==="number"){
              if(payload.revision>(modelRef.current?.revision??0)) void refresh().catch(()=>undefined);
            }
          }catch{/* Ignore non-document collaboration frames here; the canvas presence hook owns them. */}
        };
        socket.onclose=()=>{
          if(heartbeat!==undefined){window.clearInterval(heartbeat);heartbeat=undefined;}
          if(active) reconnect=window.setTimeout(connect,3000);
        };
        socket.onerror=()=>socket?.close();
      }catch{
        if(active) reconnect=window.setTimeout(connect,5000);
      }
    };
    connect();
    return()=>{
      active=false;
      if(reconnect!==undefined)window.clearTimeout(reconnect);
      if(heartbeat!==undefined)window.clearInterval(heartbeat);
      socket?.close();
    };
  },[websiteId,refresh]);

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
