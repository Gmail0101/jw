const calendar = document.getElementById("calendar");
const monthTitle = document.getElementById("monthTitle");
const modal = document.getElementById("modal");
const form = document.getElementById("scheduleForm");
const dateInput = document.getElementById("dateInput");
const categoryInput = document.getElementById("categoryInput");
const titleInput = document.getElementById("titleInput");
const timeInput = document.getElementById("timeInput");
const memoInput = document.getElementById("memoInput");
const imageInput = document.getElementById("imageInput");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreviewGrid = document.getElementById("imagePreviewGrid");
const removeImageBtn = document.getElementById("removeImageBtn");
const modalTitle = document.getElementById("modalTitle");
const deleteBtn = document.getElementById("deleteBtn");
const scheduleSummary = document.getElementById("scheduleSummary");
const filterDescription = document.getElementById("filterDescription");
const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = document.getElementById("imageViewerImg");
const imageViewerCounter = document.getElementById("imageViewerCounter");
const categoryFilter = document.getElementById("categoryFilter");

let currentDate = new Date();
let editingId = null;
let currentImages = [];
let activeFilter = "all";
let viewerImages = [];
let viewerIndex = 0;
const STORAGE_KEY = "toss_style_scheduler_events_v5";
const OLD_KEYS = ["toss_style_scheduler_events_v4", "toss_style_scheduler_events_v3"];
const CATEGORIES = ["CPF 지원", "차량사고", "이슈"];

function normalizeEvent(e) {
  let images = Array.isArray(e.images) ? e.images.filter(Boolean) : [];
  if (!images.length && e.image) images = [e.image];
  return { ...e, category: CATEGORIES.includes(e.category) ? e.category : "이슈", images };
}
function loadEvents() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of OLD_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }
    return (JSON.parse(raw) || []).map(normalizeEvent);
  } catch { return []; }
}
function saveEvents(events) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events.map(normalizeEvent))); }
  catch (e) { alert("저장 공간이 부족합니다. 이미지 개수나 크기를 줄이거나 기존 일정을 삭제해주세요."); throw e; }
}
function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatDate(date) { const [y,m,d] = date.split("-"); return `${y}.${m}.${d}`; }
function categoryClass(category) { if (category === "CPF 지원") return "cpf"; if (category === "차량사고") return "accident"; return "issue"; }
function categoryLabel(category) { return category || "이슈"; }
function getImages(event) { return Array.isArray(event.images) ? event.images : (event.image ? [event.image] : []); }

function resetImagePreview() {
  currentImages = [];
  imageInput.value = "";
  imagePreviewGrid.innerHTML = "";
  imagePreviewWrap.classList.add("hidden");
}
function showImagePreviews(images) {
  currentImages = Array.isArray(images) ? images.filter(Boolean) : [];
  imagePreviewGrid.innerHTML = "";
  if (!currentImages.length) { imagePreviewWrap.classList.add("hidden"); return; }
  currentImages.forEach((src, index) => {
    const box = document.createElement("div"); box.className = "preview-item";
    const img = document.createElement("img"); img.src = src; img.alt = `이미지 ${index+1}`;
    const badge = document.createElement("span"); badge.textContent = index + 1; badge.className = "preview-number";
    box.append(img, badge); imagePreviewGrid.appendChild(box);
  });
  imagePreviewWrap.classList.remove("hidden");
}
function compressImage(file, maxSize = 1400, quality = .82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("이미지 파일이 아닙니다."));
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (Math.max(w, h) > maxSize) { const s = maxSize / Math.max(w, h); w = Math.round(w*s); h = Math.round(h*s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다.")); img.src = r.result;
    };
    r.onerror = () => reject(new Error("파일을 읽을 수 없습니다.")); r.readAsDataURL(file);
  });
}

