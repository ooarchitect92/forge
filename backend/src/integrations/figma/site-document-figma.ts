import { createHash } from "node:crypto";
import type { SiteCommand } from "../../domain/site-commands.js";
import type { JsonValue, SiteDocument, SiteElement } from "../../domain/site-document.js";

type FigmaPaint = { type?: string; visible?: boolean; color?: {r?:number;g?:number;b?:number;a?:number}; opacity?:number; imageRef?:string };
type FigmaNode = {
  id?: string; name?: string; type?: string; characters?: string; children?: FigmaNode[];
  visible?: boolean; opacity?: number; fills?: FigmaPaint[]; strokes?: FigmaPaint[]; strokeWeight?:number; cornerRadius?: number;
  absoluteBoundingBox?: { x?: number; y?: number; width?: number; height?: number };
  style?: Record<string, unknown>; styles?: Record<string,string>; componentId?:string;
  componentPropertyDefinitions?:Record<string,{type?:string;defaultValue?:unknown;variantOptions?:string[]}>;
  componentProperties?:Record<string,{type?:string;value?:unknown}>;
  layoutMode?: string; itemSpacing?: number; paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
};
type FigmaStyleMeta={key?:string;name?:string;styleType?:string;node_id?:string;nodeId?:string};
export type FigmaFileSnapshot = { name?: string; version?: string; document?: FigmaNode; components?: Record<string, unknown>; componentSets?:Record<string,unknown>; styles?: Record<string, FigmaStyleMeta> };
export type FigmaVariablesSnapshot = { meta?: { variables?: Record<string, { id?: string; name?: string; resolvedType?: string; valuesByMode?: Record<string, unknown> }> } };

