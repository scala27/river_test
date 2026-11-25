let allRecords = [];
let filteredRecords = [];
let deduplicatedRecords = [];
let mergedDuplicateRecords = [];
let zeroBudgetRecords = [];
let detailAuditMode = "all";
let adminPasscode = "";
let selectedCountyForChart = "【全臺合計】";
let detailSortAsc = {};
let isResizingCol = false;
let currentMainTab = "approval";

const COL_WIDTH_STORAGE_KEY = "flood_projects_v2_col_widths";
const DEFAULT_DETAIL_COL_WIDTHS = {
  year: 48, appendix: 82, category: 78, branch: 50, county: 76, water: 84,
  name: 300, approved: 90, usable: 90, code: 150, remark: 130, concern: 112
};

function $(id) { return document.getElementById(id); }

window.addEventListener("DOMContentLoaded", () => {
  if (typeof initMobileLayout === "function") initMobileLayout();
  initCategoryCheckboxes();
  initDetailColumnResizer();
  if (typeof initCharts === "function") initCharts();

  document.addEventListener("click", (e) => {
    if ($("topMenuContainer") && !$("topMenuContainer").contains(e.target)) closeTopMenu();
    if ($("categoryDropdownWrapper") && !$("categoryDropdownWrapper").contains(e.target)) {
      $("categoryDropdownPanel")?.classList.add("hidden");
    }
  });

  reloadAllV2Data(false);
});

async function reloadAllV2Data(forceNotify) {
  await Promise.all([loadAllData(false), loadV2LifecycleData(false)]);
  if (forceNotify) alert(`同步完成（活水 ${v2ActiveCases.length} 筆、歷年 ${allRecords.length} 筆）`);
}

function switchMainTab(tab) {
  currentMainTab = tab;
  const map = {
    approval: ["mainTabApproval", "viewApproval"],
    progress: ["mainTabProgress", "viewProgress"],
    budget: ["mainTabBudget", "viewBudget"],
    history: ["mainTabHistory", "viewHistory"]
  };
  Object.keys(map).forEach(k => {
    const [btnId, viewId] = map[k];
    const active = k === tab;
    $(viewId)?.classList.toggle("hidden", !active);
    const btn = $(btnId);
    if (btn) {
      btn.classList.toggle("bg-[#1D3557]", active);
      btn.classList.toggle("text-white", active);
      btn.classList.toggle("shadow-xs", active);
      btn.classList.toggle("text-[#1D3557]/75", !active);
      btn.classList.toggle("hover:text-[#1D3557]", !active);
    }
  });

  if (tab === "budget" && typeof renderBudgetView === "function") {
    renderBudgetView();
  }

  if (tab !== "history") {
    $("kpiSection")?.classList.add("hidden");
    if ($("menuToggleKpiLabel")) $("menuToggleKpiLabel").textContent = "顯示統計卡片";
  } else {
    setTimeout(() => { if (typeof renderActiveCharts === "function") renderActiveCharts(); }, 30);
  }
}

function switchHistorySubTab(sub) {
  ["Detail", "County", "Trend", "Branch"].forEach(name => {
    $(`view${name}`)?.classList.add("hidden");
    const btn = $(`tabBtn${name}`);
    if (btn) {
      btn.classList.remove("bg-[#004E89]", "text-white");
      btn.classList.add("bg-white", "text-[#1D3557]");
    }
  });
  const cap = sub.charAt(0).toUpperCase() + sub.slice(1);
  $(`view${cap}`)?.classList.remove("hidden");
  const activeBtn = $(`tabBtn${cap}`);
  if (activeBtn) {
    activeBtn.classList.remove("bg-white", "text-[#1D3557]");
    activeBtn.classList.add("bg-[#004E89]", "text-white");
  }
  setTimeout(() => { if (typeof renderActiveCharts === "function") renderActiveCharts(); }, 30);
}

function toggleTopMenu(e) { if (e) e.stopPropagation(); $("topMenuDropdown")?.classList.toggle("hidden"); }
function closeTopMenu() { $("topMenuDropdown")?.classList.add("hidden"); }

function toggleKpiSection() {
  if (currentMainTab !== "history") switchMainTab("history");
  const sec = $("kpiSection");
  if (!sec) return;
  const isHidden = sec.classList.toggle("hidden");
  if ($("menuToggleKpiLabel")) $("menuToggleKpiLabel").textContent = isHidden ? "顯示統計卡片" : "隱藏統計卡片";
  if (typeof renderActiveCharts === "function") setTimeout(() => renderActiveCharts(), 30);
}

