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
let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTouchStartX = null;
let peopleRecords = [];
const PEOPLE_REGIONS = ["대전", "서울", "경기"];
const CUSTOM_REGION_VALUE = "__custom__";

const $ = id => document.getElementById(id);

function dateString(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function formatDateKR(v){const [y,m,d]=v.split("-");return `${y}년 ${Number(m)}월 ${Number(d)}일`}
function categoryClass(c){return ({"CPF 지원":"cpf","차량사고":"accident","이슈":"issue","신규입차자(신입)":"new-hire","퇴사":"resignation"})[c]||"issue"}

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
  const initial=String(data.display_name || data.username || "U").trim().charAt(0).toUpperCase();
  if($("avatarInitial")) $("avatarInitial").textContent=initial;
  document.querySelectorAll(".admin-nav").forEach(el=>el.classList.toggle("hidden",data.role!=="admin"));
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


function fillRegionSelect(select, includeAll=false){
  if(!select)return; const old=select.value;
  select.innerHTML=(includeAll?'<option value="all">전체 지역</option>':'<option value="" disabled>지역 선택</option>')+PEOPLE_REGIONS.map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")+(includeAll?'':'<option value="'+CUSTOM_REGION_VALUE+'">직접입력</option>');
  if([...select.options].some(o=>o.value===old))select.value=old;
}
async function loadPeople(){
  if(!currentProfile || (currentProfile.role!=="admin" && currentProfile.approval_status!=="approved"))return;
  const {data,error}=await db.from("personnel_events").select("*").order("event_date",{ascending:true});
  if(error){console.error(error);alert("신규입차자/퇴사 정보를 불러오지 못했습니다. personnel_events 테이블 SQL을 실행했는지 확인해주세요.\n"+error.message);return}
  peopleRecords=data||[]; renderPeople(); updateSummary(); renderCalendar(); renderScheduleList();
}
function renderPeople(){
  const active=peopleRecords.filter(x=>x.status!=="취소");
  $("statHirePending").textContent=active.filter(x=>x.event_type==="신규입차자"&&x.status!=="완료").length+"명";
  $("statHireDone").textContent=active.filter(x=>x.event_type==="신규입차자"&&x.status==="완료").length+"명";
  $("statExitPending").textContent=active.filter(x=>x.event_type==="퇴사"&&x.status!=="완료").length+"명";
  $("statExitDone").textContent=active.filter(x=>x.event_type==="퇴사"&&x.status==="완료").length+"명";
  const type=$("peopleTypeFilter").value,region=$("peopleRegionFilter").value,shift=$("peopleShiftFilter").value;
  const q=($("peopleSearch")?.value||"").trim().toLocaleLowerCase();
  const rows=peopleRecords.filter(r=>(type==="all"||r.event_type===type)&&(region==="all"||r.region===region)&&(shift==="all"||r.shift_type===shift)&&
    (!q||[r.name,r.event_type,r.shift_type,r.event_date,r.region,r.router_code,r.phone,r.status,r.memo,r.manager].some(v=>String(v||"").toLocaleLowerCase().includes(q))));
  if(!rows.length){$("peopleList").innerHTML='<div class="empty">등록된 신규입차자/퇴사 정보가 없습니다.</div>';return}
  $("peopleList").innerHTML=rows.map(r=>`<article class="person-row"><div class="person-main"><div class="person-title"><strong>${escapeHtml(r.name)}</strong><span class="person-tag ${r.event_type==="퇴사"?"exit":"hire"}">${escapeHtml(r.event_type)}</span><span class="person-tag shift">${escapeHtml(r.shift_type)}</span><span class="person-status status-${r.status==="완료"?"done":r.status==="취소"?"cancel":"active"}">${escapeHtml(r.status)}</span></div><div class="person-meta">${escapeHtml(r.event_date)} · ${escapeHtml(r.region)} · 라우터 ${escapeHtml(r.router_code||"미입력")} · 연락처 ${escapeHtml(r.phone||"미입력")}</div><div class="person-meta">담당자 · ${escapeHtml(r.manager||"미입력")}${r.memo?` · ${escapeHtml(r.memo)}`:""}</div></div><div class="schedule-actions"><button class="small-btn" onclick="editPerson('${r.id}')">수정</button><button class="small-btn" onclick="deletePerson('${r.id}')">삭제</button></div></article>`).join("");
}
function openPersonModal(record=null){
  if(currentProfile?.role!=="admin"){alert("관리자만 이용할 수 있습니다.");return}
  $("personForm").reset();$("personId").value=record?.id||"";
  $("personType").value=record?.event_type||"신규입차자";$("personName").value=record?.name||"";$("personShift").value=record?.shift_type||"주간";
  $("personDate").value=record?.event_date||dateString(selectedDate);
  const knownRegion=PEOPLE_REGIONS.includes(record?.region);$("personRegion").value=record?(knownRegion?record.region:CUSTOM_REGION_VALUE):"";$("personRegionCustom").value=record&&!knownRegion?(record.region||""):"";toggleCustomRegion();
  $("personRouter").value=record?.router_code||"";$("personPhone").value=record?.phone||"";$("personStatus").value=record?.status||"예정";$("personManager").value=record?.manager||currentProfile?.display_name||currentProfile?.username||"";$("personMemo").value=record?.memo||"";
  $("personModalTitle").textContent=record?"입차자 / 퇴사 정보 수정":"신규입차자 / 퇴사 등록";updatePersonDateLabel();$("personModal").classList.remove("hidden");
}
function updatePersonDateLabel(){$("personDateLabel").firstChild.textContent=$("personType").value==="퇴사"?"퇴사일":"신규입차일"}
function toggleCustomRegion(){const custom=$("personRegion").value===CUSTOM_REGION_VALUE;$("personRegionCustom").classList.toggle("hidden",!custom);$("personRegionCustom").required=custom;if(!custom)$("personRegionCustom").value="";}
function editPerson(id){const r=peopleRecords.find(x=>String(x.id)===String(id));if(r)openPersonModal(r)}
async function savePerson(e){e.preventDefault();if(currentProfile?.role!=="admin")return;
 const id=$("personId").value;const payload={event_type:$("personType").value,name:$("personName").value.trim(),shift_type:$("personShift").value,event_date:$("personDate").value,region:$("personRegion").value===CUSTOM_REGION_VALUE?$("personRegionCustom").value.trim():$("personRegion").value,router_code:$("personRouter").value.trim()||null,phone:$("personPhone").value.trim()||null,status:$("personStatus").value,memo:$("personMemo").value.trim()||null,manager:$("personManager").value.trim()};
 if(id){const {error}=await db.from("personnel_events").update(payload).eq("id",id);if(error){alert("수정 실패: "+error.message);return}}else{payload.created_by=currentUser.id;const {error}=await db.from("personnel_events").insert(payload);if(error){alert("등록 실패: "+error.message);return}}
 $("personModal").classList.add("hidden");await loadPeople();
}
async function deletePerson(id){if(currentProfile?.role!=="admin"||!confirm("이 정보를 삭제할까요?"))return;const {error}=await db.from("personnel_events").delete().eq("id",id);if(error){alert("삭제 실패: "+error.message);return}await loadPeople()}

async function loadSchedules(){
  const {data,error}=await db.from("schedules").select(`*, schedule_images(id,file_name,file_path,created_at)`).order("schedule_date",{ascending:true}).order("start_time",{ascending:true,nullsFirst:true});
  if(error){console.error(error);alert("일정을 불러오지 못했습니다.\n"+error.message);return}
  allSchedules=data||[];
  updateSummary();
  renderCalendar();renderScheduleList();
}


function updateSummary(){
  const counts={"CPF 지원":0,"차량사고":0,"이슈":0};
  allSchedules.forEach(s=>{if(counts[s.category]!==undefined) counts[s.category]++;});
  // 신규입차/퇴사는 일반 일정 카테고리가 아니라 personnel_events 등록 건수로 집계
  const activePeople=peopleRecords.filter(r=>r.status!=="취소");
  const hireCount=activePeople.filter(r=>r.event_type==="신규입차자").length;
  const exitCount=activePeople.filter(r=>r.event_type==="퇴사").length;
  if($("cpfCount")) $("cpfCount").textContent=`${counts["CPF 지원"]}건`;
  if($("accidentCount")) $("accidentCount").textContent=`${counts["차량사고"]}건`;
  if($("issueCount")) $("issueCount").textContent=`${counts["이슈"]}건`;
  if($("newHireCount")) $("newHireCount").textContent=`${hireCount}건`;
  if($("resignationCount")) $("resignationCount").textContent=`${exitCount}건`;
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
    const scheduleEvents=allSchedules.filter(s=>s.schedule_date===v).slice(0,3);
    scheduleEvents.forEach(s=>{const e=document.createElement("div");e.className=`day-event ${categoryClass(s.category)}`;const t=s.start_time?s.start_time.slice(0,5)+" ":"";e.textContent=t+s.title;ev.appendChild(e)});
    peopleRecords.filter(r=>r.event_date===v && r.status!=="취소").slice(0,3).forEach(r=>{const e=document.createElement("div");e.className=`day-event ${r.event_type==="퇴사"?"resignation":"new-hire"}`;e.textContent=`${r.event_type==="퇴사"?"퇴사":"입차"} · ${r.name} (${r.shift_type})`;ev.appendChild(e)});
    day.onclick=()=>{selectedDate=new Date(`${v}T12:00:00`);currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);activeCategory="all";document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));document.querySelector('[data-category="all"]').classList.add("active");renderCalendar();renderScheduleList()};
    cal.appendChild(day);
  }
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function renderScheduleList(){
  const selected=dateString(selectedDate);
  let schedules=allSchedules.filter(s=>s.schedule_date===selected);
  if(activeCategory!=="all")schedules=schedules.filter(s=>s.category===activeCategory);
  let personnel=peopleRecords.filter(r=>r.event_date===selected && r.status!=="취소");
  if(activeCategory==="신규입차자(신입)")personnel=personnel.filter(r=>r.event_type==="신규입차자");
  else if(activeCategory==="퇴사")personnel=personnel.filter(r=>r.event_type==="퇴사");
  else if(activeCategory!=="all")personnel=[];
  $("selectedDateTitle").textContent=`${formatDateKR(selected)} 일정`;
  $("scheduleCount").textContent=`등록된 일정 ${schedules.length+personnel.length}개 (일반 ${schedules.length} · 입차/퇴사 ${personnel.length})`;
  if(!schedules.length&&!personnel.length){$("scheduleList").innerHTML=`<div class="empty">이 날짜에는 등록된 일정이 없습니다.</div>`;return}
  const scheduleHtml=schedules.map(s=>{
    const time=s.start_time?`${s.start_time.slice(0,5)}${s.end_time?" ~ "+s.end_time.slice(0,5):""}`:"시간 미지정";
    const author=s.author_username ? (s.author_display_name ? `${s.author_username} (${s.author_display_name})` : s.author_username) : "작성자 정보 없음";
    const imgs=(s.schedule_images||[]).map(i=>{const {data}=db.storage.from(BUCKET).getPublicUrl(i.file_path);return `<div class="image-card"><img src="${data.publicUrl}" alt="${escapeHtml(i.file_name)}"><a href="${data.publicUrl}?download=${encodeURIComponent(i.file_name)}" download>다운로드</a></div>`}).join("");
    const canManage=currentProfile?.role==="admin" || s.user_id===currentUser.id;
    return `<article class="schedule-item"><div class="schedule-row"><div><h3 class="schedule-title">${escapeHtml(s.title)}</h3><div class="schedule-meta"><span class="badge">${escapeHtml(s.category)}</span>${escapeHtml(time)}</div><div class="schedule-author">작성자 · ${escapeHtml(author)}</div></div>${canManage?`<div class="schedule-actions"><button class="small-btn" onclick="editSchedule(${s.id})">수정</button><button class="small-btn" onclick="deleteSchedule(${s.id})">삭제</button></div>`:""}</div>${s.description?`<div class="schedule-description">${escapeHtml(s.description)}</div>`:""}${imgs?`<div class="images">${imgs}</div>`:""}</article>`;
  }).join("");
  const personnelHtml=personnel.map(r=>`<article class="schedule-item personnel-schedule-item ${r.event_type==="퇴사"?"resignation-item":"new-hire-item"}">
    <div class="schedule-row"><div><h3 class="schedule-title">${r.event_type==="퇴사"?"퇴사":"신규입차"} · ${escapeHtml(r.name)}</h3>
    <div class="schedule-meta"><span class="badge">${escapeHtml(r.event_type)}</span><span class="badge">${escapeHtml(r.shift_type)}</span><span class="badge">${escapeHtml(r.status)}</span></div>
    <div class="schedule-author">${escapeHtml(r.event_date)} · ${escapeHtml(r.region)} · 라우터 ${escapeHtml(r.router_code||"미입력")}</div>
    <div class="schedule-author">연락처 ${escapeHtml(r.phone||"미입력")} · 담당자 ${escapeHtml(r.manager||"미입력")}</div></div>
    ${currentProfile?.role==="admin"?`<div class="schedule-actions"><button class="small-btn" onclick="editPerson('${r.id}')">수정</button><button class="small-btn" onclick="deletePerson('${r.id}')">삭제</button></div>`:""}
    </div>${r.memo?`<div class="schedule-description">${escapeHtml(r.memo)}</div>`:""}</article>`).join("");
  $("scheduleList").innerHTML=scheduleHtml+personnelHtml;
}

