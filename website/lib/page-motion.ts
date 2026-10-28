const revealSelector='.classification-summary-grid > section, .panel, .view-summary, .investment-stats > section, .platform-detail-group';

/** Decorative enhancement only: the ledger and all controls remain in normal document flow. */
export function mountPageMotion(root:HTMLElement,background:HTMLElement){
 if(typeof window.matchMedia!=='function'||typeof IntersectionObserver==='undefined'||typeof MutationObserver==='undefined')return ()=>{};
 const preference=window.matchMedia('(prefers-reduced-motion: reduce)');

 function activate(){
  const tracked=new Set<HTMLElement>();
  let frame=0,index=0;
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){
    const element=entry.target as HTMLElement;
    if(element.dataset.scrollReveal==='pending')element.dataset.scrollReveal='revealing';
    observer.unobserve(element);
   }
  },{rootMargin:'0px 0px -24px 0px',threshold:0});

  function register(element:HTMLElement){
   if(tracked.has(element)||element.parentElement?.closest(revealSelector))return;
   tracked.add(element);
   element.style.setProperty('--reveal-delay',`${index++%3*55}ms`);
   const rect=element.getBoundingClientRect();
   const focused=root.ownerDocument.activeElement;
   if(focused&&element.contains(focused))element.dataset.scrollReveal='shown';
   else if(rect.top<window.innerHeight-24&&rect.bottom>0)element.dataset.scrollReveal='revealing';
   else{element.dataset.scrollReveal='pending';observer.observe(element);}
  }
  function collect(element:HTMLElement){
   if(element.matches(revealSelector))register(element);
   for(const child of element.querySelectorAll<HTMLElement>(revealSelector))register(child);
  }
  const mutations=new MutationObserver(entries=>{
   for(const element of tracked)if(!root.contains(element)){observer.unobserve(element);tracked.delete(element);}
   for(const entry of entries)for(const node of entry.addedNodes)if(node.nodeType===1)collect(node as HTMLElement);
  });
  mutations.observe(root,{childList:true,subtree:true});
  collect(root);

  function paint(){
   frame=0;
   const limit=window.innerWidth<=650?24:64;
   const offset=Math.min(limit,Math.max(0,window.scrollY)*.08);
   background.style.setProperty('--parallax-near',`${offset.toFixed(2)}px`);
   background.style.setProperty('--parallax-far',`${(offset*.42).toFixed(2)}px`);
  }
  function schedule(){if(!frame)frame=window.requestAnimationFrame(paint);}
  function focus(event:FocusEvent){
   const element=(event.target as HTMLElement)?.closest<HTMLElement>('[data-scroll-reveal]');
   if(element&&tracked.has(element)){element.dataset.scrollReveal='shown';observer.unobserve(element);}
  }
  function finish(event:AnimationEvent){
   const element=event.target as HTMLElement;
   if(event.animationName==='atlas-scroll-in'&&tracked.has(element))element.dataset.scrollReveal='shown';
  }
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  root.addEventListener('focusin',focus);
  root.addEventListener('animationend',finish);
  paint();
  return ()=>{
   observer.disconnect();mutations.disconnect();
   if(frame)window.cancelAnimationFrame(frame);
   window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);
   root.removeEventListener('focusin',focus);root.removeEventListener('animationend',finish);
   for(const element of tracked){delete element.dataset.scrollReveal;element.style.removeProperty('--reveal-delay');}
   background.style.removeProperty('--parallax-near');background.style.removeProperty('--parallax-far');
  };
 }
 let stop=()=>{};
 function update(){stop();stop=preference.matches?()=>{}:activate();}
 update();preference.addEventListener('change',update);
 return ()=>{preference.removeEventListener('change',update);stop();};
}