function renderCalendar() {
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  monthTitle.textContent = `${year}년 ${month+1}월`;
  calendar.innerHTML = "";
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month+1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDay + lastDate) / 7) * 7;
  const events = loadEvents();

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div"); cell.className = "day";
    let cellDate, dayNumber;
    if (i < firstDay) { dayNumber = prevLastDate-firstDay+i+1; cellDate = new Date(year, month-1, dayNumber); cell.classList.add("other-month"); }
    else if (i >= firstDay+lastDate) { dayNumber = i-firstDay-lastDate+1; cellDate = new Date(year, month+1, dayNumber); cell.classList.add("other-month"); }
    else { dayNumber = i-firstDay+1; cellDate = new Date(year, month, dayNumber); }
    const key = dateKey(cellDate);
    if (key === dateKey(new Date())) cell.classList.add("today");
    const number = document.createElement("div"); number.className = "day-number"; number.textContent = dayNumber; cell.appendChild(number);
    const list = document.createElement("div"); list.className = "event-list";
    events.filter(e => e.date === key).sort((a,b) => (a.time||"99:99").localeCompare(b.time||"99:99")).forEach(event => {
      const item = document.createElement("div"); item.className = `event ${categoryClass(event.category)}`; item.title = event.memo || event.title;
      const category = document.createElement("span"); category.className = "event-category"; category.textContent = categoryLabel(event.category); item.appendChild(category);
      if (event.time) { const t = document.createElement("span"); t.className = "event-time"; t.textContent = event.time; item.appendChild(t); }
      const images = getImages(event); if (images.length) { const m = document.createElement("span"); m.className = "image-mark"; m.textContent = images.length > 1 ? `📷${images.length}` : "📷"; item.appendChild(m); }
      item.appendChild(document.createTextNode(event.title));
      item.addEventListener("click", e => { e.stopPropagation(); openEdit(event.id); }); list.appendChild(item);
    });
    cell.appendChild(list); cell.addEventListener("click", () => openAdd(key)); calendar.appendChild(cell);
  }
  renderScheduleSummary(events);
}

function renderScheduleSummary(events) {
  const datePicker = document.getElementById("scheduleDatePicker");
  const selectedDate = datePicker && datePicker.value ? datePicker.value : dateKey(new Date());

  if (datePicker && !datePicker.value) {
    datePicker.value = selectedDate;
  }

  scheduleSummary.innerHTML = "";

  // 핵심: 등록된 일정은 항상 선택한 날짜 하루만 표시합니다.
  let dateEvents = events.filter(e => e.date === selectedDate);
  const filtered = activeFilter === "all"
    ? dateEvents
    : dateEvents.filter(e => categoryLabel(e.category) === activeFilter);

  const prettyDate = formatDate(selectedDate);
  filterDescription.textContent =
    activeFilter === "all"
      ? `${prettyDate} · 전체 일정 ${filtered.length}건`
      : `${prettyDate} · ${activeFilter} 일정 ${filtered.length}건`;

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-summary";
    empty.innerHTML = `${prettyDate}에 등록된 일정이 없습니다. <strong>＋ 일정 추가</strong> 버튼으로 일정을 등록해보세요.`;
    scheduleSummary.appendChild(empty);
    return;
  }

  const groups = activeFilter === "all" ? CATEGORIES : [activeFilter];

  groups.forEach(group => {
    const className = categoryClass(group);
    const groupEvents = filtered
      .filter(e => categoryLabel(e.category) === group)
      .sort((a,b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    if (!groupEvents.length) return;

    const groupBox = document.createElement("div");
    groupBox.className = `summary-group ${className}`;
    groupBox.innerHTML =
      `<div class="summary-group-head"><span class="category-chip ${className}">${group}</span><span class="summary-count">${groupEvents.length}건</span></div>`;

    groupEvents.forEach(event => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "summary-item";

      const images = getImages(event);

      // 날짜는 이미 상단에서 선택했으므로 여기서는 시간만 표시
      row.innerHTML =
        `<div class="summary-date">${event.time ? event.time : "시간 미지정"}</div>` +
        `<div class="summary-main"><strong></strong><p></p></div>` +
        `${images.length ? `<span class="summary-image">📷${images.length > 1 ? images.length : ""}</span>` : ""}`;

      row.querySelector("strong").textContent = event.title;
      row.querySelector("p").textContent = event.memo || "메모 없음";
      row.addEventListener("click", () => openEdit(event.id));
      groupBox.appendChild(row);
    });

    scheduleSummary.appendChild(groupBox);
  });
}

