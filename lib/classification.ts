import type {Asset,Book,RecordEntry} from './finance.ts';

export const defaultClassifications=['股市','黄金','基金'];
export function categoryFromClassification(classification:string):Asset['category']{
 if(classification==='股市'||classification==='股票')return '股票';
 if(classification==='黄金'||classification==='基金'||classification==='现金'||classification==='债券')return classification;
 return '其他';
}
export function defaultClassification(category?:string){
 return category==='股票'?'股市':category??'其他';
}
export function assetClassification(asset:Pick<Asset,'category'|'classification'>){
 return asset.classification??defaultClassification(asset.category);
}
export function recordClassification(book:Book,record:RecordEntry){
 if(record.classification!==undefined)return record.classification;
 const asset=[...book.assets,...(book.closedAssets??[])].find(item=>item.id===record.assetId);
 return asset?assetClassification(asset):defaultClassification(book.investments?.find(item=>item.assetId===record.assetId)?.category);
}
export function classificationOptions(book:Book){
 return [...new Set([...defaultClassifications,...book.assets.map(assetClassification),...book.assets.map(asset=>asset.accountClassification),...book.records.map(record=>recordClassification(book,record))])].filter((value):value is string=>!!value);
}

export function fillClassifications(book:Book){
 const next=structuredClone(book);
 const remaining=new Set(next.records.filter(record=>record.type==='剩余').map(record=>record.assetId));
 for(const asset of [...next.assets,...(next.closedAssets??[])]){asset.classification??=assetClassification(asset);asset.category=remaining.has(asset.id)?'现金':categoryFromClassification(asset.classification);}
 for(const record of next.records){record.classification??=recordClassification(next,record);record.category=remaining.has(record.assetId)?'现金':categoryFromClassification(record.classification);}
 return next;
}
