/* The Extra Coach Facilities — app screens. Data calls go through window.DB (js/data.js). */
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dObj=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d,12);};
const addDays=(s,n)=>{const d=dObj(s);d.setDate(d.getDate()+n);return iso(d);};
const todayISO=()=>iso(new Date());
const toMin=t=>{const [h,m]=String(t||"0:0").split(":").map(Number);return h*60+m;};
const fromMin=m=>`${pad(Math.floor(m/60))}:${pad(m%60)}`;
const ampm=t=>{if(!t)return "";const [h,m]=t.split(":").map(Number);return `${((h+11)%12)+1}${m?":"+pad(m):""} ${h<12?"AM":"PM"}`;};
const span=(a,b)=>{const A=ampm(a),B=ampm(b);return A.slice(-2)===B.slice(-2)?`${A.slice(0,-3)} – ${B}`:`${A} – ${B}`;};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],DOWL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MON=["January","February","March","April","May","June","July","August","September","October","November","December"];
const longDay=s=>dObj(s).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
const shortDay=s=>dObj(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
const startOfWeek=s=>{const d=dObj(s);d.setDate(d.getDate()-d.getDay());return iso(d);};   // Sunday
const msg=(el,t,k)=>{el.textContent=t||"";el.className="msg"+(k?" "+k:"");};
let toastT;const toast=t=>{const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,3600);};
const show=id=>{$$(".screen").forEach(s=>s.hidden=s.id!==id);};
const store={get(k,d){try{const v=localStorage.getItem("fac:"+k);return v==null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem("fac:"+k,JSON.stringify(v));}catch{}}};

/* ---------- state ---------- */
const S={orgs:[],org:null,spaces:[],bookings:[],members:[],invites:[],
  view:store.get("view","month"),date:todayISO(),focus:store.get("focusSpace",null),tab:"schedule",pub:null};
const role=()=>S.org?S.org.role:null,isAdmin=()=>role()==="admin",canBook=()=>role()==="admin"||role()==="editor";
const direct=()=>isAdmin()||(role()==="editor"&&(S.org.direct||S.org.approval===false));
const spaceOf=id=>S.spaces.find(s=>s.id===id)||{name:"Space",color:"#888"};
/* One gym at a time by default (the one you last picked); "All" puts every space side by side. */
const focusId=()=>S.focus==="all"||S.spaces.length<2?"all":(S.spaces.some(s=>s.id===S.focus)?S.focus:S.spaces[0].id);
const visibleSpaces=()=>{const f=focusId();return f==="all"?S.spaces:S.spaces.filter(s=>s.id===f);};
const shown=id=>{const f=focusId();return f==="all"||f===id;};

/* ---------- start ---------- */
async function start(){
  const p=new URLSearchParams(location.search);
  if(p.get("s")){startPublic(p.get("s"));return;}
  if(DB.demo)demoBar();
  if(/type=recovery/.test(location.hash)){show("screen-newpw");return;}
  const u=await DB.session().catch(()=>null);
  DB.onAuth((ev,u2)=>{if(ev==="PASSWORD_RECOVERY")show("screen-newpw");else if(ev==="SIGNED_IN"&&u2&&!S.signedIn)afterLogin();});
  if(u)afterLogin();else{show("screen-auth");}
}
async function afterLogin(){
  S.signedIn=true;
  await DB.claimInvites();
  try{S.orgs=await DB.orgs();}catch(e){show("screen-setup");msg($("#suMsg"),e.message,"err");return;}
  if(!S.orgs.length){setupScreen();return;}
  const last=store.get("org",null);S.org=S.orgs.find(o=>o.id===last)||S.orgs[0];
  await openOrg();
}
async function openOrg(){
  store.set("org",S.org.id);
  document.body.classList.toggle("is-admin",isAdmin());
  document.body.classList.toggle("can-book",canBook());
  document.body.classList.toggle("is-editor",role()==="editor");
  S.spaces=await DB.spaces(S.org.id);
  show("screen-app");renderOrgPick();renderMe();
  if(!isAdmin()&&["requests","people","settings"].includes(S.tab))S.tab="schedule";
  if(role()!=="editor"&&S.tab==="mine")S.tab="schedule";
  setTab(S.tab);refreshBadge();
}

/* ---------- auth ---------- */
let authMode="in";
$$("[data-auth]").forEach(b=>b.addEventListener("click",()=>{authMode=b.dataset.auth;
  $$("[data-auth]").forEach(x=>x.setAttribute("aria-selected",x===b));$("#fName").hidden=authMode!=="up";
  $("#authGo").textContent=authMode==="up"?"Create account":"Sign in";$("#aPw").autocomplete=authMode==="up"?"new-password":"current-password";msg($("#authMsg"),"");}));
$("#authForm").addEventListener("submit",async e=>{e.preventDefault();
  const email=$("#aEmail").value.trim(),pw=$("#aPw").value,b=$("#authGo");
  if(!/^\S+@\S+\.\S+$/.test(email)){msg($("#authMsg"),"Enter your email.","err");return;}
  if(pw.length<6){msg($("#authMsg"),"Passwords are at least 6 characters.","err");return;}
  b.disabled=true;msg($("#authMsg"),authMode==="up"?"Creating your account…":"Signing in…");
  try{if(authMode==="up"){const r=await DB.signUp(email,pw,$("#aName").value.trim());
      if(r.needsConfirm){msg($("#authMsg"),"Check your email to confirm your account, then sign in here.","ok");b.disabled=false;return;}}
    else await DB.signIn(email,pw);
    afterLogin();}
  catch(err){msg($("#authMsg"),err.message,"err");}b.disabled=false;});
$("#authForgot").addEventListener("click",async()=>{const email=$("#aEmail").value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)){msg($("#authMsg"),"Type your email above first, then tap Forgot password.","err");$("#aEmail").focus();return;}
  try{await DB.resetPassword(email);msg($("#authMsg"),"We sent a link to reset your password.","ok");}catch(err){msg($("#authMsg"),err.message,"err");}});
$("#newPwForm").addEventListener("submit",async e=>{e.preventDefault();const pw=$("#npPw").value;
  if(pw.length<6){msg($("#npMsg"),"At least 6 characters.","err");return;}
  try{await DB.setPassword(pw);history.replaceState(null,"",location.pathname);afterLogin();}catch(err){msg($("#npMsg"),err.message,"err");}});
document.addEventListener("click",async e=>{if(!e.target.closest("[data-signout]"))return;await DB.signOut();store.set("org",null);location.href=location.pathname;});

