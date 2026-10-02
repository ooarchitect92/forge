import test from "node:test";
import assert from "node:assert/strict";
import { buildFigmaTokenPushPlan } from "../integrations/figma/site-document-figma-push.js";
import { validateSiteDocument } from "../domain/site-document.js";

function document() {
  return validateSiteDocument({
    id:"site-1",schemaVersion:1,
    site:{title:"Forge",defaultLocale:"en",metadata:{}},
    pages:[],components:[],styles:[],
    tokens:[
      {id:"primary",name:"Primary",category:"color",value:"#336699",source:"forge"},
      {id:"space-md",name:"Space / MD",category:"spacing",value:"16px",source:"forge"},
      {id:"complex",name:"Complex",category:"typography",value:{family:"Inter"},source:"forge"},
    ],
    assets:[],cms:{collections:[],items:[],bindings:[]},
    interactions:[],forms:[],locales:[],experiments:[],integrations:[],extensions:{},
  });
}

test("Figma token push creates compatible Forge tokens and skips complex values",()=>{
  const plan=buildFigmaTokenPushPlan({fileKey:"abcdef123",document:document(),variables:{meta:{variables:{},variableCollections:{}}},mappings:[]});
  assert.equal(plan.createCount,2);
  assert.equal(plan.updateCount,0);
  assert.equal(plan.skipCount,1);
  assert.equal((plan.body.variableCollections as unknown[]).length,1);
  assert.equal((plan.body.variables as unknown[]).length,2);
  assert.equal(plan.temporaryMappings.length,2);
});

test("Figma token push updates an existing mapped variable in its default mode",()=>{
  const plan=buildFigmaTokenPushPlan({
    fileKey:"abcdef123",document:document(),
    variables:{meta:{
      variables:{v1:{id:"v1",name:"Old Primary",variableCollectionId:"c1",resolvedType:"COLOR"}},
      variableCollections:{c1:{id:"c1",name:"Brand",defaultModeId:"m1"}},
    }},
    mappings:[{kind:"TOKEN",externalId:"v1",localId:"primary"}],
  });
  assert.equal(plan.updateCount,1);
  assert.equal(plan.createCount,1);
  const updates=(plan.body.variables as Array<any>).filter(value=>value.action==="UPDATE");
  assert.deepEqual(updates,[{action:"UPDATE",id:"v1",name:"Primary"}]);
  const value=(plan.body.variableModeValues as Array<any>).find(value=>value.variableId==="v1");
  assert.equal(value.modeId,"m1");
  assert.deepEqual(value.value,{r:0.2,g:0.4,b:0.6,a:1});
});

test("Figma token push does not mutate a mapped variable across resolved types",()=>{
  const plan=buildFigmaTokenPushPlan({
    fileKey:"abcdef123",document:document(),
    variables:{meta:{
      variables:{v1:{id:"v1",variableCollectionId:"c1",resolvedType:"FLOAT"}},
      variableCollections:{c1:{id:"c1",defaultModeId:"m1"}},
    }},
    mappings:[{kind:"TOKEN",externalId:"v1",localId:"primary"}],
  });
  const primary=plan.actions.find(action=>action.tokenId==="primary");
  assert.equal(primary?.action,"SKIP");
  assert.match(primary?.reason??"",/resolved type/i);
});
