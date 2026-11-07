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
let scheduleComments = {};
let scheduleCommentsReady = false;
let activeCategory = "all";
let editingId = null;
let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTouchStartX = null;
let peopleRecords = [];
let memberRecords = [];
let peoplePage = 1;
let memberPage = 1;
const PAGE_SIZE = 10;
const PEOPLE_REGIONS = ["대전", "서울", "경기"];
const CUSTOM_REGION_VALUE = "__custom__";

const $ = id => document.getElementById(id);


// 변경 이력은 감사 로그 테이블이 설치된 경우 기록합니다. 로그 실패가 본 작업을 막지는 않습니다.
async function writeAudit(action, entityType, entityId, details={}) {
  try { const {error}=await db.from("audit_logs").insert({actor_id:currentUser?.id||null,actor_username:currentProfile?.username||null,action,entity_type:entityType,entity_id:String(entityId??""),details}); if(error) console.warn("감사 로그 기록 실패(SQL 설치 여부 확인):",error.message); } catch(e){console.warn("감사 로그 기록 실패:",e)}
}
function downloadCSV(filename, rows) {
  if(!rows.length){alert("내보낼 데이터가 없습니다.");return}
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const cell=v=>{let x=String(v??"");if(/^[=+@\-]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'};
  const csv="\uFEFF"+[keys.map(cell).join(","),...rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
function exportPeopleCSV(){downloadCSV(`입차퇴사_현황_${dateString(new Date())}.csv`,peopleRecords.map(r=>({유형:r.event_type,이름:r.name,근무구분:r.shift_type,일자:r.event_date,지역:r.region,라우터코드:r.router_code,연락처:r.phone,상태:r.status,담당자:r.manager,메모:r.memo,등록자:r.created_by,등록ID:r.id})));}
function exportMembersCSV(){if(currentProfile?.role!=="admin"){alert("관리자만 내보낼 수 있습니다.");return}downloadCSV(`회원목록_${dateString(new Date())}.csv`,memberRecords.map(r=>({아이디:r.username,이름:r.display_name,권한:r.role,승인상태:r.approval_status,가입일:r.created_at,회원ID:r.id})));}
function exportSchedulesCSV(){downloadCSV(`일정목록_${dateString(new Date())}.csv`,allSchedules.map(s=>({날짜:s.schedule_date,시작시간:s.start_time,종료시간:s.end_time,카테고리:s.category,제목:s.title,내용:s.description,작성자:s.author_username,작성자이름:s.author_display_name,첨부이미지수:(s.schedule_images||[]).length,등록일:s.created_at,일정ID:s.id})));}
function updateOverview(){const today=dateString(new Date()),weekEnd=new Date();weekEnd.setDate(weekEnd.getDate()+7);const end=dateString(weekEnd),selected=dateString(selectedDate);const countPeople=(a,b)=>peopleRecords.filter(r=>r.event_date>=a&&r.event_date<=b&&r.status!=="취소").length;const put=(id,v)=>{if($(id))$(id).textContent=v+"건"};put("overviewToday",allSchedules.filter(s=>s.schedule_date===today).length+countPeople(today,today));put("overviewWeek",allSchedules.filter(s=>s.schedule_date>=today&&s.schedule_date<=end).length+countPeople(today,end));put("overviewImages",allSchedules.filter(s=>(s.schedule_images||[]).length>0).length);put("overviewSelected",allSchedules.filter(s=>s.schedule_date===selected).length+countPeople(selected,selected));}
async function loadAuditLogs(){
  if(currentProfile?.role!=="admin")return;
  const list=$("auditList");
  list.innerHTML='<div class="empty">변경 이력을 불러오는 중입니다.</div>';
  const {data,error}=await db.from("audit_logs").select("id,actor_username,action,entity_type,entity_id,details,created_at").order("created_at",{ascending:false}).limit(100);
  if(error){list.innerHTML='<div class="empty">이력을 불러오지 못했습니다. audit_logs_setup.sql을 Supabase SQL Editor에서 실행했는지 확인해주세요.</div>';console.warn(error);return}
  if(!data?.length){list.innerHTML='<div class="empty">아직 기록된 변경 이력이 없습니다.</div>';return}
  const actionLabels={create:"등록",update:"정보 수정",delete:"삭제",approval_approved:"회원 승인",approval_rejected:"회원 승인 거절"};
  const typeLabels={personnel_event:"입차·퇴사 정보",schedule:"일정",schedules:"일정",profile:"회원 정보",profiles:"회원 정보",member:"회원",schedule_image:"일정 이미지",schedule_images:"일정 이미지"};
  const keyLabels={name:"이름",region:"지역",status:"진행 상태",manager:"담당자",event_date:"처리 예정일",event_type:"구분",shift_type:"근무 형태",router_code:"라우터 코드",memo:"메모",title:"일정 제목",description:"내용",schedule_date:"일정 날짜",category:"카테고리",start_time:"시작 시간",end_time:"종료 시간",approval_status:"승인 상태",username:"아이디",display_name:"이름",phone:"연락처"};
  const safeValue=(k,v)=>k.toLowerCase()==="phone"?"전화번호 변경":(v===null||v===undefined||v===""?"-":String(v));
  list.innerHTML=data.map((r,i)=>{
    const time=r.created_at?new Date(r.created_at).toLocaleString("ko-KR"):"시간 미상";
    const details=r.details&&typeof r.details==="object"?r.details:{};
    const entries=Object.entries(details).filter(([k])=>!['password','token','access_token','refresh_token'].includes(k.toLowerCase()));
    const get=(...keys)=>{for(const k of keys){if(details[k]!==undefined&&details[k]!==null&&details[k]!=="")return String(details[k])}return ""};
    const target=get("name","display_name","target_name","person_name")||((r.entity_type||"").includes("personnel")?"입차·퇴사 대상자":"");
    let title=actionLabels[r.action]||"활동 기록";
    const eventType=get("event_type");
    if((r.entity_type||"").includes("personnel")) title=(eventType==="퇴사"?"퇴사 정보 ":eventType==="신규입차자"||eventType==="신규 입차"?"신규 입차 정보 ":"입차·퇴사 정보 ")+(r.action==="create"?"등록":r.action==="delete"?"삭제":"수정");
    const actor=escapeHtml(r.actor_username||"알 수 없음");
    const targetText=target?`<span class="audit-target">대상자 <b>${escapeHtml(target)}</b></span>`:"";
    const chips=entries.filter(([k])=>['region','shift_type','status','event_type','category','approval_status'].includes(k)).slice(0,4).map(([k,v])=>`<span class="audit-chip">${escapeHtml(keyLabels[k]||k)} ${escapeHtml(safeValue(k,v))}</span>`).join("");
    const detail=entries.map(([k,v])=>`<div class="audit-detail-item"><span>${escapeHtml(keyLabels[k]||k.replaceAll('_',' '))}</span><b>${escapeHtml(safeValue(k,v))}</b></div>`).join("");
    const id=String(r.id??i).replace(/[^a-zA-Z0-9_-]/g,"");
    return `<article class="audit-row audit-compact"><button type="button" class="audit-summary" aria-expanded="false" data-audit-toggle="${escapeHtml(id)}"><span class="audit-icon">${(r.entity_type||"").includes("personnel")?"♙":(r.entity_type||"").includes("schedule")?"▦":"↻"}</span><span class="audit-summary-main"><span class="audit-title-line"><strong>${escapeHtml(title)}</strong><time>${escapeHtml(time)}</time></span><span class="audit-meta">작업자 <b>${actor}</b>${targetText}</span>${chips?`<span class="audit-chips">${chips}</span>`:""}</span><span class="audit-expand">상세 <span>⌄</span></span></button><div class="audit-expanded hidden" id="audit-detail-${escapeHtml(id)}"><div class="audit-expanded-head">상세 내용</div>${detail||'<div class="audit-detail-item"><span>상세 정보</span><b>추가 정보 없음</b></div>'}</div></article>`;
  }).join("");
  list.querySelectorAll("[data-audit-toggle]").forEach(btn=>btn.addEventListener("click",()=>{const panel=$("audit-detail-"+btn.dataset.auditToggle);const open=btn.getAttribute("aria-expanded")==="true";btn.setAttribute("aria-expanded",String(!open));panel?.classList.toggle("hidden",open);btn.querySelector(".audit-expand").innerHTML=open?'상세 <span>⌄</span>':'접기 <span>⌃</span>'; }));
}
function openNotifications(){const panel=$("notificationPanel"),now=Date.now();const recent=allSchedules.filter(s=>s.created_at&&(now-new Date(s.created_at).getTime())<=7*86400000).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8);$("notificationList").innerHTML=recent.length?recent.map(s=>`<button type="button" class="notification-entry" data-schedule-date="${escapeHtml(s.schedule_date)}"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.category)} · ${escapeHtml(s.schedule_date)}</span><small>작성자 ${escapeHtml(s.author_username||'미상')}</small></button>`).join(''):'<div class="empty">최근 7일 내 새 일정이 없습니다.</div>';panel.classList.toggle('hidden')}


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
  // 신규입차자/퇴사 메뉴는 승인된 일반 사용자도 이용 가능
  if($("sidebarPeopleBtn")) $("sidebarPeopleBtn").classList.toggle("hidden",data.role!=="admin" && data.approval_status!=="approved");
}

async function loadMembers(){
  if(currentProfile?.role!=="admin")return;
  const {data,error}=await db.from("profiles").select("id,username,display_name,role,approval_status,created_at").order("created_at",{ascending:false});
  if(error){alert("회원 목록을 불러오지 못했습니다.\n"+error.message);return}
  memberRecords=data||[]; memberPage=1;updateOpsDashboard();
  $("memberAdminCard").classList.remove("hidden");
  $("memberCount").textContent=`가입 회원 ${memberRecords.length}명`;
  renderMembers();
}
function renderMembers(){
  const list=$("memberList"), pager=$("memberPagination");
  const total=memberRecords.length, pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  memberPage=Math.min(Math.max(1,memberPage),pages);
  const start=(memberPage-1)*PAGE_SIZE, rows=memberRecords.slice(start,start+PAGE_SIZE);
  if(!total){list.innerHTML='<div class="empty">가입 회원이 없습니다.</div>';pager.innerHTML='';return}
  list.innerHTML=rows.map(m=>{
    const status=m.approval_status||"pending";
    const label=status==="approved"?"승인됨":status==="rejected"?"거절됨":"승인 대기";
    const date=m.created_at?new Date(m.created_at).toLocaleDateString("ko-KR"):"";
    const actions=m.role==="admin"?'<span class="member-note">관리자</span>':`<div class="member-actions"><button class="small-btn" onclick="setMemberApproval('${m.id}','approved')">승인</button><button class="small-btn" onclick="setMemberApproval('${m.id}','rejected')">거절</button></div>`;
    return `<div class="member-item"><div><strong>${escapeHtml(m.display_name||"")}</strong> <span class="member-username">@${escapeHtml(m.username||"")}</span><div class="member-meta"><span class="approval-badge ${status}">${label}</span> ${date}</div></div>${actions}</div>`;
  }).join("");
  pager.innerHTML=renderPager(memberPage,pages,total,'member');
}
function renderPager(page,pages,total,kind){
  if(total<=PAGE_SIZE)return '';
  const fn=kind==='member'?'goMemberPage':'goPeoplePage';
  let buttons='';
  buttons+=`<button type="button" class="page-btn" ${page<=1?'disabled':''} onclick="${fn}(${page-1})">이전</button>`;
  const from=Math.max(1,page-2),to=Math.min(pages,page+2);
  for(let p=from;p<=to;p++)buttons+=`<button type="button" class="page-btn ${p===page?'active':''}" onclick="${fn}(${p})">${p}</button>`;
  buttons+=`<button type="button" class="page-btn" ${page>=pages?'disabled':''} onclick="${fn}(${page+1})">다음</button>`;
  return `<div class="pagination-info">총 ${total}명 · ${page} / ${pages} 페이지</div><div class="pagination-buttons">${buttons}</div>`;
}
function goMemberPage(page){memberPage=page;renderMembers()}
function goPeoplePage(page){peoplePage=page;renderPeople()}

async function setMemberApproval(id,status){
  if(currentProfile?.role!=="admin")return;
  if(id===currentUser.id){alert("현재 로그인한 관리자 계정의 승인 상태는 변경할 수 없습니다.");return}
  const label=status==="approved"?"승인": "거절";
  if(!confirm(`이 회원을 ${label} 처리할까요?`))return;
  const {error}=await db.from("profiles").update({approval_status:status,updated_at:new Date().toISOString()}).eq("id",id);
  if(error){alert("회원 상태 변경 실패: "+error.message);return}
  await writeAudit("approval_"+status,"profile",id,{status});
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
  peopleRecords=data||[]; renderPeople(); updateSummary(); renderCalendar(); renderScheduleList();updateOverview();updateOpsDashboard();
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
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));peoplePage=Math.min(Math.max(1,peoplePage),pages);
  const visibleRows=rows.slice((peoplePage-1)*PAGE_SIZE,peoplePage*PAGE_SIZE);
  if(!rows.length){$("peopleList").innerHTML='<div class="empty">등록된 신규입차자/퇴사 정보가 없습니다.</div>';$("peoplePagination").innerHTML='';return}
  $("peopleList").innerHTML=visibleRows.map(r=>{const canManage=currentProfile?.role==="admin"||String(r.created_by)===String(currentUser?.id);return `<article class="person-row"><div class="person-main"><div class="person-title"><strong>${escapeHtml(r.name)}</strong><span class="person-tag ${r.event_type==="퇴사"?"exit":"hire"}">${escapeHtml(r.event_type)}</span><span class="person-tag shift">${escapeHtml(r.shift_type)}</span><span class="person-status status-${r.status==="완료"?"done":r.status==="취소"?"cancel":"active"}">${escapeHtml(r.status)}</span></div><div class="person-meta">${escapeHtml(r.event_date)} · ${escapeHtml(r.region)} · 라우터 ${escapeHtml(r.router_code||"미입력")} · 연락처 ${escapeHtml(r.phone||"미입력")}</div><div class="person-meta">담당자 · ${escapeHtml(r.manager||"미입력")}${r.memo?` · ${escapeHtml(r.memo)}`:""}</div></div>${canManage?`<div class="schedule-actions"><button class="small-btn" onclick="editPerson('${r.id}')">수정</button><button class="small-btn" onclick="deletePerson('${r.id}')">삭제</button></div>`:""}</article>`}).join("");
  $("peoplePagination").innerHTML=renderPager(peoplePage,pages,rows.length,'people');
}
function openPersonModal(record=null){
  if(!currentProfile || (currentProfile.role!=="admin" && currentProfile.approval_status!=="approved")){alert("승인된 회원만 이용할 수 있습니다.");return}
  if(record && currentProfile.role!=="admin" && String(record.created_by)!==String(currentUser?.id)){alert("본인이 등록한 정보만 수정할 수 있습니다.");return}
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
async function savePerson(e){e.preventDefault();if(!currentProfile || (currentProfile.role!=="admin" && currentProfile.approval_status!=="approved"))return;
 const id=$("personId").value;const existing=id?peopleRecords.find(x=>String(x.id)===String(id)):null;if(id&&!existing){alert("수정할 정보를 찾을 수 없습니다.");return}if(existing&&currentProfile.role!=="admin"&&String(existing.created_by)!==String(currentUser?.id)){alert("본인이 등록한 정보만 수정할 수 있습니다.");return}const payload={event_type:$("personType").value,name:$("personName").value.trim(),shift_type:$("personShift").value,event_date:$("personDate").value,region:$("personRegion").value===CUSTOM_REGION_VALUE?$("personRegionCustom").value.trim():$("personRegion").value,router_code:$("personRouter").value.trim()||null,phone:$("personPhone").value.trim()||null,status:$("personStatus").value,memo:$("personMemo").value.trim()||null,manager:$("personManager").value.trim()};
 if(id){const {error}=await db.from("personnel_events").update(payload).eq("id",id);if(error){alert("수정 실패: "+error.message);return}await writeAudit("update","personnel_event",id,payload)}else{payload.created_by=currentUser.id;const {data,error}=await db.from("personnel_events").insert(payload).select("id").single();if(error){alert("등록 실패: "+error.message);return}await writeAudit("create","personnel_event",data?.id,payload)}
 $("personModal").classList.add("hidden");await loadPeople();
}
async function deletePerson(id){const r=peopleRecords.find(x=>String(x.id)===String(id));if(!r)return;if(currentProfile?.role!=="admin"&&String(r.created_by)!==String(currentUser?.id)){alert("본인이 등록한 정보만 삭제할 수 있습니다.");return}if(!confirm("이 정보를 삭제할까요?"))return;const {error}=await db.from("personnel_events").delete().eq("id",id);if(error){alert("삭제 실패: "+error.message);return}await writeAudit("delete","personnel_event",id,{name:r.name,event_type:r.event_type});await loadPeople()}

function updateOpsDashboard(){
  const today=dateString(new Date());
  const endDate=new Date();endDate.setDate(endDate.getDate()+7);const end=dateString(endDate);
  const fmtDate=new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"short"});
  const set=(id,value)=>{const el=$(id);if(el)el.textContent=value};
  set("opsTodayDate",fmtDate);
  const memberCard=$("opsPendingMembers")?.closest(".ops-stat-card");if(memberCard)memberCard.classList.toggle("hidden",currentProfile?.role!=="admin");
  const activePeople=peopleRecords.filter(r=>r.status!=="취소");
  const todaySchedules=allSchedules.filter(s=>s.schedule_date===today).length+activePeople.filter(r=>r.event_date===today).length;
  const weekSchedules=allSchedules.filter(s=>s.schedule_date>=today&&s.schedule_date<=end).length+activePeople.filter(r=>r.event_date>=today&&r.event_date<=end).length;
  const inProgress=activePeople.filter(r=>r.status==="진행중").length;
  const pendingMembers=currentProfile?.role==="admin"?memberRecords.filter(m=>m.approval_status!=="approved"&&m.role!=="admin").length:0;
  set("opsTodaySchedules",todaySchedules);set("opsInProgress",inProgress);set("opsWeekSchedules",weekSchedules);set("opsPendingMembers",currentProfile?.role==="admin"?pendingMembers:"—");
  const cats=[{name:"CPF 지원",count:allSchedules.filter(s=>s.category==="CPF 지원").length,cls:"cpf"},{name:"차량사고",count:allSchedules.filter(s=>s.category==="차량사고").length,cls:"accident"},{name:"이슈",count:allSchedules.filter(s=>s.category==="이슈").length,cls:"issue"}];
  const max=Math.max(1,...cats.map(c=>c.count));
  if($("opsCategoryBars"))$("opsCategoryBars").innerHTML=cats.map(c=>`<div class="ops-bar-row"><div><span>${c.name}</span><strong>${c.count}건</strong></div><div class="ops-bar-track"><i class="${c.cls}" style="width:${Math.round(c.count/max*100)}%"></i></div></div>`).join("");
  const alerts=[];
  const soon=activePeople.filter(r=>r.event_date>=today&&r.event_date<=end&&r.status!=="완료");
  if(soon.length)alerts.push({icon:"◷",title:`7일 이내 입차·퇴사 ${soon.length}건`,desc:"예정일과 담당자를 확인하세요.",action:"people"});
  const overdue=activePeople.filter(r=>r.event_date<today&&r.status!=="완료");
  if(overdue.length)alerts.push({icon:"!",title:`예정일이 지난 미완료 항목 ${overdue.length}건`,desc:"진행 상태를 업데이트해 주세요.",action:"people"});
  if(currentProfile?.role==="admin"&&pendingMembers)alerts.push({icon:"♙",title:`회원 승인 대기 ${pendingMembers}명`,desc:"회원 관리에서 가입 요청을 확인하세요.",action:"members"});
  const noManager=activePeople.filter(r=>!String(r.manager||"").trim()&&r.status!=="완료");
  if(noManager.length)alerts.push({icon:"＋",title:`담당자 미지정 ${noManager.length}건`,desc:"담당자를 지정하면 운영 누락을 줄일 수 있습니다.",action:"people"});
  if($("opsAlerts"))$("opsAlerts").innerHTML=alerts.length?alerts.slice(0,4).map(a=>`<button type="button" class="ops-alert-item" data-ops-action="${a.action}"><span class="ops-alert-icon">${a.icon}</span><span><strong>${a.title}</strong><small>${a.desc}</small></span><b>›</b></button>`).join(""):'<div class="ops-empty success">확인이 필요한 항목이 없습니다. 현재 등록된 운영 정보를 기준으로 표시합니다.</div>';
  const todayRows=[
    ...allSchedules.filter(s=>s.schedule_date===today).map(s=>({kind:"schedule",title:s.title||"제목 없는 일정",sub:s.category||"일반 일정",action:"calendar"})),
    ...activePeople.filter(r=>r.event_date===today).map(r=>({kind:"person",title:r.name||"이름 미입력",sub:r.event_type==="퇴사"?"퇴사":"신규입차",action:"people"}))
  ];
  if($("opsTodayItems"))$("opsTodayItems").innerHTML=todayRows.length?todayRows.map(r=>`<button type="button" class="ops-today-row" data-ops-action="${r.action}"><span class="ops-today-kind ${r.kind}">${r.kind==="person"?"입차·퇴사":"일정"}</span><span class="ops-today-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.sub)}</small></span><b>›</b></button>`).join(""):'<div class="ops-empty">오늘 등록된 일정이나 입차·퇴사 정보가 없습니다.</div>';

  const recent=[...allSchedules.map(s=>({...s,_kind:"schedule",_date:s.schedule_date,_title:s.title,_sub:s.category})),...activePeople.map(r=>({...r,_kind:"person",_date:r.event_date,_title:r.name,_sub:r.event_type}))].sort((a,b)=>String(b._date).localeCompare(String(a._date))).slice(0,5);
  if($("opsRecentSchedules"))$("opsRecentSchedules").innerHTML=recent.length?recent.map(r=>`<div class="ops-recent-row"><span class="ops-recent-dot ${r._kind==="person"?(r.event_type==="퇴사"?"exit":"hire"):categoryClass(r.category)}"></span><span class="ops-recent-main"><strong>${escapeHtml(r._title||"")}</strong><small>${escapeHtml(r._sub||"")}</small></span><time>${escapeHtml(r._date||"")}</time></div>`).join(""):'<div class="ops-empty">아직 등록된 일정이 없습니다.</div>';
  const upcoming=activePeople.filter(r=>r.event_date>=today).sort((a,b)=>a.event_date.localeCompare(b.event_date)).slice(0,5);
  if($("opsPeopleUpcoming"))$("opsPeopleUpcoming").innerHTML=upcoming.length?upcoming.map(r=>`<div class="ops-upcoming-row"><span class="ops-person-badge ${r.event_type==="퇴사"?"exit":"hire"}">${r.event_type==="퇴사"?"퇴사":"입차"}</span><span class="ops-upcoming-main"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.region||"지역 미입력")} · ${escapeHtml(r.manager||"담당자 미지정")}</small></span><time>${escapeHtml(r.event_date)}</time></div>`).join(""):'<div class="ops-empty">예정된 입차·퇴사 항목이 없습니다.</div>';
}