function stable(fileKey: string, externalId: string, prefix: string): string {
  return `${prefix}-${createHash("sha256").update(`${fileKey}:${externalId}`).digest("hex").slice(0, 24)}`;
}
function slug(name: string, index: number): string {
  const value=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  return index===0?"/":`/${value||`figma-page-${index+1}`}`;
}
function rgba(value:unknown):string|undefined {
  if(!value||typeof value!=="object") return undefined;
  const source=value as {color?:unknown;r?:unknown;g?:unknown;b?:unknown;a?:unknown};
  const c=(source.color&&typeof source.color==="object"?source.color:source) as {r?:unknown;g?:unknown;b?:unknown;a?:unknown};
  const r=c.r,g=c.g,b=c.b;
  if(typeof r!=="number"||typeof g!=="number"||typeof b!=="number") return undefined;
  const channel=(x:number)=>Math.max(0,Math.min(255,Math.round(x*255)));
  const a=typeof c.a==="number"?Math.max(0,Math.min(1,c.a)):1;
  return a<1?`rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`:`#${[r,g,b].map(x=>channel(x).toString(16).padStart(2,"0")).join("")}`;
}
function firstSolid(fills:FigmaPaint[]|undefined):string|undefined {
  const fill=Array.isArray(fills)?fills.find(value=>value?.type==="SOLID"&&value?.visible!==false):undefined;
  return rgba(fill);
}
function elementType(type:string|undefined):string {
  if(type==="TEXT") return "text";
  if(["RECTANGLE","ELLIPSE","LINE","POLYGON","STAR","VECTOR"].includes(type||"")) return "shape";
  if(type==="INSTANCE") return "component-instance";
  return "container";
}
function styleClass(fileKey:string,externalId:string):string {
  return stable(fileKey,externalId,"figma-style").replace(/[^a-zA-Z0-9_-]/g,"-");
}
function nodeStyles(node:FigmaNode):Record<string,JsonValue>{
  const box=node.absoluteBoundingBox||{};
  const textStyle=node.style||{};
  const styles:Record<string,JsonValue>={};
  if(typeof box.width==="number") styles.width=`${Math.max(0,box.width)}px`;
  if(typeof box.height==="number") styles.height=`${Math.max(0,box.height)}px`;
  if(typeof node.opacity==="number") styles.opacity=node.opacity;
  if(typeof node.cornerRadius==="number") styles.borderRadius=`${node.cornerRadius}px`;
  const fill=firstSolid(node.fills);
  if(fill) styles[node.type==="TEXT"?"color":"backgroundColor"]=fill;
  const stroke=firstSolid(node.strokes);
  if(stroke){styles.borderColor=stroke;styles.borderStyle="solid";if(typeof node.strokeWeight==="number")styles.borderWidth=`${node.strokeWeight}px`;}
  const get=(key:string)=>textStyle[key];
  if(typeof get("fontFamily")==="string") styles.fontFamily=get("fontFamily") as string;
  if(typeof get("fontSize")==="number") styles.fontSize=`${get("fontSize")}px`;
  if(typeof get("fontWeight")==="number") styles.fontWeight=get("fontWeight") as number;
  if(typeof get("lineHeightPx")==="number") styles.lineHeight=`${get("lineHeightPx")}px`;
  if(typeof get("letterSpacing")==="number") styles.letterSpacing=`${get("letterSpacing")}px`;
  if(node.layoutMode==="HORIZONTAL"||node.layoutMode==="VERTICAL"){
    styles.display="flex";styles.flexDirection=node.layoutMode==="HORIZONTAL"?"row":"column";
    if(typeof node.itemSpacing==="number")styles.gap=`${node.itemSpacing}px`;
  }
  for(const [key,value] of [["paddingTop",node.paddingTop],["paddingRight",node.paddingRight],["paddingBottom",node.paddingBottom],["paddingLeft",node.paddingLeft]] as const){
    if(typeof value==="number")styles[key]=`${value}px`;
  }
  return styles;
}
function walkNodes(node:FigmaNode|undefined,visit:(node:FigmaNode,parent:FigmaNode|undefined)=>void,parent?:FigmaNode):void{
  if(!node)return;visit(node,parent);for(const child of node.children||[])walkNodes(child,visit,node);
}
function variantProps(name:string,node:FigmaNode):Record<string,JsonValue>{
  const props:Record<string,JsonValue>={figmaNodeId:String(node.id||"")};
  for(const piece of name.split(",")){
    const index=piece.indexOf("=");if(index<=0)continue;
    const key=piece.slice(0,index).trim(),value=piece.slice(index+1).trim();
    if(key&&value)props[key.slice(0,100)]=value.slice(0,500);
  }
  return props;
}
function toElement(
  fileKey:string,node:FigmaNode,mappings:Array<{kind:string;externalId:string;localId:string}>,
  componentOwners:Map<string,string>,
):SiteElement {
  const external=String(node.id||createHash("sha1").update(JSON.stringify(node)).digest("hex").slice(0,12));
  const local=stable(fileKey,external,"figma");
  mappings.push({kind:"NODE",externalId:external,localId:local});
  const styleIds=Object.values(node.styles||{}).filter(value=>typeof value==="string");
  const props:Record<string,JsonValue>={
    figmaNodeId:external,figmaNodeType:String(node.type||"UNKNOWN"),visible:node.visible!==false,
  };
  if(styleIds.length){
    props.figmaStyleIds=styleIds;
    props.className=styleIds.map(value=>styleClass(fileKey,value)).join(" ");
  }
  const imageFill=(node.fills||[]).find(fill=>fill.type==="IMAGE"&&typeof fill.imageRef==="string");
  if(imageFill?.imageRef)props.figmaImageRef=imageFill.imageRef;
  const owner=node.componentId?componentOwners.get(node.componentId):undefined;
  return {
    id:local,type:elementType(node.type),name:typeof node.name==="string"?node.name.slice(0,255):undefined,
    props,styles:nodeStyles(node),
    ...(owner?{componentId:owner}:{}),
    ...(node.type==="TEXT"&&typeof node.characters==="string"?{content:node.characters}:{}),
    children:(node.children||[]).slice(0,2000).map(child=>toElement(fileKey,child,mappings,componentOwners)),
  };
}
function pages(snapshot:FigmaFileSnapshot):FigmaNode[] {
  const canvases=(snapshot.document?.children||[]).filter(node=>node.type==="CANVAS");
  const candidates=canvases.flatMap(canvas=>(canvas.children||[]).filter(node=>["FRAME","SECTION"].includes(node.type||"")));
  return candidates.length?candidates.slice(0,50):(snapshot.document?.children||[]).slice(0,50);
}
function variableValue(variable:{valuesByMode?:Record<string,unknown>}|undefined):JsonValue|undefined {
  const values=variable?.valuesByMode&&typeof variable.valuesByMode==="object"?Object.values(variable.valuesByMode):[];
  const value=values[0];
  if(value===undefined) return undefined;
  const color=rgba(value);
  return (color??value) as JsonValue;
}

