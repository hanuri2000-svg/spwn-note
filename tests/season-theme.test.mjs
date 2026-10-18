import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = p => fs.readFileSync(new URL("../"+p, import.meta.url),"utf8");
const script = read("season-theme.js");
const style = read("season-theme.css");
const html = read("index.html");
const worker = read("sw.js");
const version = JSON.parse(read("version.json")).version;
const palettesMatch = script.match(/const PALETTES = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(palettesMatch, "monthly colors should be declarative and verifiable");
const palette = JSON.parse(palettesMatch[1]);
function luminance(color) {
  const rgb = color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
const whiteContrast = c => 1.05/(0.05+luminance(c));

function simulate(initialMonth, embedded=false) {
  let month=initialMonth;
  const children=[];
  const changed={};
  const listeners={};
  const styles={};
  const node=(tag)=>({
    tag,children:[],attrs:{},className:"",textContent:"",
    setAttribute(k,v){this.attrs[k]=v;},
    appendChild(child){this.children.push(child);return child;},
    replaceChildren(...items){this.children=items;}
  });
  const heading=node("h1");
  const body=node("body");
  body.appendChild=function(child){children.push(child);return child};
  const root={dataset:{},style:{setProperty(k,v){styles[k]=v;}}};
  const document={
    documentElement:root,body,hidden:false,
    querySelector(sel){assert.equal(sel,".brandtext h1");return heading;},
    createElement:node,
    addEventListener(event,listener){listeners[event]=listener;}
  };
  const window={addEventListener(event,listener){listeners[event]=listener;}};
  const timers=[];
  vm.runInNewContext(script,{
    document,window,location:{search:embedded?"?embed=1":""},URLSearchParams,
    Intl:{DateTimeFormat:function DateTimeFormat(){this.format=()=>String(month);}},
    Date,setInterval(callback,delay){timers.push({callback,delay})}
  });
  return {root,children,heading,timers,listeners,styles,setMonth(value){month=value},document};
}
test("1–12월 전체가 독립된 색상과 계절 장식을 가진다",()=>{
  assert.equal(version,"1.7.11");
  assert.equal(Object.keys(palette).length,12);
  for(let month=1;month<=12;month++){
    const x=palette[String(month)];
    assert.ok(x);
    assert.equal(x.decor.length,3);
    for(const color of ["bg","soft","header","accent"])assert.match(x[color],/^#[0-9a-f]{6}$/i);
    assert.ok(whiteContrast(x.accent)>=4.5,month+"월 버튼 명암비");
    assert.ok(whiteContrast(x.header)>=4.5,month+"월 상단 명암비");
  }
  assert.equal(palette["10"].icon,"🍁");
  assert.equal(palette["12"].icon,"🎄");
  assert.notEqual(palette["3"].bg,palette["5"].bg);
  assert.notEqual(palette["9"].bg,palette["10"].bg);
  assert.notEqual(palette["10"].bg,palette["11"].bg);
});
test("매월 배경·상단·장식이 함께 바뀌며 자동 재확인한다",()=>{
  for(let month=1;month<=12;month++){
    const a=simulate(month);
    assert.equal(a.root.dataset.spwnSeason,String(month));
    assert.equal(a.children.length,1);
    assert.equal(a.children[0].attrs["aria-hidden"],"true");
    assert.deepEqual(Array.from(a.children[0].children,child=>child.textContent),palette[month].decor);
    assert.equal(a.styles["--spwn-header"],palette[month].header);
    assert.equal(a.styles["--spwn-accent"],palette[month].accent);
    assert.ok(a.heading.children[0].textContent.includes(month+"월"));
    assert.equal(a.timers[0].delay,900000);
  }
  const a=simulate(10);
  a.setMonth(12);
  a.listeners.pageshow();
  assert.equal(a.root.dataset.spwnSeason,"12");
  assert.deepEqual(Array.from(a.children[0].children,child=>child.textContent),palette["12"].decor);
  a.setMonth(1);
  a.timers[0].callback();
  assert.equal(a.root.dataset.spwnSeason,"1");
  a.document.hidden=true;
  a.setMonth(2);
  a.timers[0].callback();
  assert.equal(a.root.dataset.spwnSeason,"1");
  a.document.hidden=false;
  a.listeners.visibilitychange();
  assert.equal(a.root.dataset.spwnSeason,"2");
});
test("독립 페이지에만 적용하고 도랑이꺼야 임베드는 건드리지 않는다",()=>{
  const a=simulate(10,true);
  assert.equal(a.children.length,0);
  assert.equal(a.root.dataset.spwnSeason,undefined);
  assert.match(script,/Asia\/Seoul/);
  assert.match(style,/html\[data-spwn-season\] body > header/);
  assert.match(style,/html\[data-spwn-season\] \.tier-group/);
  assert.match(style,/pointer-events: none/);
  assert.match(style,/@media\(max-width:700px\)/);
  assert.match(style,/html\[data-spwn-season\] body::before/);
});
test("버전과 서비스워커 캐시가 계절 파일까지 일치한다",()=>{
  assert.ok(html.includes('season-theme.css?v='+version));
  assert.ok(html.includes('season-theme.js?v='+version));
  assert.ok(html.includes('ui.js?v='+version));
  assert.ok(html.includes('v'+version+'</span>'));
  assert.ok(worker.includes("spawn-note-v"+version));
  assert.ok(worker.includes('"./season-theme.css"'));
  assert.ok(worker.includes('"./season-theme.js"'));
  new vm.Script(script);
});