/* ---------- first school ---------- */
let suSpaces=["Main Gym"];
function setupScreen(){show("screen-setup");const u=DB.user();$("#suEmail").textContent=u?u.email:"your email";renderSuSpaces();}
function renderSuSpaces(){$("#suSpaces").innerHTML=suSpaces.map((s,i)=>`<span class="chip">${esc(s)}<button type="button" data-surm="${i}" aria-label="Remove ${esc(s)}">✕</button></span>`).join("")||`<span class="help">Add at least one.</span>`;}
$("#suSpaces").addEventListener("click",e=>{const b=e.target.closest("[data-surm]");if(b){suSpaces.splice(+b.dataset.surm,1);renderSuSpaces();}});
const suAdd=()=>{const v=$("#suAdd").value.trim();if(v&&!suSpaces.includes(v))suSpaces.push(v);$("#suAdd").value="";renderSuSpaces();$("#suAdd").focus();};
$("#suAddBtn").addEventListener("click",suAdd);
$("#suAdd").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();suAdd();}});
$("#setupForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("#suName").value.trim();
  if($("#suAdd").value.trim())suAdd();
  if(!name){msg($("#suMsg"),"Add the school's name.","err");return;}if(!suSpaces.length){msg($("#suMsg"),"Add at least one space.","err");return;}
  try{const id=await DB.createOrg(name,suSpaces);S.orgs=await DB.orgs();S.org=S.orgs.find(o=>o.id===id)||S.orgs[0];await openOrg();toast("Your school is ready. Add your staff on the People tab.");}
  catch(err){msg($("#suMsg"),err.message,"err");}});

/* ---------- header ---------- */
function renderOrgPick(){
  const el=$("#orgPick");
  el.innerHTML=S.orgs.length>1?`<select id="orgSel" aria-label="School">${S.orgs.map(o=>`<option value="${o.id}"${o.id===S.org.id?" selected":""}>${esc(o.name)}</option>`).join("")}<option value="__new">+ Add another school</option></select>`
    :`<span class="org-name">${esc(S.org.name)}</span>`;
  const sel=$("#orgSel");if(sel)sel.addEventListener("change",async()=>{if(sel.value==="__new"){suSpaces=["Main Gym"];setupScreen();return;}S.org=S.orgs.find(o=>o.id===sel.value);await openOrg();});
}
const ROLE_L={admin:"Administrator",editor:"Editor",viewer:"Viewer"};
function renderMe(){
  const u=DB.user()||{},name=(u.user_metadata&&u.user_metadata.full_name)||u.name||u.email||"";
  const ini=(name.match(/\b\w/g)||["?"]).slice(0,2).join("").toUpperCase();
  $("#meBox").innerHTML=`<button type="button" aria-label="Account" aria-expanded="false">${esc(ini)}</button><div class="me-menu" hidden><b>${esc(name)}</b><small>${esc(u.email||"")}</small>
    <span class="role">${ROLE_L[role()]||""} · ${esc(S.org.name)}</span>${S.orgs.length<2?`<button class="btn sm" type="button" data-newschool>+ Add another school</button>`:""}<button class="btn sm" type="button" data-signout>Sign out</button></div>`;
}
document.addEventListener("click",e=>{const m=$("#meBox .me-menu");if(!m)return;
  if(e.target.closest("#meBox>button")){m.hidden=!m.hidden;e.target.closest("button").setAttribute("aria-expanded",!m.hidden);return;}
  if(e.target.closest("[data-newschool]")){suSpaces=["Main Gym"];setupScreen();return;}
  if(!e.target.closest(".me-menu"))m.hidden=true;});

/* ---------- tabs ---------- */
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b)setTab(b.dataset.tab);});
function setTab(t){S.tab=t;$$("#tabs [data-tab]").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  $$(".view").forEach(v=>v.hidden=v.id!=="view-"+t);
  ({schedule:loadSchedule,requests:renderRequests,mine:renderMine,people:renderPeople,settings:renderSettings})[t]();}

/* ---------- schedule ---------- */
function range(){
  if(S.view==="day")return [S.date,S.date];
  if(S.view==="week"){const a=startOfWeek(S.date);return [a,addDays(a,6)];}
  const d=dObj(S.date),first=iso(new Date(d.getFullYear(),d.getMonth(),1,12)),a=startOfWeek(first);return [a,addDays(a,41)];
}
async function loadSchedule(){
  const [a,b]=range();
  renderSchedule(true);
  try{S.bookings=S.pub?S.pub.bookings:(await DB.bookings(S.org.id,a,b));}catch(e){$("#schBody").innerHTML=`<div class="empty">${esc(e.message)}</div>`;return;}
  renderSchedule();
}
function renderSchedule(loading){
  $$("[data-view]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===S.view));
  const d=dObj(S.date);
  if(S.view==="day"){$("#schTitle").textContent=d.toLocaleDateString("en-US",{weekday:"long"});$("#schSub").textContent=d.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});}
  else if(S.view==="week"){const [a,b]=range();const A=dObj(a),B=dObj(b);$("#schTitle").textContent=`Week of ${MON[A.getMonth()].slice(0,3)} ${A.getDate()}`;
    $("#schSub").textContent=`${shortDay(a)} – ${shortDay(b)}, ${B.getFullYear()}`;}
  else{$("#schTitle").textContent=`${MON[d.getMonth()]} ${d.getFullYear()}`;$("#schSub").textContent="";}
  renderSpaceFilter();
  {const f=focusId();if(f!=="all"){const n=spaceOf(f).name;$("#schSub").textContent=($("#schSub").textContent?$("#schSub").textContent+" · ":"")+n;}}
  if(loading&&!S.bookings.length){$("#schBody").innerHTML=`<div class="empty">Loading…</div>`;return;}
  if(!S.spaces.length){$("#schBody").innerHTML=`<div class="empty">No spaces yet.${isAdmin()?" Add your gyms and rooms in Settings.":""}</div>`;return;}
  const list=S.bookings.filter(b=>b.status!=="declined"&&shown(b.space_id));
  $("#schBody").innerHTML=S.view==="day"?dayHTML(list):S.view==="week"?weekHTML(list):monthHTML(list);
  if(S.view==="day")scrollDay();
}
function renderSpaceFilter(){
  const el=$("#spaceFilter");if(S.spaces.length<2){el.innerHTML="";return;}const f=focusId();
  const chip=(id,label,color)=>`<label class="sf${f===id?" on":""}" style="--c:${esc(color)}"><input type="radio" name="spf" data-sf="${id}"${f===id?" checked":""}>${id==="all"?"":"<i></i>"}${esc(label)}</label>`;
  el.innerHTML=S.spaces.map(s=>chip(s.id,s.name,s.color)).join("")+chip("all","All spaces","var(--muted)");
}
$("#spaceFilter").addEventListener("change",e=>{const id=e.target.dataset.sf;if(!id)return;
  S.focus=id;if(!S.pub)store.set("focusSpace",id);renderSchedule();});
