import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

// This helper exports immutable objects only. Moving/deleting branch refs is not
// permitted here. Every replacement is bound to both its before and after hash.
const repo = 'ooarchitect92/forge';
const source = '20e7f7b25d7465f4b647b36e39d9e686e35a2c1e';
const base = '9d1f456e206aac2e45ef50bbe6b4d0581d839220';
const payloadHash = '2d5b51346e1ade7e584ea64cb028567e47dfcd71d881d8539077779e263b3e4f';
const parts = [
 '100fc0b8f8e22a953ded857865a7f3852a089c3b',
 '931fc304213b05bddd24faa3e044727b8cae28b5',
 '004ebf912ed244b4df7908f02ec3f586d7090f4a',
 '8d49efed64cde34bd6710ec699f919676bad9026',
 'fc4a0dd08c9b6383192ffe3b63273422706cb8f0',
 { sha:'c253571ea3f5bf53d671e9ad0cd24402164f8215', from:'A3SbcwK6AO', to:'A3SbcwK2AO', corrected:'329733aad80a14bd7a08d91f9644b3312ab7689b' },
 '59b42e4d0645a65841182072a1a98741d5c883ea',
 { sha:'63c4e33cbe016b9235f4d1cecf7d4913a073043d', from:'Frrjps0N3fff', to:'Frrjps0p3fff', corrected:'bec30c213fa230f765f9c8c3c42afbd947b7f3c4' },
 '8f6cfa9b3a7b30a7f12696149d8e40a34ad77bce',
 '5438cbf17cc7858f042d857ff33f2880b7ce9032',
 '027c0d5899f0593f3aecf5b07d826b1f77cd8e86',
 '81cc599692e75ab7e6bbefc70a6853a1d01808a0',
 'a2c9639d5fc371e28af041cdcd152763a59289c9',
 'b80273e05c6b55b9940a3429858985c883f60c23',
 '1b1b75217e40612d68064bad7aa813f44b6f872a',
 '225f2152be347ea7ccf02a8778595fbcdc9df09e',
];
const reviewedCorrections = [
 {path:'.github/workflows/saas-foundations.yml', before:'3ca1b101cf42bc1f1d2332ef5a9cf6d3e5e82919', after:'44ba7195b798b8e32807d53f65c72266711e3d02'},
 {path:'tests/browser/saas-foundations-journey.py', before:'1a25d08a17ed80f7581f8b7fc6bb6a8b1e800e72', after:'8f78fb5a5c2eaab879aee2ec4887998d26ff803f'},
];
const root=process.cwd();
const output=resolve(process.env.RUNNER_TEMP || '/tmp','consolidation-candidate');
mkdirSync(output,{recursive:true});
if(process.env.GITHUB_REPOSITORY !== repo || !process.env.GH_TOKEN) throw Error('Authorized repository context required');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const hash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
async function api(path,body){
 const res=await fetch(`https://api.github.com/repos/${repo}/${path}`,{
  method:body ? 'POST':'GET',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{}),
 });
 if(!res.ok) throw Error(`GitHub object request failed: ${res.status} ${path}`);
 return res.json();
}
async function blob(sha){
 const obj=await api(`git/blobs/${sha}`);
 if(obj.encoding!=='base64'||obj.size>8*1024*1024)throw Error('Invalid blob representation');
 const b=Buffer.from(obj.content.replace(/\s/g,''),'base64');
 if(hash(b)!==sha)throw Error('Blob hash mismatch');
 return b;
}
function safePath(path){
 if(typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))throw Error('Unsafe candidate path');
 const target=resolve(root,path);
 if(!target.startsWith(root+'/'))throw Error('Path escaped repository');
 let current=dirname(target);
 while(current!==root){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Symlink directory rejected');current=dirname(current);}
 if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('Symlink target rejected');
 return target;
}
function currentBlob(path){try{return git('rev-parse',`HEAD:${path}`);}catch{return null;}}
const mode=process.argv[2];
if(mode==='stage'){
 if(git('status','--porcelain'))throw Error('Stage requires a clean checkout');
 git('merge-base','--is-ancestor',base,'HEAD');
 git('cat-file','-e',`${source}^{commit}`);
 const main=(await api('git/ref/heads/main')).object.sha;
 if(main!==git('rev-parse','HEAD'))throw Error('Main advanced; rebuild candidate against current head');
 if((await api('git/ref/heads/qualification/saas-foundations')).object.sha!==source)throw Error('Source branch advanced');
 const buffers=[];
 for(const item of parts){
  let b=await blob(typeof item==='string'?item:item.sha);
  if(typeof item!=='string'){
   const encoded=b.toString('base64');
   if(encoded.split(item.from).length!==2)throw Error('Unexpected transfer correction');
   b=Buffer.from(encoded.replace(item.from,item.to),'base64');
   if(hash(b)!==item.corrected)throw Error('Corrected chunk hash mismatch');
  }
  buffers.push(b);
 }
 const compressed=Buffer.concat(buffers);
 if(compressed.length!==48092||createHash('sha256').update(compressed).digest('hex')!==payloadHash)throw Error('Payload integrity failure');
 const p=JSON.parse(gunzipSync(compressed,{maxOutputLength:20*1024*1024}));
 if(p.schemaVersion!==1||p.repository!==repo||p.base!==base||p.source!==source||p.files.length!==62)throw Error('Unexpected payload');
 const seen=new Set();
 for(const f of p.files){
  safePath(f.path);
  if(seen.has(f.path)||!['100644','100755'].includes(f.mode)||!/^([a-f0-9]{40})$/.test(f.after))throw Error('Invalid file manifest');
  seen.add(f.path);
  if(currentBlob(f.path)!==f.before)throw Error(`Concurrent change: ${f.path}`);
 }
 for(const [path,sha] of Object.entries(p.refs)){
  const f=p.files.find(x=>x.path===path);
  if(!f||f.after!==sha)throw Error('Undeclared reference');
  const target=safePath(path);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,await blob(sha));chmodSync(target,f.mode==='100755'?0o755:0o644);
  git('add','--',path);
 }
 const patch=resolve(output,'reviewed.patch');writeFileSync(patch,p.patch);
 git('apply','--check','--index',patch);git('apply','--index',patch);
 const changed=git('diff','--cached','--name-only','-z').split('\0').filter(Boolean);
 if(changed.length!==p.files.length||changed.some(path=>!seen.has(path)))throw Error('Undeclared staged change');
 for(const f of p.files){if(git('rev-parse',`:${f.path}`)!==f.after)throw Error(`Staged hash mismatch: ${f.path}`);}
 // Corrections discovered in the preserved failed qualifier are themselves
 // hash-bound, then rerun through the same full qualification, never bypassed.
 for(const correction of reviewedCorrections){
  const f=p.files.find(x=>x.path===correction.path);
  if(!f||f.after!==correction.before||git('rev-parse',`:${f.path}`)!==correction.before)throw Error('Correction base mismatch');
  writeFileSync(safePath(f.path),await blob(correction.after));
  chmodSync(safePath(f.path),f.mode==='100755'?0o755:0o644);
  git('add','--',f.path);f.after=correction.after;
 }
 const tree=git('write-tree');
 const env={...process.env,GIT_AUTHOR_NAME:'Forge integration qualification',GIT_AUTHOR_EMAIL:'forge-qualification@users.noreply.github.com',GIT_COMMITTER_NAME:'Forge integration qualification',GIT_COMMITTER_EMAIL:'forge-qualification@users.noreply.github.com'};
 const candidate=execFileSync('git',['commit-tree',tree,'-p',main,'-p',source,'-m','Qualification-only reviewed branch consolidation'],{encoding:'utf8',env}).trim();
 git('checkout','--detach',candidate);
 const metadata={schemaVersion:1,repository:repo,baseHead:main,sourceHead:source,testedTree:tree,testedCommit:candidate,files:p.files,payloadSha256:payloadHash};
 writeFileSync(resolve(output,'candidate.json'),JSON.stringify(metadata,null,2)+'\n');
 console.log(`Staged ${p.files.length} exact replacements in tree ${tree}; remote refs unchanged`);
}else if(mode==='export'){
 const metadata=JSON.parse(readFileSync(resolve(output,'candidate.json')));
 if(metadata.repository!==repo||git('rev-parse','HEAD^{tree}')!==metadata.testedTree||git('status','--porcelain','--untracked-files=no'))throw Error('Candidate changed during qualification');
 const elements=[];
 for(const f of metadata.files){
  const data=readFileSync(safePath(f.path));
  if(hash(data)!==f.after)throw Error('Working file differs from qualified content');
  const result=await api('git/blobs',{encoding:'base64',content:data.toString('base64')});
  if(result.sha!==f.after)throw Error('Exported hash mismatch');
  elements.push({path:f.path,mode:f.mode,type:'blob',sha:f.after});
 }
 const baseTree=(await api(`git/commits/${metadata.baseHead}`)).tree.sha;
 const exported=await api('git/trees',{base_tree:baseTree,tree:elements});
 if(exported.sha!==metadata.testedTree)throw Error('Exported tree differs from tested tree');
 writeFileSync(resolve(output,'qualified-merge.json'),JSON.stringify({...metadata,exportedTree:exported.sha},null,2)+'\n');
 console.log(`Exported exact tested tree ${exported.sha}; publication is a separate guarded action`);
}else throw Error('Use stage or export');
