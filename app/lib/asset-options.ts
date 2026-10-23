import type {Asset} from './finance.ts';
import {accountClassification} from './capital-accounts.ts';
import {defaultClassifications} from './classification.ts';

export function standardAssetCode(name:string,code=''){
 const known:Record<string,string>={'人民币':'RMB','港币':'HKD','美元':'USD','USDT':'USDT','现金':'cash'};
 return known[name.trim()]??code.trim();
}
export function assetOptionGroups(assets:Asset[]){
 const grouped=new Map<string,Asset[]>();
 for(const asset of assets){const group=accountClassification(asset);const rows=grouped.get(group)??[];rows.push(asset);grouped.set(group,rows);}
 const names=[...defaultClassifications,...[...grouped.keys()].filter(name=>!defaultClassifications.includes(name)).sort()];
 return names.filter(name=>grouped.has(name)).map(label=>({label,options:grouped.get(label)!.toSorted((a,b)=>a.platform.localeCompare(b.platform,'zh-CN')||a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id)).map(asset=>({value:asset.id,label:`${asset.name} · ${asset.platform} · ${asset.currency}`}))}));
}
