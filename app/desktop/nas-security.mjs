import {normalizeNasUrl} from './nas-credentials.mjs';
function canonicalUrl(value){try{const url=new URL(value);return typeof value==='string'&&url.href===value&&url.protocol==='https:'&&!url.username&&!url.password&&!url.hostname.endsWith('.')?url:null;}catch{return null;}}
export function allowedExternalUrl(value,nasOrigin){
 const normalized=value.endsWith('/')?value:value+'/';const url=canonicalUrl(value)??canonicalUrl(normalized);if(!url)return false;
 if(url.origin==='https://frankfurter.dev')return true;
 try{return url.origin===normalizeNasUrl(nasOrigin);}catch{return false;}
}
export function isLocalNavigation(value,origin){try{const url=new URL(value);return url.origin===origin&&!url.username&&!url.password;}catch{return false;}}
