import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {schemas,obsoleteFields,obsoleteTextFields,obsoleteFormulaFields,hiddenFields,fieldAliases,encodeRows,decodeRows,packBook,unpackBook,validateBook,numericCell,isDraftRecord} from './feishu-ledger.mjs';
import {digest,same} from './feishu-merge.mjs';
import {applyCachedDraft} from './feishu-cache.mjs';
import {ensureRateReference,verifyRateReferences} from './feishu-rates.mjs';
import {ensureAccountProjection,verifyAccountProjection} from './feishu-accounts.mjs';
import {ensureLedgerProjection,verifyLedgerProjection,backfillLedgerCodes,backfillLedgerMetadata,reconcileLedgerAssets} from './feishu-projection.mjs';
import {categories,defaultClassifications,fillClassifications,projectLedger,ledgerInputs,ensureCapitalAccounts} from './runtime/finance.mjs';
import {FeishuClient} from './mydaily-client/feishu-client.mjs';
import {createCredentialStore} from './credentials.mjs';
const enc=encodeURIComponent;
const text=v=>Array.isArray(v)?v.map(x=>x.text??x.text_run?.content??'').join(''):v==null?'':String(v);
const normalized=(row,schema)=>Object.fromEntries(schema.fields.filter(([, ,type])=>type!==20).map(([,name,type])=>[name,(type===1||type===3)?text(row?.fields?.[name]):numericCell(row?.fields?.[name])]));
const identity=(row,kind)=>kind==='rates'?(text(row.fields?.['生效日期'])?text(row.fields['生效日期'])+'/'+text(row.fields?.['币种代码']):text(row.fields?.['币种代码'])):text(row.fields?.[kind==='assets'?'资产编号':kind==='records'?'流水编号':kind==='accounts'?'账户编号':'存档名称'])||(['assets','records'].includes(kind)&&text(row.fields?.['资产名称'])?'cloud-'+row.record_id:'');
const obsoleteTypes=name=>name==='类别'?[1,3,20]:(obsoleteFormulaFields.has(name)?[2,20]:[obsoleteTextFields.has(name)?1:2]);
const fieldProperty=(type,name)=>type===2?{property:{formatter:name==='兑人民币汇率'?'0.0000':'0.00'}}:type===3?{property:{options:(name==='剩余方式'?['转入','转出','消费','更新市值']:name==='类别'?categories:defaultClassifications).map(name=>({name}))}}:{};
const fail=message=>Object.assign(new Error(message),{safe:true});
function errorFor(error){if(error?.safe)return error;const code=/^[A-Za-z0-9_-]{1,40}$/.test(String(error?.code??''))?String(error.code):'';return Object.assign(new Error('飞书请求失败'+(code?'（'+code+'）':'')+'，待上传缓存已保留。'),{safe:true,code:error?.code});}
export function createFeishuService(dataDir,{clientFactory,credentialStore=createCredentialStore()}={}){
 const file=name=>path.join(dataDir,name),connectionPath=file('feishu-connection.json');let active=false,clientPromise;
 async function readJson(target,fallback={}){try{return JSON.parse(await readFile(target,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw fail('同步配置无法读取，飞书缓存已保留。');}}
 async function persist(target,value){await mkdir(dataDir,{recursive:true});const temp=target+'.tmp';await writeFile(temp,JSON.stringify(value),'utf8');await rename(temp,target);}
 const connection=()=>readJson(connectionPath);
 async function configured(){return clientFactory?true:(await credentialStore.status()).configured;}
 async function configure(target){
  if(active)throw fail('正在同步，请稍后配置');
  await credentialStore.configure(target);clientPromise=undefined;
 }
 async function connectClient(){
  if(clientFactory)return clientFactory();clientPromise??=(async()=>{const config=await credentialStore.load();return {client:new FeishuClient({appId:config.appId,appSecret:config.appSecret,apiBaseUrl:config.apiBaseUrl,fetchImpl:(url,opts)=>fetch(url,{...opts,signal:AbortSignal.timeout(20000)})}),config};})();try{return await clientPromise;}catch(error){clientPromise=undefined;throw error;}
 }
 async function status(){const c=await connection(),credentialState=clientFactory?{configured:true,error:''}:await credentialStore.status();return {desktop:true,configured:credentialState.configured,linked:!!c.linked,url:c.url??null,target:c.url??'',lastSyncedAt:c.lastSyncedAt??null,lastPulledAt:c.lastPulledAt??null,dirty:false,syncing:active,error:credentialState.error||c.lastError||'',warning:c.readWarning??'',source:'feishu'};}
 async function pageAll(client,endpoint,query={}){const items=[];let pageToken;do{const data=await client.request(endpoint,{query:{...query,page_size:100,page_token:pageToken}});items.push(...(data.items??[]));pageToken=data.has_more?data.page_token:null;if(data.has_more&&!pageToken)throw fail('飞书返回了不完整的分页数据');if(items.length>50000)throw fail('飞书数据量超过账本容量');}while(pageToken);return items;}
 const tablePath=(c,id)=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(id);
 const getRows=async(client,c,id)=>(await pageAll(client,tablePath(c,id)+'/records',{automatic_fields:true})).map(({record_id,fields,created_time,last_modified_time})=>({record_id,fields,...(created_time!==undefined?{created_time}:{}),...(last_modified_time!==undefined?{last_modified_time}:{})}));
 async function resolve(target=''){
  const {client,config}=await connectClient(),anchor=await client.getWikiNode(config.wikiRootToken);let c=await connection();
  if(target&&target!==c.url){let token=target.trim(),kind='wiki';if(token.startsWith('http')){const url=new URL(token);if(url.origin!==new URL(config.tenantWebBaseUrl).origin||!/^\/(wiki|base)\/[A-Za-z0-9]+\/?$/.test(url.pathname))throw fail('请使用当前飞书租户的知识库或多维表格链接');kind=url.pathname.split('/')[1]==='base'?'bitable':'wiki';token=url.pathname.split('/')[2];}if(!/^[A-Za-z0-9]{10,80}$/.test(token))throw fail('飞书链接或节点 ID 无效');const node=await client.getWikiNode(token,kind);if(node.obj_type!=='bitable'||node.space_id!==anchor.space_id)throw fail('目标须为同一知识库中的多维表格');if(c.appToken&&c.appToken!==node.obj_token)throw fail('当前已有账本连接，请使用原账本链接，避免混用同步记录');c={...c,mode:'bitable-v2',appToken:node.obj_token,wikiToken:node.node_token,spaceId:node.space_id,url:config.tenantWebBaseUrl+'/wiki/'+node.node_token};}
  if(!c.appToken){const provision=await readJson(file('feishu-provision.json'));if(provision.appToken)c=provision;else{const queue=[null],matches=[];let count=0;while(queue.length){const parent=queue.shift(),nodes=await client.listWikiNodes(anchor.space_id,parent?{parentNodeToken:parent}:{});for(const n of nodes){if(n.title==='财务管理'&&n.obj_type==='bitable')matches.push(n);if(n.has_child)queue.push(n.node_token);}count+=nodes.length;if(count>500)throw fail('知识库页面过多，请指定文件链接');}if(matches.length!==1)throw fail(matches.length?'发现多个财务管理表格，请指定链接':'未找到财务管理多维表格');const node=matches[0];c={mode:'bitable-v2',appToken:node.obj_token,wikiToken:node.node_token,spaceId:node.space_id,url:config.tenantWebBaseUrl+'/wiki/'+node.node_token};}}
  const node=await client.getWikiNode(c.wikiToken);if(node.obj_token!==c.appToken||node.obj_type!=='bitable'||node.space_id!==anchor.space_id)throw fail('飞书连接身份或知识库位置发生变化');const fingerprint=createHash('sha256').update(config.appId).digest('hex').slice(0,12);if(c.appFingerprint&&c.appFingerprint!==fingerprint)throw fail('飞书应用身份发生变化，已停止同步');c.appFingerprint=fingerprint;c.deviceId??=randomUUID();c.mode='bitable-v2';await persist(connectionPath,c);return {client,c};
 }
 async function ensureSchema(client,c){
  let tables=await pageAll(client,'/bitable/v1/apps/'+enc(c.appToken)+'/tables');c.tables??={};
  for(const [kind,schema] of Object.entries(schemas)){
   const matches=tables.filter(t=>t.name===schema.name);if(matches.length>1)throw fail('飞书里有多个同名“'+schema.name+'”数据表');let table=matches[0];
   if(!table&&kind==='assets'){const defaults=tables.filter(t=>t.name==='数据表');if(defaults.length===1){const rows=await getRows(client,c,defaults[0].table_id);if(rows.every(r=>Object.values(r.fields??{}).every(v=>v==null||v===''||Array.isArray(v)&&!v.length))){table=defaults[0];await client.request(tablePath(c,table.table_id),{method:'PATCH',body:{name:schema.name}});table.name=schema.name;}}}
   if(!table){const result=await client.request('/bitable/v1/apps/'+enc(c.appToken)+'/tables',{method:'POST',body:{table:{name:schema.name,fields:schema.fields.filter(([, ,type])=>type!==20).map(([,name,type])=>({field_name:name,type,...fieldProperty(type,name)}))}}});table={table_id:result.table_id,name:schema.name};if(!table.table_id)throw fail('飞书数据表创建结果无法确认');tables.push(table);}c.tables[kind]=table.table_id;await persist(connectionPath,c);
   const fields=await pageAll(client,tablePath(c,table.table_id)+'/fields');
   for(const [name,oldNames] of Object.entries(fieldAliases[kind]??{})){
    const old=fields.find(f=>oldNames.includes(f.field_name)),existing=fields.find(f=>f.field_name===name),oldName=old?.field_name;
    if(!old)continue;if(existing)throw fail('飞书同时存在“'+oldName+'”和“'+name+'”，已停止覆盖');
    const type=schema.fields.find(([,n])=>n===name)?.[2];if(old.is_primary||(type===20?![2,20].includes(old.type):old.type!==type)||!old.field_id)throw fail('飞书旧字段“'+oldName+'”结构不匹配');
    await backup('before-field-rename',{table:schema.name,fields,rows:await getRows(client,c,table.table_id)});
    await client.request(tablePath(c,table.table_id)+'/fields/'+enc(old.field_id),{method:'PUT',body:{field_name:name,type:old.type,...(old.property?{property:old.property}:{})}});old.field_name=name;
   }
   for(const [,name,type] of schema.fields){if(type===20)continue;const existing=fields.find(f=>f.field_name===name);if(existing){const selectInput=type===1&&['平台','币种','操作','类别'].includes(name)&&existing.type===3;if(existing.type!==type&&!selectInput)throw fail('飞书字段“'+name+'”类型不匹配');continue;}const primary=fields.find(f=>f.is_primary);if(name===schema.fields[0][1]&&primary?.field_name==='文本'){await client.request(tablePath(c,table.table_id)+'/fields/'+enc(primary.field_id),{method:'PUT',body:{field_name:name,type}});primary.field_name=name;}else await client.request(tablePath(c,table.table_id)+'/fields',{method:'POST',body:{field_name:name,type,...fieldProperty(type,name)}});}
  }await ensureRateReference(client,c,{pageAll,backup});await backfillLedgerCodes(client,c,{pageAll,backup});await backfillLedgerMetadata(client,c,{pageAll,backup});await ensureLedgerProjection(client,c,{pageAll,backup});await ensureAccountProjection(client,c,{pageAll,backup});return c;
 }
 async function ensureClassificationOptions(client,c,wanted){
  for(const kind of ['assets','records']){
   const endpoint=tablePath(c,c.tables[kind])+'/fields',fields=await pageAll(client,endpoint);
   if(kind==='records'&&fields.find(field=>field.field_name==='分类')?.type!==3)throw fail('飞书分类字段类型不匹配');
   const inputs=new Set(schemas[kind].fields.filter(([, ,type])=>type===1||type===3).map(([,name])=>name));
   for(const field of fields.filter(field=>field.type===3&&inputs.has(field.field_name))){
    const options=field.property?.options??[],names=new Set(options.map(option=>option.name)),missing=[...new Set(wanted[kind].map(row=>row.fields[field.field_name]))].filter(name=>name&&!names.has(name));
    if(!missing.length)continue;
    await client.request(endpoint+'/'+enc(field.field_id),{method:'PUT',body:{field_name:field.field_name,type:3,property:{...field.property,options:[...options,...missing.map(name=>({name}))]}}});
   }
  }
 }
 async function removeObsoleteFields(client,c){
  for(const [kind,names] of Object.entries(obsoleteFields)){
   const endpoint=tablePath(c,c.tables[kind])+'/fields',fields=await pageAll(client,endpoint),obsolete=fields.filter(f=>names.includes(f.field_name));
   if(!obsolete.length)continue;
   if(obsolete.some(f=>f.is_primary||!(obsoleteTypes(f.field_name).includes(f.type))||!f.field_id))throw fail('飞书旧字段结构不匹配，已停止清理');
   await backup('before-field-cleanup',{table:schemas[kind].name,fields,rows:await getRows(client,c,c.tables[kind])});
   for(const field of obsolete){
    const fresh=(await pageAll(client,endpoint)).find(f=>f.field_id===field.field_id);if(!fresh)continue;
    if(fresh.field_name!==field.field_name||fresh.is_primary||!(obsoleteTypes(fresh.field_name).includes(fresh.type)))throw fail('清理期间飞书字段发生变化，已停止删除');
    await client.request(endpoint+'/'+enc(field.field_id),{method:'DELETE'});
   }
   if((await pageAll(client,endpoint)).some(f=>names.includes(f.field_name)))throw fail('飞书旧字段清理未完成，请重新同步');
  }
 }
 async function simplifyViews(client,c){
  if(c.viewSchemaVersion===6)return;
  for(const [kind,names] of Object.entries(hiddenFields)){
   const base=tablePath(c,c.tables[kind]),fields=await pageAll(client,base+'/fields'),views=await pageAll(client,base+'/views');
   const view=views.find(v=>v.view_type==='grid');if(!view)continue;
   const detail=await client.request(base+'/views/'+enc(view.view_id)),property=detail.view?.property??{};
   const hidden=[...new Set([...(property.hidden_fields??[]),...fields.filter(f=>names.includes(f.field_name)).map(f=>f.field_id)])];
   await backup('before-view-simplify',{table:schemas[kind].name,view:detail.view});
   await client.request(base+'/views/'+enc(view.view_id),{method:'PATCH',body:{property:{hidden_fields:hidden}}});
   const verify=await client.request(base+'/views/'+enc(view.view_id));if(hidden.some(id=>!verify.view?.property?.hidden_fields?.includes(id)))throw fail('飞书内部编号隐藏未完成');
  }
  c.viewSchemaVersion=6;await persist(connectionPath,c);
 }
 function uploadMessage(marker,c){
  const stamp=Date.parse(marker.heartbeatAt??marker.startedAt),old=!Number.isFinite(stamp)||Date.now()-stamp>10*60*1000;
  if(old)return marker.device===c.deviceId?'上次上传未完成，点击上传可继续':'上次上传未完成，请在发起上传的设备上重试上传';
  return marker.device===c.deviceId?'本机上次上传尚未完成，点击上传可继续':'另一台设备正在上传，请稍后上传';
 }
 async function readRemote(client,c,{allowWriting=false,decodeWriting=false,cachedBook,readOnly=false}={}){
  let rows=Object.fromEntries(await Promise.all(Object.entries(c.tables).map(async([kind,id])=>[kind,await getRows(client,c,id)]))),archive=rows.archive??[],find=key=>archive.find(r=>text(r.fields?.['存档名称'])===key);let marker={};try{marker=JSON.parse(text(find('同步状态')?.fields?.['数据'])||'{}');}catch{throw fail('飞书同步状态数据无效');}
  if(allowWriting&&marker.phase==='writing'&&!decodeWriting)return {book:null,rows,hash:null,marker};
  const manifestRow=find('账本清单');if(!manifestRow){if(!(allowWriting&&marker.phase==='writing')&&(rows.assets.some(r=>text(r.fields?.['资产名称']).trim())||rows.records.some(r=>text(r.fields?.['资产名称']).trim())||rows.rates.some(r=>text(r.fields?.['币种代码']).trim())))throw fail('现有表格已有数据，但缺少完整账本存档；已停止覆盖');return {book:null,rows,hash:null,marker};}
  let manifest;try{manifest=JSON.parse(text(manifestRow.fields?.['数据']));}catch{throw fail('飞书账本清单格式无效');}if(manifest.format!=='finance-atlas-v2'||!Number.isInteger(manifest.parts)||manifest.parts<1||manifest.parts>500)throw fail('飞书账本存档格式无效');const parts=Array.from({length:manifest.parts},(_,i)=>text(find(manifest.generation+'/'+String(i+1).padStart(3,'0'))?.fields?.['数据']));if(parts.some(p=>!p))throw fail('飞书账本存档分片缺失');let source,book;try{source=unpackBook(parts);if(digest(source)!==manifest.hash)throw fail('飞书账本存档校验未通过');
   // Never expose half-written tables. Keep the local book, or use the last verified archive on a new device.
   if(marker.phase==='writing'&&!allowWriting){
    const after=await getRows(client,c,c.tables.archive);
    if(!same(normalized(manifestRow,schemas.archive),normalized(after.find(r=>text(r.fields?.['存档名称'])==='账本清单'),schemas.archive)))throw fail('飞书正在更新，已保留飞书缓存，稍后自动重试');
    return {book:source,rows,hash:digest(source),marker,deferred:true};
   }
   rows=await reconcileLedgerAssets(client,c,rows,source,{pageAll,backup,readOnly});book=decodeRows(rows,source,{netCostColumns:manifest.columnsVersion>=3,ledgerAuthority:true});}catch(e){throw fail(e.message);}
  if(cachedBook&&!book.ledgerAuthority){const derived=cachedBook.records.filter(r=>/^cloud-(change|remove)-/.test(r.id)&&!source.records.some(v=>v.id===r.id)&&!book.records.some(v=>v.id===r.id)),derivedDates=new Set(derived.map(r=>r.date));book.records.push(...derived);for(const point of cachedBook.snapshots??[])if(derivedDates.has(point.date)&&!book.snapshots.some(v=>v.date===point.date))book.snapshots.push(point);for(const point of cachedBook.gainSnapshots??[])if(derivedDates.has(point.date)&&!book.gainSnapshots?.some(v=>v.date===point.date))book.gainSnapshots=[...(book.gainSnapshots??[]),point];book.snapshots.sort((a,b)=>a.date.localeCompare(b.date));book.gainSnapshots?.sort((a,b)=>a.date.localeCompare(b.date));const order=new Map(source.records.map((r,i)=>[r.id,i]));book.records.sort((a,b)=>(order.get(a.id)??-1)-(order.get(b.id)??-1));}
  const after=await getRows(client,c,c.tables.archive);if(!same(normalized(manifestRow,schemas.archive),normalized(after.find(r=>text(r.fields?.['存档名称'])==='账本清单'),schemas.archive)))throw fail('飞书正在更新，请稍后重试');const afterMarker=after.find(r=>text(r.fields?.['存档名称'])==='同步状态');if(!allowWriting&&JSON.parse(text(afterMarker?.fields?.['数据'])||'{}').phase==='writing')throw fail('飞书正在同步，请稍后重试');return {book,rows,hash:digest(book),marker};
 }
 async function backup(label,value){const directory=file('feishu-backups');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,label+'-'+Date.now()+'.json'),JSON.stringify(value),'utf8');}
 function mergeUpload(local,remote,baseBook){try{return validateBook(remote.book?applyCachedDraft(baseBook??remote.book,local,remote.book):projectLedger(local));}catch(error){throw fail(error.message);}}
 async function upsert(client,c,kind,wanted,{before,retain=false}={}){
  const schema=schemas[kind],existing=await getRows(client,c,c.tables[kind]),endpoint=tablePath(c,c.tables[kind])+'/records',named=existing.filter(r=>identity(r,kind)),map=new Map(named.map(r=>[identity(r,kind),r]));if(map.size!==named.length)throw fail('飞书'+schema.name+'存在重复编号');const desired=new Map(wanted.map(r=>[identity(r,kind),r]));
  if(before){const old=new Map(before.filter(r=>identity(r,kind)).map(r=>[identity(r,kind),r]));for(const row of named){const key=identity(row,kind),prior=old.get(key),planned=desired.get(key);if(!same(normalized(row,schema),normalized(prior,schema))&&!same(normalized(row,schema),normalized(planned,schema)))throw fail('上传期间飞书'+schema.name+'被修改，已停止覆盖');}for(const [key] of old)if(!map.has(key)&&desired.has(key))throw fail('上传期间飞书行被删除，已停止覆盖');}
  const blank=existing.filter(r=>!identity(r,kind)&&Object.values(r.fields??{}).every(v=>v==null||v===''||Array.isArray(v)&&!v.length)),updates=[],creates=[],deletes=[];for(const [key,row] of desired){const old=map.get(key)??blank.shift();if(old){if(!same(normalized(old,schema),normalized(row,schema)))updates.push({record_id:old.record_id,fields:row.fields});}else creates.push({fields:row.fields});}if(!retain)for(const [key,row] of map)if(!desired.has(key)&&!(kind==='records'&&isDraftRecord(row))&&!(kind==='assets'&&!text(row.fields['币种'])))deletes.push(row.record_id);
  for(let i=0;i<updates.length;i+=100)await client.request(endpoint+'/batch_update',{method:'POST',body:{records:updates.slice(i,i+100)}});if(kind==='records')creates.reverse();for(let i=0;i<creates.length;i+=100){const hash=digest(creates.slice(i,i+100)),token=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);await client.request(endpoint+'/batch_create',{method:'POST',query:{client_token:token},body:{records:creates.slice(i,i+100)}});}for(let i=0;i<deletes.length;i+=100)await client.request(endpoint+'/batch_delete',{method:'POST',body:{records:deletes.slice(i,i+100)}});
 }
 async function sync(book,target='',{baseBook,prepareOnly=false,recovery}={}){
  if(active)throw fail('正在同步，请稍后');active=true;let c;
  try{const resolved=await resolve(target),client=resolved.client;c=await ensureSchema(client,resolved.c);if(recovery){if(recovery.appToken!==c.appToken)throw fail('上传恢复记录属于其他账本');c.deviceId=recovery.deviceId;}else if(prepareOnly)c.deviceId=randomUUID();await persist(connectionPath,c);const pendingPath=file('feishu-upload.json'),pending=recovery??await readJson(pendingPath);const remote=await readRemote(client,c,{allowWriting:true,cachedBook:book});if(remote.marker.phase==='writing'&&remote.marker.device!==c.deviceId)throw fail(uploadMessage(remote.marker,c));let merged,before;
   if(remote.marker.phase==='writing'){if(!pending.book||pending.appToken!==c.appToken)throw fail('未找到未完成上传的本机备份，已停止覆盖');const latest=await readRemote(client,c,{allowWriting:true,decodeWriting:true,cachedBook:book});const recoveryBase=decodeRows(pending.before,pending.book,{ledgerAuthority:true});merged=applyCachedDraft(baseBook??recoveryBase,book,latest.book);before=latest.rows;await backup('before-upload-resume',{book,remote:latest.rows});await persist(pendingPath,{appToken:c.appToken,book:merged,before});}else{merged=mergeUpload(book,remote,baseBook);before=remote.rows;await backup('before-upload',{book,remote:remote.rows});await persist(pendingPath,{appToken:c.appToken,book:merged,before});}
   merged=projectLedger(fillClassifications(merged));ensureCapitalAccounts(merged);validateBook(merged);if(prepareOnly)return {prepared:{appToken:c.appToken,deviceId:c.deviceId,book:merged,before}};const parts=packBook(merged),generation=digest(merged).slice(0,24),archiveRows=parts.map((data,i)=>({fields:{'存档名称':generation+'/'+String(i+1).padStart(3,'0'),'数据':data}}));await upsert(client,c,'archive',[{fields:{'存档名称':'同步状态','数据':JSON.stringify({phase:'writing',device:c.deviceId,startedAt:new Date().toISOString()})}},...archiveRows],{retain:true});const wanted=encodeRows(merged);await ensureClassificationOptions(client,c,wanted);for(const kind of ['rates','assets','records','accounts'])await upsert(client,c,kind,wanted[kind],{before:before[kind]});const updatedAt=new Date().toISOString();await upsert(client,c,'archive',[{fields:{'存档名称':'账本清单','数据':JSON.stringify({format:'finance-atlas-v2',columnsVersion:7,generation,parts:parts.length,hash:digest(merged),updatedAt})}}],{retain:true});const verify=await readRemote(client,c,{allowWriting:true,decodeWriting:true,cachedBook:merged});if(!same(encodeRows(verify.book),encodeRows(merged)))throw fail('飞书流水回读核对未通过，待上传缓存已保留');merged=verify.book;for(let attempt=0;;attempt++){try{const check=attempt?{assets:await getRows(client,c,c.tables.assets),records:await getRows(client,c,c.tables.records),accounts:await getRows(client,c,c.tables.accounts)}:verify.rows;verifyRateReferences(check.records,merged);verifyLedgerProjection(check,merged);verifyAccountProjection(check.accounts,merged);break;}catch(error){if(attempt>=4)throw fail(error.message);await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}await removeObsoleteFields(client,c);await simplifyViews(client,c);await upsert(client,c,'archive',[{fields:{'存档名称':'同步状态','数据':JSON.stringify({phase:'ready',updatedAt})}}],{retain:true});c.linked=true;c.lastError='';c.readWarning='';c.conflicts=[];delete c.conflictHash;await persist(connectionPath,c);
   return {book:merged,receipt:{book:merged,hash:digest(merged),uploaded:true,at:updatedAt},status:await status()};
  }catch(e){const error=errorFor(e);if(c){c=await connection();c.lastError=error.message;await persist(connectionPath,c);}throw error;}finally{active=false;}
 }
 async function pull(cachedBook,{target=''}={}){
  if(active)return {book:cachedBook,status:await status()};
  if(!await configured())return {book:cachedBook,status:await status()};
  active=true;
  try{
   const {client,c}=await resolve(target);
   if(!c.tables){const tables=await pageAll(client,'/bitable/v1/apps/'+enc(c.appToken)+'/tables');c.tables=Object.fromEntries(Object.entries(schemas).map(([kind,schema])=>{const table=tables.find(table=>table.name===schema.name);if(!table)throw fail('飞书账本数据表缺失');return [kind,table.table_id];}));}
   const remote=await readRemote(client,c,{cachedBook,readOnly:true});
   if(!remote.book)throw fail('飞书尚无可读取的完整数据');
   const hasCache=!!(cachedBook?.initialized||cachedBook?.assets.length||cachedBook?.records.length);
   const book=remote.deferred&&hasCache?cachedBook:projectLedger(remote.book);
   const warning=remote.deferred?uploadMessage(remote.marker,c)+'；已显示'+(hasCache?'飞书缓存':'上次完整账本')+'，稍后自动重试读取。':'';
   c.linked=true;c.lastError='';c.readWarning=warning;c.conflicts=[];delete c.conflictHash;await persist(connectionPath,c);
   return {book,...(remote.deferred&&hasCache?{}:{receipt:{book,hash:digest(book),uploaded:false,at:new Date().toISOString(),warning}}),status:await status()};
  }catch(e){const error=errorFor(e),c=await connection();c.lastError=error.message;await persist(connectionPath,c);throw error;}finally{active=false;}
 }
 async function accept(receipt){if(!receipt)return;const c=await connection();c.remoteHash=receipt.hash;c.lastPulledAt=receipt.at;if(receipt.uploaded)c.lastSyncedAt=receipt.at;c.lastError='';c.readWarning=receipt.warning??'';c.conflicts=[];delete c.conflictHash;await persist(connectionPath,c);if(receipt.uploaded)await rm(file('feishu-upload.json'),{force:true});}
 return {status,sync,pull,accept,configure};
}

