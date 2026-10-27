import {useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Compass} from 'lucide-react';
import FinanceApp from '@/components/finance-app';
import {setAccount} from './cache';
import '@/app/globals.css';
import '@/app/finance.css';
import '@/app/connections.css';
import '@/app/refined.css';
import './web.css';

function Root(){
 const [user,setUser]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function session(){try{const res=await fetch('/api/session',{cache:'no-store'}),data=await res.json();if(!res.ok)throw Error();if(data.authenticated){setAccount(data.cacheNamespace??data.accountId,data);setUser(true);}}catch{setError('暂时无法连接服务器，请稍后重试。');}finally{setLoading(false);}}
 useEffect(()=>{void session();const expired=()=>{setUser(false);setAccount('');setError('登录已过期，请重新登录。浏览器草稿仍保留。');};window.addEventListener('atlas-session-expired',expired);return()=>window.removeEventListener('atlas-session-expired',expired);},[]);
 async function login(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:form.get('password')})}),data=await res.json();if(!res.ok)throw Error(data.error||'登录失败。');setAccount(data.cacheNamespace??data.accountId,data);setUser(true);}catch(e){setError((e as Error).message||'连接失败，请稍后重试。');}finally{setBusy(false);}
 }
 async function logout(){try{const res=await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!res.ok)throw Error();setAccount('');setUser(false);setError('');}catch{window.alert('退出失败，请恢复网络后重试。');}}
 if(user)return <FinanceApp onLogout={()=>void logout()}/>;
 return <main className="web-login"><section className="web-login-card"><div className="login-brand"><Compass size={30}/><span>资产罗盘</span></div>{loading?<p role="status">正在连接…</p>:<form onSubmit={login}><label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={512} disabled={busy}/>{error&&<p className="login-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?'正在登录…':'登录账本'}</button></form>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
