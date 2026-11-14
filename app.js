'use strict';
const APP_VERSION='2.2.6';
const KEY='my-starlog-spwn-note-v1', DRAFT='my-starlog-spwn-note-draft';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const blank=()=>({version:1,matches:[],trash:[],settings:{name:'',race:'P',maps:['폴리포이드','투혼','실피드','버터'],builds:['더블 넥서스','게이트 더블','원배럭 더블','팩더블','12앞마당']},lastBackup:null});
let db=blank(),storageOK=true;try{const raw=localStorage.getItem(KEY);if(raw){const parsed=JSON.parse(raw);if(!validDB(parsed))throw Error('invalid');db=parsed}}catch(e){storageOK=false;setTimeout(()=>toast('저장 자료를 읽지 못했어요. 원본 보호를 위해 새 저장을 중단했어요.'),100)}
function validMatch(m){return m&&typeof m.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(m.id)&&typeof m.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(m.date)&&!isNaN(Date.parse(m.date))&&['스폰','래더','연습','CK','기타'].includes(m.type)&&['W','L'].includes(m.result)&&['P','T','Z','R'].includes(m.race)&&['P','T','Z','R'].includes(m.myRace)&&['opponent','map','build','enemyBuild','memo','tags'].every(k=>typeof m[k]==='string'&&m[k].length<=(k==='memo'?10000:4000))&&!!m.opponent.trim()&&!!m.map.trim()&&typeof m.star==='boolean'}
function validDB(d){return d&&d.version===1&&Array.isArray(d.matches)&&Array.isArray(d.trash)&&d.matches.every(validMatch)&&d.trash.every(validMatch)&&new Set([...d.matches,...d.trash].map(m=>m.id)).size===d.matches.length+d.trash.length&&d.settings&&typeof d.settings.name==='string'&&['P','T','Z','R'].includes(d.settings.race)&&['maps','builds'].every(k=>Array.isArray(d.settings[k])&&d.settings[k].every(s=>typeof s==='string'))}
function commit(next){if(!storageOK){toast('기존 자료를 먼저 백업하거나 복원해 주세요.');return false}try{localStorage.setItem(KEY,JSON.stringify(next));db=next;return true}catch(e){toast('저장 공간 또는 브라우저 설정 때문에 저장하지 못했어요. 백업을 확인해 주세요.');return false}}
function change(fn){const next=structuredClone(db);fn(next);return commit(next)}
let page='stats',statKey='race',reviewMode='all',calendar=new Date(new Date().getFullYear(),new Date().getMonth(),1),filters={q:'',type:'',race:'',result:'',from:'',to:''};
const sorted=()=>[...db.matches].sort((a,b)=>b.date.localeCompare(a.date)||(b.created||0)-(a.created||0));
const info=rows=>{const w=rows.filter(m=>m.result==='W').length;return {n:rows.length,w,l:rows.length-w,rate:rows.length?Math.round(w/rows.length*100):0}};
const typeOptions=['스폰','래더','연습','CK','기타'],raceNames={P:'프로토스',T:'테란',Z:'저그',R:'랜덤 / 모름'};
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500)}
function empty(icon,title,desc){return `<div class="empty"><span class="empty-icon">${icon}</span><b>${title}</b><p>${desc}</p></div>`}
function metric(title,value,sub,icon){return `<div class="metric"><span class="metric-icon">${icon}</span><div class="metric-title">${title}</div><strong>${value}</strong><small>${sub}</small></div>`}
function heading(title,desc){return `<div class="page-heading"><div><span class="eyebrow">MY STARLOG</span><h1 class="page-title" style="margin-top:10px">${title}</h1><p class="subtext">${desc}</p></div><button class="btn primary" onclick="openForm()">＋ 경기 기록</button></div>`}
function table(rows,compact=false){if(!rows.length)return empty('🪄','아직 기록된 경기가 없어요','첫 번째 한 판을 기록하고<br>나만의 스타 이야기를 시작해 보세요.');return `<div class="table-wrap"><table><thead><tr><th>날짜</th><th>상대</th><th>맵</th><th>결과</th>${compact?'':'<th>유형</th><th>내 빌드</th><th>다시 보기</th><th>관리</th>'}</tr></thead><tbody>${rows.map(m=>`<tr class="clickable"><td><button class="icon-btn" onclick="openForm('${m.id}')">${esc(m.date.slice(5).replace('-','.'))}</button></td><td><button class="icon-btn" onclick="openForm('${m.id}')"><span class="race ${m.race}">${m.race}</span>${esc(m.opponent)}</button></td><td>${esc(m.map)}</td><td><span class="badge ${m.result==='W'?'win':'loss'}">${m.result==='W'?'WIN':'LOSE'}</span></td>${compact?'':`<td>${esc(m.type)}</td><td>${esc(m.build||'—')}</td><td><button class="star-button ${m.star?'on':''}" onclick="toggleStar('${m.id}')" aria-label="다시 보기 ${m.star?'해제':'표시'}">${m.star?'♥':'♡'}</button></td><td><button class="icon-btn" onclick="openForm('${m.id}')">수정</button><button class="icon-btn danger" onclick="removeMatch('${m.id}')">삭제</button></td>`}</tr>`).join('')}</tbody></table></div>`}
function drawStats(){const all=sorted(),d=today(),t=info(all.filter(m=>m.date===d)),month=info(all.filter(m=>m.date.startsWith(d.slice(0,7)))),total=info(all);let streak=0;for(const m of all){if(m.result===all[0]?.result)streak++;else break}$('#stats').innerHTML=`<div class="hero"><div class="hero-copy"><span class="eyebrow">MY STARCRAFT MATCH JOURNAL</span><h1>나의 스타크래프트<br><span>경기 기록장</span></h1><p>스폰부터 래더·연습·CK까지,<br>모든 한 판을 기록해요.</p><div class="game-types" aria-label="기록할 수 있는 경기 유형"><span>🎮 스폰</span><span>🏆 래더</span><span>✨ 연습</span><span>🤝 CK</span><span>✦ 기타</span></div><button class="btn primary" onclick="openForm()">＋ 오늘의 경기 기록하기</button></div><div class="hero-art" aria-hidden="true"><img class="hero-logo" src="./assets/newcatsle-logo.png" alt="" width="154" height="193"><div class="orbit"></div><div class="moon"></div><div class="cloud"></div><span class="art-star s1">✧</span><span class="art-star s2">✦</span><span class="art-star s3">✧</span><span class="art-ribbon">🎀</span></div></div><div class="section-top"><h2>나의 통계 ✧</h2><span class="date-label">${d.replaceAll('-','.')} 기준</span></div><div class="metrics">${metric('오늘의 전적',`${t.w}<small>승</small> ${t.l}<small>패</small>`,t.n?'오늘도 한 판씩 쌓아가는 중':'오늘의 첫 경기를 기다려요','🎮')}${metric('이번 달 승률',`${month.n?month.rate:'—'}<small>%</small>`,`${month.n}경기 · ${month.w}승 ${month.l}패`,'🌷')}${metric('현재 연속 기록',`${streak}<small>${all[0]?.result==='L'?'연패':'연승'}</small>`,streak?'최근 경기부터 집계했어요':'새로운 기록의 시작','✨')}${metric('전체 경기',`${total.n}<small>판</small>`,`${total.w}승 ${total.l}패 · 승률 ${total.n?total.rate+'%':'—'}`,'📖')}</div><div id="statsBreakdown"></div><div class="panel"><div class="panel-title"><h3>나의 플레이 달력 🌙</h3></div><div id="calendar"></div></div><div class="tip"><span>💌</span><div><b>승리도, 아쉬운 한 판도 모두 나의 경험이에요.</b><p>오늘 기억하고 싶은 순간을 복기 노트에 짧게 남겨보세요.</p></div></div>`;drawBreakdown();drawCalendar()}
function drawCalendar(){const y=calendar.getFullYear(),mo=calendar.getMonth(),days=new Date(y,mo+1,0).getDate(),first=new Date(y,mo,1).getDay();$('#calendar').innerHTML=`<div class="calendar-head"><button class="icon-btn" onclick="moveMonth(-1)" aria-label="이전 달">‹</button><span>${y}년 ${mo+1}월</span><button class="icon-btn" onclick="moveMonth(1)" aria-label="다음 달">›</button></div><div class="calendar-grid">${['S','M','T','W','T','F','S'].map(s=>`<div class="day-label">${s}</div>`).join('')}${'<span></span>'.repeat(first)}${Array.from({length:days},(_,i)=>{const date=`${y}-${String(mo+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`,n=db.matches.filter(m=>m.date===date).length;return `<button class="day ${date===today()?'today':''} ${n?'has-game':''}" onclick="filterDate('${date}')" title="${date}, ${n}경기">${i+1}</button>`}).join('')}</div><div class="calendar-legend">● 경기 기록이 있는 날 · 날짜를 눌러 확인해요</div>`}
function moveMonth(n){calendar.setMonth(calendar.getMonth()+n);drawCalendar()}
function filterDate(date){filters={q:'',type:'',race:'',result:'',from:date,to:date};location.hash='records';render()}
function filtered(){return sorted().filter(m=>(!filters.q||[m.opponent,m.map,m.build,m.enemyBuild,m.memo,m.tags].some(s=>s.toLowerCase().includes(filters.q.toLowerCase())))&&(!filters.type||m.type===filters.type)&&(!filters.race||m.race===filters.race)&&(!filters.result||m.result===filters.result)&&(!filters.from||m.date>=filters.from)&&(!filters.to||m.date<=filters.to))}
function drawRecords(){const rows=filtered(),s=info(rows);$('#records').innerHTML=heading('경기 기록 📖','스폰·래더·연습·CK까지, 나의 스타크래프트 경기를 모아보세요.')+`<div style="margin-bottom:16px"><button class="btn small" onclick="showTrash()">휴지통</button></div><div class="filters"><input id="search" value="${esc(filters.q)}" placeholder="상대, 맵, 빌드, 메모 검색" aria-label="경기 검색" oninput="setFilter('q',this.value)"><select aria-label="유형 필터" onchange="setFilter('type',this.value)"><option value="">모든 유형</option>${typeOptions.map(v=>`<option ${filters.type===v?'selected':''}>${v}</option>`).join('')}</select><select aria-label="종족 필터" onchange="setFilter('race',this.value)"><option value="">모든 종족</option>${Object.entries(raceNames).map(([k,v])=>`<option value="${k}" ${filters.race===k?'selected':''}>${v}</option>`).join('')}</select><select aria-label="결과 필터" onchange="setFilter('result',this.value)"><option value="">모든 결과</option><option value="W" ${filters.result==='W'?'selected':''}>승리</option><option value="L" ${filters.result==='L'?'selected':''}>패배</option></select><input type="date" aria-label="시작 날짜" value="${filters.from}" onchange="setFilter('from',this.value)"><input type="date" aria-label="종료 날짜" value="${filters.to}" onchange="setFilter('to',this.value)"><button class="btn small" onclick="resetFilters()">초기화</button></div><div class="panel"><div class="panel-title"><h3 id="resultCount">${s.n}경기 · ${s.w}승 ${s.l}패</h3><span class="date-label">최신 경기순</span></div><div id="recordsTable">${rows.length?table(rows):empty('🔎','찾은 경기가 없어요','검색 조건을 바꾸거나 새로운 경기를 기록해 보세요.')}</div></div>`}
function setFilter(k,v){filters[k]=v;const rows=filtered(),s=info(rows);$('#resultCount').textContent=`${s.n}경기 · ${s.w}승 ${s.l}패`;$('#recordsTable').innerHTML=rows.length?table(rows):empty('🔎','찾은 경기가 없어요','검색 조건을 바꾸거나 새로운 경기를 기록해 보세요.',false)}
function resetFilters(){filters={q:'',type:'',race:'',result:'',from:'',to:''};drawRecords()}
function drawBreakdown(){let groups=Object.create(null);for(const m of db.matches){let k=statKey==='month'?m.date.slice(0,7):(m[statKey]||'미입력');(groups[k]??=[]).push(m)}if(statKey==='race')for(const race of ['T','Z','P','R'])groups[race]??=[];let entries=Object.entries(groups).sort((a,b)=>statKey==='month'?b[0].localeCompare(a[0]):b[1].length-a[1].length);$('#statsBreakdown').innerHTML=`<div class="section-top"><h2>상세 전적</h2><span class="date-label">전체 기간 · 모든 경기 유형</span></div><div class="segmented">${[['opponent','상대별'],['map','맵별'],['race','종족별'],['build','빌드별'],['type','유형별'],['month','월별']].map(([k,v])=>`<button class="${statKey===k?'selected':''}" onclick="statKey='${k}';drawBreakdown()">${v}</button>`).join('')}</div><div class="panel" style="margin-top:20px">${entries.length?`<div class="table-wrap"><table><thead><tr><th>구분</th><th>경기 수</th><th>승</th><th>패</th><th>승률</th><th>승률 그래프</th></tr></thead><tbody>${entries.map(([k,ms])=>{const x=info(ms);return `<tr><td>${esc(statKey==='race'?raceNames[k]:k)}</td><td>${x.n}판</td><td>${x.w}</td><td>${x.l}</td><td>${x.n?x.rate+'%':'—'}</td><td><div class="bar-track"><div class="bar-fill" style="width:${x.rate}%"></div></div></td></tr>`}).join('')}</tbody></table></div>`:empty('🔮','아직 기록된 경기가 없어요','경기 기록 메뉴에서 경기를 추가하면 통계가 나타나요.',false)}</div><p class="stat-note">✧ 승률은 승리 ÷ 전체 경기로 계산해요. 경기 수를 함께 확인해 주세요.<br>빌드를 적지 않은 경기는 ‘미입력’으로 표시해요. 종족별은 상대 종족 기준이에요.</p>`}

function reviewTier(m){return String(m.opponentTier??m.tier??m.legacyRecord?.tier??'').trim()||'미입력'}
function reviewFacts(m){return [['경기 날짜',m.date],['경기 유형',m.type],['승패',m.result==='W'?'승리':'패배'],['상대 이름',m.opponent],['상대 종족',raceNames[m.race]],['상대 티어',reviewTier(m)],['맵',m.map],['내 빌드',m.build],['상대 빌드',m.enemyBuild]].map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value||'미입력')}</dd></div>`).join('')}
function openReview(id){
 const m=db.matches.find(x=>x.id===id);if(!m)return;
 let dialog=document.getElementById('reviewDetail');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='reviewDetail';dialog.className='review-detail';dialog.setAttribute('aria-labelledby','reviewDetailTitle');document.body.appendChild(dialog)}
 dialog.innerHTML=`<div class="review-detail-top"><h2 id="reviewDetailTitle">경기 복기 💌</h2><button class="btn small" data-close>닫기 ✕</button></div><dl class="review-facts">${reviewFacts(m)}</dl><h3>복기 메모</h3><div class="review-full-memo">${esc(m.memo||'아직 작성된 복기 메모가 없어요.')}</div><div class="review-detail-tags">${m.tags.split(',').filter(t=>t.trim()).map(t=>`<span class="tag"># ${esc(t.trim())}</span>`).join('')}</div><button class="btn" data-edit>노트 수정 ↗</button>`;
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.querySelector('[data-edit]').onclick=()=>{dialog.close();openForm(id)};
 dialog.showModal();
}
function drawReview(){
 const rows=sorted().filter(m=>reviewMode==='star'?m.star:reviewMode==='empty'?!m.memo.trim():m.memo.trim()||m.star);
 $('#review').innerHTML=heading('복기 노트 💌','경기를 누르면 경기 정보와 복기 내용을 모두 볼 수 있어요.')+`<div class="segmented" style="margin:24px 0">${[['all','모든 노트'],['star','♡ 다시 볼 경기'],['empty','복기 미작성']].map(([k,v])=>`<button class="${reviewMode===k?'selected':''}" onclick="reviewMode='${k}';drawReview()">${v}</button>`).join('')}</div>${rows.length?`<div class="review-grid">${rows.map(m=>`<article class="review-card review-compact"><div class="review-card-top"><span class="badge ${m.result==='W'?'win':'loss'}">${m.result==='W'?'승리':'패배'} · ${esc(m.type)}</span><button class="star-button ${m.star?'on':''}" onclick="toggleStar('${m.id}')" aria-label="다시 보기 표시">${m.star?'♥':'♡'}</button></div><button class="review-open" onclick="openReview('${m.id}')" aria-label="${esc(m.date+' '+m.opponent+' 경기 복기 보기')}"><h3>${esc(m.opponent)} · ${esc(m.map)}</h3><span class="date-label">${esc(m.date)} · ${esc(raceNames[m.race])} · 티어 ${esc(reviewTier(m))}</span><span class="review-build">내 빌드: ${esc(m.build||'미입력')} / 상대 빌드: ${esc(m.enemyBuild||'미입력')}</span><span class="review-open-hint">${m.memo.trim()?'복기 내용 전체 보기 ↗':'복기 미작성 · 경기 보기 ↗'}</span></button></article>`).join('')}</div>`:empty('💌','기억하고 싶은 순간을 모아보세요','경기에 메모를 남기거나 하트를 누르면<br>여기에서 다시 만날 수 있어요.')}`;
 document.querySelectorAll('.review-compact').forEach(card=>card.addEventListener('click',e=>{if(!e.target.closest('button'))card.querySelector('.review-open').click()}));
}


function render(){const version=document.querySelector('.sidebar-bottom span');if(version)version.textContent='v'+APP_VERSION;const hash=location.hash.slice(1);page=['records','stats','review'].includes(hash)?hash:'stats';document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===page));document.querySelectorAll('#nav a').forEach(el=>el.classList.toggle('active',el.hash==='#'+page));const names={records:'경기 기록',stats:'나의 통계',review:'복기 노트',settings:'설정 · 백업'};$('#breadcrumb').innerHTML=`나의 작은 기록 공간 <span> / ${names[page]}</span>`;$('#profileName').textContent=db.settings.name||'나의 스타로그';const registeredName=db.settings.name.trim();$('#nameGreeting').hidden=!registeredName;$('#nameGreeting').textContent=registeredName?'🌷 '+registeredName+'님, 반가워요! 오늘의 스타 이야기도 함께 기록해요.':'';({records:drawRecords,stats:drawStats,review:drawReview})[page]();showMigrationNotice();showWelcomeNotice();for(const [id,items] of [['opponents',db.matches.map(m=>m.opponent)],['maps',[...db.settings.maps,...db.matches.map(m=>m.map)]],['builds',[...db.settings.builds,...db.matches.map(m=>m.build)]]])$('#'+id).innerHTML=[...new Set(items)].filter(Boolean).map(s=>`<option value="${esc(s)}"></option>`).join('')}
const form=$('#matchForm');
function fillForm(m){for(const [k,v] of Object.entries(m)){const el=form.elements.namedItem(k);if(!el)continue;if(k==='star')el.checked=!!v;else el.value=v??''}}
function formData(){const f=new FormData(form),v=Object.fromEntries(f.entries());v.star=f.has('star');const existing=db.matches.find(m=>m.id===v.id);v.myRace=existing?existing.myRace:db.settings.race;v.opponentTier=existing&&existing.opponent===v.opponent?reviewTier(existing):String(window.starlogPlayerTier?.(v.opponent)||"");return v}
function saveDraft(){try{localStorage.setItem(DRAFT,JSON.stringify(formData()))}catch(e){}}
function openForm(id){form.reset();fillForm({id:'',date:today(),myRace:db.settings.race});if(id){const m=db.matches.find(x=>x.id===id);if(!m)return;fillForm(m)}else{try{const draft=JSON.parse(localStorage.getItem(DRAFT)||'null');if(draft&&!draft.id)fillForm(draft)}catch(e){}}$('#formTitle').textContent=id?'한 판의 기록 다듬기 ✨':'오늘의 한 판 기록하기 ✨';$('#editor').showModal()}
function closeForm(){saveDraft();$('#editor').close()}
form.addEventListener('input',saveDraft);$('#editor').addEventListener('cancel',saveDraft);
function copyLast(){const last=sorted()[0];if(!last){toast('먼저 기록한 경기가 필요해요.');return}const currentId=form.elements.id.value;fillForm({...last,id:currentId,date:today(),result:'',memo:'',tags:'',star:false});saveDraft();toast('상대와 맵, 빌드를 가져왔어요. 결과를 선택해 주세요.')}
form.onsubmit=e=>{e.preventDefault();const v=formData();for(const k of ['opponent','map','build','enemyBuild','memo','tags'])v[k]=(v[k]||'').trim();const existing=db.matches.find(m=>m.id===v.id);v.id=existing?.id||crypto.randomUUID();v.created=existing?.created||Date.now();if(!validMatch(v)){toast('상대 이름, 맵, 날짜와 결과를 확인해 주세요.');return}if(change(d=>{const i=d.matches.findIndex(m=>m.id===v.id);if(i<0)d.matches.push(v);else d.matches[i]=v})){try{localStorage.removeItem(DRAFT)}catch(e){}$('#editor').close();render();toast(existing?'기록을 수정했어요 ✨':'나의 별 하나를 기록했어요 ✨')}};
function toggleStar(id){if(change(d=>{const m=d.matches.find(m=>m.id===id);if(m)m.star=!m.star}))render()}
function removeMatch(id){if(!confirm('이 경기를 휴지통으로 옮길까요? 설정에서 복구할 수 있어요.'))return;if(change(d=>{const i=d.matches.findIndex(m=>m.id===id);if(i>=0)d.trash.push(d.matches.splice(i,1)[0])})){render();toast('휴지통으로 옮겼어요. 설정에서 복구할 수 있어요.')}}
function recover(id){if(change(d=>{const i=d.trash.findIndex(m=>m.id===id);if(i>=0)d.matches.push(d.trash.splice(i,1)[0])})){render();toast('기록을 복구했어요 ✨')}}
function backup(){const next=structuredClone(db);next.lastBackup=new Date().toISOString();const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(next,null,2)],{type:'application/json'}));a.download=`my-starlog-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);if(storageOK)commit(next);render();toast('백업 파일 다운로드를 요청했어요. 다운로드 폴더를 확인해 주세요.')}
function convertSponsorBackup(rows,myRace,existing){
 if(!Array.isArray(rows))throw Error('스폰노트 백업 형식이 아니에요.');
 if(!['P','T','Z','R'].includes(myRace))throw Error('내 종족을 확인해 주세요.');
 const raceMap={'프로토스':'P','토스':'P','':'R','테란':'T','저그':'Z','랜덤':'R',P:'P',T:'T',Z:'Z',R:'R'};
 const resultMap={'승':'W','패':'L','승리':'W','패배':'L',W:'W',L:'L'};
 const fingerprint=m=>JSON.stringify([m.date,m.type,m.opponent,m.race,m.myRace,m.map,m.result,m.build,m.enemyBuild,m.memo,m.tags]);
 const ids=new Set(existing.map(m=>m.id)),prints=new Set(existing.map(fingerprint));
 const added=[];let duplicate=0,invalid=0;
 for(const row of rows){
  if(!row||typeof row!=='object'||!['string','number'].includes(typeof row.id)||!/^[a-zA-Z0-9_-]{1,80}$/.test(String(row.id))){invalid++;continue}
  const string=k=>typeof row[k]==='string'?row[k].trim():'';
  const blocks=[['당시 상대 티어',string('tier')],['패인 / 경기 포인트',string('cause')],['느낀 점 / 메모',string('note')],['피드백',string('feedback')],['내 종족',myRace==='R'?'이전 기록에 정보 없음 · 미등록':'']].filter(([,v])=>v).map(([k,v])=>`[${k}]\n${v}`);
  const m={id:'sponsor-'+row.id,date:string('date'),type:'스폰',opponent:string('opponent'),race:raceMap[string('race')]||'R',myRace,result:resultMap[string('result')],map:string('map')||'맵 미입력',build:string('myBuild'),enemyBuild:string('enemyBuild'),memo:blocks.join('\n\n'),tags:'',star:false,legacyRecord:{...row},created:typeof row.id==='number'&&Number.isSafeInteger(row.id)?row.id:0};
  if(!validMatch(m)){invalid++;continue}
  const fp=fingerprint(m);if(ids.has(m.id)||prints.has(fp)){duplicate++;continue}
  ids.add(m.id);prints.add(fp);added.push(m);
 }
 return {added,duplicate,invalid};
}
async function importSponsorFile(input){
 const file=input.files[0];input.value='';if(!file)return;
 if(file.size>20*1024*1024){toast('20MB 이하의 백업 파일을 선택해 주세요.');return}
 try{
  const rows=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
  const myRace=document.getElementById('legacyRace').value;
  const preview=convertSponsorBackup(rows,myRace,[...db.matches,...db.trash]);
  if(!preview.added.length){toast(`추가할 경기가 없어요. 중복 ${preview.duplicate}건 · 확인 필요 ${preview.invalid}건`);return}
  if(!confirm(`스폰노트 경기 ${preview.added.length}건을 추가할까요?\n중복 ${preview.duplicate}건 · 형식 확인 필요 ${preview.invalid}건은 제외돼요.\n내 종족: ${raceNames[myRace]}\n기존 기록과 설정은 유지하고, 패인·메모·피드백은 복기 메모에 보관해요.`))return;
  // Recheck current records after confirmation to avoid adding duplicates.
  const final=convertSponsorBackup(rows,myRace,[...db.matches,...db.trash]);
  if(change(d=>d.matches.push(...final.added))){render();toast(`${final.added.length}건을 가져왔어요. 중복 ${final.duplicate}건 · 확인 필요 ${final.invalid}건 제외`)}
 }catch(e){toast('스폰노트 백업 형식을 확인해 주세요. 기존 기록은 변경하지 않았어요.')}
}