const evHTML=(b,style="")=>{const sp=spaceOf(b.space_id);
  return `<button type="button" class="ev ${b.status}" data-bk="${b.id}" style="--c:${esc(sp.color)};${style}"><b>${esc(b.title)}</b><small>${span(b.start_time,b.end_time)}${S.view!=="day"&&focusId()==="all"?" · "+esc(sp.name):""}</small>${b.status==="pending"?`<span class="st">Waiting for approval</span>`:""}</button>`;};

/* Day: spaces side by side on a time grid. Overlapping requests share the column. */
function dayHTML(list){
  const org=S.pub?S.pub.org:S.org,sp=visibleSpaces();if(!sp.length)return `<div class="empty">Pick at least one space above.</div>`;
  let a=toMin(org.day_start||"06:00"),z=toMin(org.day_end||"22:00");
  list.forEach(b=>{a=Math.min(a,Math.floor(toMin(b.start_time)/60)*60);z=Math.max(z,Math.ceil(toMin(b.end_time)/60)*60);});
  a=Math.floor(a/60)*60;z=Math.ceil(z/60)*60;
  const H=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour"))||52,px=m=>(m-a)/60*H,hours=(z-a)/60;
  const cols=sp.map(s=>{const items=list.filter(b=>b.space_id===s.id).sort((x,y)=>toMin(x.start_time)-toMin(y.start_time));
    const lanes=[];items.forEach(b=>{let l=lanes.findIndex(end=>end<=toMin(b.start_time));if(l<0){l=lanes.length;lanes.push(0);}lanes[l]=toMin(b.end_time);b._l=l;});
    const n=Math.max(1,lanes.length);
    const now=S.date===todayISO()?(()=>{const t=new Date(),m=t.getHours()*60+t.getMinutes();return m>=a&&m<=z?`<div class="now" style="top:${px(m)}px"></div>`:"";})():"";
    return `<div class="col" data-col="${s.id}" style="height:${hours*H}px">${now}${items.map(b=>{const top=px(toMin(b.start_time)),h=Math.max(22,px(toMin(b.end_time))-top-2);
      return evHTML(b,`top:${top+1}px;height:${h}px;left:calc(${b._l/n*100}% + 3px);right:auto;width:calc(${100/n}% - 6px)`);}).join("")}</div>`;}).join("");
  const times=Array.from({length:hours},(_,i)=>`<div>${i?ampm(fromMin(a+i*60)):""}</div>`).join("");
  return `<div class="day-wrap" data-start="${a}"><div class="day-grid" style="--cols:${sp.length}"><div class="hd corner"></div>${sp.map(s=>`<div class="hd" style="--c:${esc(s.color)}"><i></i><span>${esc(s.name)}</span></div>`).join("")}
    <div class="times">${times}</div>${cols}</div></div>`;
}
function scrollDay(){const w=$(".day-wrap");if(!w)return;const a=+w.dataset.start,H=52;
  const first=S.bookings.filter(b=>b.date===S.date&&shown(b.space_id)).map(b=>toMin(b.start_time)).sort((x,y)=>x-y)[0];
  const t=S.date===todayISO()?new Date().getHours()*60-60:first!=null?first-30:8*60;w.scrollTop=Math.max(0,(t-a)/60*H);}
function weekHTML(list){
  const [a]=range(),t=todayISO();
  return `<div class="week">${Array.from({length:7},(_,i)=>{const d=addDays(a,i),items=list.filter(b=>b.date===d);const D=dObj(d);
    return `<section class="wk-day${d===t?" today":""}${d<t?" past":""}"><button type="button" class="wk-h" data-goday="${d}"><b>${DOW[D.getDay()]}</b><small>${MON[D.getMonth()].slice(0,3)} ${D.getDate()}</small></button>
      ${items.length?items.map(b=>evHTML(b)).join(""):`<span class="none">Open</span>`}${S.pub?"":`<button type="button" class="wk-add" data-addday="${d}">+ Book</button>`}</section>`;}).join("")}</div>`;
}
/* Month: like The Extra Coach calendar. Each day lists what's booked; the bar shows how full the day is. Tap a day for open times. */
function dayBounds(){const org=S.pub?S.pub.org:S.org;return [toMin(org.day_start||"06:00"),toMin(org.day_end||"22:00")];}
function fullness(items,nSpaces){const [a,z]=dayBounds();if(z<=a)return 0;let used=0;
  const by={};items.forEach(b=>{(by[b.space_id]=by[b.space_id]||[]).push([Math.max(a,toMin(b.start_time)),Math.min(z,toMin(b.end_time))]);});
  Object.values(by).forEach(l=>{l.sort((x,y)=>x[0]-y[0]);let cs=-1,ce=-1;l.forEach(([x,y])=>{if(x>ce){if(ce>cs)used+=ce-cs;cs=x;ce=y;}else ce=Math.max(ce,y);});if(ce>cs)used+=ce-cs;});
  return Math.min(1,used/((z-a)*Math.max(1,nSpaces)));}
function monthHTML(list){
  const [a]=range(),m=dObj(S.date).getMonth(),t=todayISO(),one=focusId()!=="all",n=visibleSpaces().length;
  return `<div class="month${one?" one":""}"><div class="mo-h">${DOW.map(x=>`<div>${x}</div>`).join("")}</div><div class="mo-g">${Array.from({length:42},(_,i)=>{const d=addDays(a,i),D=dObj(d),items=list.filter(b=>b.date===d);
    const full=fullness(items.filter(b=>b.status==="approved"),n),pct=Math.round(full*100);
    return `<button type="button" class="mo-c${D.getMonth()!==m?" out":""}${d===t?" today":""}${d<t?" past":""}" data-peek="${d}" aria-label="${esc(longDay(d))}: ${items.length} booking${items.length===1?"":"s"}, ${100-pct}% open"><span class="n">${D.getDate()}</span>
      <span class="mo-list">${items.slice(0,3).map(b=>`<span class="mo-e ${b.status}" style="--c:${esc(spaceOf(b.space_id).color)}"><i></i><span><b>${esc(b.title)}</b><small>${esc(ampm(b.start_time).replace(":00","").replace(" ",""))}</small></span></span>`).join("")}</span>
      ${items.length>3?`<span class="mo-more">+${items.length-3} more</span>`:""}
      <span class="mo-bar" title="${100-pct}% open"><i style="width:${pct}%"></i></span></button>`;}).join("")}</div></div>`;
}
/* Tap a day: what's booked and the open times in between, for the gym you're looking at (or every space). */
function slotsFor(spaceId,date,list){
  const [a,z]=dayBounds(),items=list.filter(b=>b.space_id===spaceId&&b.date===date&&b.status!=="declined").sort((x,y)=>toMin(x.start_time)-toMin(y.start_time));
  const out=[];let cur=a;
  items.forEach(b=>{const st=toMin(b.start_time),en=toMin(b.end_time);if(st-cur>=15)out.push({open:true,s:cur,e:st});out.push({b});cur=Math.max(cur,en);});
  if(z-cur>=15)out.push({open:true,s:cur,e:z});return out;}
