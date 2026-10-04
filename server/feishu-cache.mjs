import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {emptyBook,ledgerInputs,projectLedger} from './runtime/finance.mjs';
import {same,mergeBooks} from './feishu-merge.mjs';

// Only locally edited inputs are overlaid. Everything else comes from Feishu.
// Clicking Upload commits these edits, including an edited field that also changed remotely.
export function applyCachedDraft(base,draft,cloud){
 return projectLedger(mergeBooks(ledgerInputs(base),ledgerInputs(draft),ledgerInputs(cloud)).book);
}
const equivalent=(a,b)=>same(ledgerInputs(a),ledgerInputs(b));
export async function openCloudCache(dataDir,{preview=false}={}){
 await mkdir(dataDir,{recursive:true});const file=path.join(dataDir,'feishu-cache.json');
 let state={format:'feishu-cache-v1',version:0,cloud:null,draft:null};
 try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.format!=='feishu-cache-v1'||!Number.isInteger(saved.version)||saved.cloud&&!Array.isArray(saved.cloud.records)||saved.draft&&(!saved.cloud||!saved.draft.base||!saved.draft.book))throw new Error('Invalid cache');state=saved;}
 catch(error){if(error.code!=='ENOENT'){if(error.code)throw error;await rename(file,file+'.invalid-'+Date.now());}}
 // Standalone previews may seed a fixture; the desktop app never imports a local book.
 if(preview&&!state.cloud){try{const fixture=JSON.parse(await readFile(path.join(dataDir,'book.json'),'utf8'));state.cloud=fixture.book;state.version=fixture.version??0;}catch(error){if(error.code!=='ENOENT')throw error;}}
 const project=book=>book.ledgerAuthority?projectLedger(book):book;
 if(state.cloud)state.cloud=project(state.cloud);
 let display=state.draft?applyCachedDraft(state.draft.base,state.draft.book,state.cloud):state.cloud??emptyBook();
 async function persist(next){const temp=file+'.tmp';await writeFile(temp,JSON.stringify(next),'utf8');await rename(temp,file);state=next;display=state.draft?applyCachedDraft(state.draft.base,state.draft.book,state.cloud):state.cloud??emptyBook();}
 return {
  get cloud(){return state.cloud;},get draft(){return state.draft;},get book(){return display;},get version(){return state.version;},get ready(){return !!state.cloud;},get dirty(){return !!state.draft;},
  async receive(book,{uploaded=false}={}){
   const cloud=project(book);let draft=uploaded?null:state.draft;
   if(draft&&equivalent(applyCachedDraft(draft.base,draft.book,cloud),cloud))draft=null;
   if(same(cloud,state.cloud)&&same(draft,state.draft))return;
   await persist({...state,version:state.version+1,cloud,draft});
  },
  async edit(book){
   if(!state.cloud)throw new Error('请先读取飞书数据，再更新缓存');
   const draft=equivalent(book,state.cloud)?null:{base:structuredClone(state.cloud),book:project(book)};
   if(same(book,display)&&same(draft,state.draft))return;
   await persist({...state,version:state.version+1,draft});
  }
 };
}
