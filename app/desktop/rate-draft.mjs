import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {today,hasConfirmedRates} from './runtime/finance.mjs';

export async function openRateDraft(dataDir){
 const file=path.join(dataDir,'rate-draft.json');let draft=null;
 function checked(value){
  if(value===null)return null;
  if(!value||typeof value.date!=='string'||value.date.length>10||!value.rates||typeof value.rates!=='object'||Array.isArray(value.rates)||Object.keys(value.rates).length>100)throw Error('汇率输入格式无效');
  for(const [code,rate] of Object.entries(value.rates))if(!/^[A-Z]{3}$/.test(code)||typeof rate!=='string'||rate.length>40)throw Error('汇率输入格式无效');
  return {date:value.date,rates:{...value.rates}};
 }
 try{draft=checked(JSON.parse(await readFile(file,'utf8')));}catch(error){if(error.code!=='ENOENT')throw Error('汇率输入缓存无法读取，请保留缓存并重试');}
 return {
  get value(){return draft?structuredClone(draft):null;},
  async save(value){const next=checked(value);await mkdir(dataDir,{recursive:true});if(next){await writeFile(file+'.tmp',JSON.stringify(next),'utf8');await rename(file+'.tmp',file);}else await rm(file,{force:true});draft=next;},
  async clearSaved(action){if(action.type==='rates'&&draft&&draft.date===action.date&&Object.entries(draft.rates).every(([c,v])=>v.trim()!==''&&Number(v)===action.rates[c]))await this.save(null);}
 };
}

export function operationRateRequirement(book,action){
 if(!['trade','cash','position','add','transfer','classify','recordEdit'].includes(action?.type))return null;
 const date=action.date??(action.type==='add'?action.assets?.[0]?.date:undefined)??today();
 const currencies=Object.keys(book.rates);
 if(!hasConfirmedRates(book,date))return {date,currencies};
 return null;
}
