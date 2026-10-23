import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/auth.mjs';
import {createWebServer} from '../server/server.mjs';
import {ledgerIdentity} from '../server/mongo-ledger.mjs';

const options={password:'web',secret:'local-test-secret-more-than-32-characters',accountId:'test-ledger'};

test('successful logins cannot reset the one-minute submission budget',async()=>{
 let time=0;const auth=await createAuth({...options,clock:()=>time});
 for(let i=0;i<10;i++)assert.equal((await auth.login({password:'web'},'client')).status,200);
 const blocked=await auth.login({password:'web'},'client');
 assert.equal(blocked.status,429);assert.equal(blocked.retryAfter,60);
 time=60000;assert.equal((await auth.login({password:'web'},'client')).status,200);
});

test('six failures suspend attempts for the remaining fifteen-minute window',async()=>{
 let time=0;const auth=await createAuth({...options,clock:()=>time});
 for(let i=0;i<6;i++)assert.equal((await auth.login({password:'wrong'},'client')).status,401);
 let blocked=await auth.login({password:'web'},'client');
 assert.equal(blocked.status,429);assert.equal(blocked.retryAfter,900);assert.equal(blocked.cookie,undefined);
 time=60000;blocked=await auth.login({password:'web'},'client');assert.equal(blocked.retryAfter,840);
 assert.equal((await auth.login({password:'web'},'another-client')).status,200);
 time=900000;assert.equal((await auth.login({password:'web'},'client')).status,200);
});

test('site-wide budget bounds attempts even when request addresses keep changing',async()=>{
 const auth=await createAuth({...options,clock:()=>0});
 for(let i=0;i<60;i++)assert.equal((await auth.login({},'client-'+i)).status,401);
 const blocked=await auth.login({password:'web'},'new-client');assert.equal(blocked.status,429);assert.equal(blocked.retryAfter,60);
});

test('admission happens before reading bodies and at most four requests are active',async()=>{
 const auth=await createAuth(options);let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const running=Array.from({length:4},(_,i)=>auth.login(async()=>{await gate;return {password:'web'};},'client-'+i));
 let read=false;
 const blocked=await auth.login(async()=>{read=true;return {};},'extra');
 assert.equal(blocked.status,429);assert.ok(blocked.retryAfter>0);assert.equal(read,false);
 release();assert.deepEqual((await Promise.all(running)).map(r=>r.status),[200,200,200,200]);
 assert.equal((await auth.login({password:'web'},'extra')).status,200);
});

test('malformed HTTP bodies consume failure quota; forwarded IP headers cannot bypass it',async t=>{
 const environment={APP_PASSWORD:'web',SESSION_SECRET:options.secret,LEDGER_INSTANCE_ID:'login-test'};
 const identity=ledgerIdentity(environment);let ledgerCalls=0;
 const service={identity,status:async()=>{ledgerCalls++;return {};},pull:async()=>{ledgerCalls++;return {};},sync:async()=>{ledgerCalls++;}};
 const server=await createWebServer({environment,service,staticDir:'.'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const request=(body,i)=>fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.'+i,'X-Real-IP':'198.51.100.'+i},body});
 const login=await request(JSON.stringify({password:'web'}),0),cookie=login.headers.get('set-cookie')?.split(';')[0];assert.equal(login.status,200);await login.text();assert.ok(cookie);
 for(let i=0;i<6;i++){const response=await request('{',i);assert.equal(response.status,400);await response.text();}
 const response=await request('{',100),data=await response.json();
 assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);assert.ok(data.retryAfter>0);assert.match(data.error,/秒/);
 assert.equal(response.headers.get('set-cookie'),null);assert.equal(ledgerCalls,0);
 const session=await fetch(origin+'/api/session');assert.equal(session.status,200);assert.equal((await session.json()).authenticated,false);
 const existing=await fetch(origin+'/api/session',{headers:{Cookie:cookie}});assert.equal(existing.status,200);assert.equal((await existing.json()).authenticated,true);
});
