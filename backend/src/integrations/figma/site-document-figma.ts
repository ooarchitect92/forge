import { createHash } from "node:crypto";
import type { SiteCommand } from "../../domain/site-commands.js";
import type { JsonValue, SiteDocument, SiteElement } from "../../domain/site-document.js";

type FigmaNode = {
  id?: string; name?: string; type?: string; characters?: string; children?: FigmaNode[];
  visible?: boolean; opacity?: number; fills?: any[]; strokes?: any[]; cornerRadius?: number;
  absoluteBoundingBox?: { x?: number; y?: number; width?: number; height?: number };
  style?: Record<string, any>; layoutMode?: string; itemSpacing?: number; paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
};
export type FigmaFileSnapshot = { name?: string; version?: string; document?: FigmaNode; components?: Record<string, any>; styles?: Record<string, any> };
export type FigmaVariablesSnapshot = { meta?: { variables?: Record<string, { id?: string; name?: string; resolvedType?: string; valuesByMode?: Record<string, any> }> } };

function stable(fileKey: string, externalId: string, prefix: string): string {
  return `${prefix}-${createHash("sha256").update(`${fileKey}:${externalId}`).digest("hex").slice(0, 24)}`;
}
function slug(name: string, index: number): string {
  const value=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  return index===0?"/":`/${value||`figma-page-${index+1}`}`;
}
function rgba(value:any):string|undefined {
  if(!value||typeof value!=="object") return undefined;
  const c=value.color||value;
  if([c.r,c.g,c.b].some((x:any)=>typeof x!=="number")) return undefined;
  const channel=(x:number)=>Math.max(0,Math.min(255,Math.round(x*255)));
  const a=typeof c.a==="number"?Math.max(0,Math.min(1,c.a)):1;
  return a<1?`rgba(${channel(c.r)}, ${channel(c.g)}, ${channel(c.b)}, ${a})`:`#${[c.r,c.g,c.b].map((x:number)=>channel(x).toString(16).padStart(2,"0")).join("")}`;
}
function firstSolid(fills:any[]|undefined):string|undefined {
  const fill=Array.isArray(fills)?fills.find(value=>value?.type==="SOLID"&&value?.visible!==false):undefined;
  return rgba(fill);
}
function elementType(type:string|undefined):string {
  if(type==="TEXT") return "text";
  if(["RECTANGLE","ELLIPSE","LINE","POLYGON","STAR","VECTOR"].includes(type||"")) return "shape";
  if(type==="INSTANCE") return "component-instance";
  return "container";
}
function toElement(fileKey:string,node:FigmaNode,mappings:Array<{kind:string;externalId:string;localId:string}>):SiteElement {
  const external=String(node.id||createHash("sha1").update(JSON.stringify(node)).digest("hex").slice(0,12));
  const local=stable(fileKey,external,"figma");
  mappings.push({kind:"NODE",externalId:external,localId:local});
  const box=node.absoluteBoundingBox||{};
  const textStyle=node.style||{};
  const styles:Record<string,JsonValue>={};
  if(typeof box.width==="number") styles.width=`${Math.max(0,box.width)}px`;
  if(typeof box.height==="number") styles.height=`${Math.max(0,box.height)}px`;
  if(typeof node.opacity==="number") styles.opacity=node.opacity;
  if(typeof node.cornerRadius==="number") styles.borderRadius=`${node.cornerRadius}px`;
  const fill=firstSolid(node.fills);
  if(fill) styles[node.type==="TEXT"?"color":"backgroundColor"]=fill;
  if(typeof textStyle.fontFamily==="string") styles.fontFamily=textStyle.fontFamily;
  if(typeof textStyle.fontSize==="number") styles.fontSize=`${textStyle.fontSize}px`;
  if(typeof textStyle.fontWeight==="number") styles.fontWeight=textStyle.fontWeight;
  if(typeof textStyle.lineHeightPx==="number") styles.lineHeight=`${textStyle.lineHeightPx}px`;
  if(typeof textStyle.letterSpacing==="number") styles.letterSpacing=`${textStyle.letterSpacing}px`;
  if(node.layoutMode==="HORIZONTAL"||node.layoutMode==="VERTICAL"){
    styles.display="flex"; styles.flexDirection=node.layoutMode==="HORIZONTAL"?"row":"column";
    if(typeof node.itemSpacing==="number") styles.gap=`${node.itemSpacing}px`;
  }
  for(const [key,value] of [["paddingTop",node.paddingTop],["paddingRight",node.paddingRight],["paddingBottom",node.paddingBottom],["paddingLeft",node.paddingLeft]] as const) if(typeof value==="number") styles[key]=`${value}px`;
  return {
    id:local,type:elementType(node.type),name:typeof node.name==="string"?node.name.slice(0,255):undefined,
    props:{figmaNodeId:external,figmaNodeType:String(node.type||"UNKNOWN"),visible:node.visible!==false},
    styles,
    ...(node.type==="TEXT"&&typeof node.characters==="string"?{content:node.characters}:{}),
    children:(node.children||[]).slice(0,2000).map(child=>toElement(fileKey,child,mappings)),
  };
}
function pages(snapshot:FigmaFileSnapshot):FigmaNode[] {
  const canvases=(snapshot.document?.children||[]).filter(node=>node.type==="CANVAS");
  const candidates=canvases.flatMap(canvas=>(canvas.children||[]).filter(node=>["FRAME","SECTION","COMPONENT"].includes(node.type||"")));
  return candidates.length?candidates.slice(0,50):(snapshot.document?.children||[]).slice(0,50);
}
function variableValue(variable:any):JsonValue|undefined {
  const values=variable?.valuesByMode&&typeof variable.valuesByMode==="object"?Object.values(variable.valuesByMode):[];
  const value=values[0];
  if(value===undefined) return undefined;
  const color=rgba(value);
  return (color??value) as JsonValue;
}

export function figmaToSiteCommands(input:{fileKey:string;file:FigmaFileSnapshot;variables?:FigmaVariablesSnapshot|null;current:SiteDocument}) {
  const commands:SiteCommand[]=[];
  const mappings:Array<{kind:string;externalId:string;localId:string}>=[];
  pages(input.file).forEach((frame,index)=>{
    const external=String(frame.id||`page-${index}`);
    const pageId=stable(input.fileKey,external,"figma-page");
    mappings.push({kind:"PAGE",externalId:external,localId:pageId});
    if(input.current.pages.some(page=>page.id===pageId)) commands.push({type:"page.delete",pageId});
    commands.push({type:"page.create",page:{
      id:pageId,name:String(frame.name||`Figma Page ${index+1}`).slice(0,255),slug:slug(String(frame.name||""),index),
      elements:(frame.children||[]).map(child=>toElement(input.fileKey,child,mappings)),
      settings:{figmaFileKey:input.fileKey,figmaNodeId:external,figmaVersion:String(input.file.version||"")},
    }});
  });
  const vars=input.variables?.meta?.variables||{};
  for(const [externalId,variable] of Object.entries(vars)){
    const value=variableValue(variable); if(value===undefined) continue;
    const tokenId=stable(input.fileKey,externalId,"figma-token");
    mappings.push({kind:"TOKEN",externalId,localId:tokenId});
    const resolved=String(variable.resolvedType||"").toUpperCase();
    const category=resolved==="COLOR"?"color":resolved==="FLOAT"?"size":"other";
    commands.push({type:"token.set",token:{id:tokenId,name:String(variable.name||externalId).slice(0,255),category,value,source:"figma"}});
  }
  return {commands,mappings,version:String(input.file.version||""),fileName:String(input.file.name||"Figma design")};
}
