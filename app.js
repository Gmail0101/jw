// =====================================================
// Supabase 설정
// =====================================================
const SUPABASE_URL = "https://jkwbzegaanmxecigfhky.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mjLozLfymRcWz3pjIWwOkg_xOs-BzqK";


const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const BUCKET = "schedule-images";

let currentUser = null;
let currentProfile = null;
let currentDate = new Date();
let selectedDate = new Date();
let allSchedules = [];
let activeCategory = "all";
let editingId = null;

const $ = id => document.getElementById(id);

function dateString(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function formatDateKR(v){const [y,m,d]=v.split("-");return `${y}년 ${Number(m)}월 ${Number(d)}일`}
function categoryClass(c){return c==="CPF 지원"?"cpf":c==="차량사고"?"accident":"issue"}

function setCategory(value){
  const input=$("scheduleCategory");
  if(!input)return;
  input.value=value;
  document.querySelectorAll(".category-option").forEach(btn=>{
    const active=btn.dataset.category===value;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-checked",active?"true":"false");
  });
}

function initCategoryOptions(){
  document.querySelectorAll(".category-option").forEach(btn=>{
    btn.addEventListener("click",()=>setCategory(btn.dataset.category));
  });
  setCategory($("scheduleCategory")?.value || "CPF 지원");
}
function showAuthMessage(msg,type=""){const el=$("authMessage");el.textContent=msg;el.className=`auth-message show ${type}`}
function clearAuthMessage(){ $("authMessage").className="auth-message" }

function normalizeUsername(value){
  return String(value || "").trim().toLowerCase();
}
function internalEmail(username){
  return `${normalizeUsername(username)}@users.scheduler.invalid`;
}

async function signIn(username,password){
  const email=internalEmail(username);
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) throw error;
}
async function signUp(username,name,password){
  username=normalizeUsername(username);
  const {data,error}=await db.functions.invoke("signup", {
    body: { username, display_name: name, password }
  });
  if(error) throw error;
  if(!data?.success) throw new Error(data?.message || "회원가입에 실패했습니다.");
  return data;
}
async function signOut(){await db.auth.signOut()}

async function loadProfile(){
  const {data,error}=await db.from("profiles").select("id,email,username,display_name,role,approval_status").eq("id",currentUser.id).single();
  if(error) throw error;
  currentProfile=data;
  $("userInfo").textContent=`${data.display_name || "사용자"} · @${data.username}`;
  $("roleBadge").textContent=data.role==="admin"?"관리자":"일반 사용자";
}

async function loadMembers(){
  if(currentProfile?.role!=="admin")return;
  const {data,error}=await db.from("profiles").select("id,username,display_name,role,approval_status,created_at").order("created_at",{ascending:false});
  if(error){alert("회원 목록을 불러오지 못했습니다.\n"+error.message);return}
  $("memberAdminCard").classList.remove("hidden");
  $("memberCount").textContent=`가입 회원 ${data.length}명`;
  if(!data.length){$("memberList").innerHTML='<div class="empty">가입 회원이 없습니다.</div>';return}
  $("memberList").innerHTML=data.map(m=>{
    const status=m.approval_status||"pending";
    const label=status==="approved"?"승인됨":status==="rejected"?"거절됨":"승인 대기";
    const date=m.created_at?new Date(m.created_at).toLocaleDateString("ko-KR"):"";
    const actions=m.role==="admin"?'<span class="member-note">관리자</span>':`<div class="member-actions"><button class="small-btn" onclick="setMemberApproval('${m.id}','approved')">승인</button><button class="small-btn" onclick="setMemberApproval('${m.id}','rejected')">거절</button></div>`;
    return `<div class="member-item"><div><strong>${escapeHtml(m.display_name||"")}</strong> <span class="member-username">@${escapeHtml(m.username||"")}</span><div class="member-meta"><span class="approval-badge ${status}">${label}</span> ${date}</div></div>${actions}</div>`;
  }).join("");
}

