from pathlib import Path
import os,json,base64,urllib.request,urllib.parse

ui_path=Path('ui.js')
ui=ui_path.read_text(encoding='utf-8')
marker='if ("serviceWorker" in navigator) {'
if 'PLAYER_MASTER_URL' not in ui:
    inject=r'''
/* v1.6.0 · shared player master DB */
const PLAYER_MASTER_URL = "https://hanuri2000-svg.github.io/star-match-manager/players.json";
let masterPlayerPayload = null;
let masterPlayerDirectory = {};

function masterNameKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

async function loadSharedPlayerMaster(force = false) {
  try {
    const response = await fetch(`${PLAYER_MASTER_URL}${force ? `?t=${Date.now()}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("공용 선수 DB를 불러오지 못했어.");
    const payload = await response.json();
    const players = Array.isArray(payload.players) ? payload.players.filter((p) => p && p.active !== false && p.name) : [];
    const directory = {};
    players.forEach((player) => {
      const meta = { name: player.name, tier: player.tier || "", race: player.race || "" };
      directory[masterNameKey(player.name)] = meta;
      (player.aliases || []).forEach((alias) => { if (alias) directory[masterNameKey(alias)] = meta; });
    });
    masterPlayerPayload = payload;
    masterPlayerDirectory = directory;

    const order = Array.isArray(payload.tierOrder) ? payload.tierOrder : [];
    const groups = new Map();
    players.forEach((player) => {
      const label = player.tierLabel || (player.tier === "유스" ? "베이비" : player.tier || "미지정");
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({
        name: player.name,
        race: player.race || "",
        playerId: player.eloId || null,
        soopId: player.soopId || "",
        thumbUrl: player.thumbUrl || "",
      });
    });
    const labels = [...order.map((t) => t === "유스" ? "베이비" : t), ...groups.keys()]
      .filter((v, i, a) => a.indexOf(v) === i && groups.has(v));
    tierPayload = {
      version: payload.source?.version || "master",
      updatedOn: payload.source?.date || payload.updatedAt || "",
      tiers: labels.map((label) => ({ label, players: groups.get(label) })),
    };
    writeTierCache(tierPayload);

    let list = document.getElementById("masterPlayerNames");
    if (!list) {
      list = document.createElement("datalist");
      list.id = "masterPlayerNames";
      document.body.appendChild(list);
    }
    list.innerHTML = players.map((p) => `<option value="${esc(p.name)}">${esc(p.tier || "")} · ${esc(p.race || "")}</option>`).join("");
    const opponent = form?.elements?.opponent;
    if (opponent) {
      opponent.setAttribute("list", "masterPlayerNames");
      autoFillRecordPlayer(opponent);
    }
    renderTierTable();
    return payload;
  } catch (error) {
    console.warn("공용 선수 DB 연결 실패, 저장된/ELO 티어표 사용", error);
    return null;
  }
}

const legacySharedPlayerDirectory = sharedPlayerDirectory;
sharedPlayerDirectory = function () {
  let parentDirectory = {};
  try { parentDirectory = window.parent?.HARINA_PLAYER_DIRECTORY || {}; } catch {}
  return Object.assign({}, legacySharedPlayerDirectory(), parentDirectory, masterPlayerDirectory);
};

const legacyLoadTierTable = loadTierTable;
loadTierTable = async function (force = false) {
  if (tierLoading) return;
  tierLoading = true;
  tierError = "";
  renderTierTable();
  try {
    const [masterResult] = await Promise.allSettled([loadSharedPlayerMaster(force), fetchTierLive()]);
    if (masterResult.status === "rejected" || !masterResult.value) {
      const cached = readTierCache();
      if (cached) tierPayload = cached;
      else return legacyLoadTierTable(force);
    }
    if (!tierRefreshTimer) {
      tierRefreshTimer = setInterval(() => {
        if (!$("#tier")?.classList.contains("hidden")) fetchTierLive().then(renderTierTable);
      }, 60000);
    }
  } finally {
    tierLoading = false;
    renderTierTable();
    autoFillRecordPlayer(form?.elements?.opponent);
  }
};

const legacyLoad = load;
load = function () {
  legacyLoad();
  loadSharedPlayerMaster(false);
};
'''
    if marker not in ui: raise SystemExit('service worker marker not found')
    ui=ui.replace(marker,inject+'\n'+marker,1)
ui_path.write_text(ui,encoding='utf-8')

index=Path('index.html').read_text(encoding='utf-8')
index=index.replace('v1.5.0</span>','v1.6.0</span>')
Path('index.html').write_text(index,encoding='utf-8')

sw=Path('sw.js').read_text(encoding='utf-8').replace('spawn-note-v1.5.0','spawn-note-v1.6.0')
Path('sw.js').write_text(sw,encoding='utf-8')

repo=os.environ['GITHUB_REPOSITORY'];token=os.environ['GH_TOKEN'];branch='main'
def api(path,method='GET',payload=None):
    url='https://api.github.com/repos/'+repo+'/contents/'+urllib.parse.quote(path,safe='/')
    req=urllib.request.Request(url,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'shared-player-master'})
    if payload is not None:
        req.data=json.dumps(payload).encode();req.add_header('Content-Type','application/json')
    with urllib.request.urlopen(req) as r:return json.load(r)
def put(path,text,message):
    try:sha=api(path).get('sha')
    except Exception:sha=None
    body={'message':message,'content':base64.b64encode(text.encode()).decode(),'branch':branch}
    if sha:body['sha']=sha
    api(path,'PUT',body)
put('ui.js',ui,'Connect 스폰노트 to shared player master DB v1.6.0')
put('index.html',index,'Release 스폰노트 v1.6.0')
put('sw.js',sw,'Bump 스폰노트 cache v1.6.0')