let scheduleCommentsLoadPromise=null;
async function loadScheduleComments(){
  // 동시에 여러 화면 갱신이 호출되어도 댓글을 한 번만 읽고,
  // 각 응답을 전역 배열에 누적하지 않고 완성된 목록으로 한 번에 교체합니다.
  if(scheduleCommentsLoadPromise) return scheduleCommentsLoadPromise;
  scheduleCommentsLoadPromise=(async()=>{
    scheduleCommentsReady=false;
    const ids=[...new Set(allSchedules.map(s=>s.id).filter(id=>id!==null&&id!==undefined).map(String))];
    if(!ids.length){scheduleComments={};scheduleCommentsReady=true;return}
    const {data,error}=await db.from("schedule_comments")
      .select("id,schedule_id,parent_comment_id,comment,author_id,author_username,created_at,updated_at")
      .in("schedule_id",ids).order("created_at",{ascending:true});
    if(error){console.warn("일정 댓글을 불러오지 못했습니다. schedule_comments_setup.sql 실행 여부를 확인하세요.",error.message);return}
    const nextComments={};
    const seenIds=new Set();
    (data||[]).forEach(row=>{
      const rowId=String(row.id);
      if(seenIds.has(rowId)) return;
      seenIds.add(rowId);
      const key=String(row.schedule_id);
      (nextComments[key] ||= []).push(row);
    });
    scheduleComments=nextComments;
    scheduleCommentsReady=true;
  })();
  try{return await scheduleCommentsLoadPromise}
  finally{scheduleCommentsLoadPromise=null}
}