async function setMemberApproval(id,status){
  if(currentProfile?.role!=="admin")return;
  if(id===currentUser.id){alert("현재 로그인한 관리자 계정의 승인 상태는 변경할 수 없습니다.");return}
  const label=status==="approved"?"승인": "거절";
  if(!confirm(`이 회원을 ${label} 처리할까요?`))return;
  const {error}=await db.from("profiles").update({approval_status:status,updated_at:new Date().toISOString()}).eq("id",id);
  if(error){alert("회원 상태 변경 실패: "+error.message);return}
  await loadMembers();
}


async function loadSchedules(){
  const {data,error}=await db.from("schedules").select(`*, schedule_images(id,file_name,file_path,created_at)`).order("schedule_date",{ascending:true}).order("start_time",{ascending:true,nullsFirst:true});
  if(error){console.error(error);alert("일정을 불러오지 못했습니다.\n"+error.message);return}
  allSchedules=data||[];
  renderCalendar();renderScheduleList();
}

function renderCalendar(){
  const y=currentDate.getFullYear(),m=currentDate.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0);
  $("monthTitle").textContent=`${y}년 ${m+1}월`;
  const start=new Date(y,m,1-first.getDay()),end=new Date(y,m,last.getDate()+(6-last.getDay()));
  const today=dateString(new Date()),selected=dateString(selectedDate),cal=$("calendar");cal.innerHTML="";
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const v=dateString(d),day=document.createElement("button");day.type="button";day.className="day";
    if(d.getMonth()!==m)day.classList.add("other");if(v===today)day.classList.add("today");if(v===selected)day.classList.add("selected");
    day.innerHTML=`<span class="day-number">${d.getDate()}</span><div class="day-events"></div>`;
    const ev=day.querySelector(".day-events");
    allSchedules.filter(s=>s.schedule_date===v).slice(0,3).forEach(s=>{const e=document.createElement("div");e.className=`day-event ${categoryClass(s.category)}`;e.textContent=s.title;ev.appendChild(e)});
    day.onclick=()=>{selectedDate=new Date(`${v}T12:00:00`);currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);activeCategory="all";document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));document.querySelector('[data-category="all"]').classList.add("active");renderCalendar();renderScheduleList()};
    cal.appendChild(day);
  }
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function renderScheduleList(){
  const selected=dateString(selectedDate);
  let schedules=allSchedules.filter(s=>s.schedule_date===selected);
  if(activeCategory!=="all")schedules=schedules.filter(s=>s.category===activeCategory);
  $("selectedDateTitle").textContent=`${formatDateKR(selected)} 일정`;
  $("scheduleCount").textContent=`등록된 일정 ${schedules.length}개`;
  if(!schedules.length){$("scheduleList").innerHTML=`<div class="empty">이 날짜에는 등록된 일정이 없습니다.</div>`;return}
  $("scheduleList").innerHTML=schedules.map(s=>{
    const time=s.start_time?`${s.start_time.slice(0,5)}${s.end_time?" ~ "+s.end_time.slice(0,5):""}`:"시간 미지정";
    const author=s.author_username ? (s.author_display_name ? `${s.author_username} (${s.author_display_name})` : s.author_username) : "작성자 정보 없음";
    const imgs=(s.schedule_images||[]).map(i=>{const {data}=db.storage.from(BUCKET).getPublicUrl(i.file_path);return `<div class="image-card"><img src="${data.publicUrl}"><a href="${data.publicUrl}?download=${encodeURIComponent(i.file_name)}" download>다운로드</a></div>`}).join("");
    const canManage=currentProfile?.role==="admin" || s.user_id===currentUser.id;
    return `<article class="schedule-item"><div class="schedule-row"><div><h3 class="schedule-title">${escapeHtml(s.title)}</h3><div class="schedule-meta"><span class="badge">${escapeHtml(s.category)}</span>${escapeHtml(time)}</div><div class="schedule-author">작성자 · ${escapeHtml(author)}</div></div>${canManage?`<div class="schedule-actions"><button class="small-btn" onclick="editSchedule(${s.id})">수정</button><button class="small-btn" onclick="deleteSchedule(${s.id})">삭제</button></div>`:""}</div>${s.description?`<div class="schedule-description">${escapeHtml(s.description)}</div>`:""}${imgs?`<div class="images">${imgs}</div>`:""}</article>`;
  }).join("");
}

