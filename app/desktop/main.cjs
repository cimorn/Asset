const {app,BrowserWindow,Menu,shell,dialog}=require('electron');
const path=require('node:path');
let server;
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.setName('资产罗盘');
 app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  try{
   const {startServer}=await import('./server.mjs');
   const {createNasCredentialStore}=await import('./nas-credentials.mjs');
   const {prepareCredentials}=await import('./credential-startup.mjs');
   const {createNasService}=await import('./nas-service.mjs');
   const {createLegacyReader}=await import('./nas-legacy.mjs');
   const {allowedExternalUrl,isLocalNavigation}=await import('./nas-security.mjs');
   const dataDir=path.join(app.getPath('appData'),'FinanceAtlas');
   const portableDirectory=process.env.PORTABLE_EXECUTABLE_DIR;
   const credentials=createNasCredentialStore(portableDirectory?{root:dataDir}:undefined);
   const selectNasConfig=async(reason='')=>{const result=await dialog.showOpenDialog({title:'选择 NAS .env 配置文件',message:reason||'选择含 NAS_URL 和 NAS_PASSWORD 的配置，单独保存为 nas.env，下次自动读取',defaultPath:credentials.filename,properties:['openFile'],filters:[{name:'NAS 配置',extensions:['env']},{name:'所有文件',extensions:['*']}]});return result.canceled?'':result.filePaths[0];};
   await prepareCredentials(credentials,{chooseFile:selectNasConfig,showError:async message=>(await dialog.showMessageBox({type:'warning',title:'无法使用该配置',message,detail:'请重新选择包含 NAS_URL 和 NAS_PASSWORD 的独立 NAS .env 文件。',buttons:['重新选择','暂不连接'],defaultId:0,cancelId:1})).response===0});
   const legacyReader=createLegacyReader({dataDir,configRoot:path.dirname(credentials.filename)});
   server=await startServer({dataDir,selectNasConfig,legacyReader,nasService:createNasService(dataDir,{credentialStore:credentials})});
   const win=new BrowserWindow({width:1440,height:960,minWidth:390,minHeight:650,title:'资产罗盘',backgroundColor:'#f6f8fc',icon:path.join(__dirname,'web-dist/favicon.ico'),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
   const external=async url=>{try{const configured=await credentials.load();if(allowedExternalUrl(url,configured.url))void shell.openExternal(url);}catch{}};
   win.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
   win.webContents.on('will-navigate',(event,url)=>{if(!isLocalNavigation(url,server.url)){event.preventDefault();void external(url);}});
   win.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
   win.webContents.session.on('will-download',(_,item)=>{item.setSaveDialogOptions({title:'保存资产罗盘导出文件'});});
   await win.loadURL(server.launchUrl);
  }catch{dialog.showErrorBox('资产罗盘启动失败','无法读取缓存或程序资源不完整。请检查软件目录后重试，NAS 正式账本中的数据不受影响。');app.quit();}
 });
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>server?.server.close());
}
