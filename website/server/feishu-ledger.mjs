import {gzipSync,gunzipSync} from 'node:zlib';
import {categories,markets,currencyNames,investmentRows,recordEntries,stampRecord,today,capturePortfolio,captureGains,finalizeFinancialRecords,ratesAt,assetClassification,recordClassification,projectLedger,fillClassifications,categoryFromClassification,capitalAccounts,accountClassification} from './runtime/finance.mjs';
import {digest,same} from './feishu-merge.mjs';

export const assetFields=[['name','资产名称',1],['accountClassification','账户归属',1],['code','代码',20],['classification','分类',20],['platform','平台',20],['currency','币种',20],['netCost','成本',20],['value','市值',20],['gain','收益',20],['date','更新日期',20],['proceeds','累计卖出',20],['id','资产编号',1],['anchorPlatform','_关联平台',1],['anchorCurrency','_关联币种',1]];
export const recordFields=[['name','资产名称',1],['code','代码',1],['platform','平台',1],['classification','分类',3],['date','日期',1],['type','操作',1],['remainingMode','剩余方式',3],['currency','币种',1],['operationAmount','金额',2],['after','市值',2],['exchangeRate','汇率',20],['assetId','资产编号',1],['id','流水编号',1]];
const legacyRecordFields=[['name','资产名称',1],['platform','平台',1],['date','日期',1],['type','操作',1],['currency','币种',1],['settlement','收支金额',2],['before','更新前市值或余额',2],['after','市值',2],['amount','市值或余额变动',2],['flowIn','转入',2],['flowOut','转出',2],['invested','累计投入成本',2],['proceeds','累计卖出',2],['gain','累计收益',2],['exchangeRate','汇率',2],['settlementCny','本次收支人民币金额',2],['valueCny','更新后人民币市值或余额',2],['investedCny','累计投入人民币成本',2],['proceedsCny','累计卖出人民币到账',2],['gainCny','累计人民币收益',2],['note','备注',1],['assetId','资产编号',1],['id','流水编号',1]];
export const rateFields=[['code','币种代码',1],['name','币种名称',1],['rate','兑人民币汇率',2],['date','生效日期',1]];
export const archiveFields=[['key','存档名称',1],['data','数据',1]];
export const accountFields=[['name','账户',1],['platform','平台',1],['classification','分类',1],['currency','币种',1],['cost','投入成本',20],['cash','现金余额',20],['holdings','持仓市值',20],['value','账户总值',20],['gain','收益',20],['returnRate','收益率',20],['costCny','_人民币投入成本',20],['key','账户编号',1]];
export const obsoleteFields={assets:['类别','数量','净值','已实现盈亏','市场','备注'],records:['类别','成本','累计卖出','_有效流水','_流水日期','_净投入','_卖出金额','数量','成交净值','手续费','结转成本','本次已实现盈亏','收支金额','更新前市值或余额','市值或余额变动','转入','转出','累计投入成本','累计收益','本次收支人民币金额','更新后人民币市值或余额','累计投入人民币成本','累计卖出人民币到账','累计人民币收益','备注'],rates:['汇率来源','汇率编号']};
export const obsoleteFormulaFields=new Set(['成本','累计卖出','_有效流水','_流水日期','_净投入','_卖出金额']);
export const obsoleteTextFields=new Set(['市场','备注','汇率来源','汇率编号']);
export const hiddenFields={assets:['资产编号','_关联平台','_关联币种','累计卖出'],records:['资产编号','流水编号'],accounts:['账户编号','_人民币投入成本']};
export const fieldAliases={assets:{'市值':['市值或余额'],'成本':['累计投入成本','持仓成本'],'累计卖出':['累计卖出到账']},records:{'金额':['收支金额'],'市值':['更新后市值或余额'],'汇率':['当次兑人民币汇率']}};
const aliases={'收支金额':['金额'],'累计投入成本':['成本'],'市值':['市值或余额','更新后市值或余额'],'成本':['累计投入成本','持仓成本'],'汇率':['当次兑人民币汇率']};
export const schemas={assets:{name:'资产',fields:assetFields},records:{name:'流水',fields:recordFields},rates:{name:'币种与汇率',fields:rateFields},accounts:{name:'账户',fields:accountFields},archive:{name:'系统存档',fields:archiveFields}};
const fieldsOf=(item,fields)=>Object.fromEntries(fields.filter(([, ,type])=>type!==20).map(([key,name])=>[name,item[key]??null]));
export function encodeRows(book){
 const names=currencyNames(book),investments=new Map(investmentRows(book).map(row=>[row.assetId,row])),entries=new Map(recordEntries(book).map(item=>[item.record.id,item]));
 return {assets:book.assets.map(asset=>{const row=investments.get(asset.id);return {fields:fieldsOf({...asset,anchorPlatform:asset.platform,anchorCurrency:asset.currency,classification:assetClassification(asset),netCost:row?.known?row.netCost:null,proceeds:row?.proceeds??null},assetFields)};}),records:book.records.map(record=>{const entry=entries.get(record.id);return {fields:fieldsOf({...record,classification:recordClassification(book,record),category:record.category??book.assets.find(asset=>asset.id===record.assetId)?.category??book.closedAssets?.find(asset=>asset.id===record.assetId)?.category,code:record.code??book.assets.find(asset=>asset.id===record.assetId)?.code??book.closedAssets?.find(asset=>asset.id===record.assetId)?.code??'',type:record.inputType??entry.label,operationAmount:entry.operationAmount,netCost:entry.netCost,proceeds:entry.proceeds,exchangeRate:entry.exchangeRate},recordFields)};}),rates:book.rateHistory?.length?book.rateHistory.flatMap(point=>Object.keys(point.rates).map(code=>({fields:fieldsOf({code,name:names[code],rate:point.rates[code],date:point.date},rateFields)}))):Object.keys(names).map(code=>({fields:fieldsOf({code,name:names[code],rate:book.rates[code],date:book.rateDate},rateFields)})),accounts:capitalAccounts(book).map(account=>{const assets=book.assets.filter(asset=>asset.platform===account.platform&&accountClassification(asset)===account.classification&&asset.currency===account.currency),cash=round(assets.filter(asset=>asset.category==='现金').reduce((sum,asset)=>sum+asset.value,0)),holdings=round(assets.filter(asset=>asset.category!=='现金').reduce((sum,asset)=>sum+asset.value,0)),value=round(cash+holdings),gain=round(value-account.cost);return {fields:fieldsOf({...account,name:account.classification==="现金"?`现金 · ${account.currency}`:`${account.platform} · ${account.classification} · ${account.currency}`,cash,holdings,value,gain,returnRate:account.cost>0?round(gain/account.cost*100):null},accountFields)};})};
}
function text(value){if(Array.isArray(value))return value.map(v=>v.text??v.text_run?.content??'').join('');return value==null?'':String(value);}
export function numericCell(value){if(Array.isArray(value)&&value.length===1)return numericCell(value[0]);if(value&&typeof value==='object'&&'value' in value)return numericCell(value.value);if(value==null||value==='')return null;if(typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))return Number(value);return value;}
function number(value,label,nullable=false,signed=false){
 if(value==null||value===''){if(nullable)return null;throw new Error('飞书字段“'+label+'”未填写');}
 if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12||(!signed&&value<0))throw new Error('飞书字段“'+label+'”数字无效');return value;
}
const cell=(row,name)=>row.fields?.[name]??(aliases[name]??[]).map(alias=>row.fields?.[alias]).find(value=>value!==undefined);
export function isDraftRecord(row){return ['资产名称','分类','平台','日期','操作','币种'].some(name=>!text(cell(row,name)).trim())||cell(row,'市值')==null||cell(row,'市值')==='';}
const read=(row,fields)=>Object.fromEntries(fields.map(([key,name,type])=>[key,(type===1||type===3||['name','code','category','classification','platform','currency','date','id'].includes(key))?text(cell(row,name)):numericCell(cell(row,name))]));
function date(value,optional=false){if(optional&&!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('飞书日期须为 YYYY-MM-DD');return value;}
function unique(list,key,label){const values=list.map(v=>v[key]);if(values.some(v=>!v||v.length>100)||new Set(values).size!==values.length)throw new Error('飞书'+label+'编号为空或重复');}
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function validateBook(book){
 if(!book||typeof book!=='object'||!Array.isArray(book.assets)||!Array.isArray(book.records)||!Array.isArray(book.snapshots)||!book.rates||book.rates.CNY!==1)throw new Error('飞书账本结构无效');
 if(book.assets.length>2000||book.records.length>20000)throw new Error('飞书账本超出容量限制');
 if(typeof book.initialized!=='boolean'||!currencyNames(book)[book.base])throw new Error('飞书账本币种或状态无效');
 unique(book.assets,'id','资产');unique(book.records,'id','流水');
 const walk=value=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error('飞书账本包含无效数字');if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('飞书账本字段无效');walk(v);}};walk(book);
 for(const code of Object.keys(currencyNames(book))){const rate=book.rates[code];if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>1e6)throw new Error('飞书币种汇率无效');}
 for(const asset of book.assets){if(!categories.includes(asset.category)||!markets.includes(asset.market)||!currencyNames(book)[asset.currency]||!asset.name?.trim()||!asset.platform?.trim())throw new Error('飞书资产名称、平台、分类、市场或币种无效');date(asset.date);for(const key of ['value','cost','proceeds','quantity','unitPrice'])number(asset[key],key,key!=='value');if(asset.icon&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(asset.icon))throw new Error('飞书图标数据无效');}
 if(book.statisticsStart)date(book.statisticsStart);
 if(book.rateHistory){unique(book.rateHistory,'date','汇率日期');for(const point of book.rateHistory){date(point.date);if(point.rates?.CNY!==1)throw new Error('飞书人民币汇率须为 1');for(const rate of Object.values(point.rates))if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>1e6)throw new Error('飞书历史汇率无效');}}
 for(const record of book.records)if(record.exchangeRate!==undefined&&(typeof record.exchangeRate!=='number'||record.exchangeRate<=0||record.exchangeRate>1e6||(record.currency==='CNY'&&record.exchangeRate!==1)))throw new Error('飞书流水汇率无效');
 for(const item of [...book.assets,...book.records])if(item.classification!==undefined&&(typeof item.classification!=='string'||!item.classification.trim()||item.classification.length>40))throw new Error('飞书分类须为 1–40 个字符');
 for(const account of book.investments??[])for(const key of ['invested','proceeds'])number(account[key],key,true);
 if(book.capitalAccounts){unique(book.capitalAccounts,'key','账户');for(const account of book.capitalAccounts){if(account.key!==JSON.stringify([account.platform,account.classification,account.currency])||!account.platform?.trim()||!account.classification?.trim()||!currencyNames(book)[account.currency])throw new Error('飞书账户归属无效');number(account.cost,'账户成本',false,true);number(account.costCny,'人民币账户成本',false,true);}}
 return book;
}
export function packBook(book){
 validateBook(book);const encoded=gzipSync(Buffer.from(JSON.stringify(book))).toString('base64');return Array.from({length:Math.ceil(encoded.length/40000)},(_,i)=>encoded.slice(i*40000,(i+1)*40000));
}
export function unpackBook(parts){if(!Array.isArray(parts)||!parts.length||parts.length>500)throw new Error('飞书存档不完整');return validateBook(JSON.parse(gunzipSync(Buffer.from(parts.join(''),'base64'),{maxOutputLength:32*1024*1024}).toString('utf8')));}
function decodeAuthoritativeRows(rows,source){
 const book=structuredClone(source),oldAssets=new Map([...source.closedAssets??[],...source.assets].map(asset=>[asset.id,asset]));
 const complete=rows.records.filter(row=>text(row.fields?.['资产名称']).trim()&&!isDraftRecord(row));
 book.assets=rows.assets.filter(row=>text(row.fields?.['资产名称']).trim()).flatMap(row=>{
  const raw=read(row,assetFields),id=raw.id||'cloud-'+row.record_id,old=oldAssets.get(id);
  const matching=complete.filter(record=>text(record.fields['资产编号'])===id||!text(record.fields['资产编号'])&&text(record.fields['资产名称'])===raw.name&&text(record.fields['平台'])===text(row.fields['_关联平台']??row.fields['平台'])&&text(record.fields['币种'])===text(row.fields['_关联币种']??row.fields['币种']));
  const latest=matching.sort((left,right)=>text(left.fields['日期']).localeCompare(text(right.fields['日期']))||(numericCell(left.fields['_流水序号'])??0)-(numericCell(right.fields['_流水序号'])??0)).at(-1);
  if(!latest)return [];
  const inputs=read(latest,recordFields);inputs.category=matching.some(record=>text(record.fields['操作'])==='剩余')?'现金':categoryFromClassification(inputs.classification);
  return [{...old,id,name:inputs.name.trim(),code:inputs.code,platform:inputs.platform.trim(),category:inputs.category,classification:inputs.classification,...(inputs.category==='现金'&&raw.accountClassification?.trim()?{accountClassification:raw.accountClassification.trim()}:{}),market:old?.market??'不适用',currency:inputs.currency,value:0,cost:inputs.category==='现金'?null:0,proceeds:inputs.category==='现金'?undefined:0,quantity:null,unitPrice:null,date:book.statisticsStart??'2026-09-01',note:old?.note??''}];
 });
 const prior=new Map(source.records.map(record=>[record.id,record]));
 book.records=rows.records.filter(row=>text(row.fields?.['资产名称']).trim()&&!isDraftRecord(row)).map((row,index)=>{
  const raw=read(row,recordFields),id=raw.id||'cloud-'+row.record_id,old=prior.get(id);raw.category=categoryFromClassification(raw.classification);
  const candidates=book.assets.filter(asset=>asset.name===raw.name&&asset.platform===raw.platform&&asset.currency===raw.currency&&asset.classification===raw.classification);
  const asset=raw.assetId?[...book.assets,...book.closedAssets??[]].find(asset=>asset.id===raw.assetId):candidates.length===1?candidates[0]:null;
  if(!asset)throw new Error(raw.name+' 的流水未关联到唯一资产，请先在资产表填写名称、平台、分类和币种');
  if(raw.currency!==asset.currency)throw new Error(raw.name+' 的流水币种与资产不一致');
  if(!['买入','卖出','更新','剩余','转入','消费','存入','取出','买入扣款','卖出到账','转账转入','转账转出'].includes(raw.type))throw new Error('飞书操作须为买卖、更新、剩余或有效资金操作');
  if(asset.category!=='现金'&&['转入','消费','存入','取出','买入扣款','卖出到账','转账转入','转账转出'].includes(raw.type))throw new Error(raw.name+' 的操作与资产分类不一致');
  const cashAlias=asset.category==='现金'&&['买入','卖出'].includes(raw.type),type=cashAlias?(raw.type==='买入'?'转入':'消费'):raw.type;
  if(raw.remainingMode&&(!['转入','转出','消费','更新市值'].includes(raw.remainingMode)||raw.type!=='剩余'))throw new Error('剩余方式仅用于剩余流水，须为转入、转出、消费或更新市值');
  const remainingFlow=raw.type==='剩余'&&raw.remainingMode&&raw.remainingMode!=='更新市值';
  const amount=remainingFlow||!['更新','剩余'].includes(raw.type)?number(raw.operationAmount,'金额'):0;
  const serial=numericCell(row.fields?.['_流水序号']);
  const record={...old,id,assetId:asset.id,name:raw.name,code:raw.code,category:asset.category,platform:raw.platform,currency:raw.currency,classification:raw.classification||old?.classification||assetClassification(asset),date:date(raw.date),type,inputType:cashAlias?raw.type:undefined,before:0,after:number(raw.after,'市值'),amount:0,note:old?.note??'',settlement:remainingFlow?(raw.remainingMode==='转入'?amount:-amount):['更新','剩余'].includes(type)?undefined:['买入','消费','取出','买入扣款','转账转出'].includes(type)?-amount:amount,order:typeof serial==='number'?serial:old?.order??rows.records.length-index};
  if(raw.remainingMode)record.remainingMode=raw.remainingMode;else delete record.remainingMode;
  if(!cashAlias)delete record.inputType;return record;
 });
 unique(book.assets,'id','资产');unique(book.records,'id','流水');book.initialized=true;book.ledgerAuthority=true;
 const newCashInput=book.records.some(record=>!source.records.some(old=>old.id===record.id)&&['转入','存入','消费','转账转入','转账转出'].includes(record.type));
 if(!book.ledgerAuthority&&(source.capitalBase||newCashInput)){
  book.capitalBase??=capitalAccounts(source).map(account=>({...account}));
  book.capitalBaseDate??=[...source.assets.map(asset=>asset.date),...source.records.map(record=>record.date),source.rateDate].filter(Boolean).sort().at(-1)??'';
  book.capitalMovements??=[];
  const oldRecords=new Map(source.records.map(record=>[record.id,record]));
  const movementTypes=new Map([['存入',1],['转入',1],['转账转入',1],['消费',-1],['取出',-1],['转账转出',-1]]);
  const amountOf=record=>{const sign=movementTypes.get(record.type);return sign?sign*Math.abs(record.settlement??record.amount):0;};
  const keyFor=record=>{const asset=book.assets.find(asset=>asset.id===record.assetId)??source.assets.find(asset=>asset.id===record.assetId);return asset?JSON.stringify([asset.platform,accountClassification(asset),asset.currency]):null;};
  for(const record of book.records){
   if(record.type==='取出'&&!oldRecords.has(record.id))throw new Error('飞书转出必须填写目标账户，请使用转账转出和转账转入');
   if(record.type==='转账转出'&&!book.records.some(other=>other.id!==record.id&&other.type==='转账转入'&&other.date===record.date&&other.currency===record.currency&&Math.abs(other.settlement??0)===Math.abs(record.settlement??0)))throw new Error('飞书转账缺少同日、同币种、同金额的目标账户流水');
   const old=oldRecords.get(record.id),amount=amountOf(record),previous=old?amountOf(old):0,key=keyFor(record),movement=book.capitalMovements.find(item=>item.id==='capital-'+record.id);
   if(!key||!amount&&!previous)continue;
   if(movement){movement.key=key;movement.amount=round(amount);movement.amountCny=round(amount*(record.exchangeRate??book.rates[record.currency]??1));}
   else if(amount!==previous)book.capitalMovements.push({id:'cloud-capital-'+digest([record.id,amount,record.date]).slice(0,32),key,date:record.date,amount:round(amount-previous),amountCny:round((amount-previous)*(record.exchangeRate??book.rates[record.currency]??1))});
  }
  for(const old of source.records.filter(record=>movementTypes.has(record.type)&&!book.records.some(item=>item.id===record.id))){const existing=book.capitalMovements.findIndex(item=>item.id==='capital-'+old.id);if(existing>=0)book.capitalMovements.splice(existing,1);else{const key=keyFor(old);if(key)book.capitalMovements.push({id:'cloud-capital-remove-'+digest(old.id).slice(0,24),key,date:old.date,amount:round(-amountOf(old)),amountCny:round(-amountOf(old)*(old.exchangeRate??book.rates[old.currency]??1))});}}
  const prior=new Map(capitalAccounts(source).map(account=>[account.key,account]));
  for(const row of rows.accounts??[]){const raw=read(row,accountFields),key=JSON.stringify([raw.platform,raw.classification,raw.currency]);if(raw.key!==key)throw new Error('飞书账户编号与归属不一致');const cost=number(raw.cost,'投入成本',false,true),old=prior.get(key);if(old&&Math.abs(old.cost-cost)>.001)throw new Error('账户投入成本请通过现金转入或转账修改，不能直接改汇总值');}
  book.capitalAccounts=capitalAccounts(book);
 }
 return validateBook(projectLedger(fillClassifications(book)));
}
export function decodeRows(rows,archive,{netCostColumns=true,ledgerAuthority=true}={}){
 const book=structuredClone(archive),rates={},custom={};
 const rateRows=rows.rates.filter(row=>text(row.fields?.['币种代码']).trim()).map(row=>read(row,rateFields));const historical=!!book.rateHistory?.length||new Set(rateRows.map(row=>row.date)).size>1;
 if(historical){
  unique(rateRows.map(row=>({key:date(row.date)+'/'+row.code})),'key','汇率');
  const points=new Map();
  for(const row of rateRows){
   if(!/^[A-Z]{3}$/.test(row.code)||!row.name.trim())throw new Error('飞书币种代码或名称无效');
   const rate=number(row.rate,'兑人民币汇率');if(rate<=0||rate>1e6)throw new Error('飞书汇率超出范围');
   const point=points.get(row.date)??{date:row.date,rates:{},source:book.rateHistory?.find(point=>point.date===row.date)?.source??book.rateSource??'手动汇率'};point.rates[row.code]=rate;points.set(row.date,point);
   if(!['CNY','USD','HKD'].includes(row.code))custom[row.code]=row.name;
  }
  const history=[...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(!history.length)throw new Error('飞书汇率记录缺失');
  for(const point of history){if(point.rates.CNY!==1||!point.rates.USD||!point.rates.HKD)throw new Error('飞书各日期须保留人民币、美元和港币汇率');}
  book.rateHistory=history;const latest=history.at(-1);book.rates={...latest.rates};book.rateDate=latest.date;book.rateSource=latest.source;
 }else{
  unique(rateRows,'code','币种');const primary=rateRows.find(r=>r.code==='CNY');if(!primary||primary.rate!==1)throw new Error('飞书人民币汇率须为 1');
  for(const row of rateRows){if(!/^[A-Z]{3}$/.test(row.code)||!row.name.trim())throw new Error('飞书币种代码或名称无效');rates[row.code]=number(row.rate,'兑人民币汇率');if(rates[row.code]<=0||rates[row.code]>1e6)throw new Error('飞书汇率超出范围');if(!['CNY','USD','HKD'].includes(row.code))custom[row.code]=row.name;}
  for(const c of ['CNY','USD','HKD'])if(!rates[c])throw new Error('飞书默认币种缺失');book.rates=rates;book.rateDate=primary.date?date(primary.date):'';book.rateSource=archive.rateSource;
 }
 if(Object.keys(custom).length||book.customCurrencies)book.customCurrencies=custom;
 if(ledgerAuthority)return decodeAuthoritativeRows(rows,book);
 const priorInvestments=new Map(investmentRows(archive).map(row=>[row.assetId,row]));
 const assets=rows.assets.filter(row=>text(row.fields?.['资产名称']).trim()).map(row=>{
  const raw=read(row,assetFields),id=raw.id||'cloud-'+row.record_id,old=archive.assets.find(a=>a.id===id),prior=priorInvestments.get(id);
  const netCost=number(raw.netCost,'成本',true,netCostColumns),proceeds=number(raw.proceeds,'累计卖出',true),oldProceeds=prior?.proceeds??0;
  let cost=netCost;
  if(netCostColumns&&netCost!==null){
   if(old&&prior){cost=same(netCost,prior.netCost)&&same(proceeds??0,oldProceeds)?old.cost:(old.proceeds!==undefined||!same(proceeds??0,oldProceeds)?round(netCost+(proceeds??0)):round((old.cost??0)+netCost-prior.netCost));}
   else cost=round(netCost+(proceeds??0));
   number(cost,'累计买入金额',true);
  }
  const asset={...(old??{}),id,name:raw.name.trim(),code:raw.code,platform:raw.platform.trim(),category:raw.category,market:old?.market||text(row.fields?.['市场'])||'不适用',currency:raw.currency,value:number(raw.value,'市值'),cost,quantity:old?.quantity??null,unitPrice:old?.unitPrice??null,date:date(raw.date||old?.date||today()),note:old?.note??text(row.fields?.['备注'])};
  if(raw.classification.trim())asset.classification=raw.classification.trim();
  if(!netCostColumns&&row.fields?.['备注']!==undefined)asset.note=text(row.fields['备注']);
  if(proceeds!==null&&(!netCostColumns||old?.proceeds!==undefined||!same(proceeds,oldProceeds)))asset.proceeds=proceeds;
  if(old&&asset.currency!==old.currency)throw new Error(asset.name+'已有历史记录，请新增资产而不是修改币种');
  if(asset.category==='现金'||asset.proceeds!==undefined){asset.quantity=null;asset.unitPrice=null;}
  else if(old&&asset.value!==old.value&&asset.quantity)asset.unitPrice=Math.round(asset.value/asset.quantity*1e8)/1e8;
  const account=book.investments?.find(a=>a.assetId===id),realized=account?.realized??0;
  if(old&&raw.date===old.date&&['value','cost','proceeds','quantity','unitPrice'].some(k=>!same(old[k]??null,asset[k]??null))&&typeof row.last_modified_time==='number')asset.date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.last_modified_time));
  if(account)Object.assign(account,{...Object.fromEntries(['name','code','platform','category','currency'].filter(key=>!same(asset[key],old?.[key])).map(key=>[key,asset[key]])),...(asset.proceeds!==undefined?{invested:asset.cost??account.invested??0,proceeds:asset.proceeds}:{basis:asset.cost??account.basis}),realized,value:asset.value,quantity:asset.quantity,unitPrice:asset.unitPrice});
  return asset;
 });
 const priorRecords=new Map(recordEntries(archive).map(item=>[item.record.id,item]));
 const records=rows.records.filter(row=>text(row.fields?.['资产名称']).trim()&&(!isDraftRecord(row)||archive.records.some(record=>record.id===(text(row.fields?.['流水编号'])||'cloud-'+row.record_id)))).map(row=>{
  const raw=read(row,netCostColumns?recordFields:legacyRecordFields),id=raw.id||'cloud-'+row.record_id,old=archive.records.find(r=>r.id===id),prior=priorRecords.get(id);
  const assetId=raw.assetId||assets.find(a=>a.name===raw.name&&a.platform===raw.platform&&a.currency===raw.currency)?.id;
  const record={...(old??{}),id,assetId,name:raw.name,platform:raw.platform,currency:raw.currency,date:date(raw.date),type:netCostColumns&&prior?.label===raw.type?old.type:raw.type,note:old?.note??''};
  if(raw.classification?.trim())record.classification=raw.classification.trim();
  if(!record.assetId)throw new Error('飞书流水缺少资产编号');
  if(!netCostColumns){
   record.note=raw.note;for(const [key,label,type] of legacyRecordFields.filter(([, ,type])=>type===2)){const value=number(raw[key],label,!['before','after','amount'].includes(key),['amount','settlement','gain','settlementCny','gainCny'].includes(key));if(value!==null)record[key]=value;else delete record[key];}
   return record;
  }
  if(!['买入','卖出','更新','转入','消费','存入','取出','买入扣款','卖出到账','转账转入','转账转出'].includes(raw.type))throw new Error('飞书操作须为买卖、更新或有效现金操作');
  record.before=old?.before??0;record.after=number(raw.after,'市值');record.amount=round(record.after-record.before);
  const amount=number(raw.operationAmount,'金额',true),netCost=number(raw.netCost,'成本',true,true),proceeds=number(raw.proceeds,'累计卖出',true),rate=number(ratesAt(book,record.date)[record.currency],'汇率');
  if(rate<=0||rate>1e6||(record.currency==='CNY'&&rate!==1))throw new Error('飞书流水汇率无效');
  let financialChanged=!old;
  if(!prior||raw.type!==prior.label||!same(amount,prior.operationAmount)){
   if(raw.type==='更新')delete record.settlement;
   else{if(amount===null)throw new Error('飞书买入或卖出须填写金额');record.settlement=['买入','消费','取出','买入扣款','转账转出'].includes(raw.type)?-amount:amount;record.flowIn=record.settlement>0?amount:0;record.flowOut=record.settlement<0?amount:0;}
   financialChanged=true;
  }
  if(!prior||!same(netCost,prior.netCost)||!same(proceeds,prior.proceeds)){
   if(netCost!==null){record.invested=round(netCost+(proceeds??0));number(record.invested,'累计买入金额');record.proceeds=proceeds??0;record.gain=round(record.after-netCost);}
   financialChanged=true;
  }
  if(!prior||rate!==prior.exchangeRate){record.exchangeRate=rate;financialChanged=true;}
  if(old&&record.after!==old.after)financialChanged=true;
  if(financialChanged){record.exchangeRate=rate;stampRecord(book,record);}
  return record;
 });
 unique(assets,'id','资产');unique(records,'id','流水');
 const assetOrder=new Map(archive.assets.map((a,i)=>[a.id,i])),recordOrder=new Map(archive.records.map((r,i)=>[r.id,i]));
 assets.sort((a,b)=>(assetOrder.get(a.id)??Number.MAX_SAFE_INTEGER)-(assetOrder.get(b.id)??Number.MAX_SAFE_INTEGER));
 records.sort((a,b)=>(recordOrder.get(a.id)??-1)-(recordOrder.get(b.id)??-1));
 book.assets=assets;book.records=records;
 let changed=!same(book.rates,archive.rates),changeDate=book.rateDate||'';
 for(const asset of assets){const old=archive.assets.find(a=>a.id===asset.id);if(!old||['value','cost','proceeds','quantity','unitPrice'].some(k=>!same(old[k]??null,asset[k]??null))||(book.investments?.find(a=>a.assetId===asset.id)?.realized??0)!==(archive.investments?.find(a=>a.assetId===asset.id)?.realized??0)){
  changed=true;changeDate=asset.date>changeDate?asset.date:changeDate;const id='cloud-change-'+digest({asset,old,generation:archive.records.length}).slice(0,32);
  if(!records.some(r=>r.id===id))book.records.unshift({id,assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,date:asset.date,type:old?'飞书更新':'飞书录入',before:old?.value??0,after:asset.value,amount:round(asset.value-(old?.value??0)),note:'',costBasis:asset.cost??undefined});
 }}
 for(const old of archive.assets.filter(a=>!assets.some(v=>v.id===a.id))){
  const tracked=book.investments?.find(a=>a.assetId===old.id);if(tracked&&old.value!==0)throw new Error(old.name+'仍有持仓，请清仓后再移除飞书资产行');
  changed=true;changeDate=old.date>changeDate?old.date:changeDate;
  if(book.months?.length)book.closedAssets=[...(book.closedAssets??[]).filter(a=>a.id!==old.id),old];
  const id='cloud-remove-'+digest(old).slice(0,32);if(!records.some(r=>r.id===id))book.records.unshift({id,assetId:old.id,name:old.name,platform:old.platform,currency:old.currency,date:old.date,type:'移除资产',before:old.value,after:0,amount:-old.value,note:'飞书移除'});
 }
 if(changed){
  const latest=[changeDate,...book.snapshots.map(point=>point.date),...assets.map(asset=>asset.date)].sort().at(-1)||today();
  finalizeFinancialRecords(book,archive);capturePortfolio(book,latest);captureGains(book,latest);
 }
 return validateBook(book);
}