function setFilter(filter) {
  activeFilter = filter;
  categoryFilter.querySelectorAll(".filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === filter));
  renderScheduleSummary(loadEvents());
}

function openAdd(date = dateKey(new Date())) {
  editingId = null; modalTitle.textContent = "일정 추가"; form.reset(); dateInput.value = date; categoryInput.value = "CPF 지원"; timeInput.value = ""; timeInput.removeAttribute("readonly"); timeInput.disabled = false; resetImagePreview(); deleteBtn.classList.add("hidden"); modal.classList.remove("hidden"); titleInput.focus();
}
function openEdit(id) {
  const event = loadEvents().find(e => e.id === id); if (!event) return;
  editingId = id; modalTitle.textContent = "일정 수정"; dateInput.value = event.date; categoryInput.value = categoryLabel(event.category); titleInput.value = event.title; timeInput.value = event.time || ""; timeInput.removeAttribute("readonly"); timeInput.disabled = false; memoInput.value = event.memo || ""; showImagePreviews(getImages(event)); deleteBtn.classList.remove("hidden"); modal.classList.remove("hidden"); titleInput.focus();
}
function closeModal() { modal.classList.add("hidden"); editingId = null; form.reset(); resetImagePreview(); }

form.addEventListener("submit", e => {
  e.preventDefault();
  const events = loadEvents(), timeValue = timeInput.value.trim();
  const validTime = timeValue === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue);
  if (!validTime) { alert("시간은 00:00 ~ 23:59 형식으로 입력해주세요."); timeInput.focus(); return; }
  const data = { id: editingId || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())), date: dateInput.value, category: categoryLabel(categoryInput.value), title: titleInput.value.trim(), time: timeValue, memo: memoInput.value.trim(), images: [...currentImages] };
  if (!data.title) return alert("일정 제목을 입력해주세요."); if (!data.date) return alert("날짜를 선택해주세요.");
  if (editingId) { const i = events.findIndex(e => e.id === editingId); if (i !== -1) events[i] = data; } else events.push(data);
  try { saveEvents(events); } catch { return; }
  closeModal(); renderCalendar();
});

