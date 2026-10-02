figma.showUI(__html__, { width: 460, height: 640 });

const FONT = { family: "Inter", style: "Regular" };

function num(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = /^(-?\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
    if (m) return Number(m[1]);
  }
  return fallback;
}
function rgba(value) {
  if (typeof value !== "string") return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return {
    r: parseInt(hex[1].slice(0,2),16)/255,
    g: parseInt(hex[1].slice(2,4),16)/255,
    b: parseInt(hex[1].slice(4,6),16)/255,
  };
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(value.trim());
  if (rgb) return { r:Number(rgb[1])/255, g:Number(rgb[2])/255, b:Number(rgb[3])/255 };
  return null;
}
function applyVisual(node, spec) {
  const styles = spec.styles || {};
  if ("resize" in node) node.resize(Math.max(1,num(styles.width,node.width||100)),Math.max(1,num(styles.height,node.height||40)));
  if ("opacity" in node && typeof styles.opacity === "number") node.opacity=Math.max(0,Math.min(1,styles.opacity));
  const background=rgba(styles.backgroundColor || styles.background);
  if (background && "fills" in node) node.fills=[{type:"SOLID",color:background}];
  const radius=num(styles.borderRadius,0);
  if (radius && "cornerRadius" in node) node.cornerRadius=radius;
  if (node.type==="FRAME") {
    if (styles.display==="flex") {
      node.layoutMode=styles.flexDirection==="row"?"HORIZONTAL":"VERTICAL";
      node.itemSpacing=num(styles.gap,0);
      node.primaryAxisSizingMode="AUTO";
      node.counterAxisSizingMode="AUTO";
    }
    node.paddingTop=num(styles.paddingTop,0);
    node.paddingRight=num(styles.paddingRight,0);
    node.paddingBottom=num(styles.paddingBottom,0);
    node.paddingLeft=num(styles.paddingLeft,0);
  }
}
function findOwned(id) {
  return figma.currentPage.findOne(node => typeof node.getPluginData==="function" && node.getPluginData("forgeId")===id);
}
async function makeText(spec) {
  await figma.loadFontAsync(FONT);
  let node=findOwned(spec.id);
  if (!node || node.type!=="TEXT") node=figma.createText();
  node.fontName=FONT;
  node.characters=typeof spec.content==="string"?spec.content:String(spec.content??spec.name??"");
  node.name=spec.name || spec.type || "Text";
  const color=rgba((spec.styles||{}).color);
  if(color) node.fills=[{type:"SOLID",color}];
  const size=num((spec.styles||{}).fontSize,16);
  if(size>0) node.fontSize=Math.max(1,Math.min(512,size));
  node.setPluginData("forgeId",spec.id);
  if(spec.componentId) node.setPluginData("forgeComponentId",spec.componentId);
  return node;
}
async function reconcile(spec,parent,replace) {
  let node;
  if (["text","heading","button"].includes(spec.type)) {
    node=await makeText(spec);
  } else if (spec.type==="shape") {
    node=findOwned(spec.id);
    if(!node || node.type!=="RECTANGLE") node=figma.createRectangle();
    node.name=spec.name || "Shape";
    node.setPluginData("forgeId",spec.id);
  } else {
    node=findOwned(spec.id);
    if(!node || node.type!=="FRAME") node=figma.createFrame();
    node.name=spec.name || spec.type || "Container";
    node.setPluginData("forgeId",spec.id);
    if(spec.componentId) node.setPluginData("forgeComponentId",spec.componentId);
    if(replace) {
      for(const child of [...node.children]) if(child.getPluginData("forgeManaged")==="1") child.remove();
    }
    for(const childSpec of spec.children||[]) {
      const child=await reconcile(childSpec,node,replace);
      child.setPluginData("forgeManaged","1");
    }
  }
  applyVisual(node,spec);
  if(node.parent!==parent) parent.appendChild(node);
  return node;
}
async function importPage(page,revision,replace) {
  let root=figma.currentPage.findOne(node=>node.type==="FRAME"&&node.getPluginData("forgePageId")===page.id);
  if(!root || root.type!=="FRAME") root=figma.createFrame();
  root.name=`Forge · ${page.name} · r${revision}`;
  root.setPluginData("forgePageId",page.id);
  root.setPluginData("forgeRevision",String(revision));
  root.resize(1440,900);
  root.layoutMode="VERTICAL";
  root.primaryAxisSizingMode="AUTO";
  root.counterAxisSizingMode="FIXED";
  root.itemSpacing=24;
  if(replace) for(const child of [...root.children]) child.remove();
  for(const element of page.elements||[]) {
    const child=await reconcile(element,root,replace);
    child.setPluginData("forgeManaged","1");
  }
  return root;
}
async function importComponents(payload,replace) {
  for(const component of payload.components||[]) {
    let existing=figma.currentPage.findOne(node=>node.type==="COMPONENT"&&node.getPluginData("forgeComponentDefinitionId")===component.id);
    if(!existing || existing.type!=="COMPONENT") existing=figma.createComponent();
    existing.name=`Forge Component / ${component.name}`;
    existing.setPluginData("forgeComponentDefinitionId",component.id);
    existing.setPluginData("forgeRevision",String(payload.revision));
    if(replace) for(const child of [...existing.children]) child.remove();
    const root=await reconcile(component.root,existing,replace);
    root.setPluginData("forgeManaged","1");
  }
}
function validPayload(value) {
  return value && value.kind==="forge-site-document-figma-plugin" && value.exportVersion===1 &&
    Number.isInteger(value.revision) && Array.isArray(value.pages) && Array.isArray(value.components);
}

figma.ui.onmessage = async msg => {
  if(msg.type==="CANCEL"){figma.closePlugin();return;}
  if(msg.type!=="IMPORT") return;
  try {
    const payload=msg.payload;
    if(!validPayload(payload)) throw new Error("Unsupported Forge export payload.");
    const replace=msg.mode==="replace";
    await importComponents(payload,replace);
    const roots=[];
    for(const page of payload.pages) roots.push(await importPage(page,payload.revision,replace));
    if(roots.length) {
      figma.currentPage.selection=roots;
      figma.viewport.scrollAndZoomIntoView(roots);
    }
    figma.ui.postMessage({type:"DONE",pages:roots.length,revision:payload.revision});
  } catch(error) {
    figma.ui.postMessage({type:"ERROR",message:error instanceof Error?error.message:"Import failed"});
  }
};
