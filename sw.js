// Only this app's exact assets are cached. Other GitHub Pages applications are untouched.
const VERSION='2.1.1';
const CACHE_NAME='my-starlog-spwn-'+encodeURIComponent(self.registration.scope)+'-'+VERSION;
const ASSETS=['./','./index.html','./app.js?v='+VERSION,'./style.css?v='+VERSION,'./manifest.webmanifest','./assets/newcatsle-logo.png'];
const assetURLs=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 // Never return a cached version response as an update check.
 if(url.pathname===new URL('./version.json',self.registration.scope).pathname)return;
 const navigation=event.request.mode==='navigate';
 if(!navigation&&!assetURLs.has(url.href))return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok)event.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(navigation?new URL('./index.html',self.registration.scope).href:event.request,response.clone())).catch(()=>{}));
  return response;
 }).catch(async()=>{const c=await caches.open(CACHE_NAME);return await c.match(navigation?new URL('./index.html',self.registration.scope).href:event.request)||Response.error()}));
});
