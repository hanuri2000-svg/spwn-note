import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/spwn-note/';
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url))).version;
const current = 'spawn-note-v'+version;
function harness() {
  const stores = new Map();
  const listeners = {};
  let online = true, status = 200, failInstall = false, skipped = false, claimed = false;
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const body = url => 'asset:'+new URL(url).pathname;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(paths) {
          if (failInstall) throw Error('installation interrupted');
          for (const path of paths) entries.set(key(path), new Response(body(key(path))));
        },
        async put(request, response) { entries.set(key(request), response.clone()); },
        async match(request) { return entries.get(key(request))?.clone(); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  vm.runInNewContext(source, { URL, Set, Response, caches,
    fetch: async request => { if (!online) throw Error('offline'); return new Response(body(key(request)), {status}); },
    self: {registration:{scope}, location:{origin:new URL(scope).origin},
      addEventListener(name, cb){listeners[name]=cb},
      skipWaiting(){skipped=true}, clients:{claim(){claimed=true}}}
  });
  async function dispatch(name, request) {
    const waits=[]; let response;
    listeners[name]({request, waitUntil(p){waits.push(p)}, respondWith(p){response=p}});
    const result=await response;
    await Promise.all(waits);
    return result;
  }
  return {stores,caches,body,key,dispatch,
    offline(){online=false}, status(value){status=value}, fail(){failInstall=true},
    get skipped(){return skipped},get claimed(){return claimed},
    request(path,mode='cors',method='GET'){return {url:key(path),mode,method}}
  };
}
async function assertAssets(h) {
  for (const path of ['ui.js','season-theme.css','season-theme.js']) {
    const response=await h.dispatch('fetch',h.request(path+'?v='+version));
    assert.equal(response.status,200);
    assert.equal(await response.text(),h.body(h.key(path)));
  }
}
test('new install serves versioned JS/CSS offline before any runtime request',async()=>{
  const h=harness();await h.dispatch('install');assert.ok(h.skipped);
  h.offline();await assertAssets(h);
});
test('update then immediate disconnect uses new precache, never stale cache',async()=>{
  const h=harness();const old=await h.caches.open('spawn-note-v1.7.10');
  await old.put(h.request('ui.js?v='+version),new Response('stale'));
  await h.dispatch('install');h.offline();await assertAssets(h);
  const unrelated=await h.caches.open('other-app');await unrelated.put('./data',new Response('keep'));
  await h.dispatch('activate');assert.ok(h.claimed);
  assert.equal(h.stores.has('spawn-note-v1.7.10'),false);
  assert.equal(await (await unrelated.match('./data')).text(),'keep');
  await assertAssets(h);
});
test('HTML fallback applies only to navigation; unknown resources fail',async()=>{
  const h=harness();await h.dispatch('install');h.offline();
  const page=await h.dispatch('fetch',h.request('?appVersion='+version,'navigate'));
  assert.equal(await page.text(),h.body(h.key('index.html')));
  for(const path of ['missing.js','missing.css','api?player=one','ui.js?player=one&v='+version]){
    const r=await h.dispatch('fetch',h.request(path));assert.equal(r.type,'error');
  }
});
test('successful runtime requests use canonical key, HTTP failures do not poison precache',async()=>{
  const h=harness();await h.dispatch('install');
  await h.dispatch('fetch',h.request('ui.js?v='+version));
  assert.equal(h.stores.get(current).has(h.key('ui.js?v='+version)),false);
  h.status(404);assert.equal((await h.dispatch('fetch',h.request('ui.js?v='+version))).status,404);
  h.offline();await assertAssets(h);
});
test('failed install does not skip waiting or delete old cache',async()=>{
  const h=harness();await h.caches.open('spawn-note-v1.7.10');h.fail();
  await assert.rejects(h.dispatch('install'));assert.equal(h.skipped,false);
  assert.ok(h.stores.has('spawn-note-v1.7.10'));
});
test('non-GET and cross-origin requests bypass worker',async()=>{
  const h=harness();assert.equal(await h.dispatch('fetch',h.request('ui.js','cors','POST')),undefined);
  assert.equal(await h.dispatch('fetch',{url:'https://external.test/a.js',method:'GET'}),undefined);
});