const scheduleCommentSubmitLocks=new Set();


async function submitScheduleComment(scheduleId, form){
  const lockKey=`root:${scheduleId}`;
  if(scheduleCommentSubmitLocks.has(lockKey))return;
  if(currentProfile?.role!=="admin"){alert("관리자만 새 일정 댓글을 작성할 수 있습니다.");return}
  const input=form.querySelector("[name='comment']");
  const comment=String(input?.value||"").trim();
  if(!comment){alert("댓글 내용을 입력해주세요.");input?.focus();return}
  const button=form.querySelector("button[type='submit']");
  if(button){button.disabled=true;button.textContent="등록 중..."}
  const {data,error}=await db.from("schedule_comments").insert({
    schedule_id:scheduleId,parent_comment_id:null,comment,author_id:currentUser.id,
    author_username:currentProfile.username||currentProfile.display_name||"관리자"
  }).select("id").single();
  if(error){alert("댓글 등록 실패: "+error.message+"\\nSQL 설정 파일을 실행했는지 확인해주세요.");if(button){button.disabled=false;button.textContent="댓글 등록"}return}
  await loadScheduleComments();await loadCommentNotifications();renderScheduleList();
}
async function submitScheduleCommentReply(parentId, form){
  const lockKey=`reply:${parentId}`;
  if(scheduleCommentSubmitLocks.has(lockKey))return;
  const input=form.querySelector("[name='reply']");
  const comment=String(input?.value||"").trim();
  if(!comment){alert("답글 내용을 입력해주세요.");input?.focus();return}
  const parent=Object.values(scheduleComments).flat().find(c=>String(c.id)===String(parentId));
  if(!parent){alert("원본 댓글을 찾을 수 없습니다.");return}
  const button=form.querySelector("button[type='submit']");
  scheduleCommentSubmitLocks.add(lockKey);
  if(button){button.disabled=true;button.textContent="등록 중..."}
  const {error}=await db.from("schedule_comments").insert({
    schedule_id:parent.schedule_id,parent_comment_id:parent.id,comment,
    author_id:currentUser.id,
    author_username:currentProfile.username||currentProfile.display_name||(currentProfile.role==="admin"?"관리자":"사용자")
  });
  if(error){scheduleCommentSubmitLocks.delete(lockKey);alert("답글 등록 실패: "+error.message);if(button){button.disabled=false;button.textContent="답글 등록"}return}
  await loadScheduleComments();await loadCommentNotifications();renderScheduleList();
  scheduleCommentSubmitLocks.delete(lockKey);
}
let editingScheduleCommentId=null;
function canManageScheduleComment(row){
  return currentProfile?.role==="admin" || String(row.author_id)===String(currentUser?.id);
}
function editScheduleComment(commentId){
  const row=Object.values(scheduleComments).flat().find(c=>String(c.id)===String(commentId));
  if(!row || !canManageScheduleComment(row))return;
  editingScheduleCommentId=String(commentId);
  renderScheduleList();
  const editor=document.querySelector(`[data-comment-edit-form="${commentId}"] textarea`);
  editor?.focus();
  editor?.setSelectionRange(editor.value.length,editor.value.length);
}
function cancelEditScheduleComment(){editingScheduleCommentId=null;renderScheduleList()}
async function saveScheduleCommentEdit(commentId,form){
  const row=Object.values(scheduleComments).flat().find(c=>String(c.id)===String(commentId));
  if(!row || !canManageScheduleComment(row))return;
  const input=form.querySelector("[name='edited_comment']"),comment=String(input?.value||"").trim();
  if(!comment){input?.focus();return}
  const button=form.querySelector("button[type='submit']");if(button){button.disabled=true;button.textContent="저장 중..."}
  const {error}=await db.from("schedule_comments").update({comment,updated_at:new Date().toISOString()}).eq("id",commentId);
  if(error){alert("댓글 수정 실패: "+error.message);if(button){button.disabled=false;button.textContent="저장"}return}
  editingScheduleCommentId=null;await loadScheduleComments();renderScheduleList();
}
async function deleteScheduleComment(commentId){
  const row=Object.values(scheduleComments).flat().find(c=>String(c.id)===String(commentId));
  if(!row || !canManageScheduleComment(row))return;
  const isRoot=!row.parent_comment_id;
  if(!confirm(isRoot?"이 댓글과 연결된 답글을 모두 삭제할까요?":"이 답글을 삭제할까요?"))return;
  const {error}=await db.from("schedule_comments").delete().eq("id",commentId);
  if(error){alert("댓글 삭제 실패: "+error.message);return}
  if(String(editingScheduleCommentId)===String(commentId))editingScheduleCommentId=null;
  await loadScheduleComments();renderScheduleList();
}
let scheduleCommentNotifications=[];
async function loadCommentNotifications(){
  if(!currentUser?.id)return;
  const {data,error}=await db.from("schedule_comment_notifications")
    .select("id,schedule_id,comment_id,notification_type,message,is_read,created_at")
    .eq("recipient_id",currentUser.id).order("created_at",{ascending:false}).limit(60);
  if(error){console.warn("댓글 알림 불러오기 실패:",error.message);return}
  scheduleCommentNotifications=data||[];renderCommentNotificationBell();
}
function renderCommentNotificationBell(){
  const count=$("commentNotificationCount");if(!count)return;
  const unread=scheduleCommentNotifications.filter(n=>!n.is_read).length;
  count.textContent=unread>99?"99+":String(unread);count.classList.toggle("hidden",unread===0);
}
function renderCommentNotificationList(){
  const list=$("commentNotificationList");if(!list)return;
  if(!scheduleCommentNotifications.length){list.innerHTML='<div class="comment-notification-empty">새 댓글 알림이 없습니다.</div>';return}
  list.innerHTML=scheduleCommentNotifications.map(n=>`<button type="button" class="comment-notification-item ${n.is_read?"read":"unread"}" data-comment-notification-id="${n.id}" data-comment-schedule-id="${n.schedule_id}"><span class="comment-notification-dot"></span><span class="comment-notification-copy"><strong>${n.notification_type==="comment_reply"?"새 답글":"새 댓글"}</strong><span>${escapeHtml(n.message||"일정에 새 댓글이 등록되었습니다.")}</span><time>${escapeHtml(new Date(n.created_at).toLocaleString("ko-KR",{dateStyle:"medium",timeStyle:"short"}))}</time></span></button>`).join("");
}
function toggleCommentNotifications(){
  const panel=$("commentNotificationPanel");if(!panel)return;
  const willOpen=panel.classList.contains("hidden");
  if(willOpen){renderCommentNotificationList();panel.classList.remove("hidden");panel.setAttribute("aria-hidden","false");}
  else closeCommentNotifications();
}
function closeCommentNotifications(){
  const panel=$("commentNotificationPanel");
  if(panel){panel.classList.add("hidden");panel.setAttribute("aria-hidden","true");}
}
async function openCommentNotification(notificationId,scheduleId){
  const {error}=await db.from("schedule_comment_notifications").update({is_read:true,read_at:new Date().toISOString()}).eq("id",notificationId).eq("recipient_id",currentUser.id);
  if(error)console.warn("알림 읽음 처리 실패:",error.message);
  const n=scheduleCommentNotifications.find(x=>String(x.id)===String(notificationId));if(n)n.is_read=true;
  renderCommentNotificationBell();closeCommentNotifications();
  const schedule=allSchedules.find(s=>String(s.id)===String(scheduleId));
  if(!schedule){alert("해당 일정이 삭제되었거나 접근 권한이 없습니다.");return}
  selectedDate=new Date(schedule.schedule_date+"T12:00:00");currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
  activeCategory="all";document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
  document.querySelector('.filter[data-category="all"]')?.classList.add("active");
  setWorkspaceView("calendar");renderCalendar();renderScheduleList();updateOverview();
}