const dur=m=>{const h=Math.floor(m/60),r=m%60;return (h?h+" hr":"")+(h&&r?" ":"")+(r?r+" min":"");};
function peekDay(date){
  let d=$("#peekDlg");
  if(!d){d=document.createElement("dialog");d.id="peekDlg";d.className="sheet";document.body.appendChild(d);
    d.addEventListener("click",e=>{if(e.target===d||e.target.closest("[data-pk=close]")){d.close();return;}
      const bk=e.target.closest("[data-pkbook]");if(bk){d.close();const [sp,st,en]=bk.dataset.pkbook.split("|");openBook({date:d.dataset.date,space_id:sp,start_time:fromMin(+st),end_time:fromMin(Math.min(+en,+st+120))});return;}
      const ev=e.target.closest("[data-bk]");if(ev){d.close();openDetail(S.bookings.find(b=>b.id===ev.dataset.bk));return;}
      if(e.target.closest("[data-pk=day]")){d.close();S.date=d.dataset.date;S.view="day";if(!S.pub)store.set("view","day");loadSchedule();}});}
  d.dataset.date=date;const past=date<todayISO(),sp=visibleSpaces();
  d.innerHTML=`<div><div class="sheet-head"><div><h2>${esc(dObj(date).toLocaleDateString("en-US",{weekday:"long"}))}</h2><p class="sub" style="margin:2px 0 0">${esc(dObj(date).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}))}</p></div>
      <button class="btn icon" type="button" data-pk="close" aria-label="Close">✕</button></div>
    ${sp.map(s=>{const rows=slotsFor(s.id,date,S.bookings);const free=rows.filter(r=>r.open).reduce((t,r)=>t+r.e-r.s,0);
      return `<section class="pk-sp" style="--c:${esc(s.color)}"><h3><i></i>${esc(s.name)}<small>${free?dur(free)+" open":"Fully booked"}</small></h3><ol class="slots">${rows.map(r=>r.open?
        `<li class="slot open"><span class="t">${span(fromMin(r.s),fromMin(r.e))}</span><span class="w"><b>Open</b><small>${dur(r.e-r.s)}</small></span>${canBook()&&!S.pub&&!past?`<button class="btn sm" type="button" data-pkbook="${s.id}|${r.s}|${r.e}">${direct()?"Book":"Request"}</button>`:""}</li>`:
        `<li class="slot ${r.b.status}"><span class="t">${span(r.b.start_time,r.b.end_time)}</span><button type="button" class="w" data-bk="${r.b.id}"><b>${esc(r.b.title)}</b><small>${r.b.status==="pending"?"Waiting for approval":esc(r.b.group_name||"Booked")}</small></button></li>`).join("")}</ol></section>`;}).join("")}
    <div class="actions"><button class="btn" type="button" data-pk="day">See the day on a timeline</button></div></div>`;
  d.showModal();
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>{S.view=b.dataset.view;if(!S.pub)store.set("view",S.view);loadSchedule();}));
const step=dir=>{if(S.view==="day")S.date=addDays(S.date,dir);else if(S.view==="week")S.date=addDays(S.date,7*dir);else{const d=dObj(S.date);S.date=iso(new Date(d.getFullYear(),d.getMonth()+dir,1,12));}loadSchedule();};
$("#prev").addEventListener("click",()=>step(-1));$("#next").addEventListener("click",()=>step(1));
$("#today").addEventListener("click",()=>{S.date=todayISO();loadSchedule();});
$("#schBody").addEventListener("click",e=>{
  const ev=e.target.closest("[data-bk]");if(ev){openDetail(S.bookings.find(b=>b.id===ev.dataset.bk));return;}
  const pk=e.target.closest("[data-peek]");if(pk){peekDay(pk.dataset.peek);return;}
  const g=e.target.closest("[data-goday]");if(g){S.date=g.dataset.goday;S.view="day";if(!S.pub)store.set("view","day");loadSchedule();return;}
  const ad=e.target.closest("[data-addday]");if(ad){openBook({date:ad.dataset.addday});return;}
  const col=e.target.closest("[data-col]");if(col&&canBook()&&!S.pub){const w=$(".day-wrap"),a=+w.dataset.start,r=col.getBoundingClientRect();
    const m=a+Math.floor((e.clientY-r.top)/52*2)*30;openBook({date:S.date,space_id:col.dataset.col,start_time:fromMin(m),end_time:fromMin(Math.min(m+90,23*60+55))});}
});
$("#bookBtn").addEventListener("click",()=>openBook({date:S.date<todayISO()?todayISO():S.date}));
/* swipe between days / weeks / months on phones */
let sx=null,sy=null;
$("#schBody").addEventListener("touchstart",e=>{if(e.target.closest(".day-wrap"))return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
$("#schBody").addEventListener("touchend",e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;sx=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.6)step(dx<0?1:-1);},{passive:true});

