import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {emptyBook,ledgerInputs,projectLedger} from './runtime/finance.mjs';
import {advanceDraft,mergeBooks,same} from './nas-merge.mjs';
import {checkedNasIdentity,sameNasIdentity} from './nas-service.mjs';

const visible=s=>s.draft&&s.cloud?projectLedger(mergeBooks(ledgerInputs(s.draft.base),ledgerInputs(s.draft.book),ledgerInputs(s.cloud)).book):s.cloud??emptyBook();
export async function openNasCache(dataDir,{preview=false,legacyReader}={}){
 await mkdir(dataDir,{recursive:true});const file=path.join(dataDir,'nas-cache.json');let verified=preview;
 let state={format:'nas-cache-v1',version:0,identity:null,cloud:null,draft:null,saveAttempt:null};
 try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.format!=='nas-cache-v1'||!Number.isInteger(saved.version)||saved.cloud&&!Array.isArray(saved.cloud.records)||saved.draft&&(!saved.cloud||!saved.draft.base||!saved.draft.book))throw Error();if(saved.identity)checkedNasIdentity(saved.identity);if(saved.saveAttempt&&(saved.saveAttempt.format!=='nas-save-v1'||!saved.draft||!sameNasIdentity(saved.identity,checkedNasIdentity(saved.saveAttempt.identity))||typeof saved.saveAttempt.action?.type!=='string'))throw Error();state=saved;}catch(e){if(e.code!=='ENOENT')throw Object.assign(Error('NAS 缓存无法读取，请保留原文件并重试。'),{safe:true});}
 if(preview&&!state.cloud){try{const fixture=JSON.parse(await readFile(path.join(dataDir,'book.json'),'utf8'));state.cloud=fixture.book;state.version=fixture.version??0;}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function persist(next){await writeFile(file+'.tmp',JSON.stringify(next),'utf8');await rename(file+'.tmp',file);state=next;}
 return {
  get cloud(){return state.cloud;},get draft(){return state.draft;},get saveAttempt(){return state.saveAttempt??null;},get identity(){return state.identity;},get book(){return visible(state);},get version(){return state.version;},get ready(){return verified&&!!state.cloud;},get dirty(){return !!state.draft;},
  async receive(book,{uploaded=false,identity}={}){
   const received=checkedNasIdentity(identity);if(state.identity&&!sameNasIdentity(state.identity,received))throw Object.assign(Error('NAS 缓存账本身份发生变化，草稿已保留。'),{safe:true});
   let draft=uploaded?null:state.draft,legacyRateDraft=null;
   if(!state.cloud&&legacyReader&&received.legacyAccountId){const legacy=await legacyReader();if(legacy?.accountId===received.legacyAccountId)draft??=structuredClone(legacy.draft);}
   const cloud=projectLedger(book),next={...state,identity:received,cloud,draft,saveAttempt:uploaded?null:state.saveAttempt??null};if(draft&&!next.saveAttempt&&same(ledgerInputs(visible(next)),ledgerInputs(cloud)))next.draft=null;
   if(!same(state,next)){next.version++;await persist(next);}verified=true;return {legacyRateDraft};
  },
  async edit(book){
   if(!verified||!state.cloud)throw Object.assign(Error('请先读取 NAS 正式账本，再更新缓存。'),{safe:true});
   const before=visible(state),advanced=state.draft?advanceDraft(ledgerInputs(state.draft.base),ledgerInputs(state.draft.book),ledgerInputs(state.cloud)):null;
   const base=advanced?projectLedger(advanced.base):state.cloud,local=advanced?projectLedger(mergeBooks(ledgerInputs(before),ledgerInputs(book),advanced.local).book):projectLedger(book);
   const draft=same(ledgerInputs(local),ledgerInputs(base))?null:{base:structuredClone(base),book:local};if(same(draft,state.draft))return;await persist({...state,version:state.version+1,draft});
  },
  async combineDraft(pair){
   if(!verified||!state.cloud)throw Object.assign(Error('请先读取 NAS 正式账本，再更新缓存。'),{safe:true});
   const context=ledgerInputs(visible(state)),financial=state.draft?advanceDraft(ledgerInputs(state.draft.base),ledgerInputs(state.draft.book),ledgerInputs(state.cloud)):{base:ledgerInputs(state.cloud),local:ledgerInputs(state.cloud)};
   // Each pair has latest context on untouched paths. Financial changes keep
   // their original baseline; the most recent form owns its changed rates.
   const base=projectLedger(mergeBooks(context,financial.base,ledgerInputs(pair.base)).book),book=projectLedger(mergeBooks(context,ledgerInputs(pair.book),financial.local).book),draft=same(ledgerInputs(base),ledgerInputs(book))?null:{base,book};
   if(!same(draft,state.draft))await persist({...state,version:state.version+1,draft});
  },
  async stageSave(pair,action){
   if(!verified||!state.cloud||state.draft||state.saveAttempt)throw Object.assign(Error('请先恢复未完成的保存，或归档本机草稿。'),{safe:true,status:409});
   await persist({...state,version:state.version+1,draft:structuredClone(pair),saveAttempt:{format:'nas-save-v1',identity:structuredClone(state.identity),action:structuredClone(action),createdAt:new Date().toISOString()}});
  },
  async archiveDrafts(extra){
   const file=path.join(dataDir,'nas-draft-archive-'+randomUUID()+'.json');await writeFile(file,JSON.stringify({format:'nas-draft-archive-v1',identity:state.identity,cloud:state.cloud,draft:state.draft,saveAttempt:state.saveAttempt??null,...extra}),'utf8');await persist({...state,version:state.version+1,draft:null,saveAttempt:null});
  },
  async exportedArchives(){const names=await readdir(dataDir);return Promise.all(names.filter(name=>/^nas-draft-archive-[a-f0-9-]+\.json$/.test(name)).map(async name=>JSON.parse(await readFile(path.join(dataDir,name),'utf8'))));}
 };
}
