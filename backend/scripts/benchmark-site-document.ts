import { performance } from "node:perf_hooks";
import { applySiteCommands } from "../src/domain/site-commands.js";
import { validateSiteDocument, type SiteDocument } from "../src/domain/site-document.js";

const pages=Math.max(1,Math.min(200,Number(process.env.FORGE_BENCH_PAGES||50)));
const perPage=Math.max(1,Math.min(500,Number(process.env.FORGE_BENCH_ELEMENTS_PER_PAGE||100)));
const iterations=Math.max(1,Math.min(50,Number(process.env.FORGE_BENCH_ITERATIONS||10)));
const maxMs=Math.max(100,Number(process.env.FORGE_BENCH_MAX_MS||5000));

function makeDocument():SiteDocument{
  return validateSiteDocument({
    id:"benchmark-site",schemaVersion:1,
    site:{title:"Benchmark",defaultLocale:"en",metadata:{}},
    pages:Array.from({length:pages},(_,p)=>({
      id:`page-${p}`,name:`Page ${p}`,slug:p===0?"/":`/page-${p}`,settings:{},
      elements:Array.from({length:perPage},(_,e)=>({
        id:`p${p}-e${e}`,type:e%7===0?"heading":"text",props:{role:e%7===0?"heading":"content"},
        styles:{fontSize:`${16+(e%8)}px`,marginBottom:`${e%12}px`},
        content:`Synthetic benchmark content ${p}:${e}`,children:[],
      })),
    })),
    components:[],styles:[],tokens:[],assets:[],
    cms:{collections:[],items:[],bindings:[]},
    interactions:[],forms:[],locales:[],experiments:[],integrations:[],extensions:{},
  });
}

const source=makeDocument();
const commandCount=Math.min(500,pages*perPage);
const commands=Array.from({length:commandCount},(_,index)=>{
  const p=Math.floor(index/perPage)%pages;
  const e=index%perPage;
  return {type:"element.updateProperties" as const,pageId:`page-${p}`,elementId:`p${p}-e${e}`,props:{benchmarkIteration:index}};
});

const samples:number[]=[];
for(let i=0;i<iterations;i++){
  const started=performance.now();
  const next=applySiteCommands(source,commands);
  if(next.pages.length!==pages) throw new Error("Benchmark validation failed");
  samples.push(performance.now()-started);
}
samples.sort((a,b)=>a-b);
const p95=samples[Math.min(samples.length-1,Math.floor(samples.length*0.95))]??0;
const average=samples.reduce((sum,value)=>sum+value,0)/samples.length;
const result={pages,elements:pages*perPage,commands:commandCount,iterations,averageMs:Number(average.toFixed(2)),p95Ms:Number(p95.toFixed(2)),maxAllowedMs:maxMs};
console.log(JSON.stringify(result));
if(p95>maxMs){
  console.error(JSON.stringify({event:"site_document.benchmark_budget_exceeded",...result}));
  process.exitCode=2;
}
