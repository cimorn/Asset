import type {Asset,Book} from './finance.ts';
import {assetClassification} from './classification.ts';
import {investmentRows,roundMoney} from './investing.ts';
import {ratesAt} from './exchange.ts';
import {recordDisplay} from './record-display.ts';

export type CapitalAccount={key:string;platform:string;classification:string;currency:string;cost:number;costCny:number};
export type CapitalMovement={id:string;key:string;date:string;amount:number;amountCny:number};
export function accountClassification(asset:Asset){return asset.category==='现金'&&assetClassification(asset)==='现金'?(asset.accountClassification?.trim()||'现金'):assetClassification(asset);}
export function accountKey(platform:string,classification:string,currency:string){return JSON.stringify([platform,classification,currency]);}
export function assetAccountKey(asset:Asset){return accountKey(asset.platform,accountClassification(asset),asset.currency);}

function balanceNetInput(book:Book,asset:Asset){
 const records=book.records.map((record,index)=>({record,index})).filter(item=>item.record.assetId===asset.id).sort((a,b)=>a.record.date.localeCompare(b.record.date)||(a.record.order??-a.index)-(b.record.order??-b.index));
 // A neutral first balance is an opening input; later neutral records only replace its valuation.
 const inputs=records.filter(({record},index)=>record.remainingMode!=='更新市值'&&(index===0||recordDisplay(record).direction!=='neutral')).map(item=>item.record);
 const principal=book.ledgerAuthority&&records.length?inputs.reduce((sum,record)=>sum+record.after-record.before,0):asset.value;
 const basis=book.ledgerAuthority&&records.length?inputs.reduce((sum,record)=>sum+(record.fundingAmount!==undefined?record.settlementCny??0:(record.after-record.before)*ratesAt(book,record.date)[record.currency]),0):asset.value*(book.rates[asset.currency]??1);
 return {netInput:roundMoney(principal),netInputCny:roundMoney(basis)};
}

/** Native currency amounts for holdings and remaining balances, all derived from ledger inputs. */
export function assetFinancialRows(book:Book){
 const investments=new Map(investmentRows(book).map(row=>[row.assetId,row]));
 return book.assets.map(asset=>{
  const investment=investments.get(asset.id),known=asset.category==='现金'||!!investment?.known;
  const input=asset.category==='现金'?balanceNetInput(book,asset):{netInput:investment?.netCost??0,netInputCny:investment?.netCostCny??0};
  return {assetId:asset.id,known,netInput:known?input.netInput:null,netInputCny:known?input.netInputCny:null,gain:known?roundMoney(asset.value-input.netInput):null,gainCny:known?roundMoney(asset.value*(book.rates[asset.currency]??1)-input.netInputCny):null};
 });
}

/** Preserve the old reported gain when first assigning existing holdings to accounts. */
export function capitalAccounts(book:Book):CapitalAccount[]{
 if(!book.ledgerAuthority&&book.capitalBase){
  const accounts=new Map(book.capitalBase.map(row=>[row.key,{...row}]));
  for(const event of book.capitalMovements??[]){
   let row=accounts.get(event.key);
   if(!row){const [platform,classification,currency]=JSON.parse(event.key);row={key:event.key,platform,classification,currency,cost:0,costCny:0};accounts.set(event.key,row);}
   row.cost=roundMoney(row.cost+event.amount);row.costCny=roundMoney(row.costCny+event.amountCny);
  }
  return [...accounts.values()];
 }
 if(!book.ledgerAuthority&&book.capitalAccounts)return book.capitalAccounts;
 const accounts=new Map<string,CapitalAccount>();
 const add=(asset:Asset,cost:number,costCny:number)=>{
  const classification=accountClassification(asset),key=accountKey(asset.platform,classification,asset.currency);
  const row=accounts.get(key)??{key,platform:asset.platform,classification,currency:asset.currency,cost:0,costCny:0};
  row.cost=roundMoney(row.cost+cost);row.costCny=roundMoney(row.costCny+costCny);accounts.set(key,row);
 };
 for(const row of investmentRows(book)){
  const asset=book.assets.find(item=>item.id===row.assetId);
  if(asset&&row.known)add(asset,row.netCost,row.netCostCny);
 }
 for(const asset of book.assets.filter(item=>item.category==='现金')){
  const input=balanceNetInput(book,asset);add(asset,input.netInput,input.netInputCny);
 }
 // Cash is one independent account per default currency; empty currencies derive zero from no ledger inputs.
 if(book.ledgerAuthority&&book.assets.some(asset=>assetClassification(asset)==='现金'))for(const currency of ['CNY','USD','HKD']){
  if(!book.rates[currency])continue;
  if(![...accounts.values()].some(account=>account.classification==='现金'&&account.currency===currency)){
   const key=accountKey('全平台','现金',currency);accounts.set(key,{key,platform:'全平台',classification:'现金',currency,cost:0,costCny:0});
  }
 }
 return [...accounts.values()];
}
export function ensureCapitalAccounts(book:Book){if(!book.ledgerAuthority&&!book.capitalBase){book.capitalBase=capitalAccounts(book).map(row=>({...row}));book.capitalMovements=[];book.capitalBaseDate=[...book.assets.map(asset=>asset.date),...book.records.map(record=>record.date),book.rateDate].filter(Boolean).sort().at(-1)??'';}book.capitalAccounts=capitalAccounts(book);return book.capitalAccounts;}
export function changeCapital(book:Book,asset:Asset,delta:number,date:string,id?:string){
 if(book.ledgerAuthority)return;
 ensureCapitalAccounts(book);const key=assetAccountKey(asset),rate=ratesAt(book,date)[asset.currency]??1;
 book.capitalMovements!.push({id:id?`capital-${id}`:crypto.randomUUID(),key,date,amount:roundMoney(delta),amountCny:roundMoney(delta*rate)});
 const accounts=book.capitalAccounts!;
 let row=accounts.find(item=>item.key===key);
 if(!row){row={key,platform:asset.platform,classification:accountClassification(asset),currency:asset.currency,cost:0,costCny:0};accounts.push(row);}
 row.cost=roundMoney(row.cost+delta);
 row.costCny=roundMoney(row.costCny+delta*rate);
 return row;
}
