/* coi.js — Mirall de veu
   Fa que la pàgina quedi "cross-origin isolated" afegint les capçaleres COOP/COEP a totes les respostes
   mitjançant un service worker. Això permet el WebAssembly multifil (SharedArrayBuffer), de manera que la
   separació de veu amb el processador va diverses vegades més ràpida. GitHub Pages no deixa posar aquestes
   capçaleres al servidor; per això es fa així. Al primer accés, la pàgina es recarrega un cop sola. */
if(typeof window==='undefined'){
  // ---- dins del service worker
  self.addEventListener('install',()=>self.skipWaiting());
  self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
  self.addEventListener('message',e=>{if(e.data&&e.data.type==='deregister'){self.registration.unregister().then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))}});
  self.addEventListener('fetch',e=>{
    const r=e.request;
    if(r.cache==='only-if-cached'&&r.mode!=='same-origin')return;
    e.respondWith(fetch(r).then(res=>{
      if(res.status===0)return res;
      const h=new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy','credentialless');
      h.set('Cross-Origin-Opener-Policy','same-origin');
      return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
    }).catch(err=>{console.error('coi',err);return Response.error()}));
  });
}else{
  // ---- dins de la pàgina
  (async()=>{
    try{
      if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
      if(window.crossOriginIsolated)return;
      const reg=await navigator.serviceWorker.register(document.currentScript.src,{scope:'./'});
      if(!navigator.serviceWorker.controller){
        // primera visita: quan el worker prengui el control, recarrega un cop perquè les capçaleres facin efecte
        navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!sessionStorage.getItem('coi-reloaded')){sessionStorage.setItem('coi-reloaded','1');location.reload()}},{once:true});
        if(reg.active&&!navigator.serviceWorker.controller&&!sessionStorage.getItem('coi-reloaded')){sessionStorage.setItem('coi-reloaded','1');location.reload()}
      }
    }catch(e){console.warn('coi',e)}
  })();
}
