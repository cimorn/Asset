import {numericCell} from './feishu-ledger.mjs';
import {investmentRows,assetFinancialRows} from './runtime/finance.mjs';
import {digest,same} from './feishu-merge.mjs';
import {formulaMatches,formulaProperty} from './feishu-rates.mjs';
import {randomUUID} from 'node:crypto';
const enc=encodeURIComponent;
const ref=(table,id)=>`bitable::$table[${table}].$field[${id}]`;
const cellText=value=>Array.isArray(value)?value.map(item=>item.text??item.text_run?.content??'').join(''):String(value??'');
const publicIdentity=fields=>['资产名称','平台','币种'].map(name=>cellText(fields[name]).trim());
const assetIdentity=fields=>[cellText(fields['资产名称']).trim(),cellText(fields['_关联平台']??fields['平台']).trim(),cellText(fields['_关联币种']??fields['币种']).trim()];
const assetKey=fields=>'ledger-'+digest([...publicIdentity(fields),cellText(fields['分类']).trim()]).slice(0,32);
const ledgerInputCells=fields=>Object.fromEntries(['资产名称','代码','平台','分类','币种','日期','操作','剩余方式','金额','市值','资产编号','流水编号'].map(name=>[name,['金额','市值'].includes(name)?numericCell(fields?.[name]):cellText(fields?.[name])]));
const ledgerVersion=rows=>digest(rows.map(row=>({id:row.record_id,inputs:ledgerInputCells(row.fields)})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));