/* ---------- book / edit ---------- */
let editing=null;
function openBook(v={}){
  if(!canBook())return;editing=v.id?v:null;
  const d=$("#bookDlg");
  $("#bkTitle").textContent=editing?"Edit booking":direct()?"Book time":"Request time";
  $("#bkSpace").innerHTML=S.spaces.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#bkSpace").value=v.space_id||visibleSpaces()[0]?.id||S.spaces[0]?.id||"";
  $("#bkDate").value=v.date||todayISO();
  $("#bkStart").value=v.start_time||"15:30";$("#bkEnd").value=v.end_time||"17:30";
  $("#bkWhat").value=v.title||"";$("#bkGroup").value=v.group_name||"";$("#bkNotes").value=v.notes||"";
  $("#bkGroups").innerHTML=[...new Set(S.bookings.map(b=>b.group_name).filter(Boolean))].map(g=>`<option value="${esc(g)}">`).join("");
  $("#bkRepeatBox").hidden=!!editing;$("#bkRepeat").checked=false;
  const wd=dObj($("#bkDate").value).getDay();
  $("#bkDow").innerHTML=DOW.map((x,i)=>`<label><input type="checkbox" value="${i}"${i===wd?" checked":""}><span>${x}</span></label>`).join("");
  $("#bkUntil").value=addDays($("#bkDate").value,8*7);
  $("#bkNote").textContent=direct()?"":"Your request goes to the administrator. It shows on the schedule as waiting until they approve it.";
  msg($("#bkMsg"),"");repeatUi();checkConflicts();d.showModal();setTimeout(()=>{if(!v.title)$("#bkWhat").focus();},50);
}
function occurrences(){
  const date=$("#bkDate").value;if(!date)return [];
  if(editing||!$("#bkRepeat").checked)return [date];
  const days=[...$$("#bkDow input:checked")].map(x=>+x.value),until=$("#bkUntil").value;if(!days.length||!until||until<date)return [date];
  const out=[];for(let d=date;d<=until&&out.length<200;d=addDays(d,1))if(days.includes(dObj(d).getDay()))out.push(d);return out;
}
function repeatUi(){const on=$("#bkRepeat").checked;$("#bkRepeatBox").classList.toggle("off",!on);
  const n=occurrences().length;$("#bkCount").textContent=on?`${n} date${n===1?"":"s"}`+(n>=200?" (the most at once)":""):"";
  $("#bkGo").textContent=(editing?"Save":direct()?"Book":"Request")+(n>1?` ${n} dates`:"");}
