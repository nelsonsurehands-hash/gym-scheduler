/* Data layer. Two back ends with the same calls:
   - Supabase (the real app): rules are enforced by the database (supabase/facilities.sql).
   - Demo (?demo in the address): everything stays in this browser, with the same rules
     copied here, so a school can try it without an account. */
(function(){
const CFG=window.FAC_CONFIG||{};
const DEMO=new URLSearchParams(location.search).has("demo")||!CFG.supabaseUrl;
const BOOK_COLS="id,org_id,space_id,date,start_time,end_time,title,group_name,notes,series_id,status,requested_by,requester,decided_at,decline_note,created_at";
const uuid=()=>crypto.randomUUID?crypto.randomUUID():"x"+Math.random().toString(36).slice(2)+Date.now().toString(36);
const fail=e=>{throw new Error(friendly(e&&e.message||String(e)));};
const ap=t=>{const [h,m]=t.split(":").map(Number);return `${((h+11)%12)+1}${m?":"+String(m).padStart(2,"0"):""} ${h<12?"AM":"PM"}`;};
function friendly(m){
  m=String(m).replace(/\b(\d{2}):(\d{2})\b/g,(x)=>ap(x));
  if(/fac_(orgs|spaces|members|bookings|invites)|schema cache|does not exist/i.test(m))return "The gym schedule isn't set up on the server yet. Run the setup SQL in Supabase first.";
  if(/row-level security/i.test(m))return "You don't have permission to do that.";
  if(/Invalid login/i.test(m))return "That email and password don't match.";
  if(/duplicate key.*fac_invites/i.test(m))return "That person is already invited.";
  return m;
}

/* ---------------- Supabase ---------------- */
function supa(){
  const sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,detectSessionInUrl:true,flowType:"implicit",storageKey:"fac-auth"}});
  let me=null;
  const q=async p=>{const {data,error}=await p;if(error)fail(error);return data;};
  return {
    demo:false,
    async session(){const {data:{session}}=await sb.auth.getSession();me=session&&session.user;return me;},
    onAuth(fn){sb.auth.onAuthStateChange((ev,s)=>{me=s&&s.user;fn(ev,me);});},
    user:()=>me,
    async signIn(email,password){const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)fail(error);me=data.user;return me;},
    async signUp(email,password,name){const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:location.origin+location.pathname}});if(error)fail(error);me=data.session?data.user:null;return {user:data.user,needsConfirm:!data.session};},
    async resetPassword(email){const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)fail(error);},
    async setPassword(password){const {error}=await sb.auth.updateUser({password});if(error)fail(error);},
    async signOut(){await sb.auth.signOut();me=null;},
    async claimInvites(){try{const {data}=await sb.rpc("fac_claim_invites");return data||0;}catch{return 0;}},
    async orgs(){const rows=await q(sb.from("fac_members").select("role,direct,fac_orgs(*)").eq("user_id",me.id));
      return rows.filter(r=>r.fac_orgs).map(r=>({...r.fac_orgs,role:r.role,direct:r.direct})).sort((a,b)=>a.name.localeCompare(b.name));},
    async createOrg(name,spaces){return q(sb.rpc("fac_create_org",{p_name:name,p_spaces:spaces}));},
    async updateOrg(id,patch){await q(sb.from("fac_orgs").update(patch).eq("id",id));},
    async deleteOrg(id){await q(sb.from("fac_orgs").delete().eq("id",id));},
    async spaces(org){return q(sb.from("fac_spaces").select("*").eq("org_id",org).order("sort").order("name"));},
    async addSpace(org,v){return (await q(sb.from("fac_spaces").insert({org_id:org,...v}).select()))[0];},
    async updateSpace(id,patch){await q(sb.from("fac_spaces").update(patch).eq("id",id));},
    async deleteSpace(id){await q(sb.from("fac_spaces").delete().eq("id",id));},
    async bookings(org,from,to){return q(sb.from("fac_bookings").select(BOOK_COLS).eq("org_id",org).gte("date",from).lte("date",to).order("date").order("start_time"));},
    async pending(org){return q(sb.from("fac_bookings").select(BOOK_COLS).eq("org_id",org).eq("status","pending").order("date").order("start_time"));},
    async mine(org){return q(sb.from("fac_bookings").select(BOOK_COLS).eq("org_id",org).eq("requested_by",me.id).gte("date",new Date(Date.now()-864e5*14).toISOString().slice(0,10)).order("date").order("start_time"));},
    async addBooking(row){return (await q(sb.from("fac_bookings").insert(row).select(BOOK_COLS)))[0];},
    async updateBooking(id,patch){return (await q(sb.from("fac_bookings").update(patch).eq("id",id).select(BOOK_COLS)))[0];},
    async deleteBookings(ids){await q(sb.from("fac_bookings").delete().in("id",ids));},
    async members(org){return q(sb.from("fac_members").select("user_id,role,direct,email,display_name,created_at").eq("org_id",org).order("created_at"));},
    async updateMember(org,uid,patch){await q(sb.from("fac_members").update(patch).eq("org_id",org).eq("user_id",uid));},
    async removeMember(org,uid){await q(sb.from("fac_members").delete().eq("org_id",org).eq("user_id",uid));},
    async invites(org){return q(sb.from("fac_invites").select("*").eq("org_id",org).order("created_at"));},
    async addInvites(org,emails,role,direct){return q(sb.from("fac_invites").upsert(emails.map(email=>({org_id:org,email,role,direct})),{onConflict:"org_id,email"}).select());},
    async deleteInvite(id){await q(sb.from("fac_invites").delete().eq("id",id));},
    async publicView(token,from,to){return q(sb.rpc("fac_public",{p_token:token,p_from:from,p_to:to}));}
  };
}

