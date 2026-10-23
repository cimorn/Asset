'use client';
import {useState} from 'react';
import {Upload,RotateCcw} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Asset,type Action} from '@/lib/finance';
import AssetIcon from './finance-asset-icon';

async function iconData(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 图片');
 if(file.size>5*1024*1024)throw new Error('图片请控制在 5 MB 内');
 const source=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
 const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>reject(new Error('图片无法打开'));item.src=source;});
 const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
 const context=canvas.getContext('2d');if(!context)throw new Error('图片处理失败');
 const scale=Math.min(144/image.width,144/image.height),width=image.width*scale,height=image.height*scale;
 context.drawImage(image,(160-width)/2,(160-height)/2,width,height);
 const result=canvas.toDataURL('image/png');if(result.length>150000)throw new Error('请换用更简单的图标图片');
 return result;
}
export default function IconForm({asset,onSave,onClose,busy}:{asset:Asset;onSave:(action:Action)=>Promise<boolean>;onClose:()=>void;busy:boolean}){
 const [icon,setIcon]=useState(asset.icon),[error,setError]=useState(''),[reading,setReading]=useState(false);
 const blocked=busy||reading;
 return <Dialog open onOpenChange={value=>!value&&!blocked&&onClose()}><DialogContent className="finance-dialog icon-dialog"><DialogHeader><DialogTitle>更换图标</DialogTitle><DialogDescription>{asset.name}</DialogDescription></DialogHeader><div className="icon-preview"><AssetIcon asset={{...asset,icon}}/></div><div className="icon-file-actions"><label className={`button secondary ${blocked?'disabled':''}`}><Upload size={15}/>选择图片<input className="sr-only" type="file" disabled={blocked} accept="image/png,image/jpeg,image/webp" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setReading(true);setError('');try{setIcon(await iconData(file));}catch(error){setError((error as Error).message);}finally{setReading(false);event.target.value='';}}}/></label><button className="button secondary" disabled={blocked} onClick={()=>{setIcon(undefined);setError('');}}><RotateCcw size={14}/>恢复默认</button></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-footer"><button type="button" className="button secondary" disabled={blocked} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={blocked} onClick={async()=>{if(await onSave({type:'icon',id:asset.id,value:icon}))onClose();}}>{busy?'保存中…':reading?'读取中…':'保存图标'}</button></div></DialogContent></Dialog>;
}