async function loadSchedules(){
  const {data,error}=await db.from("schedules").select(`*, schedule_images(id,file_name,file_path,created_at)`).order("schedule_date",{ascending:true}).order("start_time",{ascending:true,nullsFirst:true});
  if(error){console.error(error);alert("일정을 불러오지 못했습니다.\n"+error.message);return}
  allSchedules=data||[];
  await loadScheduleComments();
  updateSummary();
  renderCalendar();renderScheduleList();updateOverview();updateOpsDashboard();
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
    day.onclick=()=>{selectedDate=new Date(`${v}T12:00:00`);currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);activeCategory="all";document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));document.querySelector('[data-category="all"]').classList.add("active");renderCalendar();renderScheduleList();updateOverview()};
    cal.appendChild(day);
  }
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}


function renderScheduleComments(scheduleId){
  const rows=scheduleComments[String(scheduleId)]||[];
  const roots=rows.filter(row=>!row.parent_comment_id);
  const editMarkup=row=>`<form class="schedule-comment-edit-form" data-comment-edit-form="${row.id}"><textarea name="edited_comment" maxlength="2000" rows="3">${escapeHtml(row.comment)}</textarea><div class="comment-edit-actions"><button type="submit">저장</button><button type="button" class="comment-cancel-edit" data-cancel-comment-edit>취소</button></div></form>`;
  const replyMarkup=reply=>{
    const editing=String(editingScheduleCommentId)===String(reply.id);
    const actions=canManageScheduleComment(reply)?`<div class="comment-admin-actions"><button type="button" onclick="editScheduleComment(${reply.id})">수정</button><button type="button" onclick="deleteScheduleComment(${reply.id})">삭제</button></div>`:"";
    return `<div class="schedule-comment schedule-comment-reply"><div class="schedule-comment-meta"><span class="comment-author-line"><span class="comment-avatar">${escapeHtml((reply.author_username||"사").slice(0,1).toUpperCase())}</span><strong>${escapeHtml(reply.author_username||"사용자")}</strong><em>답글</em></span><time>${escapeHtml(new Date(reply.created_at).toLocaleString("ko-KR",{dateStyle:"medium",timeStyle:"short"}))}${reply.updated_at?" · 수정됨":""}</time></div>${editing?editMarkup(reply):`<p>${escapeHtml(reply.comment)}</p>${actions}`}</div>`;
  };
  const commentsHtml=roots.length?roots.map(row=>{
    const replies=rows.filter(reply=>String(reply.parent_comment_id)===String(row.id));
    const editing=String(editingScheduleCommentId)===String(row.id);
    const actions=canManageScheduleComment(row)?`<div class="comment-admin-actions"><button type="button" onclick="editScheduleComment(${row.id})">수정</button><button type="button" onclick="deleteScheduleComment(${row.id})">삭제</button></div>`:"";
    const replyForm=`<form class="schedule-comment-reply-form" data-comment-reply-form="${row.id}"><textarea name="reply" maxlength="2000" rows="2" placeholder="이 댓글에 답글 남기기..."></textarea><button type="submit"><span>↩</span> 답글 등록</button></form>`;
    return `<div class="schedule-comment-thread"><div class="schedule-comment schedule-comment-root"><div class="schedule-comment-meta"><span class="comment-author-line"><span class="comment-avatar main">${escapeHtml((row.author_username||"관").slice(0,1).toUpperCase())}</span><strong>${escapeHtml(row.author_username||"관리자")}</strong><em>원댓글</em></span><time>${escapeHtml(new Date(row.created_at).toLocaleString("ko-KR",{dateStyle:"medium",timeStyle:"short"}))}${row.updated_at?" · 수정됨":""}</time></div>${editing?editMarkup(row):`<p>${escapeHtml(row.comment)}</p>${actions}`}</div><div class="schedule-comment-replies">${replies.map(replyMarkup).join("")}</div>${replyForm}</div>`;
  }).join(""):'<div class="schedule-comments-empty">아직 등록된 댓글이 없습니다.</div>';
  const adminForm=currentProfile?.role==="admin"?`<form class="schedule-comment-form" data-comment-form="${escapeHtml(scheduleId)}"><textarea name="comment" maxlength="2000" rows="2" placeholder="이 일정에 대한 관리자 댓글을 입력하세요."></textarea><button type="submit">댓글 등록</button></form>`:"";
  const setupWarning=!scheduleCommentsReady&&currentProfile?.role==="admin"?'<div class="schedule-comments-warning">댓글 기능을 사용하려면 SQL 설정 파일을 먼저 실행해주세요.</div>':"";
  return `<section class="schedule-comments"><div class="schedule-comments-heading"><div><span class="comments-heading-kicker">DISCUSSION</span><strong>댓글 및 답글</strong></div><span class="comments-count">${rows.length}개</span></div>${setupWarning}${commentsHtml}${adminForm}</section>`;
}

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
    return `<article class="schedule-item"><div class="schedule-row"><div><h3 class="schedule-title">${escapeHtml(s.title)}</h3><div class="schedule-meta"><span class="badge">${escapeHtml(s.category)}</span>${escapeHtml(time)}</div><div class="schedule-author">작성자 · ${escapeHtml(author)}</div></div>${canManage?`<div class="schedule-actions"><button class="small-btn" onclick="editSchedule(${s.id})">수정</button><button class="small-btn" onclick="deleteSchedule(${s.id})">삭제</button></div>`:""}</div>${s.description?`<div class="schedule-description">${escapeHtml(s.description)}</div>`:""}${imgs?`<div class="images">${imgs}</div>`:""}${renderScheduleComments(s.id)}</article>`;
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
    await writeAudit("update","schedule",editingId,{title:payload.title,category:payload.category,schedule_date:payload.schedule_date});
  }else{
    const {data,error}=await db.from("schedules").insert({...payload,...authorPayload}).select().single();
    if(error){alert("등록 실패: "+error.message);return}
    scheduleId=data.id;
    await writeAudit("create","schedule",scheduleId,{title:payload.title,category:payload.category,schedule_date:payload.schedule_date});
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
  const {error}=await db.from("schedules").delete().eq("id",id);if(error){alert("삭제 실패: "+error.message);return}await writeAudit("delete","schedule",id,{title:s.title,category:s.category});await loadSchedules();
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
  await loadCommentNotifications();
  if(currentProfile.role==="admin"){await loadMembers();}
  if(currentProfile.role==="admin" || currentProfile.approval_status==="approved"){await loadPeople();}
  updateOpsDashboard();setWorkspaceView("overview");
}

