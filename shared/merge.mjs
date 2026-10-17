export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const same=(a,b)=>canonical(a)===canonical(b);
const arrayKey=p=>p==='assets'||p==='records'||p==='closedAssets'||p==='capitalMovements'?'id':p==='investments'?'assetId':p==='capitalBase'?'key':['snapshots','gainSnapshots','months','rateHistory'].includes(p)?'date':null;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
/** Advance observed remote context only on paths with no local change. */
export function advanceDraft(base,local,remote){
 function advance(b,l,r,p,rowType=null){
  if(same(b,l))return {base:structuredClone(r),local:structuredClone(r)};
  if(b===undefined&&rowType==='rateHistory'&&object(l)&&object(r)&&l.date===r.date){
   // A jointly introduced date needs valid projection context. Seed its identity
   // and pre-existing rates from the old baseline, never from owned new rates.
   const prior=base.rateHistory?.filter(point=>point.date<=l.date).sort((a,c)=>a.date.localeCompare(c.date)).at(-1);
   b={date:l.date,rates:structuredClone(prior?.rates??base.rates),source:prior?.source??base.rateSource};
  }
  if(Array.isArray(l)&&Array.isArray(r)&&(b===undefined||Array.isArray(b))){
   const key=arrayKey(p),original=b??[];
   if(key&&[original,l,r].every(list=>list.every(v=>v&&typeof v[key]==='string')&&new Set(list.map(v=>v[key])).size===list.length)){
    const maps=[original,l,r].map(list=>new Map(list.map(v=>[v[key],v]))),ids=[...new Set([...l,...r,...original].map(v=>v[key]))];
    const pairs=ids.map(id=>advance(maps[0].get(id),maps[1].get(id),maps[2].get(id),p+'['+id+']',p));
    const result={base:pairs.map(pair=>pair.base).filter(v=>v!==undefined),local:pairs.map(pair=>pair.local).filter(v=>v!==undefined)};
    if(key==='date')for(const list of [result.base,result.local])list.sort((a,c)=>a.date.localeCompare(c.date));
    return result;
   }
  }else if(object(l)&&object(r)&&(object(b)||b===undefined&&rowType===null)){
   // Missing optional dictionaries still merge by child. Other locally added
   // keyed rows keep an absent baseline instead of acquiring partial identities.
   const original=b??{};
   const pairs=[...new Set([...Object.keys(original),...Object.keys(l),...Object.keys(r)])].map(key=>[key,advance(original[key],l[key],r[key],p?p+'.'+key:key)]);
   return {base:Object.fromEntries(pairs.filter(([,pair])=>pair.base!==undefined).map(([key,pair])=>[key,pair.base])),local:Object.fromEntries(pairs.filter(([,pair])=>pair.local!==undefined).map(([key,pair])=>[key,pair.local]))};
  }
  // Local additions, changes and deletions keep their original conflict baseline.
  return {base:structuredClone(b),local:structuredClone(l)};
 }
 return advance(base,local,remote,'');
}
export function mergeBooks(base,local,remote){
 const conflicts=[];
 function merge(b,l,r,p){
  if(same(l,r)||same(r,b))return structuredClone(l);
  if(same(l,b))return structuredClone(r);
  if(l===undefined||r===undefined){conflicts.push(p);return structuredClone(l);}
  if(Array.isArray(l)&&Array.isArray(r)&&Array.isArray(b)){
   const key=arrayKey(p);
   if(key&&[b,l,r].every(list=>list.every(v=>v&&typeof v[key]==='string')&&new Set(list.map(v=>v[key])).size===list.length)){
    const maps=[b,l,r].map(list=>new Map(list.map(v=>[v[key],v])));
    const order=[...new Set([...l,...r,...b].map(v=>v[key]))];
    const result=order.map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),p+'['+id+']')).filter(v=>v!==undefined);
    if(key==='date')result.sort((a,c)=>a.date.localeCompare(c.date));
    return result;
   }
  }else if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)){
   return Object.fromEntries([...new Set([...Object.keys(b??{}),...Object.keys(l),...Object.keys(r)])].map(k=>[k,merge(b?.[k],l[k],r[k],p?p+'.'+k:k)]).filter(([,v])=>v!==undefined));
  }
  conflicts.push(p);return structuredClone(l);
 }
 return {book:merge(base,local,remote,''),conflicts};
}