let ccT;
async function checkConflicts(){clearTimeout(ccT);ccT=setTimeout(async()=>{
  const dates=occurrences(),sp=$("#bkSpace").value,st=$("#bkStart").value,en=$("#bkEnd").value,box=$("#bkConflicts");
  if(!dates.length||!st||!en||en<=st){box.innerHTML=en&&st&&en<=st?"The end time must be after the start time.":"";box.className="conflicts";return;}
  let list;try{list=await DB.bookings(S.org.id,dates[0],dates[dates.length-1]);}catch{return;}
  const hits=list.filter(b=>b.space_id===sp&&dates.includes(b.date)&&b.status!=="declined"&&(!editing||b.id!==editing.id)&&b.start_time<en&&st<b.end_time);
  const hard=hits.filter(b=>b.status==="approved"),soft=hits.filter(b=>b.status==="pending");
  if(!hits.length){box.innerHTML="";return;}
  box.className="conflicts"+(hard.length?"":" soft");
  box.innerHTML=(hard.length?`<b>${spaceOf(sp).name} is already booked${dates.length>1?` on ${hard.length} of these dates`:""}:</b>`:`<b>Someone else has asked for this time:</b>`)+
    `<ul>${hits.slice(0,4).map(b=>`<li>${esc(shortDay(b.date))}, ${span(b.start_time,b.end_time)}: ${esc(b.title)}${b.status==="pending"?" (waiting)":""}</li>`).join("")}${hits.length>4?`<li>and ${hits.length-4} more</li>`:""}</ul>`+
    (hard.length&&dates.length>1?`<small>The other dates will still go through.</small>`:"");
},200);}
["#bkSpace","#bkDate","#bkStart","#bkEnd","#bkUntil"].forEach(s=>$(s).addEventListener("change",()=>{if(s==="#bkDate"&&!$("#bkRepeat").checked){const wd=dObj($("#bkDate").value).getDay();$$("#bkDow input").forEach(x=>x.checked=+x.value===wd);}repeatUi();checkConflicts();}));
$("#bkRepeat").addEventListener("change",()=>{repeatUi();checkConflicts();});
$("#bkDow").addEventListener("change",()=>{repeatUi();checkConflicts();});
$("#bkGo").addEventListener("click",async()=>{
  const title=$("#bkWhat").value.trim(),st=$("#bkStart").value,en=$("#bkEnd").value,dates=occurrences();
  if(!title){msg($("#bkMsg"),"Say what the time is for.","err");$("#bkWhat").focus();return;}
  if(!st||!en||en<=st){msg($("#bkMsg"),"The end time must be after the start time.","err");return;}
  const base={org_id:S.org.id,space_id:$("#bkSpace").value,start_time:st,end_time:en,title,group_name:$("#bkGroup").value.trim()||null,notes:$("#bkNotes").value.trim()||null};
  const b=$("#bkGo");b.disabled=true;msg($("#bkMsg"),"Saving…");
  try{
    if(editing){await DB.updateBooking(editing.id,{...base,date:dates[0]});$("#bookDlg").close();toast(direct()?"Booking saved.":"Saved. It goes back to the administrator to approve.");}
    else{const series=dates.length>1?(crypto.randomUUID?crypto.randomUUID():null):null;let ok=0;const bad=[];
      for(const d of dates){try{await DB.addBooking({...base,date:d,series_id:series});ok++;}catch(err){bad.push(shortDay(d)+": "+err.message);}}
      if(!ok){msg($("#bkMsg"),bad[0]||"Not saved.","err");b.disabled=false;return;}
      $("#bookDlg").close();
      toast(`${direct()?"Booked":"Requested"} ${ok} date${ok===1?"":"s"}.${bad.length?` ${bad.length} couldn't be booked because the space was taken.`:""}`);}
    S.date=dates[0];loadSchedule();refreshBadge();
  }catch(err){msg($("#bkMsg"),err.message,"err");}
  b.disabled=false;
});

/* ---------- details ---------- */
function openDetail(b){if(!b)return;
  const sp=spaceOf(b.space_id),mine=DB.user()&&b.requested_by===DB.user().id,canEdit=!S.pub&&(isAdmin()||(canBook()&&mine));
  const series=b.series_id?S.bookings.filter(x=>x.series_id===b.series_id).length:0;
  $("#detailBody").innerHTML=`<div class="dt-head"><div><span class="dt-space" style="--c:${esc(sp.color)}"><i></i>${esc(sp.name)}</span><h2 id="dtTitle" style="margin-top:6px">${esc(b.title)}</h2></div>
      <button class="btn icon" type="button" data-dt="close" aria-label="Close">✕</button></div>
    <p class="dt-when">${esc(longDay(b.date))}<br>${span(b.start_time,b.end_time)}</p>
    <span class="pill ${b.status}">${b.status==="pending"?"Waiting for approval":b.status}</span>
    <dl class="dt-rows">${b.group_name?`<dt>Group</dt><dd>${esc(b.group_name)}</dd>`:""}${b.notes?`<dt>Notes</dt><dd>${esc(b.notes)}</dd>`:""}
      ${!S.pub&&b.requester?`<dt>Booked by</dt><dd>${esc(b.requester)}</dd>`:""}${b.series_id?`<dt>Repeats</dt><dd>Part of a weekly series</dd>`:""}
      ${b.decline_note?`<dt>Note</dt><dd>${esc(b.decline_note)}</dd>`:""}</dl>
    <div class="actions">
      ${isAdmin()&&b.status==="pending"?`<button class="btn good" type="button" data-dt="approve">Approve</button><button class="btn warn" type="button" data-dt="decline">Decline</button>`:""}
      ${canEdit?`<button class="btn" type="button" data-dt="edit">Edit</button><button class="btn warn" type="button" data-dt="delete">Delete</button>`:""}
      ${canEdit&&b.series_id?`<button class="btn warn" type="button" data-dt="deleteSeries">Delete this and later dates</button>`:""}
    </div>`;
  $("#detailDlg").dataset.id=b.id;$("#detailDlg").showModal();
}
$("#detailDlg").addEventListener("click",async e=>{const d=$("#detailDlg");if(e.target===d){d.close();return;}
  const a=e.target.closest("[data-dt]");if(!a)return;const k=a.dataset.dt,b=S.bookings.find(x=>x.id===d.dataset.id);
  if(k==="close"){d.close();return;}
  try{
    if(k==="approve"){await decide([b],"approved");d.close();}
    if(k==="decline"){d.close();await declineFlow([b]);}
    if(k==="edit"){d.close();openBook(b);}
    if(k==="delete"&&await ask("Delete this booking?",`${b.title}, ${shortDay(b.date)}.`)){await DB.deleteBookings([b.id]);d.close();toast("Deleted.");loadSchedule();refreshBadge();}
    if(k==="deleteSeries"){const all=(await DB.bookings(S.org.id,b.date,addDays(b.date,400))).filter(x=>x.series_id===b.series_id);
      if(await ask(`Delete ${all.length} dates?`,`${b.title} on ${shortDay(b.date)} and every later date in the series.`)){await DB.deleteBookings(all.map(x=>x.id));d.close();toast(`Deleted ${all.length} dates.`);loadSchedule();refreshBadge();}}
  }catch(err){toast(err.message);}
});
function ask(title,text,withNote){return new Promise(res=>{const d=$("#askDlg");$("#askTitle").textContent=title;$("#askText").textContent=text||"";
  $("#askNoteWrap").hidden=!withNote;$("#askNote").value="";$("#askYes").textContent=withNote?"Decline":"OK";
  d.onclose=()=>res(d.returnValue==="yes"?(withNote?{note:$("#askNote").value.trim()}:true):false);d.returnValue="";d.showModal();});}

/* ---------- approve / decline ---------- */
async function decide(list,status,note){
  let ok=0;const bad=[];
  for(const b of list){try{await DB.updateBooking(b.id,{status,...(note?{decline_note:note}:{})});ok++;}catch(err){bad.push(`${shortDay(b.date)}: ${err.message}`);}}
  toast(`${status==="approved"?"Approved":"Declined"} ${ok}${list.length>1?" of "+list.length:""}.${bad.length?" "+bad[0]:""}`);
  refreshBadge();if(S.tab==="requests")renderRequests();else loadSchedule();
}
async function declineFlow(list){const r=await ask(list.length>1?`Decline ${list.length} dates?`:"Decline this request?",`${list[0].title}${list.length>1?"":", "+shortDay(list[0].date)}.`,true);if(r)await decide(list,"declined",r.note||null);}
async function refreshBadge(){if(!isAdmin()||S.pub)return;try{const p=await DB.pending(S.org.id);const n=new Set(p.filter(b=>b.date>=todayISO()).map(b=>b.series_id||b.id)).size;const el=$("#reqBadge");el.textContent=n;el.hidden=!n;}catch{}}

/* Requests: one card per series, with any clash against what's already approved. */
async function renderRequests(){
  const el=$("#reqList");el.innerHTML=`<div class="empty">Loading…</div>`;
  let p;try{p=(await DB.pending(S.org.id)).filter(b=>b.date>=todayISO());}catch(e){el.innerHTML=`<div class="empty">${esc(e.message)}</div>`;return;}
  if(!p.length){el.innerHTML=`<div class="empty">Nothing waiting. New requests show up here.</div>`;return;}
  const appr=await DB.bookings(S.org.id,p[0].date,p[p.length-1].date).catch(()=>[]);
  const groups=[];const seen=new Map();
  p.forEach(b=>{const k=b.series_id||b.id;if(!seen.has(k)){seen.set(k,{k,items:[]});groups.push(seen.get(k));}seen.get(k).items.push(b);});
  S.reqGroups=groups;
  el.innerHTML=groups.map((g,i)=>{const b=g.items[0],sp=spaceOf(b.space_id),n=g.items.length;
    const clashes=g.items.filter(x=>appr.some(y=>y.status==="approved"&&y.space_id===x.space_id&&y.date===x.date&&y.start_time<x.end_time&&x.start_time<y.end_time));
    const when=n>1?`${n} dates · ${[...new Set(g.items.map(x=>DOWL[dObj(x.date).getDay()]+"s"))].join(", ")} · ${shortDay(b.date)} – ${shortDay(g.items[n-1].date)}`:longDay(b.date);
    return `<article class="req" style="--c:${esc(sp.color)}"><div><h3>${esc(b.title)}</h3><div class="meta">${esc(sp.name)} · ${span(b.start_time,b.end_time)}<br>${esc(when)}</div>
      <div class="who">Asked by ${esc(b.requester||"someone")}${b.group_name?" · "+esc(b.group_name):""}${b.notes?" · "+esc(b.notes):""}</div></div>
      <div class="acts"><button class="btn good" type="button" data-rq="approve" data-g="${i}">Approve${n>1?" all":""}</button><button class="btn warn" type="button" data-rq="decline" data-g="${i}">Decline</button><button class="btn" type="button" data-rq="view" data-g="${i}">See on schedule</button></div>
      ${clashes.length?`<div class="clash">Overlaps something already approved on ${clashes.length===1?shortDay(clashes[0].date):clashes.length+" dates"}. ${n>1?"Approving the series skips those dates.":"Change the time or decline."}</div>`:""}</article>`;}).join("");
}
$("#reqList").addEventListener("click",async e=>{const b=e.target.closest("[data-rq]");if(!b)return;const g=S.reqGroups[+b.dataset.g];
  if(b.dataset.rq==="approve"){b.disabled=true;await decide(g.items,"approved");}
  if(b.dataset.rq==="decline")await declineFlow(g.items);
  if(b.dataset.rq==="view"){S.date=g.items[0].date;S.view="day";setTab("schedule");}});

async function renderMine(){
  const el=$("#mineList");el.innerHTML=`<div class="empty">Loading…</div>`;
  let l;try{l=await DB.mine(S.org.id);}catch(e){el.innerHTML=`<div class="empty">${esc(e.message)}</div>`;return;}
  if(!l.length){el.innerHTML=`<div class="empty">Nothing yet. Tap <b>+ Book time</b> on the Schedule to ask for a time.</div>`;return;}
  S.bookings=l;
  el.innerHTML=l.map(b=>{const sp=spaceOf(b.space_id);return `<article class="req" style="--c:${esc(sp.color)}"><div><h3>${esc(b.title)}</h3><div class="meta">${esc(sp.name)} · ${esc(shortDay(b.date))} · ${span(b.start_time,b.end_time)}</div>
    ${b.decline_note?`<div class="who">Note: ${esc(b.decline_note)}</div>`:""}</div><div class="acts"><span class="pill ${b.status}">${b.status==="pending"?"Waiting":b.status}</span><button class="btn sm" type="button" data-mine="${b.id}">Open</button></div></article>`;}).join("");
}
$("#mineList").addEventListener("click",e=>{const b=e.target.closest("[data-mine]");if(b)openDetail(S.bookings.find(x=>x.id===b.dataset.mine));});

/* ---------- people ---------- */
async function renderPeople(){
  const el=$("#memberList");el.innerHTML=`<div class="help">Loading…</div>`;
  try{[S.members,S.invites]=await Promise.all([DB.members(S.org.id),DB.invites(S.org.id)]);}catch(e){el.innerHTML=`<div class="msg err">${esc(e.message)}</div>`;return;}
  const me=DB.user()&&DB.user().id;
  el.innerHTML=S.members.map(m=>`<div class="person"><div><b>${esc(m.display_name||m.email)}${m.user_id===me?" (you)":""}</b><small>${esc(m.email||"")}</small></div>
    <div class="ctl"><select data-mrole="${m.user_id}" aria-label="Access for ${esc(m.display_name||m.email)}">${["viewer","editor","admin"].map(r=>`<option value="${r}"${m.role===r?" selected":""}>${ROLE_L[r]}</option>`).join("")}</select>
      ${m.role==="editor"?`<label class="check"><input type="checkbox" data-mdirect="${m.user_id}"${m.direct?" checked":""}> Books without approval</label>`:""}
      <button class="btn sm warn" type="button" data-mrm="${m.user_id}">Remove</button></div></div>`).join("");
  $("#invCard").hidden=!S.invites.length;
  $("#inviteList").innerHTML=S.invites.map(i=>`<div class="person"><div><b>${esc(i.email)}</b><small>${ROLE_L[i.role]}${i.direct?" · books without approval":""}</small></div><div class="ctl"><button class="btn sm" type="button" data-invrm="${i.id}">Cancel invite</button></div></div>`).join("");
  $("#invLink").textContent=location.origin+location.pathname;
}
$("#invRole").addEventListener("change",()=>{$("#invDirect").closest("label").hidden=$("#invRole").value!=="editor";});
$("#invForm").addEventListener("submit",async e=>{e.preventDefault();
  const emails=[...new Set($("#invEmails").value.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean))],bad=emails.filter(x=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if(!emails.length){msg($("#invMsg"),"Type at least one email.","err");return;}if(bad.length){msg($("#invMsg"),`Check ${bad.join(", ")}.`,"err");return;}
  const have=new Set(S.members.map(m=>(m.email||"").toLowerCase())),fresh=emails.filter(x=>!have.has(x));
  if(!fresh.length){msg($("#invMsg"),"They're already members. Change their access below.","err");return;}
  try{await DB.addInvites(S.org.id,fresh,$("#invRole").value,$("#invRole").value==="editor"&&$("#invDirect").checked);$("#invEmails").value="";
    msg($("#invMsg"),`Added ${fresh.length}. They'll join the first time they sign in with ${fresh.length===1?"that email":"those emails"}.`,"ok");renderPeople();}
  catch(err){msg($("#invMsg"),err.message,"err");}});
document.getElementById("view-people").addEventListener("change",async e=>{const t=e.target;
  try{if(t.dataset.mrole){await DB.updateMember(S.org.id,t.dataset.mrole,{role:t.value});toast("Access changed.");
      if(t.dataset.mrole===DB.user().id){S.orgs=await DB.orgs();S.org=S.orgs.find(o=>o.id===S.org.id);await openOrg();return;}renderPeople();}
    if(t.dataset.mdirect){await DB.updateMember(S.org.id,t.dataset.mdirect,{direct:t.checked});toast(t.checked?"They can book without approval.":"Their bookings need approval.");}}
  catch(err){toast(err.message);renderPeople();}});
document.getElementById("view-people").addEventListener("click",async e=>{const rm=e.target.closest("[data-mrm]"),iv=e.target.closest("[data-invrm]");
  try{if(rm){const m=S.members.find(x=>x.user_id===rm.dataset.mrm);if(!await ask(`Remove ${m.display_name||m.email}?`,"They won't see this school's schedule any more. Their bookings stay."))return;
      await DB.removeMember(S.org.id,m.user_id);toast("Removed.");if(m.user_id===DB.user().id){location.reload();return;}renderPeople();}
    if(iv){await DB.deleteInvite(iv.dataset.invrm);renderPeople();}}catch(err){toast(err.message);}});

/* ---------- settings ---------- */
function renderSettings(){
  const o=S.org;$("#stName").value=o.name;$("#stStart").value=o.day_start||"06:00";$("#stEnd").value=o.day_end||"22:00";$("#stApproval").checked=o.approval!==false;msg($("#stMsg"),"");
  $("#spaceList").innerHTML=S.spaces.map((s,i)=>`<div class="space-row" data-sp="${s.id}"><input type="color" value="${esc(s.color)}" aria-label="Color for ${esc(s.name)}" data-spf="color"><input type="text" value="${esc(s.name)}" maxlength="80" aria-label="Name" data-spf="name">
    <button class="btn sm icon" type="button" data-spmv="-1" aria-label="Move up"${i?"":" disabled"}>↑</button><button class="btn sm icon" type="button" data-spmv="1" aria-label="Move down"${i<S.spaces.length-1?"":" disabled"}>↓</button>
    <button class="btn sm warn" type="button" data-sprm>Delete</button></div>`).join("")||`<p class="help">No spaces yet.</p>`;
  renderPub();
}
$("#stSave").addEventListener("click",async()=>{const patch={name:$("#stName").value.trim(),day_start:$("#stStart").value||"06:00",day_end:$("#stEnd").value||"22:00",approval:$("#stApproval").checked};
  if(!patch.name){msg($("#stMsg"),"Add a name.","err");return;}if(patch.day_end<=patch.day_start){msg($("#stMsg"),"The schedule has to end after it starts.","err");return;}
  try{await DB.updateOrg(S.org.id,patch);Object.assign(S.org,patch);renderOrgPick();msg($("#stMsg"),"Saved.","ok");}catch(err){msg($("#stMsg"),err.message,"err");}});
$("#spaceList").addEventListener("change",async e=>{const f=e.target.dataset.spf;if(!f)return;const id=e.target.closest("[data-sp]").dataset.sp,v=e.target.value.trim();if(!v)return;
  try{await DB.updateSpace(id,{[f]:v});Object.assign(S.spaces.find(s=>s.id===id),{[f]:v});msg($("#spMsg"),"Saved.","ok");}catch(err){msg($("#spMsg"),err.message,"err");}});
$("#spaceList").addEventListener("click",async e=>{const row=e.target.closest("[data-sp]");if(!row)return;const id=row.dataset.sp,i=S.spaces.findIndex(s=>s.id===id);
  try{const mv=e.target.closest("[data-spmv]");
    if(mv){const j=i+(+mv.dataset.spmv);[S.spaces[i],S.spaces[j]]=[S.spaces[j],S.spaces[i]];await Promise.all(S.spaces.map((s,k)=>s.sort===k?null:(s.sort=k,DB.updateSpace(s.id,{sort:k}))));renderSettings();}
    if(e.target.closest("[data-sprm]")){const s=S.spaces[i];if(!await ask(`Delete ${s.name}?`,"Every booking in this space is deleted too."))return;await DB.deleteSpace(id);S.spaces.splice(i,1);renderSettings();toast("Space deleted.");}}
  catch(err){msg($("#spMsg"),err.message,"err");}});
const spAdd=async()=>{const v=$("#spNew").value.trim();if(!v)return;
  try{const s=await DB.addSpace(S.org.id,{name:v,sort:S.spaces.length,color:["#1f4e8c","#d9692a","#2f8a5b","#7a4bb3","#b3283c","#c79a12","#0f766e","#8a4f7d"][S.spaces.length%8]});S.spaces.push(s);$("#spNew").value="";renderSettings();}
  catch(err){msg($("#spMsg"),err.message,"err");}};
$("#spAdd").addEventListener("click",spAdd);$("#spNew").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();spAdd();}});
const pubUrl=t=>`${location.origin}${location.pathname}?s=${t}`;
function renderPub(){const t=S.org.public_token,box=$("#pubBox");
  box.innerHTML=t?`<div class="pub-url"><input readonly value="${esc(pubUrl(t))}" aria-label="Schedule link"><button class="btn primary" type="button" data-pub="copy">Copy</button></div>
    <div class="actions"><a class="btn" href="${esc(pubUrl(t))}" target="_blank" rel="noopener">Open</a><button class="btn" type="button" data-pub="new">Make a new link</button><button class="btn warn" type="button" data-pub="off">Turn off</button></div>`
    :`<button class="btn primary" type="button" data-pub="on">Turn on the link</button>`;}