function toggleCategoryDropdown(e) { if (e) e.stopPropagation(); $("categoryDropdownPanel")?.classList.toggle("hidden"); }

function initCategoryCheckboxes() {
  const container = $("categoryCheckboxes");
  if (!container) return;
  container.innerHTML = CATEGORIES_LIST.map(cat => `
    <label class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#FAF3E0] cursor-pointer text-[#1D3557]">
      <input type="checkbox" class="cat-chk rounded accent-[#ED6D35]" value="${cat}" checked onchange="onSingleCategoryChange()" />
      <span>${cat}</span>
    </label>
  `).join("");
  updateCategoryDropdownLabel();
}

function updateCategoryDropdownLabel() {
  const chks = Array.from(document.querySelectorAll(".cat-chk"));
  const checked = chks.filter(c => c.checked);
  const lbl = $("lblCategorySummary");
  if (!lbl) return;
  if (checked.length === chks.length) lbl.textContent = `全部類別 (${chks.length})`;
  else if (checked.length === 0) lbl.textContent = "未選取 (0)";
  else if (checked.length === 1) lbl.textContent = checked[0].value;
  else lbl.textContent = `已選 ${checked.length} 項`;
}

function toggleAllCategories(checked) {
  document.querySelectorAll(".cat-chk").forEach(el => { el.checked = checked; });
  updateCategoryDropdownLabel();
  applyFilters();
}

function onSingleCategoryChange() {
  const chks = Array.from(document.querySelectorAll(".cat-chk"));
  if ($("chkAll")) $("chkAll").checked = chks.every(c => c.checked);
  updateCategoryDropdownLabel();
  applyFilters();
}

async function loadAllData(forceNotify) {
  const tip = $("syncStatusTooltip");
  const icon = $("iconSyncCloud");
  if (tip) tip.textContent = "同步中...";
  if (icon) { icon.classList.add("animate-pulse", "text-[#ED6D35]"); icon.classList.remove("text-emerald-300", "text-rose-400"); }

  try {
    const res = await fetch(GAS_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.message || "API 回傳異常");

    allRecords = (json.data || []).map(r => ({
      ...r,
      "年度": normalizeText(r["年度"]),
      "類別": normalizeCategoryName(r["類別"]),
      "附表": normalizeText(r["附表"]),
      "分署": normalizeText(r["分署"]).replace("水規所", "水規分署"),
      "縣市": normalizeText(r["縣市"]).replace(/台/g, "臺"),
      "水系": normalizeText(r["水系"]),
      "案件名稱": normalizeText(r["案件名稱"]),
      "工程編號": normalizeText(r["工程編號"]),
      "座標點位": normalizeText(r["座標點位"]),
      "備註資訊": normalizeText(r["備註資訊"]),
      "地方關切": normalizeText(r["地方關切"]),
      "核定經費_千元": parseFloat(r["核定經費_千元"]) || 0,
      "可支用經費_千元": parseFloat(r["可支用經費_千元"]) || 0
    }));

    populateDropdownOptions();
    applyFilters();

    if (icon) { icon.classList.remove("animate-pulse", "text-[#ED6D35]"); icon.classList.add("text-emerald-300"); }
    if (tip) tip.textContent = `已同步 (${allRecords.length} 筆)`;
    if (forceNotify) alert(`同步完成，共 ${allRecords.length} 筆。`);
  } catch (err) {
    if (icon) { icon.classList.remove("animate-pulse", "text-[#ED6D35]"); icon.classList.add("text-rose-400"); }
    if (tip) tip.textContent = `連線失敗：${err.message}`;
  }
}

function populateDropdownOptions() {
  const years = Array.from(new Set(allRecords.map(r => String(r["年度"])).filter(Boolean))).sort();
  const yearList = years.length ? years : ["110", "111", "112", "113", "114", "115"];
  const selStart = $("selYearStart");
  const selEnd = $("selYearEnd");
  if (!selStart || !selEnd) return;
  selStart.innerHTML = yearList.map(y => `<option value="${y}">${y}</option>`).join("");
  selEnd.innerHTML = yearList.map(y => `<option value="${y}">${y}</option>`).join("");
  const latest = yearList[yearList.length - 1];
  selStart.value = latest;
  selEnd.value = latest;
  onDimensionChange();
}

