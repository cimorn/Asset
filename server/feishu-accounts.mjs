import {formulaMatches,formulaProperty} from './feishu-rates.mjs';
import {capitalAccounts,accountClassification} from './runtime/finance.mjs';
import {numericCell} from './feishu-ledger.mjs';
import {assetNetInputExpression} from './feishu-projection.mjs';
const enc=encodeURIComponent;
const ref=(table,id)=>`bitable::$table[${table}].$field[${id}]`;
const text=value=>Array.isArray(value)?value.map(v=>v.text??v.text_run?.content??'').join(''):String(value??'');

/** Native projections: every amount comes from ledger inputs, including balance checkpoints. */
export async function ensureAccountProjection(client,c,{pageAll,backup}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const kinds=['assets','records','accounts'];
 const fields=Object.fromEntries(await Promise.all(kinds.map(async kind=>[kind,await pageAll(client,base(kind)+'/fields')])));
 const hidden={assets:[],records:[],accounts:[]};
 const find=(kind,name)=>{const field=fields[kind].find(f=>f.field_name===name);if(!field?.field_id)throw Error('账户引用字段缺失：'+name);return field;};
 const r=name=>ref(c.tables.records,find('records',name).field_id),a=name=>ref(c.tables.assets,find('assets',name).field_id),account=name=>ref(c.tables.accounts,find('accounts',name).field_id);
 const current=name=>`CurrentValue.[${name}]`,ledger=`bitable::$table[${c.tables.records}]`,assets=`bitable::$table[${c.tables.assets}]`;
 async function formula(kind,name,expression,{hide=false,formatter='0.00',text=false}={}){
  let field=fields[kind].find(f=>f.field_name===name);
  if(!formulaMatches(field,expression,[...fields.records,...fields.assets])){
   if(field?.is_primary||field&&![1,2,20].includes(field.type))throw Error('账户公式字段类型不匹配：'+name);
   await backup('before-account-formula',{table:kind,field:field??null});
   const property=formulaProperty(field,expression,text,formatter);
   const result=await client.request(base(kind)+'/fields'+(field?'/'+enc(field.field_id):''),{method:field?'PUT':'POST',body:{field_name:name,type:20,property}});
   if(field)Object.assign(field,result.field??{type:20,property});else{field=result.field??(await pageAll(client,base(kind)+'/fields')).find(f=>f.field_name===name);fields[kind].push(field);}
  }
  if(hide)hidden[kind].push(field.field_id);
  return field.field_id;
 }
 const valid=`AND(NOT(ISBLANK(${current('资产名称')})),NOT(ISBLANK(${current('分类')})),NOT(ISBLANK(${current('平台')})),NOT(ISBLANK(${current('币种')})),NOT(ISBLANK(${current('日期')})),NOT(ISBLANK(${current('市值')})),NOT(ISBLANK(${current('操作')})))`;
 const sameAsset=`OR(AND(NOT(ISBLANK(${current('资产编号')})),NOT(ISBLANK(${r('资产编号')})),${current('资产编号')}=${r('资产编号')}),AND(OR(ISBLANK(${current('资产编号')}),ISBLANK(${r('资产编号')})),${['资产名称','平台','分类','币种'].map(name=>`${current(name)}=${r(name)}`).join(',')}))`;
 const matched=`AND(${valid},${sameAsset})`;
 const serial=find('records','_流水序号').field_id;
 const remaining=`${ledger}.FILTER(AND(${matched},${current('操作')}="剩余")).$field[${serial}].MAX()>0`;
 const isBalance=`OR(${r('分类')}="现金",${remaining})`;
 const incoming=['转入','存入','卖出到账','转账转入','买入'];
 const outgoing=['取出','消费','买入扣款','转账转出','卖出'];
 const inFilter=`OR(${incoming.map(name=>`${current('操作')}="${name}"`).join(',')},AND(${current('操作')}="剩余",${current('剩余方式')}="转入"))`,outFilter=`OR(${outgoing.map(name=>`${current('操作')}="${name}"`).join(',')},AND(${current('操作')}="剩余",OR(${current('剩余方式')}="转出",${current('剩余方式')}="消费")))`;
 const checkpoint=`AND(${matched},NOT(OR(${inFilter},${outFilter})))`;
 const numericDate=`IFERROR(VALUE(SUBSTITUTE(${current('日期')},"-","")),0)`,thisDate=`VALUE(SUBSTITUTE(${r('日期')},"-",""))`;
 const before=`OR(${numericDate}<${thisDate},AND(${numericDate}=${thisDate},${current('_流水序号')}<${r('_流水序号')}))`;
 const dateMax=`${ledger}.FILTER(AND(${checkpoint},${before})).$field[${find('records','日期').field_id}].MAP(VALUE(SUBSTITUTE(CurrentValue,"-",""))).MAX()`;
 await formula('records','_余额起点日期',`IF(ISBLANK(${dateMax}),0,${dateMax})`,{hide:true,formatter:'0'});
 const orderMax=`${ledger}.FILTER(AND(${checkpoint},${before},${numericDate}=${r('_余额起点日期')})).$field[${serial}].MAX()`;
 await formula('records','_余额起点序号',`IF(ISBLANK(${orderMax}),0,${orderMax})`,{hide:true,formatter:'0'});
 const opening=`${ledger}.FILTER(AND(${checkpoint},${before},${numericDate}=${r('_余额起点日期')},${current('_流水序号')}=${r('_余额起点序号')})).$field[${find('records','市值').field_id}].SUM()`;
 const since=`OR(${numericDate}>${r('_余额起点日期')},AND(${numericDate}=${r('_余额起点日期')},${current('_流水序号')}>${r('_余额起点序号')}))`;
 const sum=filter=>`${ledger}.FILTER(AND(${matched},${before},${since},${filter})).$field[${find('records','金额').field_id}].SUM()`;
 const previous=`(${opening}+${sum(inFilter)}-${sum(outFilter)})`;
 const operationIn=`OR(${incoming.map(name=>`${r('操作')}="${name}"`).join(',')},AND(${r('操作')}="剩余",${r('剩余方式')}="转入"))`,operationOut=`OR(${outgoing.map(name=>`${r('操作')}="${name}"`).join(',')},AND(${r('操作')}="剩余",OR(${r('剩余方式')}="转出",${r('剩余方式')}="消费")))`;
 const delta=`IF(AND(${r('操作')}="剩余",${r('剩余方式')}="更新市值"),0,IF(${operationIn},${r('金额')},IF(${operationOut},-${r('金额')},${r('市值')}-${previous})))`;
 const investment=`IF(${r('操作')}="买入",${r('金额')},IF(${r('操作')}="卖出",-${r('金额')},0))`;
 await formula('records','_账户投入',`IF(${isBalance},${delta},${investment})`,{hide:true});
 await formula('records','_账户人民币投入',`${r('_账户投入')}*${r('汇率')}`,{hide:true});
 await formula('assets','成本',assetNetInputExpression(c,fields));
 await formula('assets','收益',`${a('市值')}-${a('成本')}`);
 const linkedAsset=`OR(AND(NOT(ISBLANK(${r('资产编号')})),${current('资产编号')}=${r('资产编号')}),AND(ISBLANK(${r('资产编号')}),${['资产名称','平台','分类','币种'].map(name=>`${current(name)}=${r(name)}`).join(',')}))`;
 const assigned=`${assets}.FILTER(${linkedAsset}).$field[${find('assets','账户归属').field_id}].ARRAYJOIN("")`;
 const owner=`${assets}.FILTER(${linkedAsset}).$field[${find('assets','分类').field_id}].ARRAYJOIN("")`;
 await formula('records','_账户分类',`IF(AND(${owner}="现金",NOT(ISBLANK(${assigned}))),${assigned},IF(ISBLANK(${owner}),${r('分类')},${owner}))`,{hide:true,text:true});
 for(const name of ['平台','币种']){const value=`${assets}.FILTER(${linkedAsset}).$field[${find('assets',name).field_id}].ARRAYJOIN("")`;await formula('records','_账户'+name,`IF(ISBLANK(${value}),${r(name)},${value})`,{hide:true,text:true});}
 const sameAccount=`AND(${current('_账户平台')}=${account('平台')},${current('_账户分类')}=${account('分类')},${current('_账户币种')}=${account('币种')})`;
 const ledgerSum=name=>`${ledger}.FILTER(AND(${valid},${sameAccount})).$field[${find('records',name).field_id}].SUM()`;
 const assetAccount=`AND(${current('平台')}=${account('平台')},IF(AND(${current('分类')}="现金",NOT(ISBLANK(${current('账户归属')}))),${current('账户归属')},${current('分类')})=${account('分类')},${current('币种')}=${account('币种')})`;
 const assetSum=filter=>`${assets}.FILTER(AND(${assetAccount},${filter})).$field[${find('assets','市值').field_id}].SUM()`;
 await formula('accounts','投入成本',ledgerSum('_账户投入'));
 await formula('accounts','_人民币投入成本',ledgerSum('_账户人民币投入'),{hide:true});
 await formula('accounts','现金余额',assetSum(`${current('_余额账户')}=1`));
 await formula('accounts','持仓市值',assetSum(`${current('_余额账户')}=0`));
 await formula('accounts','账户总值',`${account('现金余额')}+${account('持仓市值')}`);
 await formula('accounts','收益',`${account('账户总值')}-${account('投入成本')}`);
 await formula('accounts','收益率',`IF(${account('投入成本')}>0,${account('收益')}/${account('投入成本')}*100,0)`);
 for(const kind of kinds)for(const view of (await pageAll(client,base(kind)+'/views')).filter(v=>v.view_type==='grid')){
  if(!hidden[kind].length)continue;
  const endpoint=base(kind)+'/views/'+enc(view.view_id),detail=await client.request(endpoint),prior=detail.view?.property?.hidden_fields??[];
  const wanted=[...new Set([...prior,...hidden[kind]])];if(wanted.length!==prior.length)await client.request(endpoint,{method:'PATCH',body:{property:{hidden_fields:wanted}}});
 }
}
export function verifyAccountProjection(rows,book){
 for(const account of capitalAccounts(book)){
  const row=rows.find(row=>text(row.fields?.['账户编号'])===account.key);if(!row)throw Error('飞书账户汇总缺失');
  const group=book.assets.filter(asset=>asset.platform===account.platform&&accountClassification(asset)===account.classification&&asset.currency===account.currency);
  const cash=group.filter(a=>a.category==='现金').reduce((sum,a)=>sum+a.value,0),holdings=group.filter(a=>a.category!=='现金').reduce((sum,a)=>sum+a.value,0),value=cash+holdings,gain=value-account.cost;
  for(const [name,expected] of [['投入成本',account.cost],['现金余额',cash],['持仓市值',holdings],['账户总值',value],['收益',gain],['收益率',account.cost>0?gain/account.cost*100:0],['_人民币投入成本',account.costCny]]){
   const actual=numericCell(row.fields[name]);if(actual===null||Math.abs(actual-expected)>.011)throw Error('飞书账户'+name+'公式尚未计算完成，请重新上传');
  }
 }
}
