export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const same=(a,b)=>canonical(a)===canonical(b);
export function mergeBooks(base,local,remote){
 const conflicts=[];
 function merge(b,l,r,p){
  if(same(l,r)||same(r,b))return structuredClone(l);
  if(same(l,b))return structuredClone(r);
  if(l===undefined||r===undefined){conflicts.push(p);return structuredClone(l);}
  if(Array.isArray(l)&&Array.isArray(r)&&Array.isArray(b)){
   const key=p==='assets'||p==='records'||p==='closedAssets'||p==='capitalMovements'?'id':p==='investments'?'assetId':p==='capitalBase'?'key':['snapshots','gainSnapshots','months','rateHistory'].includes(p)?'date':null;
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