async function restore(input){const file=input.files[0];input.value='';if(!file)return;if(file.size>20*1024*1024){toast('20MB 이하의 백업 파일을 선택해 주세요.');return}try{const parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(!validDB(parsed))throw Error('invalid');if(!confirm(`백업의 ${parsed.matches.length}개 경기로 현재 기록과 설정을 교체할까요? 현재 자료를 먼저 백업해 주세요.`))return;const was=storageOK;storageOK=true;if(commit(parsed)){render();toast('백업 자료를 복원했어요 ✨')}else storageOK=was}catch(e){toast('올바른 마이 스타로그 백업 파일이 아니에요. 기존 기록은 유지했어요.')}}
window.addEventListener('hashchange',render);window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue){try{const next=JSON.parse(e.newValue);if(validDB(next)){db=next;render()}}catch(e){}}});autoMigrateLegacy();render();



async function checkForUpdate(){
 const button=document.getElementById('updateCheck');
 if(button.disabled)return;
 button.disabled=true;button.textContent='확인 중…';
 let resultLabel='↻ 업데이트 확인';
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('./version.json?check='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw Error('version fetch failed');
  const latest=await response.json();
  if(!latest||typeof latest.version!=='string'||!/^\d+\.\d+\.\d+$/.test(latest.version))throw Error('invalid version');
  const comparison=compareVersion(latest.version,APP_VERSION);
  if(comparison===0){resultLabel='✓ 최신 버전 v'+APP_VERSION;toast('최신 버전이에요 · v'+APP_VERSION);return}
  if(comparison<0){resultLabel='↻ 배포 반영 중 · 다시 확인';toast('배포가 반영 중이에요. 잠시 후 다시 확인해 주세요.');return}
  resultLabel='새 버전 v'+latest.version+' · 다시 확인';
  if(confirm(`새 버전 v${latest.version}이 있어요. 지금 불러올까요?\n저장된 경기 기록과 설정은 그대로 유지돼요.`)){
   if(document.getElementById('editor').open)saveDraft();
   const url=new URL(location.href);url.searchParams.set('app_update',latest.version+'-'+Date.now());location.replace(url.href);
  }
 }catch(e){resultLabel='! 확인 실패 · 다시 시도';toast('업데이트를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')}
 finally{clearTimeout(timeout);button.disabled=false;button.textContent=resultLabel}
}
function compareVersion(a,b){const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1}return 0}