function onYearChange() {
  if (parseInt($("selYearStart").value, 10) > parseInt($("selYearEnd").value, 10)) $("selYearEnd").value = $("selYearStart").value;
  applyFilters();
}

function onDimensionChange() {
  const dim = $("selDimension")?.value || "branch";
  const branches = Array.from(new Set(allRecords.map(r => r["分署"]).filter(Boolean)))
    .sort((a, b) => (CHINESE_NUM_ORDER[a] || 99) - (CHINESE_NUM_ORDER[b] || 99));
  if (dim === "branch") {
    $("lblTarget").textContent = "分署別：";
    $("lblSubFilter").textContent = "縣市別：";
    $("selTarget").innerHTML = ["【全部分署】", ...branches].map(v => `<option value="${v}">${v}</option>`).join("");
    $("selSubFilter").innerHTML = ["【全部縣市】", ...STD_22_COUNTIES].map(v => `<option value="${v}">${v}</option>`).join("");
  } else {
    $("lblTarget").textContent = "縣市別：";
    $("lblSubFilter").textContent = "分署別：";
    $("selTarget").innerHTML = ["【全部縣市】", ...STD_22_COUNTIES].map(v => `<option value="${v}">${v}</option>`).join("");
    $("selSubFilter").innerHTML = ["【全部分署】", ...branches].map(v => `<option value="${v}">${v}</option>`).join("");
  }
  applyFilters();
}

function getYearRangeLabel() {
  const s = $("selYearStart")?.value || "";
  const e = $("selYearEnd")?.value || "";
  return s === e ? `(${s}年度)` : `(${s}-${e}年度)`;
}

function getAllYearsInRange() {
  const s = parseInt($("selYearStart")?.value || "110", 10);
  const e = parseInt($("selYearEnd")?.value || "115", 10);
  const list = [];
  for (let y = s; y <= e; y++) list.push(String(y));
  return list;
}

function setDetailAuditMode(mode) { detailAuditMode = mode; renderDetailTable(); }