function assetLedgerSelection(c,fields){
 const a=name=>ref(c.tables.assets,fields.assets.find(field=>field.field_name===name).field_id),current=name=>`CurrentValue.[${name}]`,table=`bitable::$table[${c.tables.records}]`;
 const metadata=`AND(${current('资产名称')}=${a('资产名称')},${current('平台')}=${a('_关联平台')},${current('币种')}=${a('_关联币种')})`;
 const identity=`OR(AND(NOT(ISBLANK(${current('资产编号')})),NOT(ISBLANK(${a('资产编号')})),${current('资产编号')}=${a('资产编号')}),AND(OR(ISBLANK(${current('资产编号')}),ISBLANK(${a('资产编号')})),${metadata}))`;
 const valid=`AND(NOT(ISBLANK(${current('日期')})),NOT(ISBLANK(${current('资产名称')})),NOT(ISBLANK(${current('分类')})),NOT(ISBLANK(${current('平台')})),NOT(ISBLANK(${current('币种')})),NOT(ISBLANK(${current('市值')})),OR(${current('操作')}="更新",${current('操作')}="剩余",AND(OR(${current('操作')}="买入",${current('操作')}="卖出",${current('操作')}="转入",${current('操作')}="消费",${current('操作')}="存入",${current('操作')}="取出",${current('操作')}="买入扣款",${current('操作')}="卖出到账",${current('操作')}="转账转入",${current('操作')}="转账转出"),NOT(ISBLANK(${current('金额')})))))`;
 return {table,match:`AND(${valid},${identity})`};
}
export function assetNetInputExpression(c,fields){
 const principal=fields.records.find(field=>field.field_name==='_账户投入');if(!principal)return null;
 const {table,match}=assetLedgerSelection(c,fields);return `${table}.FILTER(${match}).$field[${principal.field_id}].SUM()`;
}
/** Derive asset rows from ledger inputs; readonly pulls project the same result without cloud writes. */
export async function reconcileLedgerAssets(client,c,rows,source,{pageAll,backup,readOnly=false}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const prior=new Map(source.records.map(record=>[record.id,record]));
 const assets=structuredClone(rows.assets),creates=new Map(),updates=[],used=new Set(),latest=new Map(),processed=new Set();
 for(const row of rows.records){
  const f=row.fields,identity=publicIdentity(f),type=cellText(f['操作']),date=cellText(f['日期']);
  if(identity.some(value=>!value)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['买入','卖出','更新','剩余','转入','消费','存入','取出','买入扣款','卖出到账','转账转入','转账转出'].includes(type)||numericCell(f['市值'])===null||!['更新','剩余'].includes(type)&&numericCell(f['金额'])===null)continue;
  processed.add(row);
  let matches=assets.filter(asset=>same(assetIdentity(asset.fields),identity));
  const exact=matches.filter(asset=>(asset.classification??cellText(asset.fields['分类']))===cellText(f['分类']));
  if(exact.length||matches.length>1)matches=exact;
  else if(matches.length===1&&(matches[0].classification??cellText(matches[0].fields['分类']))&&cellText(matches[0].fields['资产编号'])!==cellText(f['资产编号']))matches=[];
  if(matches.length>1)throw new Error(identity[0]+' 存在多个同名、同平台、同币种资产，请先合并资产资料');
  const id=cellText(f['资产编号']),linked=assets.find(asset=>cellText(asset.fields['资产编号'])===id);
  const previous=prior.get(cellText(f['流水编号'])||'cloud-'+row.record_id);
  const oldAsset=[...source.assets,...source.closedAssets??[]].find(asset=>asset.id===id);
  const metadataChanged=previous&&same([previous.name,previous.platform,previous.currency],identity)&&linked&&(oldAsset?.currency===identity[2]||assetIdentity(linked.fields)[2]===identity[2]);
  const renamed=previous&&oldAsset&&linked&&previous.assetId===id&&oldAsset.platform===identity[1]&&oldAsset.currency===identity[2]&&oldAsset.classification===cellText(f['分类']);
  let asset=renamed?linked:matches[0]??(metadataChanged?linked:null);
  if(!asset){
   const classification=cellText(f['分类']).trim();
   if(!classification)throw new Error(identity[0]+' 的新资产须在流水中填写分类');

   const fields={'资产名称':identity[0],'_关联平台':identity[1],'_关联币种':identity[2],'资产编号':assetKey(f)};
   asset={fields,classification};assets.push(asset);creates.set(fields['资产编号'],asset);
  }
  const wanted=cellText(asset.fields['资产编号'])||'cloud-'+asset.record_id;
  used.add(asset);
  const last=latest.get(asset),order=numericCell(f['_流水序号'])??0;
  if(!last||date>last.date||date===last.date&&order>=last.order)latest.set(asset,{date,order,identity});
  if(id!==wanted)updates.push({record_id:row.record_id,fields:{'资产编号':wanted},before:f});
 }
 // Keep a row referenced by an unfinished input; do not discard data while the user is typing.
 for(const row of rows.records.filter(row=>!processed.has(row))){const id=cellText(row.fields['资产编号']);if(id)for(const asset of assets)if(cellText(asset.fields['资产编号'])===id)used.add(asset);}
 const deletes=assets.filter(asset=>asset.record_id&&!used.has(asset)&&cellText(asset.fields['资产名称']).trim());
 const metadataUpdates=[];
 for(const [asset,{identity}] of latest){
  const fields={'资产名称':identity[0],'_关联平台':identity[1],'_关联币种':identity[2]};
  if(asset.record_id&&!same(Object.keys(fields).map(name=>cellText(asset.fields[name])),Object.values(fields)))metadataUpdates.push({record_id:asset.record_id,fields,before:structuredClone(asset.fields)});
  Object.assign(asset.fields,fields);
 }
 const projectedAssets=assets.filter(asset=>!deletes.includes(asset));
 if(!creates.size&&!updates.length&&!deletes.length&&!metadataUpdates.length)return rows;
 if(readOnly){
  const patches=new Map(updates.map(update=>[update.record_id,update.fields]));
  return {...rows,assets:projectedAssets,records:rows.records.map(row=>patches.has(row.record_id)?{...row,fields:{...row.fields,...patches.get(row.record_id)}}:row)};
 }
 await backup('before-ledger-links',{assets:rows.assets,records:rows.records});
 const guard=async expected=>{const fresh=await pageAll(client,base('records')+'/records');if(ledgerVersion(fresh)!==ledgerVersion(expected))throw new Error('关联期间飞书流水被修改，已停止覆盖，请重试');return fresh;};
 await guard(rows.records);
 for(const asset of creates.values()){
  const hash=digest(asset.fields['资产编号']),token=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
  const create=clientToken=>client.request(base('assets')+'/records/batch_create',{method:'POST',query:{client_token:clientToken},body:{records:[{fields:asset.fields}]}});
  try{await create(token);}catch(error){
   if(Number(error.code)!==1254608)throw error;
   // A previously completed request token can outlive a deleted asset row.
   // Read back first so a completed but delayed response cannot create a duplicate.
   const fresh=await pageAll(client,base('assets')+'/records');
   const matches=fresh.filter(row=>same(assetIdentity(row.fields),assetIdentity(asset.fields)));
   if(matches.length>1)throw new Error('飞书中存在重复资产，已停止创建关联');
   if(!matches.length){await create(randomUUID());continue;}
   const wanted=cellText(matches[0].fields['资产编号'])||'cloud-'+matches[0].record_id;
   for(const update of updates)if(update.fields['资产编号']===asset.fields['资产编号'])update.fields['资产编号']=wanted;
  }
 }
 if(updates.length){
  await guard(rows.records);
  for(let offset=0;offset<updates.length;offset+=100)await client.request(base('records')+'/records/batch_update',{method:'POST',body:{records:updates.slice(offset,offset+100).map(({record_id,fields})=>({record_id,fields}))}});
 }
 if(metadataUpdates.length||deletes.length){
  const patches=new Map(updates.map(update=>[update.record_id,update.fields]));
  await guard(rows.records.map(row=>patches.has(row.record_id)?{...row,fields:{...row.fields,...patches.get(row.record_id)}}:row));
  const fresh=await pageAll(client,base('assets')+'/records');
  for(const change of [...metadataUpdates,...deletes.map(row=>({record_id:row.record_id,before:row.fields}))]){
   const fields=fresh.find(row=>row.record_id===change.record_id)?.fields;
   if(!fields||!same(['资产名称','_关联平台','_关联币种','资产编号'].map(name=>cellText(fields[name])),['资产名称','_关联平台','_关联币种','资产编号'].map(name=>cellText(change.before[name]))))throw new Error('修复期间飞书资产资料被修改，请重试');
  }
  for(let offset=0;offset<metadataUpdates.length;offset+=100)await client.request(base('assets')+'/records/batch_update',{method:'POST',body:{records:metadataUpdates.slice(offset,offset+100).map(({record_id,fields})=>({record_id,fields}))}});
  for(let offset=0;offset<deletes.length;offset+=100)await client.request(base('assets')+'/records/batch_delete',{method:'POST',body:{records:deletes.slice(offset,offset+100).map(row=>row.record_id)}});
 }
 return {...rows,assets:(await pageAll(client,base('assets')+'/records')).map(({record_id,fields,created_time,last_modified_time})=>({record_id,fields,created_time,last_modified_time})),records:(await pageAll(client,base('records')+'/records')).map(({record_id,fields,created_time,last_modified_time})=>({record_id,fields,created_time,last_modified_time}))};
}
export async function backfillLedgerMetadata(client,c,{pageAll,backup}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const fields=await pageAll(client,base('assets')+'/fields');
 for(const name of ['_关联平台','_关联币种'])if(!fields.some(field=>field.field_name===name)){
  const result=await client.request(base('assets')+'/fields',{method:'POST',body:{field_name:name,type:1}});fields.push(result.field??{field_name:name,type:1});
 }
 if(fields.find(field=>field.field_name==='分类')?.type===20)return;
 const [assets,records]=await Promise.all(['assets','records'].map(kind=>pageAll(client,base(kind)+'/records')));
 await backup('before-ledger-metadata',{assets:assets.map(({record_id,fields})=>({record_id,fields})),records:records.map(({record_id,fields})=>({record_id,fields}))});
 const assetsToUpdate=assets.map(row=>({record_id:row.record_id,fields:{'_关联平台':cellText(row.fields['平台']),'_关联币种':cellText(row.fields['币种'])}}));
 for(const [kind,updates] of [['assets',assetsToUpdate]])for(let offset=0;offset<updates.length;offset+=100)await client.request(base(kind)+'/records/batch_update',{method:'POST',body:{records:updates.slice(offset,offset+100)}});
}
export async function backfillLedgerCodes(client,c,{pageAll,backup}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const fields=await pageAll(client,base('assets')+'/fields');if(fields.find(field=>field.field_name==='代码')?.type===20)return;
 const [assets,records]=await Promise.all(['assets','records'].map(kind=>pageAll(client,base(kind)+'/records')));
 const updates=[];
 for(const row of records){
  if(cellText(row.fields['代码']).trim())continue;
  const id=cellText(row.fields['资产编号']);
  const matched=assets.filter(asset=>id?cellText(asset.fields['资产编号'])===id:['资产名称','平台','币种'].every(name=>cellText(asset.fields[name])===cellText(row.fields[name])));
  const code=matched.length===1?cellText(matched[0].fields['代码']):'';
  if(code)updates.push({record_id:row.record_id,fields:{'代码':code}});
 }
 if(!updates.length)return;await backup('before-ledger-code',{assets:assets.map(({record_id,fields})=>({record_id,fields})),records:records.map(({record_id,fields})=>({record_id,fields}))});
 for(let offset=0;offset<updates.length;offset+=100)await client.request(base('records')+'/records/batch_update',{method:'POST',body:{records:updates.slice(offset,offset+100)}});
}
export async function ensureLedgerProjection(client,c,{pageAll,backup}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const [assets,records]=await Promise.all(['assets','records'].map(kind=>pageAll(client,base(kind)+'/fields')));
 const fields={assets,records},helpers={assets:[],records:[]};
 const find=(kind,name)=>{const field=fields[kind].find(field=>field.field_name===name);if(!field)throw new Error('飞书财务字段缺失：'+name);return field;};
 async function formula(kind,name,expression,text=false,hidden=false){
  let field=fields[kind].find(field=>field.field_name===name);
  if(!formulaMatches(field,expression,records)){
   if(field?.is_primary||field&&![1,2,3,20].includes(field.type))throw new Error('飞书计算字段类型不匹配：'+name);
   await backup('before-ledger-formula',{table:kind,field:field??null});
   const property=formulaProperty(field,expression,text);
   const result=await client.request(base(kind)+'/fields'+(field?'/'+enc(field.field_id):''),{method:field?'PUT':'POST',body:{field_name:name,type:20,property}});
   if(field){Object.assign(field,result.field??{type:20,property});}else{field=result.field??(await pageAll(client,base(kind)+'/fields')).find(field=>field.field_name===name);fields[kind].push(field);}
  }
  if(hidden)helpers[kind].push(field.field_id);
  return field.field_id;
 }
 let serial=records.find(field=>field.field_name==='_流水序号');
 if(!serial){const result=await client.request(base('records')+'/fields',{method:'POST',body:{field_name:'_流水序号',type:1005,property:{auto_serial:{type:'auto_increment_number'}}}});serial=result.field??(await pageAll(client,base('records')+'/fields')).find(field=>field.field_name==='_流水序号');records.push(serial);}
 if(serial.type!==1005)throw new Error('飞书流水顺序字段类型不匹配');helpers.records.push(serial.field_id);
 const a=name=>ref(c.tables.assets,find('assets',name).field_id),current=name=>`CurrentValue.[${name}]`;
 const table=`bitable::$table[${c.tables.records}]`;
 const {match}=assetLedgerSelection(c,fields);
 const numericDate=`IFERROR(VALUE(SUBSTITUTE(${current('日期')},"-","")),0)`;
 const latestDate=await formula('assets','_最新流水日期',`${table}.FILTER(${match}).$field[${find('records','日期').field_id}].MAP(VALUE(SUBSTITUTE(CurrentValue,"-",""))).MAX()`,false,true);
 const latestOrder=await formula('assets','_最新流水序号',`${table}.FILTER(AND(${match},${numericDate}=${ref(c.tables.assets,latestDate)})).$field[${serial.field_id}].MAX()`,false,true);
 const cashIn=`OR(${['转入','存入','卖出到账','转账转入','买入'].map(name=>`${current('操作')}="${name}"`).join(',')},AND(${current('操作')}="剩余",${current('剩余方式')}="转入"))`;
 const cashOut=`OR(${['取出','消费','买入扣款','转账转出','卖出'].map(name=>`${current('操作')}="${name}"`).join(',')},AND(${current('操作')}="剩余",OR(${current('剩余方式')}="转出",${current('剩余方式')}="消费")))`;
 const checkpoint=`AND(${match},NOT(OR(${cashIn},${cashOut})))`;
 const dateMax=`${table}.FILTER(${checkpoint}).$field[${find('records','日期').field_id}].MAP(VALUE(SUBSTITUTE(CurrentValue,"-",""))).MAX()`;
 const cashDate=await formula('assets','_现金起点日期',`IF(ISBLANK(${dateMax}),0,${dateMax})`,false,true);
 const orderMax=`${table}.FILTER(AND(${checkpoint},${numericDate}=${ref(c.tables.assets,cashDate)})).$field[${serial.field_id}].MAX()`;
 const cashOrder=await formula('assets','_现金起点序号',`IF(ISBLANK(${orderMax}),0,${orderMax})`,false,true);
 const cashOpening=`${table}.FILTER(AND(${checkpoint},${numericDate}=${ref(c.tables.assets,cashDate)},${current('_流水序号')}=${ref(c.tables.assets,cashOrder)})).$field[${find('records','市值').field_id}].SUM()`;
 const since=`OR(${numericDate}>${ref(c.tables.assets,cashDate)},AND(${numericDate}=${ref(c.tables.assets,cashDate)},${current('_流水序号')}>${ref(c.tables.assets,cashOrder)}))`;
 const cashSum=direction=>`${table}.FILTER(AND(${match},${since},${direction})).$field[${find('records','金额').field_id}].SUM()`;
 const lastValue=`${table}.FILTER(AND(${match},${numericDate}=${ref(c.tables.assets,latestDate)},${current('_流水序号')}=${ref(c.tables.assets,latestOrder)})).$field[${find('records','市值').field_id}].SUM()`;
 await formula('assets','_余额账户',`IF(OR(${a('分类')}="现金",${table}.FILTER(AND(${match},${current('操作')}="剩余")).$field[${serial.field_id}].MAX()>0),1,0)`,false,true);
 await formula('assets','市值',`IF(${a('_余额账户')}=1,${cashOpening}+${cashSum(cashIn)}-${cashSum(cashOut)},${lastValue})`);
 for(const name of ['代码','平台','币种','分类'])await formula('assets',name,`${table}.FILTER(AND(${match},${numericDate}=${ref(c.tables.assets,latestDate)},${current('_流水序号')}=${ref(c.tables.assets,latestOrder)})).$field[${find('records',name).field_id}].ARRAYJOIN("")`,true);
 helpers.assets.push(find('assets','_关联平台').field_id,find('assets','_关联币种').field_id);
 const money=find('records','金额').field_id;
 const bought=`${table}.FILTER(AND(${match},${current('操作')}="买入")).$field[${money}].SUM()`;
 const sold=`${table}.FILTER(AND(${match},${current('操作')}="卖出")).$field[${money}].SUM()`;
 await formula('assets','成本',assetNetInputExpression(c,fields)??`IF(${a('_余额账户')}=1,0,${bought}-${sold})`);
 await formula('assets','收益',`${a('市值')}-${a('成本')}`);
 await formula('assets','累计卖出',`IF(${a('_余额账户')}=1,0,${sold})`);
 const d=ref(c.tables.assets,latestDate);
 await formula('assets','更新日期',`IF(${d}>0,CONCATENATE(LEFT(${d},4),"-",MID(${d},5,2),"-",RIGHT(${d},2)),"")`,true);
 for(const kind of ['assets','records'])for(const view of (await pageAll(client,base(kind)+'/views')).filter(view=>view.view_type==='grid')){
  const endpoint=base(kind)+'/views/'+enc(view.view_id),detail=await client.request(endpoint),hidden=detail.view?.property?.hidden_fields??[];
  const visible=kind==='assets'?new Set(['成本','收益'].map(name=>find('assets',name).field_id)):new Set(),compatibility=kind==='assets'?[find('assets','累计卖出').field_id]:[];
  const wanted=[...new Set([...hidden.filter(id=>!visible.has(id)),...helpers[kind],...compatibility])];if(!same(wanted,hidden))await client.request(endpoint,{method:'PATCH',body:{property:{hidden_fields:wanted}}});
 }
}
const text=value=>Array.isArray(value)?value.map(v=>v.text??v.text_run?.content??'').join(''):String(value??'');
export function verifyLedgerProjection(rows,book){
 const accounts=new Map(investmentRows(book).map(row=>[row.assetId,row]));
 const financials=new Map(assetFinancialRows(book).map(row=>[row.assetId,row]));
 const assertNumber=(actual,expected,label)=>{const value=numericCell(actual)??0;if(typeof value!=='number'||Math.abs(value-expected)>.00001)throw new Error('飞书'+label+'计算尚未完成，请重新同步');};
 for(const row of rows.assets){
  const asset=book.assets.find(asset=>asset.id===(text(row.fields['资产编号'])||'cloud-'+row.record_id));if(!asset)continue;
  const account=accounts.get(asset.id),financial=financials.get(asset.id);assertNumber(row.fields['市值'],asset.value,'资产市值');assertNumber(row.fields['成本'],financial?.netInput??0,'资产净投入');assertNumber(row.fields['收益'],financial?.gain??0,'资产收益');assertNumber(row.fields['累计卖出'],account?.proceeds??0,'累计卖出');
  if(text(row.fields['代码'])!==(asset.code??''))throw new Error('飞书资产代码引用尚未计算完成');
  for(const [name,key] of [['平台','platform'],['币种','currency'],['分类','classification']])if(text(row.fields[name])!==(asset[key]??''))throw new Error('飞书资产'+name+'引用尚未计算完成');
  if(book.records.some(record=>record.assetId===asset.id)&&text(row.fields['更新日期'])!==asset.date)throw new Error('飞书更新日期计算尚未完成');
 }
}