function openImageLightbox(src, caption="", images=null, startIndex=0){
  if(!src) return;
  lightboxImages = Array.isArray(images) && images.length ? images : [{src, caption}];
  lightboxIndex = Math.max(0, Math.min(startIndex, lightboxImages.length - 1));
  renderLightboxImage();
  $("imageLightbox").classList.remove("hidden");
  document.body.classList.add("image-lightbox-open");
}
function renderLightboxImage(){
  if(!lightboxImages.length) return;
  const item=lightboxImages[lightboxIndex];
  $("lightboxImage").src=item.src;
  $("lightboxImage").alt=item.caption || "확대된 일정 이미지";
  $("lightboxCaption").textContent=lightboxImages.length>1
    ? `${item.caption || "일정 이미지"}  ·  ${lightboxIndex+1} / ${lightboxImages.length}`
    : (item.caption || "");
  const multiple=lightboxImages.length>1;
  $("lightboxPrev").classList.toggle("hidden",!multiple);
  $("lightboxNext").classList.toggle("hidden",!multiple);
  $("lightboxCounter").classList.toggle("hidden",!multiple);
  $("lightboxCounter").textContent=`${lightboxIndex+1} / ${lightboxImages.length}`;
}
function moveLightbox(step){
  if(lightboxImages.length<2) return;
  lightboxIndex=(lightboxIndex+step+lightboxImages.length)%lightboxImages.length;
  renderLightboxImage();
}
function closeImageLightbox(){
  $("imageLightbox").classList.add("hidden");
  $("lightboxImage").src="";
  lightboxImages=[]; lightboxIndex=0;
  document.body.classList.remove("image-lightbox-open");
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
  if(currentProfile.role==="admin"){await loadMembers(); await loadPeople();}
}