function applyFilters() {
  detailAuditMode = "all";
  const sY = parseInt($("selYearStart")?.value || "0", 10);
  const eY = parseInt($("selYearEnd")?.value || "999", 10);
  const dim = $("selDimension")?.value || "branch";
  const target = $("selTarget")?.value || "【全部分署】";
  const sub = $("selSubFilter")?.value || "【全部縣市】";
  const kw = normalizeText($("txtKeyword")?.value || "").toLowerCase();
  const onlyConcern = Boolean($("chkOnlyConcern")?.checked);
  const selectedCats = Array.from(document.querySelectorAll(".cat-chk:checked")).map(c => c.value);

  filteredRecords = allRecords.filter(r => {
    const yr = parseInt(r["年度"], 10);
    if (yr < sY || yr > eY) return false;
    if (!selectedCats.includes(r["類別"])) return false;
    if (onlyConcern && !r["地方關切"]) return false;
    if (dim === "branch") {
      if (target !== "【全部分署】" && r["分署"] !== target) return false;
      if (sub !== "【全部縣市】" && !r["縣市"].includes(sub)) return false;
    } else {
      if (target !== "【全部縣市】" && !r["縣市"].includes(target)) return false;
      if (sub !== "【全部分署】" && r["分署"] !== sub) return false;
    }
    if (kw && !`${r["案件名稱"]} ${r["水系"]} ${r["工程編號"]} ${r["備註資訊"]} ${r["地方關切"]}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  zeroBudgetRecords = filteredRecords.filter(r => r["核定經費_千元"] <= 0);
  const valid = filteredRecords.filter(r => r["核定經費_千元"] > 0);
  mergedDuplicateRecords = [];

  if (sY !== eY) {
    const sorted = [...valid].sort((a, b) => (parseInt(b["年度"], 10) - parseInt(a["年度"], 10)) || (b["核定經費_千元"] - a["核定經費_千元"]));
    const seen = new Set();
    deduplicatedRecords = sorted.filter(r => {
      if (String(r["備註資訊"] || "").includes("[分年累加]")) return true;
      const key = `${r["分署"]}__${r["類別"]}__${getCoreProjectName(r["案件名稱"])}`;
      if (seen.has(key)) { mergedDuplicateRecords.push(r); return false; }
      seen.add(key);
      return true;
    });
  } else {
    deduplicatedRecords = valid;
  }

  updateKpiCards();
  renderDetailTable();
  if (typeof renderCountyTable === "function") renderCountyTable();
  if (typeof renderBranchTable === "function") renderBranchTable();
  if (typeof renderActiveCharts === "function") renderActiveCharts();
}

function updateKpiCards() {
  const sumAmt = arr => arr.reduce((acc, r) => acc + r["核定經費_千元"], 0) / 100000;
  $("kpiTotalCnt").textContent = `案件數: ${deduplicatedRecords.length.toLocaleString()} 筆`;
  $("kpiTotalAmt").textContent = `核定經費: ${sumAmt(deduplicatedRecords).toFixed(2)} 億元`;
  const eng = deduplicatedRecords.filter(r => getMajorCategory(r["類別"]) === "工程類");
  const engG = eng.filter(r => r["類別"] === "工程" || r["類別"] === "維修改善工程");
  const engD = eng.filter(r => r["類別"] === "委託設計/監造");
  $("kpiEngCnt").textContent = `案件數: ${eng.length.toLocaleString()} 筆`;
  $("kpiEngAmt").textContent = `核定經費: ${sumAmt(eng).toFixed(2)} 億元`;
  $("kpiEngSub").innerHTML = `├─ 一般工程: ${engG.length} 筆 / ${sumAmt(engG).toFixed(2)} 億元<br>└─ 委託設計/監造: ${engD.length} 筆 / ${sumAmt(engD).toFixed(2)} 億元`;
  const land = deduplicatedRecords.filter(r => getMajorCategory(r["類別"]) === "用地類");
  $("kpiLandCnt").textContent = `案件數: ${land.length.toLocaleString()} 筆`;
  $("kpiLandAmt").textContent = `核定經費: ${sumAmt(land).toFixed(2)} 億元`;
  const sub = deduplicatedRecords.filter(r => getMajorCategory(r["類別"]) === "補助類");
  $("kpiSubCnt").textContent = `案件數: ${sub.length.toLocaleString()} 筆`;
  $("kpiSubAmt").textContent = `核定經費: ${sumAmt(sub).toFixed(2)} 億元`;
  $("kpiCountyCnt").textContent = `案件數: ${deduplicatedRecords.length.toLocaleString()} 筆`;
  $("kpiCountyAmt").textContent = `核定經費: ${sumAmt(deduplicatedRecords).toFixed(2)} 億元`;
}

function formatIntThousand(val) { return Math.round(Number(val) || 0).toLocaleString(); }
function escapeHtmlAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderCollapsibleCell(rawVal, thresholdLen, alignCenter = false) {
  const text = String(rawVal || "").trim();
  const alignCls = alignCenter ? "text-center" : "text-left";
  if (!text || text === "-") return `<div class="w-full text-center text-slate-400">-</div>`;
  const safeText = escapeHtmlAttr(text);
  if (text.length <= thresholdLen) return `<div class="w-full truncate ${alignCls}" title="${safeText}">${safeText}</div>`;
  return `
    <div class="relative group w-full flex items-center gap-0.5">
      <div class="cell-preview truncate flex-1 ${alignCls}" title="${safeText}">${safeText}</div>
      <button type="button" onclick="toggleCellExpand(this)" class="shrink-0 p-0.5 rounded text-slate-400 hover:text-[#ED6D35]">▾</button>
    </div>
  `;
}

function toggleCellExpand(btn) {
  const preview = btn.parentElement?.querySelector(".cell-preview");
  if (!preview) return;
  const expanded = preview.classList.toggle("truncate");
  preview.classList.toggle("whitespace-normal", !expanded);
  preview.classList.toggle("break-words", !expanded);
}

function renderConcernCell(rawVal) {
  const text = String(rawVal || "").trim();
  if (!text || text === "-") return `<div class="w-full text-center text-slate-400">-</div>`;
  const safeText = escapeHtmlAttr(text);
  return `<div class="w-full truncate text-center" title="${safeText}"><span class="inline-block max-w-full truncate px-1.5 py-0.5 rounded bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/25 font-medium text-[11px]">${safeText}</span></div>`;
}

function renderDetailTable() {
  const isAdmin = Boolean(adminPasscode);
  $("thActionCol")?.classList.toggle("hidden", !isAdmin);
  if ($("colActionWidth")) $("colActionWidth").style.width = isAdmin ? "44px" : "0px";
  if (typeof syncV2AuthUI === "function") syncV2AuthUI();

  const displayRows = detailAuditMode === "merged" ? mergedDuplicateRecords : (detailAuditMode === "zero" ? zeroBudgetRecords : filteredRecords);
  if ($("lblDetailSummary")) {
    $("lblDetailSummary").textContent = `篩選 ${displayRows.length.toLocaleString()} 筆（統計實計 ${deduplicatedRecords.length.toLocaleString()} 筆）`;
  }
  if (typeof renderMobileDetailCards === "function") renderMobileDetailCards(displayRows);

  const tbody = $("tbodyDetail");
  if (!tbody) return;
  tbody.innerHTML = displayRows.map((r, idx) => {
    const bg = idx % 2 === 0 ? "bg-[#F7F5F0]/75" : "bg-white";
    const natureText = typeof formatAppendixToNature === "function" ? formatAppendixToNature(r["附表"]) : r["附表"];
    const editBtn = isAdmin ? `<td class="px-1.5 py-1.5 text-center"><button onclick='openEditModal(${JSON.stringify(r).replace(/'/g, "&#39;")})' class="text-[#004E89] hover:text-[#ED6D35] font-bold">✎</button></td>` : "";
    return `
      <tr class="${bg} hover:bg-[#FAF3E0]/75">
        <td class="px-1.5 py-1.5 text-center">${r["年度"]}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(natureText, 6, true)}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(r["類別"], 4, true)}</td>
        <td class="px-1.5 py-1.5 text-center font-medium">${r["分署"] || "-"}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(r["縣市"], 3, true)}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(r["水系"], 4, true)}</td>
        <td class="px-2 py-1.5 font-medium text-[#1D3557] truncate" title="${escapeHtmlAttr(r["案件名稱"])}">${r["案件名稱"]}</td>
        <td class="px-1.5 py-1.5 text-right">${formatIntThousand(r["核定經費_千元"])}</td>
        <td class="px-1.5 py-1.5 text-right">${formatIntThousand(r["可支用經費_千元"])}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(r["工程編號"], 18, true)}</td>
        <td class="px-1.5 py-1.5">${renderCollapsibleCell(r["備註資訊"], 12, false)}</td>
        <td class="px-1.5 py-1.5">${renderConcernCell(r["地方關切"])}</td>
        ${editBtn}
      </tr>
    `;
  }).join("");
}