/* ---------------- Demo (this browser only) ---------------- */
function demo(){
  const K="fac:demo";
  const PEOPLE=[{id:"u-admin",email:"office@riverside.edu",name:"Dana Ortiz (Athletic Director)"},{id:"u-coach",email:"coach@riverside.edu",name:"Coach Miller"},{id:"u-pe",email:"pe@riverside.edu",name:"Ms. Patel (PE)"}];
  const load=()=>{try{return JSON.parse(localStorage.getItem(K))||null;}catch{return null;}};
  let S=load()||seed();
  const save=()=>{try{localStorage.setItem(K,JSON.stringify(S));}catch{}};
  let me=PEOPLE.find(p=>p.id===S.me)||PEOPLE[0];
  function seed(){
    const o="org-demo",sp=[["Main Gym","#1f4e8c"],["Auxiliary Gym","#d9692a"],["Cafeteria","#2f8a5b"],["Weight Room","#7a4bb3"]].map(([name,color],i)=>({id:"sp"+i,org_id:o,name,color,sort:i}));
    const s={me:"u-admin",orgs:[{id:o,name:"Riverside Middle School",approval:true,day_start:"06:00",day_end:"21:00",public_token:null}],spaces:sp,
      members:[{org_id:o,user_id:"u-admin",role:"admin",direct:false,email:PEOPLE[0].email,display_name:PEOPLE[0].name,created_at:"2026-08-01"},
               {org_id:o,user_id:"u-coach",role:"editor",direct:false,email:PEOPLE[1].email,display_name:PEOPLE[1].name,created_at:"2026-08-02"},
               {org_id:o,user_id:"u-pe",role:"viewer",direct:false,email:PEOPLE[2].email,display_name:PEOPLE[2].name,created_at:"2026-08-03"}],
      invites:[{id:"inv1",org_id:o,email:"band@riverside.edu",role:"viewer",direct:false,created_at:"2026-08-04"}],bookings:[]};
    /* two weeks of a typical school gym, starting this Monday */
    const t=new Date();t.setHours(12);const mon=new Date(t);mon.setDate(t.getDate()-((t.getDay()+6)%7));
    const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const add=(day,space,st,en,title,group,status,by,series)=>{const d=new Date(mon);d.setDate(mon.getDate()+day);
      s.bookings.push({id:uuid(),org_id:o,space_id:"sp"+space,date:iso(d),start_time:st,end_time:en,title,group_name:group||null,notes:null,series_id:series||null,status:status||"approved",
        requested_by:by||"u-admin",requester:(PEOPLE.find(p=>p.id===(by||"u-admin"))||{}).name,decided_at:null,decline_note:null,created_at:new Date().toISOString()});};
    const g="s-girls",b="s-boys",pe="s-pe";
    for(let w=0;w<2;w++)for(const d of [0,1,2,3,4]){const day=w*7+d;
      add(day,0,"07:45","15:00","PE classes","Physical Education","approved","u-admin",pe);
      if(d!==2)add(day,0,"15:30","17:30","8th Grade Girls practice","Girls Basketball","approved","u-coach",g);
      if(d!==2)add(day,1,"15:30","17:30","7th Grade Boys practice","Boys Basketball","approved","u-admin",b);
      add(day,2,"11:00","13:00","Lunch","","approved","u-admin","s-lunch");
      if(d===1||d===3)add(day,3,"06:30","07:30","Morning lifting","Football","approved","u-admin","s-lift");}
    add(2,0,"17:00","19:00","Home game vs Lakeview","Girls Basketball");
    add(5,0,"09:00","12:00","Youth league","Rec Department","pending","u-coach");
    add(9,1,"18:00","20:00","Volleyball open gym","Volleyball","pending","u-coach");
    add(3,0,"17:00","18:30","Parent meeting","Girls Basketball","pending","u-coach");
    return s;
  }
  const role=org=>{const m=S.members.find(x=>x.org_id===org&&x.user_id===me.id);return m||null;};
  const isAdmin=org=>(role(org)||{}).role==="admin";
  const canBook=org=>["admin","editor"].includes((role(org)||{}).role);
  const deny=()=>fail({message:"row-level security"});
  function guard(n,old){
    const m=role(n.org_id)||{},org=S.orgs.find(o=>o.id===n.org_id)||{};const d=!!m.direct||org.approval===false;
    if(!S.spaces.some(s=>s.id===n.space_id&&s.org_id===n.org_id))fail({message:"That space is not part of this school"});
    if(!(n.end_time>n.start_time))fail({message:"The end time must be after the start time."});
    if(!old){n.requested_by=me.id;n.requester=n.requester||m.display_name||me.email;
      n.status=(m.role==="admin"||(m.role==="editor"&&d))?(n.status==="declined"?"declined":"approved"):"pending";}
    else if(n.status!==old.status){if(m.role!=="admin"&&!(m.role==="editor"&&d&&old.requested_by===me.id))fail({message:"Only an administrator can approve or decline"});n.decided_at=new Date().toISOString();}
    else if(m.role!=="admin"&&old.status==="approved"&&!d)n.status="pending";
    if(n.status==="approved"){const c=S.bookings.find(b=>b.org_id===n.org_id&&b.space_id===n.space_id&&b.date===n.date&&b.status==="approved"&&b.id!==n.id&&b.start_time<n.end_time&&n.start_time<b.end_time);
      if(c)fail({message:`Overlaps "${c.title}" (${c.start_time} – ${c.end_time}) in that space`});}
    return n;
  }
  const by=(a,b)=>a.date<b.date?-1:a.date>b.date?1:a.start_time<b.start_time?-1:1;
  const copy=x=>JSON.parse(JSON.stringify(x));
  return {
    demo:true,people:PEOPLE,
    async session(){return me;},
    onAuth(){},user:()=>me,
    switchUser(id){me=PEOPLE.find(p=>p.id===id)||me;S.me=me.id;save();},
    reset(){localStorage.removeItem(K);S=seed();me=PEOPLE[0];save();},
    async signIn(){return me;},async signUp(){return {user:me};},async resetPassword(){},async setPassword(){},async signOut(){},
    async claimInvites(){return 0;},
    async orgs(){return S.orgs.filter(o=>role(o.id)).map(o=>({...copy(o),role:role(o.id).role,direct:role(o.id).direct}));},
    async createOrg(name,spaces){const id=uuid();S.orgs.push({id,name,approval:true,day_start:"06:00",day_end:"22:00",public_token:null});
      S.members.push({org_id:id,user_id:me.id,role:"admin",direct:false,email:me.email,display_name:me.name,created_at:new Date().toISOString()});
      spaces.forEach((n,i)=>S.spaces.push({id:uuid(),org_id:id,name:n,color:["#1f4e8c","#d9692a","#2f8a5b","#7a4bb3","#b3283c","#c79a12"][i%6],sort:i}));save();return id;},
    async updateOrg(id,patch){if(!isAdmin(id))deny();Object.assign(S.orgs.find(o=>o.id===id),patch);save();},
    async deleteOrg(id){if(!isAdmin(id))deny();S.orgs=S.orgs.filter(o=>o.id!==id);S.members=S.members.filter(m=>m.org_id!==id);S.bookings=S.bookings.filter(b=>b.org_id!==id);save();},
    async spaces(org){return copy(S.spaces.filter(s=>s.org_id===org).sort((a,b)=>a.sort-b.sort));},
    async addSpace(org,v){if(!isAdmin(org))deny();const s={id:uuid(),org_id:org,color:"#1f4e8c",sort:99,...v};S.spaces.push(s);save();return copy(s);},
    async updateSpace(id,patch){const s=S.spaces.find(x=>x.id===id);if(!isAdmin(s.org_id))deny();Object.assign(s,patch);save();},
    async deleteSpace(id){const s=S.spaces.find(x=>x.id===id);if(!isAdmin(s.org_id))deny();S.spaces=S.spaces.filter(x=>x.id!==id);S.bookings=S.bookings.filter(b=>b.space_id!==id);save();},
    async bookings(org,from,to){return copy(S.bookings.filter(b=>b.org_id===org&&b.date>=from&&b.date<=to).sort(by));},
    async pending(org){return copy(S.bookings.filter(b=>b.org_id===org&&b.status==="pending").sort(by));},
    async mine(org){const since=new Date(Date.now()-864e5*14).toISOString().slice(0,10);return copy(S.bookings.filter(b=>b.org_id===org&&b.requested_by===me.id&&b.date>=since).sort(by));},
    async addBooking(row){if(!canBook(row.org_id))deny();const n=guard({id:uuid(),created_at:new Date().toISOString(),notes:null,group_name:null,series_id:null,decline_note:null,...copy(row)},null);S.bookings.push(n);save();return copy(n);},
    async updateBooking(id,patch){const old=S.bookings.find(b=>b.id===id);if(!old)fail({message:"That booking is gone."});
      if(!isAdmin(old.org_id)&&!(canBook(old.org_id)&&old.requested_by===me.id))deny();
      const n=guard({...copy(old),...patch},old);Object.assign(old,n);save();return copy(old);},
    async deleteBookings(ids){S.bookings.forEach(b=>{if(ids.includes(b.id)&&!isAdmin(b.org_id)&&b.requested_by!==me.id)deny();});S.bookings=S.bookings.filter(b=>!ids.includes(b.id));save();},
    async members(org){return copy(S.members.filter(m=>m.org_id===org));},
    async updateMember(org,uid,patch){if(!isAdmin(org))deny();const m=S.members.find(x=>x.org_id===org&&x.user_id===uid);
      if(m.role==="admin"&&patch.role&&patch.role!=="admin"&&!S.members.some(x=>x.org_id===org&&x.role==="admin"&&x.user_id!==uid))fail({message:"A school needs at least one administrator"});Object.assign(m,patch);save();},
    async removeMember(org,uid){if(!isAdmin(org)&&uid!==me.id)deny();const m=S.members.find(x=>x.org_id===org&&x.user_id===uid);
      if(m&&m.role==="admin"&&!S.members.some(x=>x.org_id===org&&x.role==="admin"&&x.user_id!==uid))fail({message:"A school needs at least one administrator"});S.members=S.members.filter(x=>!(x.org_id===org&&x.user_id===uid));save();},
    async invites(org){return isAdmin(org)?copy(S.invites.filter(i=>i.org_id===org)):[];},
    async addInvites(org,emails,role,direct){if(!isAdmin(org))deny();emails.forEach(email=>{S.invites=S.invites.filter(i=>!(i.org_id===org&&i.email===email));S.invites.push({id:uuid(),org_id:org,email,role,direct,created_at:new Date().toISOString()});});save();},
    async deleteInvite(id){S.invites=S.invites.filter(i=>i.id!==id);save();},
    async publicView(token,from,to){const o=S.orgs.find(x=>x.public_token===token);if(!o)return null;
      return {org:{name:o.name,day_start:o.day_start,day_end:o.day_end},spaces:copy(S.spaces.filter(s=>s.org_id===o.id).sort((a,b)=>a.sort-b.sort)),
        bookings:copy(S.bookings.filter(b=>b.org_id===o.id&&b.status==="approved"&&b.date>=from&&b.date<=to).sort(by))};}
  };
}

window.DB=DEMO?demo():supa();
})();
