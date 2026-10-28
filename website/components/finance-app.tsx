'use client';
import ClassificationForm from './finance-classification';
import FinancePageMotion from './finance-page-motion';
import RecordEditForm from './finance-record-edit';
import {useState,useEffect,useRef,useMemo} from 'react';
import {financeRequest as fetch,exportBrowserCaches} from '@/src/cache';
import type {RateDraft} from '@/lib/exchange';
import {Compass,LayoutDashboard,Wallet,History,Settings2,Plus,Download,ShieldCheck,Eye,EyeOff,Upload,RefreshCw,Globe2,Building2,Cloud} from 'lucide-react';
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger} from '@/components/ui/sidebar';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Toaster} from '@/components/ui/sonner';
import {toast} from 'sonner';
import {type Book,type Asset,type Action,emptyBook,csvExport,total,today} from '@/lib/finance';
import {CurrencySelect} from './finance-dashboard';
import Overview from './finance-overview';
import {AssetForm,ImportForm} from './finance-forms';
import {AssetView,RecordView,SettingsView} from './finance-views';
import {GroupedAssetView} from './finance-asset-list';
import IconForm from './finance-icon-form';
import TradeForm from './finance-trade';
import InvestmentWorkspace from './finance-investments';
import UpdateDates from './finance-update-dates';
import {assetUpdateHistory,type UpdateStatus} from '@/lib/asset-update-dates';
import {FeishuConnection,type FeishuStatus} from './finance-connections';