function sortDetailTable(field) {
  if (isResizingCol) return;
  detailSortAsc[field] = !detailSortAsc[field];
  const asc = detailSortAsc[field];
  filteredRecords.sort((a, b) => {
    if (typeof a[field] === "number") return asc ? a[field] - b[field] : b[field] - a[field];
    if (field === "分署") return asc ? ((CHINESE_NUM_ORDER[a[field]] || 99) - (CHINESE_NUM_ORDER[b[field]] || 99)) : ((CHINESE_NUM_ORDER[b[field]] || 99) - (CHINESE_NUM_ORDER[a[field]] || 99));
    return asc ? String(a[field] || "").localeCompare(String(b[field] || "")) : String(b[field] || "").localeCompare(String(a[field] || ""));
  });
  renderDetailTable();
}

function resetDetailColumnWidths() {
  try { localStorage.removeItem(COL_WIDTH_STORAGE_KEY); } catch (e) {}
  const cg = $("detailColGroup");
  if (!cg) return;
  Object.keys(DEFAULT_DETAIL_COL_WIDTHS).forEach(k => {
    const col = cg.querySelector(`col[data-col-key="${k}"]`);
    if (col) col.style.width = `${DEFAULT_DETAIL_COL_WIDTHS[k]}px`;
  });
}

function initDetailColumnResizer() {
  document.querySelectorAll("#tblDetail .col-resizer").forEach(handle => {
    handle.style.cssText = "position:absolute;right:0;top:0;bottom:0;width:7px;cursor:col-resize;z-index:30;border-right:1px solid rgba(255,255,255,0.22);";
    handle.addEventListener("click", e => e.stopPropagation());
    handle.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      const key = handle.getAttribute("data-col-key");
      const col = $("detailColGroup")?.querySelector(`col[data-col-key="${key}"]`);
      if (!col) return;
      isResizingCol = true;
      const startX = e.pageX, startW = col.getBoundingClientRect().width || 80;
      const onMove = mv => { col.style.width = `${Math.max(40, Math.round(startW + mv.pageX - startX))}px`; };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setTimeout(() => { isResizingCol = false; }, 50);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}