$("#pubBox").addEventListener("click",async e=>{const b=e.target.closest("[data-pub]");if(!b)return;const k=b.dataset.pub;
  try{if(k==="copy"){await navigator.clipboard.writeText(pubUrl(S.org.public_token)).catch(()=>{});toast("Link copied.");return;}
    if(k==="new"&&!await ask("Make a new link?","The old link stops working."))return;
    const tok=k==="off"?null:Array.from(crypto.getRandomValues(new Uint8Array(12)),x=>"abcdefghijkmnpqrstuvwxyz23456789"[x%32]).join("");
    await DB.updateOrg(S.org.id,{public_token:tok});S.org.public_token=tok;renderPub();toast(tok?"Link is on.":"Link turned off.");}catch(err){toast(err.message);}});
$("#stDelete").addEventListener("click",async()=>{if(!await ask(`Delete ${S.org.name}?`,"Every space and booking is removed for everyone. This can't be undone."))return;
  try{await DB.deleteOrg(S.org.id);store.set("org",null);location.reload();}catch(err){toast(err.message);}});

/* ---------- public, read-only schedule ---------- */
async function startPublic(token){
  const app=$("#screen-app");app.hidden=false;$$(".screen").forEach(s=>{if(s.id!=="screen-app")s.hidden=true;});
  $("#tabs").hidden=true;$("#meBox").hidden=true;document.body.classList.add("public");
  const load=async()=>{const [a,b]=range();const r=await DB.publicView(token,a,b);if(!r){$("#schBody").innerHTML=`<div class="empty">This schedule link isn't active. Ask the school for a new one.</div>`;return null;}return r;};
  S.view=store.get("pubView",matchMedia("(max-width:640px)").matches?"day":"week");
  const r=await load().catch(()=>null);if(!r){$("#orgPick").innerHTML="";return;}
  S.org={id:null,name:r.org.name,role:null,day_start:r.org.day_start,day_end:r.org.day_end};S.spaces=r.spaces;S.pub=r;
  $("#orgPick").innerHTML=`<span class="org-name">${esc(r.org.name)}</span>`;document.title=`${r.org.name} · Gym Schedule`;
  /* reload the range on navigation */
  loadSchedule=async function(){renderSchedule(true);const x=await load().catch(()=>null);if(x){S.pub=x;S.bookings=x.bookings;store.set("pubView",S.view);}renderSchedule();};
  loadSchedule();
}