const navigation=[['overview','资产总览',LayoutDashboard],['assets','全部资产',Wallet],['currencies','币种分布',Globe2],['platforms','平台账户',Building2],['records','流水明细',History]] as const;
function download(name:string,text:string,type:string){const url=URL.createObjectURL(new Blob([text],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export default function FinanceApp({onLogout}:{onLogout:()=>void}){
 const [book,setBook]=useState<Book>(emptyBook),[version,setVersion]=useState(0),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[signIn,setSignIn]=useState('');
 const [sidebarOpenMobile,setSidebarOpenMobile]=useState(false);
 const [page,setPage]=useState('overview'),[assetTab,setAssetTab]=useState('holdings'),[base,setBase]=useState('CNY'),[hidden,setHidden]=useState(false);
 const [updateFilter,setUpdateFilter]=useState<{date:string;status:UpdateStatus}>({date:'',status:'all'});
 const updateHistory=useMemo(()=>assetUpdateHistory(book),[book]);
 const updateDate=updateHistory.dates.includes(updateFilter.date)?updateFilter.date:updateHistory.dates[0]??'';

 const [modal,setModal]=useState<'asset'|'import'|'trade'|'classify'|'record'|null>(null),[editing,setEditing]=useState<Asset|undefined>(),[remove,setRemove]=useState<Asset|null>(null),[iconAsset,setIconAsset]=useState<Asset|null>(null);
 const [editingRecord,setEditingRecord]=useState<string|null>(null);
 const [sync,setSync]=useState<FeishuStatus>({});
 const [saveError,setSaveError]=useState(''),[saveState,setSaveState]=useState<'idle'|'saving'|'saved'|'failed'>('idle');
 const lock=useRef(false),live=useRef({book,base});live.current={book,base};
 const view=useRef({version,page,modal,iconAsset,remove,ready});view.current={version,page,modal,iconAsset,remove,ready};
 const loadSequence=useRef(0),loading=useRef(false);
 const [rateDraft,setRateDraft]=useState<RateDraft|null>(null);
 const draftHydrated=useRef(false),draftWrites=useRef<Promise<boolean>>(Promise.resolve(true));
 function changeRateDraft(draft:RateDraft){
  const shownVersion=version;
  setRateDraft(draft);
  draftWrites.current=draftWrites.current.then(async()=>{try{const response=await fetch('/api/rate-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:shownVersion,draft})});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error||'汇率输入缓存失败');return true;}catch(error){toast.error((error as Error).message);return false;}});
 }

 async function load(initial=false,remote=false,quiet=false){
  if(loading.current||quiet&&lock.current)return;loading.current=true;const sequence=++loadSequence.current;
  try{
   const response=await fetch('/api/book'+(remote?'?refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(remote?90000:15000)}),result=await response.json() as {book:Book;version:number;ready?:boolean;rateDraft?:RateDraft|null;sync?:FeishuStatus;error?:string;signIn?:string};
   if(!response.ok){if(result.signIn)setSignIn(result.signIn);throw new Error(result.error||'账本加载失败');}
   if(sequence!==loadSequence.current||result.version<view.current.version)return;
   if(result.sync)setSync(result.sync);
   if(!draftHydrated.current){setRateDraft(result.rateDraft??null);draftHydrated.current=true;}
   if(result.ready===false){setReady(false);setLoadError('');return;}
   setLoadError('');setSignIn('');
   if(quiet&&view.current.ready&&(result.version===view.current.version||view.current.modal||view.current.iconAsset||view.current.remove||view.current.page==='settings'))return;
   const firstLoad=!view.current.ready;setBook(result.book);setVersion(result.version);setReady(true);setLoadError('');setSignIn('');if(initial||firstLoad)setBase(result.book.base);
  }catch(error){if(!quiet||!view.current.ready)setLoadError((error as Error).name==='TimeoutError'?'读取账本超时，正在重试；已有数据保留。':(error as Error).message);}
  finally{loading.current=false;}
 }
 useEffect(()=>{void load(true);const timer=setInterval(()=>void load(false,false,true),3000);const focus=()=>void load(false,false,true);window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
 useEffect(()=>{
  const context=(document as unknown as {modelContext?:{registerTool:(tool:unknown,options:unknown)=>Promise<void>|void}}).modelContext;
  if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const tools=[
   {name:'get_asset_summary',title:'查看资产汇总',description:'读取当前显示的NAS账本资产汇总。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{const current=live.current;return {base:current.base,total:total(current.book.assets,current.base,current.book.rates),assetCount:current.book.assets.length,platforms:[...new Set(current.book.assets.map(asset=>asset.platform))],currencies:[...new Set(current.book.assets.map(asset=>asset.currency))]};}},
   {name:'open_asset_entry',title:'打开资产录入',description:'进入全部资产并打开添加资产表单，由用户填写并确认保存。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{if(input&&Object.keys(input as object).length)throw new Error('此工具不接受参数');setPage('assets');setIconAsset(null);setRemove(null);setEditing(undefined);setModal('asset');return {formOpened:true,saved:false};}}
  ];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  return ()=>lifecycle.abort();
 },[]);
 async function save(action:Action,context?:{assetBase?:Asset}):Promise<boolean>{
  if(action.type==='rates'&&!await draftWrites.current)return false;
  if(lock.current)return false;lock.current=true;setBusy(true);setSaveError('');setSaveState('saving');
  try{
   if(!ready)throw new Error('请先重新加载账本');
   if(page!=='assets'&&page!=='settings'&&!(page==='records'&&action.type==='recordEdit'))throw new Error('请在对应页面操作');
   const response=await fetch('/api/ledger/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,action,assetBase:context?.assetBase})});
   const result=await response.json() as {book:Book;version:number;ready?:boolean;rateDraft?:RateDraft|null;sync?:FeishuStatus;error?:string};
   if(!response.ok){await load();throw new Error(result.error||'保存失败');}
   loadSequence.current++;setBook(result.book);setVersion(result.version);if(action.type==='rates')setRateDraft(result.rateDraft??null);if(result.sync)setSync(result.sync);setSaveState('saved');toast.success('已保存到NAS');return true;
  }catch(error){setSaveError((error as Error).message);setSaveState('failed');toast.error((error as Error).message,{duration:7000});return false;}
  finally{lock.current=false;setBusy(false);}
 }
 async function syncBook(target=sync.target??''):Promise<boolean>{
  if(lock.current)return false;
  if(!await draftWrites.current)return false;
  if(lock.current)return false;lock.current=true;setBusy(true);loadSequence.current++;
  try{
   const current=await fetch('/api/book',{cache:'no-store'}).then(response=>response.json()) as {version:number};
   const response=await fetch('/api/ledger/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,version:current.version})});
   const result=await response.json() as {book:Book;version:number;ready?:boolean;rateDraft?:RateDraft|null;sync?:FeishuStatus;error?:string};
   if(result.sync)setSync(result.sync);
   if(!response.ok||result.sync?.error||result.sync?.warning){await load();throw new Error(result.error||result.sync?.error||result.sync?.warning||'连接失败');}
   loadSequence.current++;setBook(result.book);setVersion(result.version);setRateDraft(result.rateDraft??null);setReady(result.ready!==false);setLoadError('');if(!ready)setBase(result.book.base);
   if(result.ready!==false)toast.success('已读取NAS');return result.ready!==false;
  }catch(error){toast.error((error as Error).message,{duration:7000});return false;}finally{lock.current=false;setBusy(false);}
 }
 const changeBase=async(value:string)=>{if(await save({type:'base',base:value}))setBase(value);};
 async function continueSave(){
  if(lock.current)return;lock.current=true;setBusy(true);setSaveState('saving');setSaveError('');
  try{const response=await fetch('/api/ledger/save',{method:'POST',body:'{}'}),result=await response.json();if(!response.ok)throw Error(result.error||'保存失败，输入已保留。');loadSequence.current++;setBook(result.book);setVersion(result.version);setRateDraft(result.rateDraft??null);setSync(result.sync);setModal(null);setRemove(null);setIconAsset(null);setSaveState('saved');toast.success('已保存到NAS');}catch(error){setSaveState('failed');setSaveError((error as Error).message);toast.error((error as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 async function reprepareUpload(){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{if(!await draftWrites.current)throw Error('汇率输入尚未完整缓存，请先保留输入。');download('资产罗盘-保存恢复草稿.json',JSON.stringify(await exportBrowserCaches(),null,2),'application/json');const current=await fetch('/api/book').then(response=>response.json());const response=await fetch('/api/ledger/reprepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:current.version,discardDraft:true})});const result=await response.json();if(!response.ok)throw Error(result.error||'草稿备份恢复失败。');setRateDraft(result.rateDraft??null);setSaveError('');setSaveState('idle');await load(false,true);toast.success('恢复记录已备份，已读取正式账本；请核对后重新填写。');}catch(error){toast.error((error as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 const edit=(asset?:Asset)=>{setPage('assets');setEditing(asset);setModal('asset');};
 const update=(asset:Asset)=>{setPage('assets');setEditing(asset);setModal('trade');};
 const classify=(asset:Asset)=>{setPage('assets');setEditing(asset);setModal('classify');};
 const editIcon=(asset:Asset)=>{setPage('assets');setIconAsset(asset);};
 const editRecord=(id:string)=>{setEditingRecord(id);setModal('record');};
 const navigate=(value:string)=>{setSidebarOpenMobile(false);setModal(null);setIconAsset(null);setRemove(null);setPage(value);};
 const currentAsset=editing?(book.assets.find(asset=>asset.id===editing.id)??editing):undefined;
 const title=navigation.find(item=>item[0]===page)?.[1]??'设置与汇率';

 return <SidebarProvider openMobile={sidebarOpenMobile} onOpenMobileChange={setSidebarOpenMobile} style={{'--sidebar-width':'200px'} as React.CSSProperties}>
  <Toaster position="top-center" richColors/>
  <Sidebar className="atlas-sidebar">
   <SidebarHeader><div className="brand"><span><Compass size={25}/></span><div>资产罗盘</div></div></SidebarHeader>
   <SidebarContent><SidebarMenu>{navigation.map(([id,label,Icon])=><SidebarMenuItem key={id}><SidebarMenuButton isActive={page===id} onClick={()=>navigate(id)} className="nav-button"><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent>
   <SidebarFooter><SidebarMenuButton isActive={page==='settings'} onClick={()=>navigate('settings')}><Settings2/>设置与汇率</SidebarMenuButton><SidebarMenuButton className="web-logout" onClick={onLogout}>退出登录</SidebarMenuButton></SidebarFooter>
  </Sidebar>
  <main className="main-shell atlas-motion-shell"><FinancePageMotion/><div className="page-content">
   <div className="page-heading">
    <div className="page-title"><SidebarTrigger aria-label="展开或收起侧栏"/><h1>{title}</h1></div>
    <div className="heading-actions">
     <button className="icon-button" title={hidden?'显示金额':'隐藏金额'} aria-label={hidden?'显示金额':'隐藏金额'} onClick={()=>setHidden(!hidden)}>{hidden?<EyeOff size={16}/>:<Eye size={16}/>}</button>
     <button className="icon-button" title="读取最新账本" aria-label="读取最新账本" disabled={busy} onClick={()=>void load(false,true)}><RefreshCw size={15}/></button>
     {page==='assets'&&<CurrencySelect book={book} value={base} onChange={changeBase}/>}
     <button className="button secondary export-button" disabled={!ready} onClick={()=>download(`资产罗盘-${today()}.csv`,csvExport(book),'text/csv;charset=utf-8')}><Download size={15}/>导出</button>
     {page==='assets'&&<><button className="button secondary" disabled={!ready} onClick={()=>setModal('import')}><Upload size={15}/>批量录入</button>
     <button className="button primary" disabled={!ready} onClick={()=>edit()}><Plus size={17}/>添加资产</button></>}
    </div>
   </div>
   {!!sync.archivedDrafts&&<p className="browser-draft-note">旧来源草稿仍保留：<button className="text-button" onClick={()=>void exportBrowserCaches().then(value=>download('资产罗盘-浏览器旧草稿.json',JSON.stringify(value,null,2),'application/json')).catch(error=>toast.error((error as Error).message))}>下载旧草稿备份</button>。</p>}
   {saveState==='saving'&&<p className="browser-draft-note" role="status">正在保存到 NAS…</p>}{saveState==='saved'&&<p className="browser-draft-note" role="status">上次确认已保存到 NAS。</p>}
   {saveError&&<div className="connection-notice" role="alert"><span>保存失败，输入已保留。{saveError}</span></div>}
   {sync.canReprepare&&<p className="browser-draft-note">{sync.warning} {sync.canRetrySave&&<button className="text-button" disabled={busy} onClick={()=>void continueSave()}>继续上次保存</button>} 可<button className="text-button" disabled={busy} onClick={()=>void reprepareUpload()}>备份并读取正式账本</button>，再核对重填。</p>}
   {loadError&&<div className="connection-notice" role="alert"><span>{loadError}</span>{signIn?<a href={signIn}>登录并连接账本</a>:<button onClick={()=>void load(false)}>重新加载账本</button>}</div>}
   {!ready&&<section className="panel empty-inline" role="status"><Cloud size={24}/><p>{sync.configured===false?'请在 NAS 中配置数据库环境变量后读取账本':'正在读取NAS数据…'}</p></section>}
   {!ready&&(page==='settings'||!!sync.error||sync.configured===false)&&<FeishuConnection status={sync} busy={busy} onSync={syncBook}/>}
   {ready&&<>
   {page==='overview'&&<Overview book={book} base={base} hidden={hidden}/>}
   {page==='assets'&&<>
    <Tabs value={assetTab} onValueChange={setAssetTab} className="asset-page-tabs"><TabsList><TabsTrigger value="holdings">资产明细</TabsTrigger><TabsTrigger value="earnings">收益明细</TabsTrigger><TabsTrigger value="updates">更新记录</TabsTrigger></TabsList></Tabs>
    {assetTab==='updates'?<><UpdateDates history={updateHistory} date={updateDate} status={updateFilter.status} onSelect={(date,status)=>setUpdateFilter({date,status})}/><AssetView book={book} base={base} filter={{}} updateFilter={{date:updateDate,status:updateFilter.status}} onClearUpdate={()=>setUpdateFilter({date:updateDate,status:'all'})} showSummary={false} onEdit={edit} onUpdate={update} onClassify={classify} onIcon={editIcon} hidden={hidden}/></>:assetTab==='holdings'?<AssetView book={book} base={base} filter={{}} onEdit={edit} onUpdate={update} onClassify={classify} onIcon={editIcon} hidden={hidden}/>:<InvestmentWorkspace book={book} base={base} hidden={hidden} onIcon={editIcon}/>}
   </>}
   {page==='currencies'&&<GroupedAssetView book={book} base={base} kind="currency" hidden={hidden}/>}
   {page==='platforms'&&<GroupedAssetView book={book} base={base} kind="platform" hidden={hidden}/>}
   {page==='records'&&<RecordView book={book} hidden={hidden} onEdit={editRecord}/>}
   {page==='settings'&&<SettingsView book={book} onSave={save} busy={busy} sync={sync} onSync={syncBook} draft={rateDraft} onDraftChange={changeRateDraft} onBackup={()=>download(`资产罗盘-完整备份-${today()}.json`,JSON.stringify({format:'finance-atlas',version:1,exportedAt:new Date().toISOString(),book},null,2),'application/json')}/>}
   </>}
   <footer className="page-footer"><span title={sync.error||sync.warning||undefined}>{sync.linked?<Cloud size={13}/>:<ShieldCheck size={13}/>} {sync.configured===false?(ready?'服务端待配置 · 显示缓存':'服务端待配置'):!ready?'正在读取NAS…':sync.error?'NAS读取或保存失败 · 输入已保留':sync.canRetrySave?'NAS保存待完成 · 输入已保留':sync.dirty?'NAS账本 · 有未确认输入':'NAS账本 · 已读取'}</span>{ready&&book.rateDate&&<span>汇率日期 · {book.rateDate}</span>}</footer>
  </div></main>
  {page==='records'&&modal==='record'&&editingRecord&&<RecordEditForm key={editingRecord} book={book} id={editingRecord} busy={busy} onSave={save} onClose={()=>setModal(null)}/>}
  {page==='assets'&&modal==='trade'&&currentAsset&&<TradeForm book={book} asset={currentAsset} busy={busy} onSave={save} onEdit={()=>setModal('asset')} onClose={()=>setModal(null)}/>}
  {page==='assets'&&modal==='classify'&&currentAsset&&<ClassificationForm book={book} asset={currentAsset} busy={busy} onSave={save} onClose={()=>setModal(null)}/>}
  {page==='assets'&&modal==='asset'&&<AssetForm book={book} asset={currentAsset} onClassify={()=>currentAsset&&classify(currentAsset)} onRemove={setRemove} onClose={()=>setModal(null)} onSave={save} busy={busy}/>}
  {page==='assets'&&modal==='import'&&<ImportForm book={book} onClose={()=>setModal(null)} onSave={save} busy={busy}/>}
  {page==='assets'&&iconAsset&&<IconForm asset={book.assets.find(asset=>asset.id===iconAsset.id)??iconAsset} busy={busy} onSave={save} onClose={()=>setIconAsset(null)}/>}
  <AlertDialog open={page==='assets'&&!!remove} onOpenChange={value=>!value&&!busy&&setRemove(null)}><AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>删除“{remove?.name}”？</AlertDialogTitle><AlertDialogDescription>从当前资产中移除，历史流水和已实现收益保留。</AlertDialogDescription></AlertDialogHeader>
   <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={async event=>{event.preventDefault();if(remove&&await save({type:'remove',id:remove.id})){setRemove(null);setModal(null);}}}>确认删除</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </SidebarProvider>;
}