$("loginForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();try{await signIn($("loginUsername").value,$("loginPassword").value);await startApp()}catch(err){showAuthMessage("로그인 실패: "+err.message,"error")}};
$("signupForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();const username=normalizeUsername($("signupUsername").value);const name=$("signupName").value.trim();const password=$("signupPassword").value;const confirm=$("signupPasswordConfirm").value;if(password!==confirm){showAuthMessage("비밀번호가 일치하지 않습니다.","error");return}if(!/^[a-z0-9._-]{3,30}$/.test(username)){showAuthMessage("아이디는 영문 소문자, 숫자, ., _, -만 사용해 3~30자로 입력해주세요.","error");return}if(!name){showAuthMessage("이름을 입력해주세요.","error");return}try{await signUp(username,name,password);showAuthMessage("회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.","success");$("signupForm").reset();$("loginUsername").value=username}catch(err){showAuthMessage("회원가입 실패: "+(err.message||err),"error")}};
if($("logoutBtn")) $("logoutBtn").onclick=signOut;
$("refreshMembersBtn").onclick=loadMembers;
fillRegionSelect($("personRegion"));fillRegionSelect($("peopleRegionFilter"),true);
$("addPersonBtn").onclick=()=>openPersonModal();$("closePersonModal").onclick=()=>$("personModal").classList.add("hidden");$("cancelPersonBtn").onclick=()=>$("personModal").classList.add("hidden");
$("personModal").querySelectorAll("[data-close-person]").forEach(el=>el.onclick=()=>$("personModal").classList.add("hidden"));$("personForm").onsubmit=savePerson;$("personType").onchange=updatePersonDateLabel;$("personRegion").onchange=toggleCustomRegion;
["peopleTypeFilter","peopleRegionFilter","peopleShiftFilter"].forEach(id=>$(id).onchange=renderPeople);if($("peopleSearch"))$("peopleSearch").oninput=renderPeople;
$("resetPeopleFilters").onclick=()=>{$("peopleSearch").value="";$("peopleTypeFilter").value="all";$("peopleRegionFilter").value="all";$("peopleShiftFilter").value="all";renderPeople()};
$("applyPeopleFilters").onclick=renderPeople;
db.auth.onAuthStateChange((_event,session)=>{if(session){currentUser=session.user;startApp()}else{currentUser=null;currentProfile=null;$("authScreen").classList.remove("hidden");$("appScreen").classList.add("hidden")}});

$("prevMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()-1,1);renderCalendar()};
$("nextMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,1);renderCalendar()};
$("todayBtn").onclick=()=>{selectedDate=new Date();currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);renderCalendar();renderScheduleList()};
$("addScheduleBtn").onclick=()=>openModal();
$("sidebarAddBtn").onclick=()=>openModal();
$("sidebarTodayBtn").onclick=()=>{$("todayBtn").click()};
$("sideTodayBtn").onclick=()=>{$("todayBtn").click()};
function setWorkspaceView(view){
  const app=$("appScreen");
  app.classList.toggle("member-view",view==="members");
  app.classList.toggle("people-view",view==="people");
  document.querySelectorAll(".nav-menu .nav-item").forEach(btn=>btn.classList.remove("active"));
  const active=view==="members"?$("sidebarMemberBtn"):view==="people"?$("sidebarPeopleBtn") :$("sidebarCalendarBtn");
  if(active)active.classList.add("active");
  if(view==="members"){
    if(currentProfile?.role!=="admin"){
      alert("회원 관리는 관리자만 이용할 수 있습니다.");
      setWorkspaceView("calendar");
      return;
    }
    $("memberAdminCard").classList.remove("hidden");$("peopleAdminCard").classList.add("hidden");
    loadMembers();
  } else if(view==="people"){
    if(currentProfile?.role!=="admin"){alert("관리자만 이용할 수 있습니다.");setWorkspaceView("calendar");return}
    $("memberAdminCard").classList.add("hidden");$("peopleAdminCard").classList.remove("hidden");loadPeople();
  } else {
    $("memberAdminCard").classList.add("hidden");$("peopleAdminCard").classList.add("hidden");
  }
}
$("sidebarMemberBtn").onclick=()=>setWorkspaceView("members");
$("sidebarPeopleBtn").onclick=()=>setWorkspaceView("people");
$("sidebarCalendarBtn").onclick=()=>setWorkspaceView("calendar");
$("sidebarLogoutBtn").onclick=signOut;$("closeModal").onclick=closeModal;$("cancelBtn").onclick=closeModal;
$("modal").querySelector(".modal-backdrop").onclick=closeModal;$("scheduleForm").onsubmit=saveSchedule;
$("scheduleImages").onchange=()=>{$("imagePreview").innerHTML="";Array.from($("scheduleImages").files||[]).forEach(f=>{const i=document.createElement("img");i.src=URL.createObjectURL(f);$("imagePreview").appendChild(i)})};
// 일정에 등록된 여러 이미지는 확대 화면에서 좌우 슬라이드로 확인할 수 있습니다.
document.addEventListener("click",e=>{
  const img=e.target.closest(".image-card img, #imagePreview img");
  if(img){
    e.preventDefault();
    const group=img.closest(".images, #imagePreview");
    const groupImages=group ? Array.from(group.querySelectorAll("img")).map((el,i)=>({src:el.src,caption:el.alt || `일정 이미지 ${i+1}`})) : [];
    const index=Math.max(0,groupImages.findIndex(item=>item.src===img.src));
    openImageLightbox(img.src,img.alt || "일정 이미지",groupImages,index);
    return;
  }
  if(e.target.closest("[data-close-image]")) closeImageLightbox();
});
$("lightboxPrev").onclick=()=>moveLightbox(-1);
$("lightboxNext").onclick=()=>moveLightbox(1);
$("imageLightbox").addEventListener("touchstart",e=>{lightboxTouchStartX=e.changedTouches[0].clientX;},{passive:true});
$("imageLightbox").addEventListener("touchend",e=>{
  if(lightboxTouchStartX===null)return;
  const delta=e.changedTouches[0].clientX-lightboxTouchStartX;
  if(Math.abs(delta)>45)moveLightbox(delta<0?1:-1);
  lightboxTouchStartX=null;
},{passive:true});
document.addEventListener("keydown",e=>{
  if($("imageLightbox").classList.contains("hidden"))return;
  if(e.key==="Escape")closeImageLightbox();
  else if(e.key==="ArrowRight")moveLightbox(1);
  else if(e.key==="ArrowLeft")moveLightbox(-1);
});
initCategoryOptions();
document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderScheduleList()});

(async()=>{if(SUPABASE_URL.includes("여기에_")||SUPABASE_PUBLISHABLE_KEY.includes("여기에_")){showAuthMessage("app.js에 Supabase URL과 Publishable key를 입력하세요.","error");return}await startApp()})();