imageInput.addEventListener("change", async () => {
  const files = Array.from(imageInput.files || []); if (!files.length) return;
  const invalid = files.find(file => file.size > 10*1024*1024 || !file.type.startsWith("image/"));
  if (invalid) { alert("이미지는 10MB 이하의 파일만 등록할 수 있습니다."); imageInput.value = ""; return; }
  try {
    const newImages = [];
    for (const file of files) newImages.push(await compressImage(file));
    showImagePreviews([...currentImages, ...newImages]);
    imageInput.value = "";
  } catch(e) { alert("이미지를 불러오지 못했습니다."); console.error(e); }
});
removeImageBtn.addEventListener("click", resetImagePreview);
deleteBtn.addEventListener("click", () => { if (!editingId) return; if (!confirm("이 일정을 삭제하시겠습니까?")) return; saveEvents(loadEvents().filter(e => e.id !== editingId)); closeModal(); renderCalendar(); });
categoryFilter.addEventListener("click", e => { const btn = e.target.closest(".filter-btn"); if (btn) setFilter(btn.dataset.filter); });
document.getElementById("prevBtn").addEventListener("click", () => { currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1); renderCalendar(); });
document.getElementById("nextBtn").addEventListener("click", () => { currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1); renderCalendar(); });
document.getElementById("todayBtn").addEventListener("click", () => { currentDate = new Date(); renderCalendar(); });
document.getElementById("addBtn").addEventListener("click", () => openAdd());
document.getElementById("closeBtn").addEventListener("click", closeModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

function openImageViewer(images, index = 0) {
  viewerImages = images || []; if (!viewerImages.length) return; viewerIndex = Math.max(0, Math.min(index, viewerImages.length-1));
  imageViewerImg.src = viewerImages[viewerIndex]; imageViewerCounter.textContent = `${viewerIndex+1} / ${viewerImages.length}`; imageViewer.classList.remove("hidden");
}
function closeImageViewer() { imageViewer.classList.add("hidden"); imageViewerImg.src = ""; viewerImages = []; }
function moveViewer(step) { if (!viewerImages.length) return; viewerIndex = (viewerIndex + step + viewerImages.length) % viewerImages.length; imageViewerImg.src = viewerImages[viewerIndex]; imageViewerCounter.textContent = `${viewerIndex+1} / ${viewerImages.length}`; }
document.getElementById("imageViewerClose").addEventListener("click", closeImageViewer);
document.querySelector(".image-viewer-backdrop").addEventListener("click", closeImageViewer);
document.getElementById("viewerPrev").addEventListener("click", () => moveViewer(-1));
document.getElementById("viewerNext").addEventListener("click", () => moveViewer(1));
document.addEventListener("keydown", e => { if (imageViewer.classList.contains("hidden")) return; if (e.key === "Escape") closeImageViewer(); if (e.key === "ArrowLeft") moveViewer(-1); if (e.key === "ArrowRight") moveViewer(1); });

// 등록된 일정의 날짜 선택
const scheduleDatePicker = document.getElementById("scheduleDatePicker");
const prevScheduleDate = document.getElementById("prevScheduleDate");
const nextScheduleDate = document.getElementById("nextScheduleDate");
const todayScheduleDate = document.getElementById("todayScheduleDate");

if (scheduleDatePicker) {
  scheduleDatePicker.value = dateKey(new Date());

  scheduleDatePicker.addEventListener("change", () => {
    renderScheduleSummary(loadEvents());
  });
}

if (prevScheduleDate) {
  prevScheduleDate.addEventListener("click", () => {
    const base = new Date((scheduleDatePicker.value || dateKey(new Date())) + "T00:00:00");
    base.setDate(base.getDate() - 1);
    scheduleDatePicker.value = dateKey(base);
    renderScheduleSummary(loadEvents());
  });
}

if (nextScheduleDate) {
  nextScheduleDate.addEventListener("click", () => {
    const base = new Date((scheduleDatePicker.value || dateKey(new Date())) + "T00:00:00");
    base.setDate(base.getDate() + 1);
    scheduleDatePicker.value = dateKey(base);
    renderScheduleSummary(loadEvents());
  });
}

if (todayScheduleDate) {
  todayScheduleDate.addEventListener("click", () => {
    scheduleDatePicker.value = dateKey(new Date());
    renderScheduleSummary(loadEvents());
  });
}

// 달력의 날짜를 클릭하면 아래 '등록된 일정' 날짜도 같이 변경
document.getElementById("calendar").addEventListener("click", (e) => {
  const cell = e.target.closest(".day");
  if (!cell) return;

  // 달력의 openAdd()와 같은 날짜를 얻기 위해 day-number를 사용하지 않고,
  // 현재 달력의 셀 순서를 계산합니다.
  const cells = Array.from(document.querySelectorAll("#calendar .day"));
  const index = cells.indexOf(cell);
  if (index < 0) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const cellDate = new Date(year, month, index - firstDay + 1);
  const key = dateKey(cellDate);

  if (scheduleDatePicker) {
    scheduleDatePicker.value = key;
    renderScheduleSummary(loadEvents());
  }
});

renderCalendar();
