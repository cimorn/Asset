'use client';
import {useEffect,useRef} from 'react';
import {mountPageMotion} from '@/lib/page-motion';

export default function FinancePageMotion(){
 const background=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const layer=background.current;
  const content=layer?.parentElement?.querySelector<HTMLElement>('.page-content');
  if(layer&&content)return mountPageMotion(content,layer);
 },[]);
 return <div ref={background} className="atlas-page-background" aria-hidden="true"/>;
}