export function figmaToSiteCommands(input:{fileKey:string;file:FigmaFileSnapshot;variables?:FigmaVariablesSnapshot|null;current:SiteDocument}) {
  const commands:SiteCommand[]=[];
  const mappings:Array<{kind:string;externalId:string;localId:string}>=[];
  const componentOwners=new Map<string,string>();
  const sets:FigmaNode[]=[],standalone:FigmaNode[]=[];
  const nodesById=new Map<string,FigmaNode>();
  const styleUsage=new Map<string,FigmaNode>();
  walkNodes(input.file.document,(node,parent)=>{
    if(node.id)nodesById.set(node.id,node);
    for(const styleId of Object.values(node.styles||{}))if(typeof styleId==="string"&&!styleUsage.has(styleId))styleUsage.set(styleId,node);
    if(node.type==="COMPONENT_SET")sets.push(node);
    else if(node.type==="COMPONENT"&&parent?.type!=="COMPONENT_SET")standalone.push(node);
  });
  for(const set of sets){
    const external=String(set.id||"");if(!external)continue;
    const componentId=stable(input.fileKey,external,"figma-component");
    componentOwners.set(external,componentId);
    for(const child of set.children||[])if(child.type==="COMPONENT"&&child.id)componentOwners.set(child.id,componentId);
  }
  for(const node of standalone){
    if(node.id)componentOwners.set(node.id,stable(input.fileKey,node.id,"figma-component"));
  }
  const addComponent=(external:string,name:string,rootNode:FigmaNode,variants:Array<{id:string;name:string;props:Record<string,JsonValue>;styles:Record<string,JsonValue>}>)=>{
    const componentId=componentOwners.get(external)||stable(input.fileKey,external,"figma-component");
    mappings.push({kind:"COMPONENT",externalId:external,localId:componentId});
    if(input.current.components.some(component=>component.id===componentId))commands.push({type:"component.delete",componentId});
    commands.push({type:"component.create",component:{
      id:componentId,name:name.slice(0,255)||"Figma component",
      root:toElement(input.fileKey,rootNode,mappings,componentOwners),variants,slots:[],
    }});
  };
  for(const set of sets){
    if(!set.id)continue;
    const children=(set.children||[]).filter(node=>node.type==="COMPONENT"&&node.id);
    const root=children[0]||set;
    const variants=children.slice(0,500).map(child=>({
      id:stable(input.fileKey,String(child.id),"figma-variant"),
      name:String(child.name||"Variant").slice(0,255),
      props:variantProps(String(child.name||""),child),
      styles:nodeStyles(child),
    }));
    addComponent(set.id,String(set.name||"Component set"),root,variants);
    for(const child of children)mappings.push({kind:"COMPONENT_VARIANT",externalId:String(child.id),localId:componentOwners.get(String(child.id))!});
  }
  for(const component of standalone){
    if(component.id)addComponent(component.id,String(component.name||"Component"),component,[]);
  }

  const importSlugs=new Set<string>();
  const deletedPageIds=new Set<string>();
  pages(input.file).forEach((frame,index)=>{
    const external=String(frame.id||`page-${index}`);
    const pageId=stable(input.fileKey,external,"figma-page");
    const name=String(frame.name||`Figma Page ${index+1}`).slice(0,255);
    const preferred=slug(name,index);
    let pageSlug=preferred;
    let suffix=2;
    while(importSlugs.has(pageSlug)){
      pageSlug=preferred==="/"?`/figma-page-${index+1}`:`${preferred}-${suffix++}`;
    }
    importSlugs.add(pageSlug);
    mappings.push({kind:"PAGE",externalId:external,localId:pageId});

    // A full Figma page import is a reviewed replacement proposal. Remove the
    // previous canonical page occupying either the stable external identity or
    // the route before creating the replacement. This handles the initial blank
    // Forge home page ("/") without producing an impossible duplicate-slug batch.
    for(const existing of input.current.pages){
      if((existing.id===pageId||existing.slug===pageSlug)&&!deletedPageIds.has(existing.id)){
        commands.push({type:"page.delete",pageId:existing.id});
        deletedPageIds.add(existing.id);
      }
    }
    commands.push({type:"page.create",page:{
      id:pageId,name,slug:pageSlug,
      elements:(frame.children||[]).map(child=>toElement(input.fileKey,child,mappings,componentOwners)),
      settings:{figmaFileKey:input.fileKey,figmaNodeId:external,figmaVersion:String(input.file.version||"")},
    }});
  });

  for(const [externalId,meta] of Object.entries(input.file.styles||{})){
    const node=(meta.node_id&&nodesById.get(meta.node_id))||(meta.nodeId&&nodesById.get(meta.nodeId))||styleUsage.get(externalId);
    if(!node)continue;
    const properties=nodeStyles(node);if(!Object.keys(properties).length)continue;
    const ruleId=stable(input.fileKey,externalId,"figma-style");
    mappings.push({kind:"STYLE",externalId,localId:ruleId});
    commands.push({type:"style.updateRule",rule:{id:ruleId,selector:`.${styleClass(input.fileKey,externalId)}`,properties}});
  }

  const vars=input.variables?.meta?.variables||{};
  for(const [externalId,variable] of Object.entries(vars)){
    const value=variableValue(variable);if(value===undefined)continue;
    const tokenId=stable(input.fileKey,externalId,"figma-token");
    mappings.push({kind:"TOKEN",externalId,localId:tokenId});
    const resolved=String(variable.resolvedType||"").toUpperCase();
    const category=resolved==="COLOR"?"color":resolved==="FLOAT"?"size":"other";
    commands.push({type:"token.set",token:{id:tokenId,name:String(variable.name||externalId).slice(0,255),category,value,source:"figma"}});
  }
  return {commands,mappings,version:String(input.file.version||""),fileName:String(input.file.name||"Figma design")};
}