$("loginForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();try{await signIn($("loginUsername").value,$("loginPassword").value);await startApp()}catch(err){showAuthMessage("로그인 실패: "+err.message,"error")}};
$("signupForm").onsubmit=async e=>{e.preventDefault();clearAuthMessage();const username=normalizeUsername($("signupUsername").value);const name=$("signupName").value.trim();const password=$("signupPassword").value;const confirm=$("signupPasswordConfirm").value;if(password!==confirm){showAuthMessage("비밀번호가 일치하지 않습니다.","error");return}if(!/^[a-z0-9._-]{3,30}$/.test(username)){showAuthMessage("아이디는 영문 소문자, 숫자, ., _, -만 사용해 3~30자로 입력해주세요.","error");return}if(!name){showAuthMessage("이름을 입력해주세요.","error");return}try{await signUp(username,name,password);showAuthMessage("회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.","success");$("signupForm").reset();$("loginUsername").value=username}catch(err){showAuthMessage("회원가입 실패: "+(err.message||err),"error")}};
if($("logoutBtn")) $("logoutBtn").onclick=signOut;
$("refreshMembersBtn").onclick=loadMembers;
if($("exportPeopleBtn"))$("exportPeopleBtn").onclick=exportPeopleCSV;
if($("exportMembersBtn"))$("exportMembersBtn").onclick=exportMembersCSV;
if($("exportSchedulesBtn"))$("exportSchedulesBtn").onclick=exportSchedulesCSV;
if($("refreshAuditBtn"))$("refreshAuditBtn").onclick=loadAuditLogs;
if($("notificationBtn"))$("notificationBtn").onclick=openNotifications;
if($("commentNotificationBtn"))$("commentNotificationBtn").onclick=toggleCommentNotifications;
if($("closeCommentNotifications"))$("closeCommentNotifications").onclick=closeCommentNotifications;
if($("commentNotificationList"))$("commentNotificationList").onclick=e=>{
  const item=e.target.closest("[data-comment-notification-id]");
  if(item)openCommentNotification(item.dataset.commentNotificationId,item.dataset.commentScheduleId);
};
document.addEventListener("click",e=>{
  const panel=$("commentNotificationPanel");
  if(panel&&!panel.classList.contains("hidden")&&!e.target.closest("#commentNotificationPanel")&&!e.target.closest("#commentNotificationBtn"))closeCommentNotifications();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeCommentNotifications()});
if($("closeNotifications"))$("closeNotifications").onclick=()=>$("notificationPanel").classList.add("hidden");
if($("notificationList"))$("notificationList").onclick=e=>{const b=e.target.closest("[data-schedule-date]");if(!b)return;selectedDate=new Date(b.dataset.scheduleDate+"T12:00:00");currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);$("notificationPanel").classList.add("hidden");setWorkspaceView("calendar");renderCalendar();renderScheduleList();updateOverview()};
fillRegionSelect($("personRegion"));fillRegionSelect($("peopleRegionFilter"),true);
$("addPersonBtn").onclick=()=>openPersonModal();$("closePersonModal").onclick=()=>$("personModal").classList.add("hidden");$("cancelPersonBtn").onclick=()=>$("personModal").classList.add("hidden");
$("personModal").querySelectorAll("[data-close-person]").forEach(el=>el.onclick=()=>$("personModal").classList.add("hidden"));$("personForm").onsubmit=savePerson;$("personType").onchange=updatePersonDateLabel;$("personRegion").onchange=toggleCustomRegion;
["peopleTypeFilter","peopleRegionFilter","peopleShiftFilter"].forEach(id=>$(id).onchange=()=>{peoplePage=1;renderPeople()});if($("peopleSearch"))$("peopleSearch").oninput=()=>{peoplePage=1;renderPeople()};
$("resetPeopleFilters").onclick=()=>{peoplePage=1;$("peopleSearch").value="";$("peopleTypeFilter").value="all";$("peopleRegionFilter").value="all";$("peopleShiftFilter").value="all";renderPeople()};
$("applyPeopleFilters").onclick=()=>{peoplePage=1;renderPeople()};
db.auth.onAuthStateChange((_event,session)=>{if(session){currentUser=session.user;startApp()}else{currentUser=null;currentProfile=null;$("authScreen").classList.remove("hidden");$("appScreen").classList.add("hidden")}});