/* ---------- demo bar ---------- */
function demoBar(){const bar=$("#demoBar");bar.hidden=false;
  bar.innerHTML=`<span><b>Demo</b> · changes stay in this browser.</span><label><span class="demo-as">Viewing as </span><select id="demoWho">${DB.people.map(p=>`<option value="${p.id}"${DB.user().id===p.id?" selected":""}>${esc(p.name)}</option>`).join("")}</select></label><button type="button" id="demoReset">Reset</button><a class="demo-exit" href="./">Exit demo</a>`;
  $("#demoWho").addEventListener("change",async e=>{DB.switchUser(e.target.value);S.orgs=await DB.orgs();if(!S.orgs.length){setupScreen();return;}S.org=S.orgs[0];await openOrg();});
  $("#demoReset").addEventListener("click",()=>{DB.reset();location.reload();});}

/* keep it fresh when the phone comes back to the app */
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.org&&!S.pub&&S.tab==="schedule"){loadSchedule();refreshBadge();}});
document.addEventListener("keydown",e=>{if(document.querySelector("dialog[open]")||/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||"")||$("#screen-app").hidden||S.tab!=="schedule")return;
  if(e.key==="ArrowLeft")step(-1);if(e.key==="ArrowRight")step(1);if(e.key==="t")$("#today").click();});

start();
})();