function readLegacyRecords(storage){
 const current=storage.getItem('spawnNote.records.v1');
 const raw=current===null?storage.getItem('newcatsleSpawnNote.records.v1'):current;
 if(raw===null)return {raw:null,rows:[]};
 const rows=JSON.parse(raw.replace(/^\uFEFF/,''));
 if(!Array.isArray(rows))throw Error('Invalid legacy records');
 return {raw,rows};
}
function autoMigrateLegacy(){
 if(!storageOK)return;
 try{
  const {rows}=readLegacyRecords(localStorage);if(!rows.length)return;
  const next=structuredClone(db);const handled=new Set(next.legacyMigratedIds||[]);
  const eligible=rows.filter(r=>!r||!handled.has(String(r.id)));
  const result=convertSponsorBackup(eligible,'R',[...next.matches,...next.trash]);
  if(!result.added.length&&!result.duplicate&&!result.invalid)return;
  next.matches.push(...result.added);
  // Remember only valid converted or already-present rows. Invalid rows remain retryable.
  for(const row of eligible){const one=convertSponsorBackup([row],'R',[]);if(one.added.length)handled.add(String(row.id))}
  next.legacyMigratedIds=[...handled];
  next.legacyMigration={imported:(next.legacyMigration?.imported||0)+result.added.length,invalid:result.invalid,updated:new Date().toISOString()};
  if(commit(next)&&result.added.length)setTimeout(()=>toast(`기존 스폰노트 ${result.added.length}건을 자동으로 가져왔어요. 원본은 그대로 보관돼요.`),300);
 }catch(e){window.legacyMigrationError=true;}
}
function showMigrationNotice(){
 const node=document.getElementById('migrationNotice');if(!node)return;
 const m=db.legacyMigration;
 if(window.legacyMigrationError){node.innerHTML='<div class="tip"><div><b>기존 기록을 읽지 못했어요.</b><p>원본은 변경하지 않았어요. 설정에서 기존 백업 파일을 가져올 수 있어요.</p></div></div>';return}
 if(!m){node.innerHTML='';return}
 node.innerHTML=`<div class="tip" style="margin:0 0 20px"><span>📚</span><div><b>기존 스폰노트 ${Number(m.imported)||0}건을 자동으로 가져왔어요.</b><p>원본 기록은 그대로 보관돼요. 이전 기록의 내 종족은 미등록으로 표시해요.${m.invalid?' 확인이 필요한 '+Number(m.invalid)+'건은 원본에 남겨뒀어요.':''}</p><button class="btn small" onclick="exportLegacyOriginal()">기존 원본 백업 저장</button></div></div>`;
}
function showWelcomeNotice(){
 const p=$('#welcomeNotice');let seen={};try{seen=JSON.parse(localStorage.getItem('my-starlog-spwn-notices-seen')||'{}')||{}}catch(e){}
 const key=window.legacyMigrationError?'error':db.legacyMigration?JSON.stringify([db.legacyMigration.imported,db.legacyMigration.invalid]):'';
 if(key&&seen.migration!==key&&window.migrationDismissed!==key){window.pendingMigrationKey=key;p.oncancel=e=>{e.preventDefault();dismissWelcomeNotice()};if(!p.open&&!document.querySelector('dialog[open]'))p.showModal();return}promptProfile();
}
function dismissWelcomeNotice(){const key=window.pendingMigrationKey;window.migrationDismissed=key;try{localStorage.setItem('my-starlog-spwn-notices-seen',JSON.stringify({migration:key}))}catch(e){}$('#welcomeNotice').close();promptProfile()}
function exportLegacyOriginal(){
 try{const {raw}=readLegacyRecords(localStorage);if(raw===null){toast('기존 원본 기록이 없어요.');return}
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='sponsor-note-original-backup.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }catch(e){toast('원본 백업을 읽지 못했어요. 원본은 변경하지 않았어요.')}
}
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}));}

