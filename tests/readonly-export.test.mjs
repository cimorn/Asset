import test from 'node:test';
import assert from 'node:assert/strict';
import * as exporter from '../scripts/export-feishu-readonly.mjs';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createFeishuService} from '../server/feishu.mjs';
import {emptyBook} from '../server/runtime/finance.mjs';
import {digest} from '../server/mongo-ledger.mjs';
import {FeishuClient} from '../server/mydaily-client/feishu-client.mjs';
test('migration client rejects every remote write even through helper methods',async()=>{
 assert.equal(typeof exporter.readOnlyFeishuClient,'function','export transport must enforce read-only');
 let count=0;const client=exporter.readOnlyFeishuClient({async request(_endpoint,options){count++;return options;},async helper(){return this.request('/bitable/write',{method:'POST'});}});
 await client.request('/bitable/read',{});await assert.rejects(client.request('/bitable/write',{method:'POST'}),/禁止修改/);await assert.rejects(client.helper(),/禁止修改/);assert.equal(count,1);
});
test('real FeishuClient discovers paginated wiki nodes with GET-only business transport',async()=>{
 const calls=[],financeNode={title:'财务管理',obj_type:'bitable',obj_token:'test-table',node_token:'test-node',space_id:'test-space'};
 const transport=async(url,options)=>{
  const parsed=new URL(url);calls.push({path:parsed.pathname,method:options.method});
  if(parsed.pathname.endsWith('/auth/v3/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'synthetic-token',expire:7200});
  assert.equal(options.method,'GET','business API must stay read-only');
  let data;
  if(parsed.pathname.endsWith('/wiki/v2/spaces/get_node'))data={node:parsed.searchParams.get('token')==='test-node'?financeNode:{space_id:'test-space',node_token:'test-root',obj_type:'wiki'}};
  else if(parsed.pathname.endsWith('/wiki/v2/spaces/test-space/nodes'))data=parsed.searchParams.get('page_token')?{items:[],has_more:false}:{items:[financeNode],has_more:true,page_token:'next'};
  else if(parsed.pathname.endsWith('/bitable/v1/apps/test-table/tables'))data={items:[],has_more:false};
  else throw Error('Unexpected synthetic API path');
  return Response.json({code:0,data});
 };
 const real=new FeishuClient({appId:'synthetic-app',appSecret:'synthetic-secret',fetchImpl:transport}),client=exporter.readOnlyFeishuClient(real);
 assert.deepEqual(await client.listWikiNodes('test-space'),[financeNode]);
 const service=createFeishuService('',{volatile:true,clientFactory:async()=>({client,config:{appId:'synthetic-app',wikiRootToken:'test-root',tenantWebBaseUrl:'https://example.feishu.cn'}})});
 await assert.rejects(service.pull(),/数据表缺失/);
 const before=calls.length;
 await assert.rejects(client.createWikiNode('test-space',{title:'forbidden'}),/禁止修改/);
 await assert.rejects(client.appendParagraphs('test-doc','test-parent',['forbidden']),/禁止修改/);
 await assert.rejects(real.createDocument({title:'forbidden'}),/禁止修改/);
 await assert.rejects(client.request('/bitable/write',{method:'DELETE'}),/禁止修改/);
 assert.equal(calls.length,before,'blocked helpers must not reach the transport');
 assert.throws(()=>Object.defineProperty(real,'request',{value:()=>{}}),TypeError);
 assert.ok(calls.some(call=>call.path.endsWith('/bitable/v1/apps/test-table/tables')),'real discovery must reach table listing');
 assert.equal(calls.filter(call=>call.method==='POST').length,1,'only token authentication uses POST');
});
test('local exporter refuses NAS configuration before touching credentials or network',async()=>{
 await assert.rejects(exporter.exportFeishuReadOnly({environment:{NODE_ENV:'production'},output:'unused'}),/本机/);
 await assert.rejects(exporter.exportFeishuReadOnly({environment:{MONGODB_URI:'private'},output:'unused'}),/本机/);
});
test('deferred source and missing clean receipt are refused as migration snapshots',()=>{
 assert.equal(typeof exporter.verifyReadOnlySnapshot,'function','migration snapshot must require clean receipt');
 assert.throws(()=>exporter.verifyReadOnlySnapshot({book:emptyBook(),receipt:{warning:'pending'},status:{warning:'pending'}}),/完整/);
 assert.throws(()=>exporter.verifyReadOnlySnapshot({book:emptyBook(),status:{}}),/完整/);
 assert.equal(exporter.verifyReadOnlySnapshot({book:emptyBook(),receipt:{hash:digest(emptyBook())},status:{}}).assets.length,0);
});
test('volatile read-only Feishu connection does not persist application or table identities',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'asset-volatile-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const client={getWikiNode:async()=>({space_id:'test-space',obj_token:'test-table',obj_type:'bitable',node_token:'test-node'}),listWikiNodes:async()=>[{title:'财务管理',obj_type:'bitable',obj_token:'test-table',node_token:'test-node',space_id:'test-space'}],request:async()=>({items:[]})};
 const service=createFeishuService(dir,{volatile:true,clientFactory:async()=>({client,config:{appId:'test-app',wikiRootToken:'test-root',tenantWebBaseUrl:'https://example.feishu.cn'}})});
 await assert.rejects(service.pull(),/数据表缺失/);assert.deepEqual(await readdir(dir),[]);
 await assert.rejects(service.sync(emptyBook()),/只读/);assert.deepEqual(await readdir(dir),[]);
});