$("prevMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()-1,1);renderCalendar()};
$("nextMonth").onclick=()=>{currentDate=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,1);renderCalendar()};
$("todayBtn").onclick=()=>{selectedDate=new Date();currentDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);renderCalendar();renderScheduleList();updateOverview()};
$("addScheduleBtn").onclick=()=>openModal();
$("sidebarAddBtn").onclick=()=>openModal();
$("sidebarTodayBtn").onclick=()=>{$("todayBtn").click()};
$("sideTodayBtn").onclick=()=>{$("todayBtn").click()};
function setWorkspaceView(view){
  const app=$("appScreen");
  app.classList.toggle("member-view",view==="members");app.classList.toggle("people-view",view==="people");app.classList.toggle("audit-view",view==="audit");app.classList.toggle("overview-view",view==="overview");
  document.querySelectorAll(".nav-menu .nav-item").forEach(btn=>btn.classList.remove("active"));
  const active=view==="overview"?$("sidebarDashboardBtn"):view==="members"?$("sidebarMemberBtn"):view==="people"?$("sidebarPeopleBtn"):view==="audit"?$("sidebarAuditBtn") :$("sidebarCalendarBtn");
  if(active)active.classList.add("active");
  if(view==="overview"){["memberAdminCard","peopleAdminCard","auditAdminCard"].forEach(id=>$(id).classList.add("hidden"));updateOpsDashboard();}
  else if(view==="members"){
    if(currentProfile?.role!=="admin"){alert("회원 관리는 관리자만 이용할 수 있습니다.");setWorkspaceView("calendar");return;}
    $("memberAdminCard").classList.remove("hidden");$("peopleAdminCard").classList.add("hidden");$("auditAdminCard").classList.add("hidden");loadMembers();
  } else if(view==="audit"){if(currentProfile?.role!=="admin"){alert("변경 이력은 관리자만 볼 수 있습니다.");setWorkspaceView("calendar");return;}$("memberAdminCard").classList.add("hidden");$("peopleAdminCard").classList.add("hidden");$("auditAdminCard").classList.remove("hidden");loadAuditLogs();
  } else if(view==="people"){
    if(!currentProfile || (currentProfile.role!=="admin" && currentProfile.approval_status!=="approved")){alert("승인된 회원만 이용할 수 있습니다.");setWorkspaceView("calendar");return;}
    $("memberAdminCard").classList.add("hidden");$("peopleAdminCard").classList.remove("hidden");$("auditAdminCard").classList.add("hidden");loadPeople();
  } else {$("memberAdminCard").classList.add("hidden");$("peopleAdminCard").classList.add("hidden");$("auditAdminCard").classList.add("hidden");}
}

