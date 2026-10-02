import { createContext, useContext } from "react";
import type { SiteCommand, SiteDocumentEnvelope } from "./types";

export interface SiteDocumentContextValue {
  model:SiteDocumentEnvelope|null;
  loading:boolean;
  error:string;
  refresh:()=>Promise<SiteDocumentEnvelope>;
  preview:(commands:SiteCommand[])=>Promise<SiteDocumentEnvelope["document"]>;
  apply:(commands:SiteCommand[])=>Promise<void>;
}

export const SiteDocumentContext=createContext<SiteDocumentContextValue|null>(null);

export function useSiteDocument(){
  const value=useContext(SiteDocumentContext);
  if(!value) throw new Error("useSiteDocument must be used inside SiteDocumentProvider");
  return value;
}