function openModal(s=null){
  editingId=s?.id||null;$("modalTitle").textContent=s?"일정 수정":"일정 등록";$("scheduleId").value=s?.id||"";
  $("scheduleDate").value=s?.schedule_date||dateString(selectedDate);$("scheduleTitle").value=s?.title||"";setCategory(s?.category||"CPF 지원");
  $("startTime").value=s?.start_time?.slice(0,5)||"";$("endTime").value=s?.end_time?.slice(0,5)||"";$("scheduleDescription").value=s?.description||"";$("scheduleImages").value="";$("imagePreview").innerHTML="";$("modal").classList.remove("hidden");
}
function closeModal(){$("modal").classList.add("hidden");editingId=null}

async function saveSchedule(e){
  e.preventDefault();
  const payload={schedule_date:$("scheduleDate").value,title:$("scheduleTitle").value.trim(),category:$("scheduleCategory").value,start_time:$("startTime").value||null,end_time:$("endTime").value||null,description:$("scheduleDescription").value.trim()||null};
  const authorPayload={user_id:currentUser.id,author_username:currentProfile?.username||null,author_display_name:currentProfile?.display_name||null};
  if(!payload.title){alert("제목을 입력해주세요.");return}
  let scheduleId=editingId;
  if(editingId){
    const existing=allSchedules.find(x=>x.id===editingId);
    if(!existing){alert("일정을 찾을 수 없습니다.");return}
    if(currentProfile?.role!=="admin" && existing.user_id!==currentUser.id){alert("본인이 등록한 일정만 수정할 수 있습니다.");return}
    const {error}=await db.from("schedules").update({...payload,updated_at:new Date().toISOString()}).eq("id",editingId);
    if(error){alert("수정 실패: "+error.message);return}
  }else{
    const {data,error}=await db.from("schedules").insert({...payload,...authorPayload}).select().single();
    if(error){alert("등록 실패: "+error.message);return}
    scheduleId=data.id;
  }
  for(const file of Array.from($("scheduleImages").files||[])){
    const safe=file.name.replace(/[^a-zA-Z0-9가-힣._-]/g,"_"),path=`${scheduleId}/${Date.now()}_${crypto.randomUUID()}_${safe}`;
    const {error:up}=await db.storage.from(BUCKET).upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
    if(up){alert("이미지 업로드 실패: "+up.message);continue}
    const {error:ie}=await db.from("schedule_images").insert({schedule_id:scheduleId,file_name:file.name,file_path:path});
    if(ie)alert("이미지 정보 저장 실패: "+ie.message);
  }
  selectedDate=new Date(payload.schedule_date+"T00:00:00");currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);closeModal();await loadSchedules();
}

async function deleteSchedule(id){
  const s=allSchedules.find(x=>x.id===id);if(!s)return;if(currentProfile?.role!=="admin" && s.user_id!==currentUser.id){alert("본인이 등록한 일정만 삭제할 수 있습니다.");return}if(!confirm(`"${s.title}" 일정을 삭제할까요?`))return;
  const imgs=s.schedule_images||[];if(imgs.length)await db.storage.from(BUCKET).remove(imgs.map(i=>i.file_path));
  const {error}=await db.from("schedules").delete().eq("id",id);if(error){alert("삭제 실패: "+error.message);return}await loadSchedules();
}
function editSchedule(id){const s=allSchedules.find(x=>x.id===id);if(!s)return;if(currentProfile?.role!=="admin" && s.user_id!==currentUser.id){alert("본인이 등록한 일정만 수정할 수 있습니다.");return}openModal(s)}