$("sidebarDashboardBtn").onclick=()=>setWorkspaceView("overview");
// 대시보드 알림은 데이터 조회 후 동적으로 생성되므로 이벤트 위임 방식으로 처리
document.addEventListener("click",event=>{
  const actionElement=event.target.closest("[data-ops-action]");
  if(!actionElement)return;
  const action=actionElement.dataset.opsAction;
  if(!["overview","calendar","people","members","audit"].includes(action))return;
  event.preventDefault();
  setWorkspaceView(action);
});
$("sidebarMemberBtn").onclick=()=>setWorkspaceView("members");
$("sidebarAuditBtn").onclick=()=>setWorkspaceView("audit");
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

document.addEventListener("submit",event=>{
  const form=event.target.closest("[data-comment-form]");
  if(form){event.preventDefault();submitScheduleComment(form.dataset.commentForm,form);return}
  const reply=event.target.closest("[data-comment-reply-form]");
  if(reply){event.preventDefault();submitScheduleCommentReply(reply.dataset.commentReplyForm,reply);return}
  const edit=event.target.closest("[data-comment-edit-form]");
  if(edit){event.preventDefault();saveScheduleCommentEdit(edit.dataset.commentEditForm,edit)}
});
document.addEventListener("click",event=>{
  if(event.target.closest("[data-cancel-comment-edit]")){editingScheduleCommentId=null;renderScheduleList()}
});

(async()=>{if(SUPABASE_URL.includes("여기에_")||SUPABASE_PUBLISHABLE_KEY.includes("여기에_")){showAuthMessage("app.js에 Supabase URL과 Publishable key를 입력하세요.","error");return}await startApp();setInterval(()=>{if(currentUser?.id&&!document.hidden)loadCommentNotifications()},20000)})();