function openProfile(){const p=$('#profileDialog');$('#profileInputName').value=db.settings.name;$('#profileInputRace').value=db.settings.race;p.oncancel=e=>{e.preventDefault();closeProfile()};if(!p.open)p.showModal()}
function closeProfile(){window.profileDeferred=true;$('#profileDialog').close()}
function saveProfile(event){event.preventDefault();const name=$('#profileInputName').value.trim(),race=$('#profileInputRace').value;if(!name){$('#profileInputName').setCustomValidity('이름을 입력해 주세요.');$('#profileInputName').reportValidity();return false}if(!['P','T','Z','R'].includes(race))return false;if(change(d=>{d.settings.name=name;d.settings.race=race})){closeProfile();render();toast('이름과 종족을 저장했어요 ✨')}return false}
function promptProfile(){if(location.hash==='#tiers')return;if(!db.settings.name.trim()&&!window.profileDeferred&&!document.querySelector('dialog[open]'))openProfile()}
function showTrash(){const p=$('#trashDialog');$('#trashItems').innerHTML=db.trash.length?db.trash.map(m=>'<div style="padding:12px">'+esc(m.date)+' · '+esc(m.opponent)+' <button class="btn small" onclick="recover(\''+m.id+'\');showTrash()">복구</button></div>').join(''):'휴지통이 비어 있어요.';if(!p.open)p.showModal()}
