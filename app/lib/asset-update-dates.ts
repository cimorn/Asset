import type {Asset,Book} from './finance.ts';

export type UpdateStatus='all'|'updated'|'pending';
type AssetDates={first:string;latest:string;dates:Set<string>};
export type UpdateDateRow={date:string;total:number;updated:number;pending:number};
export type AssetUpdateHistory={dates:string[];assets:Map<string,AssetDates>;rows:UpdateDateRow[]};

/** A check-in comes from a ledger entry, including remaining balances, never an FX refresh. */
export function assetUpdateHistory(book:Book,scope:Asset[]=book.assets):AssetUpdateHistory{
 const current=new Set(book.assets.map(asset=>asset.id)),assets=new Map<string,AssetDates>(),dates=new Set<string>();
 for(const record of book.records){
  if(!current.has(record.assetId)||record.type==='移除资产'||!record.date)continue;
  dates.add(record.date);
  const item=assets.get(record.assetId);
  if(item){item.dates.add(record.date);if(record.date<item.first)item.first=record.date;if(record.date>item.latest)item.latest=record.date;}
  else assets.set(record.assetId,{first:record.date,latest:record.date,dates:new Set([record.date])});
 }
 const ordered=[...dates].sort().reverse();
 const rows=ordered.map(date=>{
  let total=0,updated=0;
  for(const asset of scope){const item=assets.get(asset.id);if(!item||item.first>date)continue;total++;if(item.dates.has(date))updated++;}
  return {date,total,updated,pending:total-updated};
 });
 return {dates:ordered,assets,rows};
}

export function assetsForUpdateStatus(assets:Asset[],history:AssetUpdateHistory,date:string,status:UpdateStatus):Asset[]{
 if(status==='all')return assets;
 if(!date)return [];
 return assets.filter(asset=>{const item=history.assets.get(asset.id);return !!item&&item.first<=date&&(status==='updated'?item.dates.has(date):!item.dates.has(date));});
}
