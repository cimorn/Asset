import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceTrees} from './source-trees.mjs';

class Events {
 listeners=new Map();
 addEventListener(type,listener){const handlers=this.listeners.get(type)??new Set();handlers.add(listener);this.listeners.set(type,handlers);}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
 emit(type,event={}){for(const listener of [...this.listeners.get(type)??[]])listener(event);}
 count(type){return this.listeners.get(type)?.size??0;}
}
class Element extends Events {
 nodeType=1;children=[];parentElement=null;dataset={};attributes=new Map();values=new Map();writes=0;isConnected=true;
 constructor({eligible=false,top=1200}={}){super();this.eligible=eligible;this.top=top;this.ownerDocument=globalThis.document;this.style={setProperty:(key,value)=>{this.values.set(key,value);this.writes++;},removeProperty:key=>this.values.delete(key),getPropertyValue:key=>this.values.get(key)??''};}
 append(child){child.parentElement=this;this.children.push(child);return child;}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 matches(selector){
  if(selector.includes('data-scroll-reveal')){const value=this.dataset.scrollReveal;if(!value)return false;const states=[...selector.matchAll(/data-scroll-reveal\s*=\s*["']([^"']+)["']/g)].map(match=>match[1]);return !states.length||states.includes(value);}
  return this.eligible;
 }
 closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 getBoundingClientRect(){return {top:this.top,bottom:this.top+250,left:0,right:500,width:500,height:250};}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='data-scroll-reveal')this.dataset.scrollReveal=String(value);}
 getAttribute(key){return key==='data-scroll-reveal'?this.dataset.scrollReveal??null:this.attributes.get(key)??null;}
 hasAttribute(key){return this.getAttribute(key)!==null;}
 removeAttribute(key){this.attributes.delete(key);if(key==='data-scroll-reveal')delete this.dataset.scrollReveal;}
}
function browser({reduced=false,mobile=false,observers=true}={}){
 const win=new Events(),media=new Events(),root=new Element(),background=new Element(),io=[],mutations=[],frames=new Map();let frameId=0;
 media.matches=reduced;media.media='(prefers-reduced-motion: reduce)';
 Object.assign(win,{scrollY:0,innerHeight:800,innerWidth:mobile?390:1440,matchMedia:query=>query.includes('prefers-reduced-motion')?media:{matches:mobile},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
 class IO {observed=new Set();disconnected=false;constructor(callback){this.callback=callback;io.push(this);}observe(node){this.observed.add(node);}unobserve(node){this.observed.delete(node);}disconnect(){this.disconnected=true;this.observed.clear();}intersect(node){this.callback([{target:node,isIntersecting:true,intersectionRatio:1}]);}}
 class MO {disconnected=false;constructor(callback){this.callback=callback;mutations.push(this);}observe(){}disconnect(){this.disconnected=true;}add(node){this.callback([{type:'childList',addedNodes:[node],removedNodes:[]}]);}}
 const document={documentElement:{clientHeight:800},activeElement:null};win.document=document;root.ownerDocument=document;background.ownerDocument=document;
 const replacements={window:win,document,IntersectionObserver:observers?IO:undefined,MutationObserver:MO,HTMLElement:Element,Element};
 const previous=new Map(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 return {win,media,root,background,io,mutations,frames,document,flush(){const queued=[...frames.values()];frames.clear();for(const frame of queued)frame(0);},restore(){for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}

for(const [name,rootUrl] of sourceTrees){
 const directory=await mkdtemp(path.join(tmpdir(),'asset-page-motion-')),outfile=path.join(directory,'motion.mjs');
 await build({entryPoints:[fileURLToPath(new URL('lib/page-motion.ts',rootUrl))],outfile,bundle:true,format:'esm',platform:'node'});
 const {mountPageMotion}=await import(pathToFileURL(outfile));
 await rm(directory,{recursive:true,force:true});
 function check(options,run){return ()=>{const dom=browser(options);let cleanup=()=>{};try{cleanup=mountPageMotion(dom.root,dom.background);run(dom,cleanup);}finally{cleanup();dom.restore();}};}

 test(`${name}: reduced motion leaves existing content visible and performs no scroll work`,()=>{
  const dom=browser({reduced:true});let cleanup=()=>{};try{
   const card=dom.root.append(new Element({eligible:true}));cleanup=mountPageMotion(dom.root,dom.background);
   assert.equal(card.getAttribute('data-scroll-reveal'),null);assert.equal(dom.io.length,0);assert.equal(dom.win.count('scroll'),0);assert.equal(dom.frames.size,0);
  }finally{cleanup();dom.restore();}
 });
 for(const mobile of [false,true])test(`${name}: scroll bursts share one frame and cap ${mobile?'mobile':'desktop'} parallax`,check({mobile},dom=>{
  dom.flush();dom.background.writes=0;dom.win.scrollY=100000;
  for(let i=0;i<10;i++)dom.win.emit('scroll');assert.equal(dom.frames.size,1);
  dom.flush();const near=parseFloat(dom.background.style.getPropertyValue('--parallax-near')),far=parseFloat(dom.background.style.getPropertyValue('--parallax-far'));
  assert.equal(near,mobile?24:64);assert.ok(Math.abs(far-near*.42)<.011);assert.ok(dom.background.writes<=2);
 }));
 test(`${name}: below-fold sections reveal once and nested cards are not double animated`,()=>{
  const dom=browser();let cleanup=()=>{};try{
   const card=dom.root.append(new Element({eligible:true})),nested=card.append(new Element({eligible:true}));cleanup=mountPageMotion(dom.root,dom.background);
   assert.equal(card.getAttribute('data-scroll-reveal'),'pending');assert.equal(nested.getAttribute('data-scroll-reveal'),null);
   assert.ok(dom.io[0].observed.has(card));dom.io[0].intersect(card);
   assert.equal(card.getAttribute('data-scroll-reveal'),'revealing');assert.ok(!dom.io[0].observed.has(card));
   dom.root.emit('animationend',{target:card,animationName:'atlas-scroll-in'});assert.equal(card.getAttribute('data-scroll-reveal'),'shown');
   dom.io[0].intersect(card);assert.equal(card.getAttribute('data-scroll-reveal'),'shown');
  }finally{cleanup();dom.restore();}
 });
 test(`${name}: dynamically added sections register and keyboard focus shows them immediately`,check({},dom=>{
  const card=dom.root.append(new Element({eligible:true})),input=card.append(new Element());dom.mutations[0].add(card);
  assert.equal(card.getAttribute('data-scroll-reveal'),'pending');dom.root.emit('focusin',{target:input});
  assert.equal(card.getAttribute('data-scroll-reveal'),'shown');assert.ok(!dom.io[0].observed.has(card));
 }));
 test(`${name}: visible cards reveal on entry and unmount restores pending content`,()=>{
  const dom=browser();let cleanup=()=>{};try{
   const visible=dom.root.append(new Element({eligible:true,top:100})),pending=dom.root.append(new Element({eligible:true}));cleanup=mountPageMotion(dom.root,dom.background);
   assert.equal(visible.getAttribute('data-scroll-reveal'),'revealing');assert.equal(pending.getAttribute('data-scroll-reveal'),'pending');dom.win.emit('scroll');
   cleanup();assert.equal(visible.getAttribute('data-scroll-reveal'),null);assert.equal(pending.getAttribute('data-scroll-reveal'),null);
   assert.equal(dom.frames.size,0);assert.equal(dom.win.count('scroll'),0);assert.equal(dom.win.count('resize'),0);assert.equal(dom.media.count('change'),0);
   assert.ok(dom.io.every(observer=>observer.disconnected));assert.ok(dom.mutations.every(observer=>observer.disconnected));
  }finally{cleanup();dom.restore();}
 });
 test(`${name}: enabling reduced motion and unmounting cancel work and restore visibility`,()=>{
  const dom=browser();let cleanup=()=>{};try{
   const card=dom.root.append(new Element({eligible:true}));cleanup=mountPageMotion(dom.root,dom.background);dom.flush();dom.win.emit('scroll');
   dom.media.matches=true;dom.media.emit('change',{matches:true});
   assert.equal(card.getAttribute('data-scroll-reveal'),null);assert.equal(dom.win.count('scroll'),0);assert.equal(dom.frames.size,0);
   assert.ok(dom.io.every(observer=>observer.disconnected));assert.ok(dom.mutations.every(observer=>observer.disconnected));
   cleanup();assert.equal(dom.media.count('change'),0);assert.equal(dom.root.count('focusin'),0);assert.equal(dom.root.count('animationend'),0);
   assert.equal(dom.background.style.getPropertyValue('--parallax-near'),'');assert.equal(dom.background.style.getPropertyValue('--parallax-far'),'');
  }finally{cleanup();dom.restore();}
 });
 test(`${name}: missing observer support never hides content`,()=>{
  const dom=browser({observers:false});let cleanup=()=>{};try{const card=dom.root.append(new Element({eligible:true}));cleanup=mountPageMotion(dom.root,dom.background);assert.equal(card.getAttribute('data-scroll-reveal'),null);}finally{cleanup();dom.restore();}
 });
}
