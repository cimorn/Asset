import {createHmac,timingSafeEqual} from 'node:crypto';
export function createJournalSigner(secret,accountId){
 const mac=payload=>createHmac('sha256',secret).update(accountId+'\n'+payload).digest('base64url');
 return {
  seal(value){const payload=JSON.stringify(value);return {payload,signature:mac(payload)};},
  open(value){
   if(typeof value?.payload!=='string'||value.payload.length>40*1024*1024||typeof value.signature!=='string')throw new Error('上传恢复记录无效。');
   const received=Buffer.from(value.signature),expected=Buffer.from(mac(value.payload));
   if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error('上传恢复记录校验失败，请使用原有服务器配置。');
   return JSON.parse(value.payload);
  },
 };
}
