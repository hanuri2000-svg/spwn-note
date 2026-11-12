/* Shared player directory: never changes saved matches while displaying a form. */
(function(){
'use strict';
const URL='https://hanuri2000-svg.github.io/star-match-manager/players.json';
const CACHE='starlog-player-directory-v1';
const norm=value=>String(value||'').replace(/\s+/g,'').toLowerCase();
let players=[],ready=false,failed=false;
function matches(name){const key=norm(name);return key?players.filter(p=>[p.name,...(Array.isArray(p.aliases)?p.aliases:[])].some(n=>norm(n)===key)):[]}
function install(){
 const form=document.getElementById('matchForm');if(!form)return;
 const input=form.elements.namedItem('opponent');if(!input)return;
 let list=document.getElementById('shared-player-names');if(!list){list=document.createElement('datalist');list.id='shared-player-names';document.body.appendChild(list)}
 list.replaceChildren(...players.map(p=>{const option=document.createElement('option');option.value=p.name;option.label=[p.race,p.tierLabel||p.tier].filter(Boolean).join(' · ');return option}));input.setAttribute('list',list.id);
 if(!document.getElementById('opponent-tier-label')){const label=document.createElement('label');label.id='opponent-tier-label';label.textContent='상대 티어';const output=document.createElement('output');output.id='opponent-tier-value';output.setAttribute('aria-live','polite');output.style.cssText='display:block;padding:10px 12px;border:1px solid var(--line,#ddd);border-radius:10px;min-height:20px;color:var(--text,#513c60);font-size:14px';label.appendChild(output);const race=form.elements.namedItem('race');race.closest('label').after(label)}
 show(false);
}
function show(apply){
 const form=document.getElementById('matchForm');if(!form)return;
 const input=form.elements.namedItem('opponent'),output=document.getElementById('opponent-tier-value');if(!input||!output)return;
 const found=matches(input.value);
 if(!input.value.trim()){output.textContent='상대 이름을 입력하면 표시돼요';return}
 if(found.length===1){const p=found[0];output.textContent=(p.tierLabel||p.tier||'티어 미등록')+(failed?' · 저장된 선수 정보':'');if(apply&&['T','P','Z'].includes(p.race)){form.elements.namedItem('race').value=p.race;form.elements.namedItem('race').dispatchEvent(new Event('input',{bubbles:true}));form.elements.namedItem('race').dispatchEvent(new Event('change',{bubbles:true}))}return}
 output.textContent=found.length>1?'동명이인 · 종족을 직접 확인해 주세요':!ready?'선수 정보를 불러오는 중…':failed?'선수 정보를 불러오지 못했어요':'선수 DB에 없는 이름이에요';
}
document.addEventListener('input',e=>{if(e.target.matches('#matchForm [name="opponent"]'))show(true)});
document.addEventListener('change',e=>{if(e.target.matches('#matchForm [name="opponent"]'))show(true)});
document.addEventListener('compositionend',e=>{if(e.target.matches('#matchForm [name="opponent"]'))show(true)});
document.addEventListener('focusout',e=>{if(e.target.matches('#matchForm [name="opponent"]'))show(true)});
function syncNewEntry(){const form=document.getElementById('matchForm');show(Boolean(form&&!form.elements.namedItem('id')?.value&&document.getElementById('editor')?.open))}
const dialog=document.getElementById('editor');if(dialog)new MutationObserver(syncNewEntry).observe(dialog,{attributes:true,attributeFilter:['open']});
try{const cached=JSON.parse(localStorage.getItem(CACHE)||'null');if(Array.isArray(cached?.players)){players=cached.players;ready=true}}catch{}
install();
fetch(URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('directory');return r.json()}).then(data=>{if(!Array.isArray(data.players)||!data.players.length)throw Error('directory');players=data.players.filter(p=>p&&p.active!==false&&typeof p.name==='string'&&p.name.trim());ready=true;try{localStorage.setItem(CACHE,JSON.stringify({players,fetchedAt:new Date().toISOString()}))}catch{}install();syncNewEntry()}).catch(()=>{ready=true;failed=true;show(false)});
})();
