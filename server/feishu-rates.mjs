import {numericCell,isDraftRecord} from './feishu-ledger.mjs';

export const rateDateField='_汇率日期';
export const matchedDateField='_汇率生效日';
const enc=encodeURIComponent;
const fieldRef=(table,field)=>`bitable::$table[${table}].$field[${field}]`;
// Feishu resolves CurrentValue.[name] to CurrentValue.$column[id] after saving.
// Compare those references by ID without changing quoted text in the formula.
export function formulaMatches(field,expression,currentFields){
 const names=new Map(currentFields.map(f=>[f.field_id,f.field_name]));
 const normalize=value=>String(value??'').replace(/"(?:\\.|""|[^"\\])*"|CurrentValue\.\$column\[([^\]]+)\]|\s+/g,(token,id)=>id?(names.has(id)?`CurrentValue.[${names.get(id)}]`:token):token.startsWith('"')?token:'');
 return field?.type===20&&normalize(field.property?.formula_expression)===normalize(expression);
}
export function formulaProperty(field,expression,text=false,defaultFormatter){
 const property=field?.type===20?structuredClone(field.property??{}):{};
 const dataType=text?1:2,priorType=property.type?.data_type===dataType?property.type:{};
 const type={data_type:dataType,...(!text?{ui_type:'Number'}:{}),...priorType};
 const formatter=field?.type===2?field.property?.formatter:defaultFormatter;
 if(!text&&!type.ui_property&&formatter)type.ui_property={formatter};
 return {...property,formula_expression:expression,type};
}
export function rateDateFormula(tables,fields){
 const table=`bitable::$table[${tables.rates}]`,current=id=>`CurrentValue.[${id===fields.code?'币种代码':id===fields.dateKey?rateDateField:'兑人民币汇率'}]`;
 const currency=fieldRef(tables.records,fields.currency),date=`VALUE(SUBSTITUTE(${fieldRef(tables.records,fields.date)},"-",""))`;
 return `${table}.FILTER(AND(${current(fields.code)}=${currency},${current(fields.dateKey)}<=${date})).$field[${fields.dateKey}].MAX()`;
}
export function rateReferenceFormula(tables,fields){
 const table=`bitable::$table[${tables.rates}]`,current=id=>`CurrentValue.[${id===fields.code?'币种代码':id===fields.dateKey?rateDateField:'兑人民币汇率'}]`;
 return `${table}.FILTER(AND(${current(fields.code)}=${fieldRef(tables.records,fields.currency)},${current(fields.dateKey)}=${fieldRef(tables.records,fields.matchedDate)})).$field[${fields.rate}].SUM()`;
}
export async function ensureRateReference(client,c,{pageAll,backup}){
 const base=kind=>'/bitable/v1/apps/'+enc(c.appToken)+'/tables/'+enc(c.tables[kind]);
 const [rates,records]=await Promise.all([pageAll(client,base('rates')+'/fields'),pageAll(client,base('records')+'/fields')]);
 const find=(fields,name)=>{const field=fields.find(f=>f.field_name===name);if(!field?.field_id)throw new Error('飞书汇率引用字段缺失');return field;};
 async function formula(kind,field,name,expression){
  if(formulaMatches(field,expression,rates))return field;
  if(field?.is_primary||field&&!([2,20].includes(field.type)))throw new Error('飞书汇率引用字段类型不匹配');
  await backup('before-rate-reference',{table:kind,field:field??null});
  const endpoint=base(kind)+'/fields'+(field?'/'+enc(field.field_id):'');
  const result=await client.request(endpoint,{method:field?'PUT':'POST',body:{field_name:name,type:20,property:formulaProperty(field,expression,false,name==='汇率'?'0.0000':undefined)}});
  return result.field??find(await pageAll(client,base(kind)+'/fields'),name);
 }
 const dateField=find(rates,'生效日期');
 const dateKey=await formula('rates',rates.find(f=>f.field_name===rateDateField),rateDateField,`VALUE(SUBSTITUTE(${fieldRef(c.tables.rates,dateField.field_id)},"-",""))`);
 const references={currency:find(records,'币种').field_id,date:find(records,'日期').field_id,code:find(rates,'币种代码').field_id,dateKey:dateKey.field_id,rate:find(rates,'兑人民币汇率').field_id};
 const matchedDate=await formula('records',records.find(f=>f.field_name===matchedDateField),matchedDateField,rateDateFormula(c.tables,references));
 const expression=rateReferenceFormula(c.tables,{...references,matchedDate:matchedDate.field_id});
 await formula('records',records.find(f=>f.field_name==='汇率'),'汇率',expression);
 for(const [kind,helper] of [['rates',dateKey],['records',matchedDate]]){
  const views=await pageAll(client,base(kind)+'/views');
  for(const view of views.filter(v=>v.view_type==='grid')){
   const endpoint=base(kind)+'/views/'+enc(view.view_id),detail=await client.request(endpoint),hidden=detail.view?.property?.hidden_fields??[];
   if(hidden.includes(helper.field_id))continue;
   await client.request(endpoint,{method:'PATCH',body:{property:{hidden_fields:[...hidden,helper.field_id]}}});
  }
 }
}
export function verifyRateReferences(rows,book){
 const history=book.rateHistory?.length?book.rateHistory:[{date:book.rateDate,rates:book.rates}];
 for(const row of rows){
  const fields=row.fields??{},text=value=>Array.isArray(value)?value.map(v=>v.text??v.text_run?.content??'').join(''):String(value??''),currency=text(fields['币种']),date=text(fields['日期']);
  if(!text(fields['资产名称']).trim()||isDraftRecord(row))continue;
  if(!currency||!date)throw new Error('飞书流水缺少币种或日期');
  const point=history.filter(p=>p.date<=date).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const expected=point?.rates[currency],actual=numericCell(fields['汇率']);
  if(!expected||typeof actual!=='number'||Math.abs(actual-expected)>1e-10)throw new Error('飞书汇率引用尚未计算完成，请重新同步');
 }
}