async function startApp(){
  const {data:{user}}=await db.auth.getUser();
  if(!user){$("authScreen").classList.remove("hidden");$("appScreen").classList.add("hidden");return}
  currentUser=user;
  try{await loadProfile()}catch(e){console.error(e);await signOut();showAuthMessage("사용자 프로필을 불러오지 못했습니다. 관리자에게 문의하세요.","error");return}
  if(!currentProfile){await signOut();showAuthMessage("사용자 프로필을 찾을 수 없습니다. 관리자에게 문의해주세요.","error");return}
  if(currentProfile.role!=="admin" && currentProfile.approval_status!=="approved"){
    await signOut();
    const msg=currentProfile.approval_status==="rejected"
      ? "회원가입이 승인되지 않았습니다. 관리자에게 문의해주세요."
      : "회원가입은 완료되었습니다. 관리자 승인 후 달력을 이용할 수 있습니다.";
    showAuthMessage(msg,"error");
    return;
  }
  $("authScreen").classList.add("hidden");$("appScreen").classList.remove("hidden");
  $("memberAdminCard").classList.toggle("hidden",currentProfile.role!=="admin");
  await loadSchedules();
  if(currentProfile.role==="admin")await loadMembers();
}

$("loginForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();try{await signIn($("loginUsername").value,$("loginPassword").value);await startApp()}catch(err){showAuthMessage("로그인 실패: "+err.message,"error")}};
$("signupForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();const username=normalizeUsername($("signupUsername").value);const name=$("signupName").value.trim();const password=$("signupPassword").value;const confirm=$("signupPasswordConfirm").value;if(password!==confirm){showAuthMessage("비밀번호가 일치하지 않습니다.","error");return}if(!/^[a-z0-9._-]{3,30}$/.test(username)){showAuthMessage("아이디는 영문 소문자, 숫자, ., _, -만 사용해 3~30자로 입력해주세요.","error");return}if(!name){showAuthMessage("이름을 입력해주세요.","error");return}try{await signUp(username,name,password);showAuthMessage("회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.","success");$("signupForm").reset();$("loginUsername").value=username}catch(err){showAuthMessage("회원가입 실패: "+(err.message||err),"error")}};
$("logoutBtn").onclick=signOut;
$("refreshMembersBtn").onclick=loadMembers;
db.auth.onAuthStateChange((_event,session)=>{if(session){currentUser=session.user;startApp()}else{currentUser=null;currentProfile=null;$("authScreen").classList.remove("hidden");$("appScreen").classList.add("hidden")}});

$("prevMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()-1,1);renderCalendar()};
$("nextMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,1);renderCalendar()};
$("todayBtn").onclick=()=>{selectedDate=new Date();currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);renderCalendar();renderScheduleList()};
$("addScheduleBtn").onclick=()=>openModal();$("closeModal").onclick=closeModal;$("cancelBtn").onclick=closeModal;
$("modal").querySelector(".modal-backdrop").onclick=closeModal;$("scheduleForm").onsubmit=saveSchedule;
$("scheduleImages").onchange=()=>{$("imagePreview").innerHTML="";Array.from($("scheduleImages").files||[]).forEach(f=>{const i=document.createElement("img");i.src=URL.createObjectURL(f);$("imagePreview").appendChild(i)})};
initCategoryOptions();
document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderScheduleList()});

(async()=>{if(SUPABASE_URL.includes("여기에_")||SUPABASE_PUBLISHABLE_KEY.includes("여기에_")){showAuthMessage("app.js에 Supabase URL과 Publishable key를 입력하세요.","error");return}await startApp()})();
