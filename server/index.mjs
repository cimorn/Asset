import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFeishuService} from './feishu.mjs';
import {createWebServer} from './server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
 const server=await createWebServer({service:createFeishuService(path.join(root,'.data')),staticDir:path.join(root,'dist')});
 const port=Number(process.env.PORT||3000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT 必须为有效端口。');
 server.listen(port,'0.0.0.0',()=>console.log(`资产罗盘网页服务已启动，端口 ${port}`));
}catch(error){console.error(error.message?.startsWith('请')||error.message?.startsWith('PORT')?error.message:'服务启动失败，请检查环境变量和构建产物。');process.exitCode=1;}
