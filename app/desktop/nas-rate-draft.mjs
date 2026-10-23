import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {applyAction,ledgerInputs,projectLedger,ratesAt} from './runtime/finance.mjs';
import {advanceDraft} from './nas-merge.mjs';
import {validateBook} from './feishu-ledger.mjs';
import {checkedNasIdentity,sameNasIdentity} from './nas-service.mjs';

const fail=message=>Object.assign(Error(message),{safe:true,status:409});
function checkedForm(value){
 if(value===null)return null;
 if(!value||typeof value.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!value.rates||typeof value.rates!=='object'||Array.isArray(value.rates)||Object.keys(value.rates).length>100)throw fail('汇率输入格式无效');
 for(const [code,text] of Object.entries(value.rates))if(!/^[A-Z]{3}$/.test(code)||typeof text!=='string'||text.length>40)throw fail('汇率输入格式无效');
 return {date:value.date,rates:{...value.rates}};
}
const numeric=text=>text.trim()===''?NaN:Number(text);
// Mark only owned currency paths. Markers stay in this merge input and are never
// projected, saved as a financial book, or sent to NAS.
function advancedContext(draft,current){
 const base=ledgerInputs(draft.base),local=structuredClone(base),date=draft.form.date;
 const point={date,rates:{...ratesAt(draft.base,date)},source:'手动汇率'};
 for(const [code,text] of Object.entries(draft.owned))point.rates[code]='rate-input:'+text;
 local.rateHistory=[...(local.rateHistory??[]).filter(p=>p.date!==date),point].sort((a,b)=>a.date.localeCompare(b.date));
 return projectLedger(advanceDraft(base,local,ledgerInputs(current)).base);
}
export async function openNasRateDraft(dataDir){
 const file=path.join(dataDir,'nas-rate-draft.json');let draft=null,unbound=[];
 try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.format==='nas-rate-draft-v1'){
   unbound=Array.isArray(saved.unbound)?saved.unbound.map(checkedForm):[];
   if(saved.form){checkedForm(saved.form);checkedNasIdentity(saved.identity);validateBook(saved.base);checkedForm({date:saved.form.date,rates:saved.owned});draft={form:saved.form,identity:saved.identity,base:saved.base,owned:saved.owned};}
  }else unbound=[checkedForm(saved)];
 }catch(error){if(error.code!=='ENOENT')throw fail('汇率输入缓存无法读取，请保留缓存并重试');}
 async function persist(next){
  await mkdir(dataDir,{recursive:true});
  if(!next&&!unbound.length)await rm(file,{force:true});
  else {await writeFile(file+'.tmp',JSON.stringify({format:'nas-rate-draft-v1',...next,unbound}),'utf8');await rename(file+'.tmp',file);}
  draft=next;
 }
 function checkIdentity(identity){const checked=checkedNasIdentity(identity);if(draft&&!sameNasIdentity(draft.identity,checked))throw fail('汇率输入来自其他 NAS 账本，已保留供导出。');return checked;}
 return {
  get value(){return draft?structuredClone(draft.form):null;},
  export(){return {rateDraftContext:draft?structuredClone(draft):null,unboundRateDrafts:structuredClone(unbound)};},
  async save(form,{book,identity}={}){
   form=checkedForm(form);if(!form){if(draft)await persist(null);return;}
   const checked=checkIdentity(identity);if(!book)throw fail('请先读取 NAS 正式账本，再修改汇率。');
   const previous=draft,base=previous?.form.date===form.date?advancedContext(previous,book):structuredClone(book),baseline=ratesAt(base,form.date),owned={...(previous?.owned??{})};
   for(const code of Object.keys(owned))if(!Object.hasOwn(form.rates,code))delete owned[code];
   for(const [code,text] of Object.entries(form.rates)){
    if(previous&&previous.form.rates[code]===text)continue;
    if(numeric(text)===baseline[code])delete owned[code];else owned[code]=text;
   }
   await persist({form,identity:checked,base,owned});
  },
  prepare(book,identity){
   if(!draft)return null;checkIdentity(identity);const base=advancedContext(draft,book),rates={...ratesAt(book,draft.form.date)};
   for(const [code,text] of Object.entries(draft.owned))rates[code]=numeric(text);
   return {base,book:applyAction(base,{type:'rates',date:draft.form.date,rates,source:'手动汇率'})};
  },
  matches(action){return action.type==='rates'&&draft?.form.date===action.date&&Object.entries(draft.form.rates).every(([code,text])=>numeric(text)===action.rates?.[code]);},
  async clearSaved(action){if(this.matches(action))await this.save(null);}
 };
}
