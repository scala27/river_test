/**
 * 治水雲庫 V2 — ⑤ 生態檢核案件（生命週期分頁、明細表格與維護視窗）
 */

let v2EcologicalCases = [];
let v2PendingEcoImport = [];
let currentEcoSubTab = "active"; // "active" | "closed" | "charts"

const V2_ECO_TEN_BRANCHES = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const V2_ECO_BRANCH_ORDER = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  "水規分署": 11
};

function initV2EcologicalData(json) {
  v2EcologicalCases = Array.isArray(json.ecologicalCases) ? json.ecologicalCases : [];
}

function canManageEcologicalAll() {
  return v2AuthState.role === "admin";
}

function canEditSingleEcologicalCase(c) {
  if (canManageEcologicalAll()) return true;
  if (v2AuthState.role === "branch" && v2AuthState.branch) {
    return v2NormBranch(c["分署別"]) === v2NormBranch(v2AuthState.branch);
  }
  return false;
}

function getEcoTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseEcoStartEndFromRecord(c) {
  const s = parseInt(c["起年"], 10);
  const e = parseInt(c["迄年"], 10);
  if (s && e) return { startYr: s, endYr: e, isSingleYear: s === e };
  const yrStr = String(c["年度"] || "").trim();
  const mRange = yrStr.match(/(1\d{2})\s*[-~～]\s*(1\d{2})/);
  if (mRange) {
    const sy = parseInt(mRange[1], 10);
    const ey = parseInt(mRange[2], 10);
    return { startYr: sy, endYr: ey, isSingleYear: sy === ey };
  }
  const fallback = parseInt(yrStr, 10) || (new Date().getFullYear() - 1911);
  return { startYr: fallback, endYr: fallback, isSingleYear: true };
}

function getEcoLifecycleInfo(c) {
  const { endYr } = parseEcoStartEndFromRecord(c);
  const closeDate = String(c["自動結案日"] || "").trim() || `${endYr + 1911}-12-31`;
  const rawStatus = String(c["執行狀態"] || "").trim();
  if (getEcoTodayStr() > closeDate) return { status: "已結案", closeDate };
  if (rawStatus === "已結案") return { status: "已結案", closeDate };
  return { status: "執行中", closeDate };
}

function getActiveEcologicalCount() {
  return (v2EcologicalCases || []).filter(c => getEcoLifecycleInfo(c).status === "執行中").length;
}

function getEcoApprovedBreakdown(c) {
  const { isSingleYear } = parseEcoStartEndFromRecord(c);
  const a1 = parseFloat(c["第1年核定經費_千元"]) || 0;
  const a2 = isSingleYear ? 0 : (parseFloat(c["第2年核定經費_千元"]) || 0);
  const rawTotal = parseFloat(c["核定經費_千元"]) || 0;
  if (a1 === 0 && a2 === 0 && rawTotal > 0) return { a1: rawTotal, a2: 0, total: rawTotal };
  return { a1, a2, total: Number((a1 + a2).toFixed(3)) };
}

function getEcoExecBreakdown(c) {
  const { isSingleYear } = parseEcoStartEndFromRecord(c);
  const y1 = parseFloat(c["第1年執行經費_千元"]) || 0;
  const y2 = isSingleYear ? 0 : (parseFloat(c["第2年執行經費_千元"]) || 0);
  const rawTotal = parseFloat(c["執行經費_千元"]) || 0;
  if (y1 === 0 && y2 === 0 && rawTotal > 0) return { y1: rawTotal, y2: 0, total: rawTotal };
  return { y1, y2, total: Number((y1 + y2).toFixed(3)) };
}

function getEcoCodeBreakdown(c) {
  const { isSingleYear } = parseEcoStartEndFromRecord(c);
  const rawLegacy = String(c["工程編號"] || "").trim();
  let c1 = String(c["第1年工程編號"] || "").trim();
  let c2 = isSingleYear ? "" : String(c["第2年工程編號"] || "").trim();
  if (!c1 && !c2 && rawLegacy) {
    const parts = rawLegacy.split("/").map(s => s.trim()).filter(Boolean);
    c1 = parts[0] || "";
    c2 = isSingleYear ? "" : (parts[1] || "");
  }
  return { c1, c2 };
}

function switchEcoSubTab(subTab) {
  currentEcoSubTab = ["active", "closed", "charts"].includes(subTab) ? subTab : "active";
  renderEcologicalView();
}

function getEcologicalFilters() {
  return {
    period: document.getElementById("selEcoPeriod")?.value || "ALL",
    branch: document.getElementById("selEcoBranch")?.value || "ALL",
    kw: normalizeText(document.getElementById("txtEcoKeyword")?.value || "").toLowerCase()
  };
}

function renderEcologicalView() {
  const container = document.getElementById("viewEcology");
  if (!container) return;

  ensureV2EcologicalModals();
  const prev = getEcologicalFilters();
  const isAdmin = canManageEcologicalAll();
  const activeCases = (v2EcologicalCases || []).filter(c => getEcoLifecycleInfo(c).status === "執行中");
  const closedCases = (v2EcologicalCases || []).filter(c => getEcoLifecycleInfo(c).status === "已結案");

  const navBadge = document.getElementById("navBadgeEcology");
  if (navBadge) navBadge.textContent = activeCases.length;

  const isChartTab = currentEcoSubTab === "charts";
  const targetPool = currentEcoSubTab === "closed" ? closedCases : activeCases;
  const periods = Array.from(new Set(targetPool.map(c => String(c["年度"]).trim()).filter(Boolean))).sort().reverse();

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#1D3557]/15 pb-2.5 mb-2.5 text-xs">
      <div class="flex items-center gap-1.5 overflow-x-auto">
        <button type="button" onclick="switchEcoSubTab('active')" class="px-3 py-1 rounded font-bold whitespace-nowrap transition flex items-center gap-1.5 ${currentEcoSubTab === "active" ? "bg-[#004E89] text-white" : "bg-white text-[#1D3557] border border-[#1D3557]/15 hover:bg-[#FAF3E0]"}">
          <span>執行中案件</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${currentEcoSubTab === "active" ? "bg-[#ED6D35] text-white" : "bg-[#1D3557]/12 text-[#1D3557]"}">${activeCases.length}</span>
        </button>
        <button type="button" onclick="switchEcoSubTab('closed')" class="px-3 py-1 rounded font-bold whitespace-nowrap transition flex items-center gap-1.5 ${currentEcoSubTab === "closed" ? "bg-[#004E89] text-white" : "bg-white text-[#1D3557] border border-[#1D3557]/15 hover:bg-[#FAF3E0]"}">
          <span>已結案歷史檔</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${currentEcoSubTab === "closed" ? "bg-[#ED6D35] text-white" : "bg-[#1D3557]/12 text-[#1D3557]"}">${closedCases.length}</span>
        </button>
        <button type="button" onclick="switchEcoSubTab('charts')" class="px-3 py-1 rounded font-bold whitespace-nowrap transition ${currentEcoSubTab === "charts" ? "bg-[#004E89] text-white" : "bg-white text-[#1D3557] border border-[#1D3557]/15 hover:bg-[#FAF3E0]"}">
          統計分析圖表
        </button>
      </div>

      ${!isChartTab ? `
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" onclick="exportEcologicalExcel()" class="px-3 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/35 font-bold transition">📥 匯出明細表</button>
          ${isAdmin ? `
            <button type="button" onclick="openV2EcoEditModal('')" class="px-3 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#1D3557] border border-[#1D3557]/25 font-bold transition">＋ 單筆新增</button>
            <button type="button" onclick="openV2EcoBatchPeriodModal()" class="px-3 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold transition">建立2年1期10分署表</button>
            <button type="button" onclick="triggerV2EcoExcelInput()" class="px-3 py-1 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold transition">匯入核定 Excel</button>
          ` : ""}
        </div>
      ` : ""}
    </div>
    <input type="file" id="fileV2EcoExcel" accept=".xlsx,.xls,.xlsm" class="hidden" onchange="handleV2EcoExcelSelect(event)" />

    <div id="ecoListWorkspace" class="${isChartTab ? "hidden" : ""}">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <select id="selEcoPeriod" onchange="renderEcologicalView()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557] font-bold">
            <option value="ALL">全部期別年度</option>
            ${periods.map(p => `<option value="${escapeHtmlAttr(p)}">${escapeHtmlAttr(p)} 年度</option>`).join("")}
          </select>
          <select id="selEcoBranch" onchange="renderEcologicalView()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
            <option value="ALL">全部分署別</option>
            ${V2_BRANCH_KEYS.map(b => `<option value="${b}">${v2DisplayBranch(b)}</option>`).join("")}
          </select>
          <input id="txtEcoKeyword" type="text" oninput="renderEcologicalTableBody()" placeholder="年度 / 案名 / 廠商 / 工程編號 / 備註" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white w-56" />
        </div>
        <div class="flex items-center gap-3 text-[11px] text-[#1D3557]/65">
          <span id="lblEcoListCount">顯示 0 筆</span>
          <span class="font-medium">單位:千元</span>
        </div>
      </div>

      <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="sticky top-0 z-10">
            <tr>
              <th class="px-2 py-2 text-center whitespace-nowrap">年度</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">分署別</th>
              <th class="px-2.5 py-2 min-w-[260px]">案名</th>
              <th class="px-2.5 py-2 min-w-[215px]">執行廠商</th>
              <th class="px-2.5 py-2 text-center whitespace-nowrap">核定經費</th>
              <th class="px-2.5 py-2 text-right whitespace-nowrap">決標金額</th>
              <th class="px-2.5 py-2 text-center whitespace-nowrap">執行經費</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">工程編號</th>
              <th class="px-2 py-2 w-28 max-w-[115px] text-center whitespace-nowrap">備註</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody id="tbodyEcological" class="divide-y divide-slate-200"></tbody>
        </table>
      </div>
    </div>

    <div id="ecoChartsWorkspace" class="${isChartTab ? "" : "hidden"}"></div>
  `;

  if (!isChartTab) {
    if (document.getElementById("selEcoPeriod") && (prev.period === "ALL" || periods.includes(prev.period))) {
      document.getElementById("selEcoPeriod").value = prev.period;
    }
    if (document.getElementById("selEcoBranch")) document.getElementById("selEcoBranch").value = prev.branch;
    if (document.getElementById("txtEcoKeyword")) document.getElementById("txtEcoKeyword").value = prev.kw;
    renderEcologicalTableBody();
  } else if (typeof renderEcologicalChartsWorkspace === "function") {
    renderEcologicalChartsWorkspace();
  }
}

function getFilteredEcologicalRows() {
  const { period, branch, kw } = getEcologicalFilters();
  const targetStatus = currentEcoSubTab === "closed" ? "已結案" : "執行中";

  return (v2EcologicalCases || [])
    .filter(c => {
      if (getEcoLifecycleInfo(c).status !== targetStatus) return false;
      if (period !== "ALL" && String(c["年度"]).trim() !== period) return false;
      if (branch !== "ALL" && v2NormBranch(c["分署別"]) !== branch) return false;
      if (kw) {
        const hay = `${c.eco_uid} ${c["年度"]} ${c["分署別"]} ${c["計畫名稱"] || ""} ${c["執行廠商"] || ""} ${c["第1年工程編號"] || ""} ${c["第2年工程編號"] || ""} ${c["工程編號"] || ""} ${c["備註"] || ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const pa = parseEcoStartEndFromRecord(a);
      const pb = parseEcoStartEndFromRecord(b);
      if (pb.startYr !== pa.startYr) return pb.startYr - pa.startYr;
      if (pb.endYr !== pa.endYr) return pb.endYr - pa.endYr;
      return (V2_ECO_BRANCH_ORDER[v2NormBranch(a["分署別"])] || 99) - (V2_ECO_BRANCH_ORDER[v2NormBranch(b["分署別"])] || 99);
    });
}

function renderEcoCompactRemarkCell(rawRemark) {
  const txt = String(rawRemark || "").trim();
  if (!txt || txt === "-") return `<div class="text-center text-slate-400">-</div>`;
  const safe = escapeHtmlAttr(txt);
  if (txt.length <= 8) return `<div class="w-24 truncate text-[#1D3557]/85" title="${safe}">${safe}</div>`;
  return `
    <div class="w-24 flex items-center gap-0.5">
      <div class="cell-preview truncate flex-1 text-[#1D3557]/85" title="${safe}">${safe}</div>
      <button type="button" onclick="toggleCellExpand(this)" title="展開/收合備註" class="shrink-0 text-slate-400 hover:text-[#ED6D35]">▾</button>
    </div>
  `;
}

function renderEcologicalTableBody() {
  const tbody = document.getElementById("tbodyEcological");
  if (!tbody) return;
  const rows = getFilteredEcologicalRows();

  const cntLbl = document.getElementById("lblEcoListCount");
  if (cntLbl) cntLbl.textContent = `${currentEcoSubTab === "closed" ? "已結案" : "執行中"}共 ${rows.length} 筆`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="py-8 text-center text-slate-400">目前無符合條件之生態檢核案件</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((c, idx) => {
    const bg = idx % 2 === 0 ? "bg-[#F7F5F0]/75" : "bg-white";
    const { startYr, endYr, isSingleYear } = parseEcoStartEndFromRecord(c);
    const life = getEcoLifecycleInfo(c);
    const { a1, a2 } = getEcoApprovedBreakdown(c);
    const { y1, y2 } = getEcoExecBreakdown(c);
    const { c1, c2 } = getEcoCodeBreakdown(c);

    const budget = parseFloat(c["預算金額_千元"]) || 0;
    const purchase = parseFloat(c["採購金額_千元"]) || 0;
    const award = parseFloat(c["決標金額_千元"]) || 0;
    const awardDate = String(c["決標公告日"] || "").trim();
    const extRaw = String(c["後續擴充"] || "").trim();
    const hasBidData = budget > 0 || purchase > 0 || award > 0 || Boolean(awardDate);
    const hasExt = hasBidData ? (extRaw !== "否") : (extRaw === "是");
    const canEdit = canEditSingleEcologicalCase(c);
    const periodLabel = isSingleYear ? `${startYr}` : `${startYr}-${endYr}`;
    const planTitle = String(c["計畫名稱"] || "").trim() || `${periodLabel}年${v2DisplayBranch(c["分署別"])}轄區生態檢核委託服務案(開口合約)`;

    const bidSubInfos = [];
    if (budget > 0 || purchase > 0 || extRaw === "是" || extRaw === "否") {
      bidSubInfos.push(`預算 ${formatIntThousand(budget)}`);
      bidSubInfos.push(`採購 ${formatIntThousand(purchase)}`);
      if (hasExt) bidSubInfos.push(`含後續擴充`);
    }

    const yearCellHtml = isSingleYear
      ? `<div class="font-bold text-[#1D3557]">${startYr}</div>`
      : `<div class="font-bold text-[#1D3557] leading-tight">${startYr}</div><div class="font-bold text-[#004E89] leading-tight mt-0.5">${endYr}</div>`;

    const apprCellHtml = isSingleYear
      ? `<div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#1D3557]"><span>${startYr}年：</span><strong>${formatIntThousand(a1)}</strong></div>`
      : `<div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#1D3557] leading-tight"><span>${startYr}年：</span><strong>${formatIntThousand(a1)}</strong></div>
         <div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#004E89] leading-tight mt-0.5"><span>${endYr}年：</span><strong>${formatIntThousand(a2)}</strong></div>`;

    const execCellHtml = isSingleYear
      ? `<div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#1D3557]"><span>${startYr}年：</span><strong>${formatIntThousand(y1)}</strong></div>`
      : `<div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#1D3557] leading-tight"><span>${startYr}年：</span><strong>${formatIntThousand(y1)}</strong></div>
         <div class="min-w-[96px] flex items-center justify-between gap-2 text-[11px] text-[#004E89] leading-tight mt-0.5"><span>${endYr}年：</span><strong>${formatIntThousand(y2)}</strong></div>`;

    const codeCellHtml = isSingleYear
      ? (c1 ? `<div class="text-[11px] text-[#1D3557]">${escapeHtmlAttr(c1)}</div>` : `<span class="text-[11px] text-rose-600">待補登</span>`)
      : (`<div class="text-[11px] leading-tight">${c1 ? `<span class="text-[#1D3557]">${escapeHtmlAttr(c1)}</span>` : `<span class="text-rose-600">待補登</span>`}</div>` +
         `<div class="text-[11px] leading-tight mt-0.5">${c2 ? `<span class="text-[#004E89]">${escapeHtmlAttr(c2)}</span>` : `<span class="text-slate-400">-</span>`}</div>`);

    return `
      <tr class="${bg} hover:bg-[#FAF3E0]/75">
        <td class="px-2 py-2 text-center whitespace-nowrap font-mono">${yearCellHtml}</td>
        <td class="px-2 py-2 text-center font-bold whitespace-nowrap">${v2DisplayBranch(c["分署別"])}</td>
        <td class="px-2.5 py-2">
          <div class="font-bold text-[#1D3557]">${escapeHtmlAttr(planTitle)}</div>
          ${life.status === "已結案" ? `<div class="text-[10px] text-[#1D3557]/55 mt-0.5">結案基準日：${escapeHtmlAttr(life.closeDate)}</div>` : ""}
        </td>
        <td class="px-2.5 py-2">
          <div>${c["執行廠商"] ? `<span class="font-medium text-[#1D3557]">${escapeHtmlAttr(c["執行廠商"])}</span>` : `<span class="text-slate-400">待填執行廠商</span>`}</div>
          ${bidSubInfos.length ? `<div class="text-[10px] text-[#004E89] mt-0.5 whitespace-nowrap">${bidSubInfos.join("｜")}</div>` : ""}
        </td>
        <td class="px-2.5 py-2 font-mono whitespace-nowrap">${apprCellHtml}</td>
        <td class="px-2.5 py-2 text-right font-mono whitespace-nowrap">
          ${award > 0 ? `<div class="font-bold text-[#ED6D35]">${formatIntThousand(award)}</div>` : `<div class="text-slate-400">-</div>`}
          ${awardDate ? `<div class="text-[10px] text-[#1D3557]/60 mt-0.5">${escapeHtmlAttr(awardDate)}</div>` : ""}
        </td>
        <td class="px-2.5 py-2 font-mono whitespace-nowrap">${execCellHtml}</td>
        <td class="px-2 py-2 text-center font-mono whitespace-nowrap">${codeCellHtml}</td>
        <td class="px-2 py-2 w-28 max-w-[115px]">${renderEcoCompactRemarkCell(c["備註"])}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          ${canEdit
            ? `<button type="button" onclick="openV2EcoEditModal('${c.eco_uid}')" class="px-2.5 py-1 rounded bg-[#FAF3E0] hover:bg-[#ED6D35] text-[#1D3557] hover:text-white border border-[#1D3557]/20 font-bold text-[11px] transition">編輯</button>`
            : `<span class="text-[11px] text-slate-400">唯讀</span>`
          }
        </td>
      </tr>
    `;
  }).join("");
}

function updateEcoModalYearLabels() {
  const sYr = parseInt(document.getElementById("ecoEdStartYr")?.value, 10) || 115;
  const eRaw = parseInt(document.getElementById("ecoEdEndYr")?.value, 10);
  const eYr = (eRaw && eRaw >= sYr) ? eRaw : sYr;
  const isSingleYear = sYr === eYr;

  if (document.getElementById("lblEcoYear1Code")) document.getElementById("lblEcoYear1Code").textContent = isSingleYear ? `工程編號（${sYr}年度）` : `第1年工程編號（${sYr}年度）`;
  if (document.getElementById("lblEcoYear2Code")) document.getElementById("lblEcoYear2Code").textContent = `第2年工程編號（${eYr}年度）`;
  if (document.getElementById("lblEcoYear1Appr")) document.getElementById("lblEcoYear1Appr").textContent = isSingleYear ? `核定經費（${sYr}年度）` : `第1年核定經費（${sYr}年度）`;
  if (document.getElementById("lblEcoYear2Appr")) document.getElementById("lblEcoYear2Appr").textContent = `第2年核定經費（${eYr}年度）`;
  if (document.getElementById("lblEcoYear1Exec")) document.getElementById("lblEcoYear1Exec").textContent = isSingleYear ? `執行經費（${sYr}年度）` : `第1年執行經費（${sYr}年度）`;
  if (document.getElementById("lblEcoYear2Exec")) document.getElementById("lblEcoYear2Exec").textContent = `第2年執行經費（${eYr}年度）`;
  if (document.getElementById("lblEcoAutoCloseHint")) document.getElementById("lblEcoAutoCloseHint").textContent = `${eYr + 1911}-12-31`;

  document.getElementById("wrapEcoYear2Code")?.classList.toggle("hidden", isSingleYear);
  document.getElementById("wrapEcoYear2Appr")?.classList.toggle("hidden", isSingleYear);
  document.getElementById("wrapEcoYear2Exec")?.classList.toggle("hidden", isSingleYear);
}

function openV2EcoEditModal(ecoUid) {
  ensureV2EcologicalModals();
  const isAdmin = canManageEcologicalAll();
  const target = ecoUid ? (v2EcologicalCases || []).find(x => x.eco_uid === ecoUid) : null;
  if (!target && !isAdmin) return alert("僅「系統管理」可新增生態檢核案件");
  if (target && !canEditSingleEcologicalCase(target)) return alert("無此案件編輯權限");

  const defaultStart = new Date().getFullYear() - 1911;
  const parsed = target ? parseEcoStartEndFromRecord(target) : { startYr: defaultStart, endYr: defaultStart + 1 };
  const life = target ? getEcoLifecycleInfo(target) : { status: getEcoTodayStr() > `${defaultStart + 1 + 1911}-12-31` ? "已結案" : "執行中" };
  const apprBrk = target ? getEcoApprovedBreakdown(target) : { a1: 0, a2: 0 };
  const execBrk = target ? getEcoExecBreakdown(target) : { y1: 0, y2: 0 };
  const codeBrk = target ? getEcoCodeBreakdown(target) : { c1: "", c2: "" };

  document.getElementById("ecoEdModalTitle").textContent = target ? "編輯生態檢核案件" : "新增生態檢核案件";
  document.getElementById("ecoEdUid").value = target ? target.eco_uid : "";
  document.getElementById("ecoEdStatus").value = life.status;
  document.getElementById("ecoEdStartYr").value = parsed.startYr;
  document.getElementById("ecoEdEndYr").value = parsed.endYr;
  document.getElementById("ecoEdBranch").value = target ? v2DisplayBranch(target["分署別"]) : "一分署";
  document.getElementById("ecoEdPlanName").value = target ? (target["計畫名稱"] || "") : "";
  document.getElementById("ecoEdVendor").value = target ? (target["執行廠商"] || "") : "";
  document.getElementById("ecoEdYear1Code").value = codeBrk.c1;
  document.getElementById("ecoEdYear2Code").value = codeBrk.c2;
  document.getElementById("ecoEdYear1Appr").value = apprBrk.a1;
  document.getElementById("ecoEdYear2Appr").value = apprBrk.a2;

  const bAmt = target ? (parseFloat(target["預算金額_千元"]) || 0) : 0;
  const pAmt = target ? (parseFloat(target["採購金額_千元"]) || 0) : 0;
  const aAmt = target ? (parseFloat(target["決標金額_千元"]) || 0) : 0;
  const aDate = target ? String(target["決標公告日"] || "").trim() : "";

  document.getElementById("ecoEdBudget").value = bAmt;
  document.getElementById("ecoEdPurchase").value = pAmt;
  document.getElementById("ecoEdAwardAmt").value = aAmt;
  document.getElementById("ecoEdAwardDate").value = aDate;
  const hasAnyBidFilled = bAmt > 0 || pAmt > 0 || aAmt > 0 || Boolean(aDate);
  const rawExt = target ? String(target["後續擴充"] || "").trim() : "";
  document.getElementById("ecoEdExtension").value = (hasAnyBidFilled && rawExt === "否") ? "否" : "是";

  document.getElementById("ecoEdYear1Exec").value = execBrk.y1;
  document.getElementById("ecoEdYear2Exec").value = execBrk.y2;
  document.getElementById("ecoEdRemark").value = target ? (target["備註"] || "") : "";

  updateEcoModalYearLabels();
  ["ecoEdStatus", "ecoEdStartYr", "ecoEdEndYr", "ecoEdBranch", "ecoEdPlanName", "ecoEdYear1Appr", "ecoEdYear2Appr"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });

  document.getElementById("btnDeleteV2EcoCase")?.classList.toggle("hidden", !(target && isAdmin));
  document.getElementById("modalV2EcoEdit").classList.remove("hidden");
}

function onEcoStartYrInput() {
  const s = parseInt(document.getElementById("ecoEdStartYr")?.value, 10);
  if (s >= 100 && s <= 150 && document.getElementById("ecoEdEndYr")) {
    const e = s + 1;
    document.getElementById("ecoEdEndYr").value = e;
    if (document.getElementById("ecoEdStatus")) {
      document.getElementById("ecoEdStatus").value = getEcoTodayStr() > `${e + 1911}-12-31` ? "已結案" : "執行中";
    }
  }
  updateEcoModalYearLabels();
}

async function saveV2EcoCase() {
  const ecoUid = document.getElementById("ecoEdUid").value.trim();
  const startYr = parseInt(document.getElementById("ecoEdStartYr").value, 10);
  const endRaw = parseInt(document.getElementById("ecoEdEndYr").value, 10);
  const endYr = (endRaw && endRaw >= startYr) ? endRaw : startYr;
  if (!startYr || endYr < startYr) return alert("請輸入正確的起迄年度");

  const isSingleYear = startYr === endYr;
  const a1 = parseFloat(document.getElementById("ecoEdYear1Appr").value) || 0;
  const a2 = isSingleYear ? 0 : (parseFloat(document.getElementById("ecoEdYear2Appr").value) || 0);
  const y1 = parseFloat(document.getElementById("ecoEdYear1Exec").value) || 0;
  const y2 = isSingleYear ? 0 : (parseFloat(document.getElementById("ecoEdYear2Exec").value) || 0);

  const record = {
    eco_uid: ecoUid,
    "執行狀態": document.getElementById("ecoEdStatus")?.value || "執行中",
    "年度": isSingleYear ? `${startYr}` : `${startYr}-${endYr}`,
    "起年": startYr, "迄年": endYr,
    "分署別": document.getElementById("ecoEdBranch").value.trim(),
    "計畫名稱": document.getElementById("ecoEdPlanName").value.trim(),
    "執行廠商": document.getElementById("ecoEdVendor").value.trim(),
    "第1年核定經費_千元": a1, "第2年核定經費_千元": a2, "核定經費_千元": Number((a1 + a2).toFixed(3)),
    "預算金額_千元": parseFloat(document.getElementById("ecoEdBudget").value) || 0,
    "採購金額_千元": parseFloat(document.getElementById("ecoEdPurchase").value) || 0,
    "決標金額_千元": parseFloat(document.getElementById("ecoEdAwardAmt").value) || 0,
    "決標公告日": document.getElementById("ecoEdAwardDate").value.trim(),
    "後續擴充": document.getElementById("ecoEdExtension").value || "是",
    "第1年執行經費_千元": y1, "第2年執行經費_千元": y2, "執行經費_千元": Number((y1 + y2).toFixed(3)),
    "第1年工程編號": document.getElementById("ecoEdYear1Code").value.trim(),
    "第2年工程編號": isSingleYear ? "" : document.getElementById("ecoEdYear2Code").value.trim(),
    "備註": document.getElementById("ecoEdRemark").value.trim()
  };

  const btn = document.getElementById("btnSaveV2EcoCase");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_save_ecological_case", role: v2AuthState.role, branch: v2AuthState.branch, passcode: v2AuthState.passcode, record })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2EcoEdit").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else alert(json.message || "儲存失敗");
  } catch (err) {
    alert("儲存失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存"; }
  }
}

async function deleteV2EcoCase() {
  const ecoUid = document.getElementById("ecoEdUid").value.trim();
  if (!ecoUid || !canManageEcologicalAll() || !confirm(`確定刪除生態檢核案件 ${ecoUid}？`)) return;
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_delete_ecological_case", passcode: v2AuthState.passcode, eco_uid: ecoUid })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2EcoEdit").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else alert(json.message || "刪除失敗");
  } catch (err) { alert("刪除失敗：" + err.message); }
}

function openV2EcoBatchPeriodModal() {
  if (!canManageEcologicalAll()) return alert("僅「系統管理」可執行此操作");
  ensureV2EcologicalModals();
  const sYr = new Date().getFullYear() - 1911;
  document.getElementById("ecoBatchStartYr").value = sYr;
  document.getElementById("ecoBatchEndYr").value = sYr + 1;
  renderEcoBatchPeriodTable();
  document.getElementById("modalV2EcoBatch").classList.remove("hidden");
}

function renderEcoBatchPeriodTable() {
  const sYr = parseInt(document.getElementById("ecoBatchStartYr")?.value, 10) || 115;
  const eYr = parseInt(document.getElementById("ecoBatchEndYr")?.value, 10) || (sYr + 1);
  const period = sYr === eYr ? `${sYr}` : `${sYr}-${eYr}`;
  const tbody = document.getElementById("tbodyEcoBatch");
  if (!tbody) return;
  tbody.innerHTML = V2_ECO_TEN_BRANCHES.map(k => {
    const brName = `第${k}河川分署`;
    const exist = (v2EcologicalCases || []).find(x => String(x["年度"]).trim() === period && v2NormBranch(x["分署別"]) === k);
    const apprBrk = exist ? getEcoApprovedBreakdown(exist) : { a1: 0, a2: 0 };
    const codeBrk = exist ? getEcoCodeBreakdown(exist) : { c1: "" };
    return `
      <tr>
        <td class="p-1.5 font-bold text-center whitespace-nowrap">${brName}</td>
        <td class="p-1.5"><input data-bkey="${k}" data-field="plan" type="text" value="${escapeHtmlAttr(exist ? exist["計畫名稱"] : `${period}年${brName}轄區生態檢核委託服務案(開口合約)`)}" class="w-full border border-[#1D3557]/20 rounded px-2 py-1" /></td>
        <td class="p-1.5"><input data-bkey="${k}" data-field="appr1" type="number" step="0.001" value="${apprBrk.a1}" class="w-24 border border-[#1D3557]/20 rounded px-2 py-1 text-right font-mono" /></td>
        <td class="p-1.5"><input data-bkey="${k}" data-field="appr2" type="number" step="0.001" value="${apprBrk.a2}" class="w-24 border border-[#1D3557]/20 rounded px-2 py-1 text-right font-mono" /></td>
        <td class="p-1.5"><input data-bkey="${k}" data-field="code1" type="text" value="${escapeHtmlAttr(codeBrk.c1)}" placeholder="第1年編號" class="w-32 border border-[#1D3557]/20 rounded px-2 py-1 font-mono" /></td>
      </tr>
    `;
  }).join("");
}

async function submitV2EcoBatchPeriod() {
  const sYr = parseInt(document.getElementById("ecoBatchStartYr")?.value, 10);
  const eYr = parseInt(document.getElementById("ecoBatchEndYr")?.value, 10) || sYr;
  if (!sYr || eYr < sYr) return alert("請輸入正確的起迄年度");
  const period = sYr === eYr ? `${sYr}` : `${sYr}-${eYr}`;
  const records = V2_ECO_TEN_BRANCHES.map(k => {
    const getV = f => document.querySelector(`#tbodyEcoBatch input[data-bkey="${k}"][data-field="${f}"]`)?.value.trim() || "";
    const a1 = parseFloat(getV("appr1")) || 0;
    const a2 = sYr === eYr ? 0 : (parseFloat(getV("appr2")) || 0);
    return {
      "年度": period, "起年": sYr, "迄年": eYr, "分署別": `${k}分署`, "計畫名稱": getV("plan"),
      "第1年核定經費_千元": a1, "第2年核定經費_千元": a2, "核定經費_千元": Number((a1 + a2).toFixed(3)),
      "後續擴充": "是", "第1年工程編號": getV("code1"), "第2年工程編號": ""
    };
  });
  const btn = document.getElementById("btnSubmitEcoBatch");
  if (btn) { btn.disabled = true; btn.textContent = "寫入中..."; }
  try {
    const res = await fetch(GAS_API_URL, { method: "POST", body: JSON.stringify({ action: "v2_batch_import_ecological", passcode: v2AuthState.passcode, records }) });
    const json = await res.json();
    if (json.status === "success") { document.getElementById("modalV2EcoBatch").classList.add("hidden"); alert(json.message); await loadV2LifecycleData(false); }
    else alert(json.message || "寫入失敗");
  } catch (err) { alert("寫入失敗：" + err.message); } finally { if (btn) { btn.disabled = false; btn.textContent = "確認寫入 10 分署案件"; } }
}

function triggerV2EcoExcelInput() {
  if (!canManageEcologicalAll()) return alert("僅「系統管理」可匯入 Excel");
  document.getElementById("fileV2EcoExcel")?.click();
}

function handleV2EcoExcelSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const periodMatch = file.name.match(/(1\d{2})\s*[-~～]\s*(1\d{2})/);
  const defaultStart = periodMatch ? parseInt(periodMatch[1], 10) : (new Date().getFullYear() - 1911);
  const defaultEnd = periodMatch ? parseInt(periodMatch[2], 10) : (defaultStart + 1);
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
    const parsed = [];
    wb.SheetNames.forEach(sheetName => {
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      let headerIdx = -1;
      for (let i = 0; i < Math.min(10, matrix.length); i++) {
        const rowClean = (matrix[i] || []).map(cleanExcelHeaderText);
        if (rowClean.some(h => h.includes("單位") || h.includes("分署")) && rowClean.some(h => h.includes("計畫名稱") || h.includes("案件名稱") || h.includes("案名"))) { headerIdx = i; break; }
      }
      if (headerIdx === -1) return;
      const r1 = matrix[headerIdx] || [], r2 = matrix[headerIdx + 1] || [], headers = [];
      for (let c = 0; c < Math.max(r1.length, r2.length); c++) headers.push(cleanExcelHeaderText(r2[c]) || cleanExcelHeaderText(r1[c]));
      const findCol = fn => headers.findIndex(fn);
      const cBr = findCol(h => h.includes("單位") || h.includes("分署")), cPlan = findCol(h => h.includes("計畫名稱") || h.includes("案件名稱") || h.includes("案名"));
      const cAgree = findCol(h => h.includes("同意經費") || h.includes("核定經費")), cReq = findCol(h => h.includes("經費需求"));
      const cVendor = findCol(h => h.includes("廠商")), cCode = findCol(h => h.includes("工程編號")), cRemark = findCol(h => h.includes("備註"));
      for (let r = headerIdx + 1; r < matrix.length; r++) {
        const row = matrix[r] || [], brRaw = normalizeText(row[cBr]), planRaw = normalizeText(row[cPlan]);
        if (!brRaw || !planRaw || ["合計", "小計", "總計", "意見"].some(k => brRaw.includes(k) || planRaw.includes(k))) continue;
        const mPeriod = planRaw.match(/(1\d{2})\s*[-~～]\s*(1\d{2})/), mSingle = !mPeriod ? planRaw.match(/(1\d{2})年/) : null;
        const sYr = mPeriod ? parseInt(mPeriod[1], 10) : (mSingle ? parseInt(mSingle[1], 10) : defaultStart);
        const eYr = mPeriod ? parseInt(mPeriod[2], 10) : (mSingle ? sYr : defaultEnd);
        let amt = cAgree >= 0 ? parseExcelNumber(row[cAgree]) : 0;
        if (amt <= 0 && cReq >= 0) amt = parseExcelNumber(row[cReq]);
        parsed.push({
          "年度": sYr === eYr ? `${sYr}` : `${sYr}-${eYr}`, "起年": sYr, "迄年": eYr, "分署別": brRaw, "計畫名稱": planRaw,
          "執行廠商": cVendor >= 0 ? normalizeText(row[cVendor]) : "", "第1年核定經費_千元": amt, "第2年核定經費_千元": 0, "核定經費_千元": amt,
          "後續擴充": "是", "第1年工程編號": cCode >= 0 ? normalizeText(row[cCode]) : "", "第2年工程編號": "", "備註": cRemark >= 0 ? normalizeText(row[cRemark]) : ""
        });
      }
    });
    if (!parsed.length) return alert("未解析到符合格式的生態檢核案件");
    v2PendingEcoImport = parsed;
    ensureV2EcologicalModals();
    document.getElementById("lblV2EcoImportSummary").textContent = `《${file.name}》共解析 ${parsed.length} 筆`;
    document.getElementById("tbodyV2EcoImport").innerHTML = parsed.map(r => `<tr><td class="p-1.5 text-center font-mono">${escapeHtmlAttr(r["年度"])}</td><td class="p-1.5 text-center font-bold">${escapeHtmlAttr(r["分署別"])}</td><td class="p-1.5">${escapeHtmlAttr(r["計畫名稱"])}</td><td class="p-1.5 text-right font-mono">${r["核定經費_千元"].toLocaleString()}</td></tr>`).join("");
    document.getElementById("modalV2EcoImport").classList.remove("hidden");
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}

async function confirmV2EcoExcelImport() {
  if (!v2PendingEcoImport.length) return;
  const btn = document.getElementById("btnConfirmV2EcoImport");
  if (btn) { btn.disabled = true; btn.textContent = "寫入中..."; }
  try {
    const res = await fetch(GAS_API_URL, { method: "POST", body: JSON.stringify({ action: "v2_batch_import_ecological", passcode: v2AuthState.passcode, records: v2PendingEcoImport }) });
    const json = await res.json();
    if (json.status === "success") { document.getElementById("modalV2EcoImport").classList.add("hidden"); alert(json.message); await loadV2LifecycleData(false); }
    else alert(json.message || "匯入失敗");
  } catch (err) { alert("匯入失敗：" + err.message); } finally { if (btn) { btn.disabled = false; btn.textContent = "確認匯入"; } }
}

function exportEcologicalExcel() {
  const rows = getFilteredEcologicalRows();
  if (!rows.length) return alert("目前無可匯出的生態檢核案件");
  const data = rows.map(c => {
    const { startYr, endYr, isSingleYear } = parseEcoStartEndFromRecord(c);
    const life = getEcoLifecycleInfo(c);
    const { a1, a2 } = getEcoApprovedBreakdown(c);
    const { y1, y2 } = getEcoExecBreakdown(c);
    const { c1, c2 } = getEcoCodeBreakdown(c);
    return {
      "執行狀態": life.status, "自動結案日": life.closeDate, "年度": isSingleYear ? `${startYr}` : `${startYr}-${endYr}`,
      "分署別": v2DisplayBranch(c["分署別"]), "案名": c["計畫名稱"] || "", "執行廠商": c["執行廠商"] || "",
      "第1年工程編號": c1, "第2年工程編號": isSingleYear ? "" : c2,
      "第1年核定經費_千元": a1, "第2年核定經費_千元": isSingleYear ? 0 : a2,
      "預算金額_千元": parseFloat(c["預算金額_千元"]) || 0, "採購金額_千元": parseFloat(c["採購金額_千元"]) || 0,
      "決標金額_千元": parseFloat(c["決標金額_千元"]) || 0, "決標公告日": String(c["決標公告日"] || "").trim(),
      "是否訂有後續擴充": String(c["後續擴充"] || "").trim() === "否" ? "否" : "是",
      "第1年執行經費_千元": y1, "第2年執行經費_千元": isSingleYear ? 0 : y2, "備註": c["備註"] || ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "生態檢核案件");
  XLSX.writeFile(wb, `治水雲庫V2_生態檢核_${currentEcoSubTab === "closed" ? "已結案歷史檔" : "執行中案件"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function ensureV2EcologicalModals() {
  if (!document.getElementById("modalV2EcoEdit")) {
    const branchOpts = V2_BRANCH_KEYS.map(b => `<option value="${v2DisplayBranch(b)}">${v2DisplayBranch(b)}</option>`).join("");
    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalV2EcoEdit" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3 text-xs">
          <div class="flex items-center justify-between border-b border-[#1D3557]/15 pb-2">
            <h2 id="ecoEdModalTitle" class="text-base font-bold text-[#1D3557]">編輯生態檢核案件</h2>
            <button type="button" onclick="document.getElementById('modalV2EcoEdit').classList.add('hidden')" class="text-xs font-bold text-[#1D3557]/60">✕</button>
          </div>
          <input type="hidden" id="ecoEdUid" />
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1">
              <span class="font-bold text-[#004E89]">1. 基本資料</span>
              <div class="flex items-center gap-2 text-[11px]">
                <span class="text-[#1D3557]/65">結案基準日：<strong id="lblEcoAutoCloseHint" class="font-mono text-[#004E89]"></strong></span>
                <select id="ecoEdStatus" class="border border-[#1D3557]/25 rounded px-2 py-0.5 bg-[#FAF3E0] font-bold text-[#1D3557]"><option value="執行中">執行中</option><option value="已結案">已結案</option></select>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2.5">
              <div><label class="font-bold block mb-1">第1年年度 (民國)</label><input id="ecoEdStartYr" type="number" oninput="onEcoStartYrInput()" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1">第2年年度 (單年度填同上)</label><input id="ecoEdEndYr" type="number" oninput="updateEcoModalYearLabels()" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1">分署別</label><select id="ecoEdBranch" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1">${branchOpts}</select></div>
            </div>
            <div><label class="font-bold block mb-1">案名</label><input id="ecoEdPlanName" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" /></div>
            <div><label class="font-bold block mb-1 text-[#004E89]">執行廠商</label><input id="ecoEdVendor" type="text" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1" /></div>
            <div class="grid grid-cols-2 gap-2.5">
              <div><label id="lblEcoYear1Code" class="font-bold block mb-1">第1年工程編號</label><input id="ecoEdYear1Code" type="text" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono" /></div>
              <div id="wrapEcoYear2Code"><label id="lblEcoYear2Code" class="font-bold block mb-1 text-[#004E89]">第2年工程編號</label><input id="ecoEdYear2Code" type="text" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono" /></div>
            </div>
          </div>
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">2. 核定經費（單位：千元）</div>
            <div class="grid grid-cols-2 gap-2.5">
              <div><label id="lblEcoYear1Appr" class="font-bold block mb-1">第1年核定經費</label><input id="ecoEdYear1Appr" type="number" step="0.001" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
              <div id="wrapEcoYear2Appr"><label id="lblEcoYear2Appr" class="font-bold block mb-1 text-[#004E89]">第2年核定經費</label><input id="ecoEdYear2Appr" type="number" step="0.001" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
            </div>
          </div>
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">3. 招(決)標資訊（單位：千元）</div>
            <div class="grid grid-cols-3 gap-2.5">
              <div><label class="font-bold block mb-1">預算金額</label><input id="ecoEdBudget" type="number" step="0.001" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#004E89]">採購金額</label><input id="ecoEdPurchase" type="number" step="0.001" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#ED6D35]">決標金額</label><input id="ecoEdAwardAmt" type="number" step="0.001" class="w-full border border-[#ED6D35]/45 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              <div><label class="font-bold block mb-1 text-[#004E89]">決標公告日</label><input id="ecoEdAwardDate" type="date" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#ED6D35]">是否訂有後續擴充</label><select id="ecoEdExtension" class="w-full border border-[#ED6D35]/45 bg-white rounded px-2 py-1 font-bold text-[#1D3557]"><option value="是" selected>是</option><option value="否">否</option></select></div>
            </div>
          </div>
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">4. 執行情形（單位：千元）</div>
            <div class="grid grid-cols-2 gap-2.5">
              <div><label id="lblEcoYear1Exec" class="font-bold block mb-1">第1年執行經費</label><input id="ecoEdYear1Exec" type="number" step="0.001" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
              <div id="wrapEcoYear2Exec"><label id="lblEcoYear2Exec" class="font-bold block mb-1 text-[#004E89]">第2年執行經費</label><input id="ecoEdYear2Exec" type="number" step="0.001" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
            </div>
          </div>
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-1.5">
            <label class="font-bold block text-[#004E89]">5. 備註</label>
            <textarea id="ecoEdRemark" rows="2" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1"></textarea>
          </div>
          <div class="flex items-center justify-between pt-1">
            <button type="button" id="btnDeleteV2EcoCase" onclick="deleteV2EcoCase()" class="hidden px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded font-bold">刪除此筆</button>
            <div class="flex gap-2 ml-auto">
              <button type="button" onclick="document.getElementById('modalV2EcoEdit').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button>
              <button type="button" id="btnSaveV2EcoCase" onclick="saveV2EcoCase()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">儲存</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(d.firstElementChild);
  }
  if (!document.getElementById("modalV2EcoBatch")) {
    const d = document.createElement("div");
    d.innerHTML = `<div id="modalV2EcoBatch" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4"><div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto space-y-3 text-xs"><div class="flex items-center justify-between border-b border-[#1D3557]/15 pb-2"><h2 class="text-base font-bold text-[#1D3557]">一次建立 2 年 1 期一～十分署生態檢核案件表</h2><button type="button" onclick="document.getElementById('modalV2EcoBatch').classList.add('hidden')" class="text-xs font-bold">✕</button></div><div class="flex items-center gap-3 bg-[#FAF3E0] border border-[#1D3557]/15 rounded p-2.5"><label class="font-bold">期別起始年度：</label><input id="ecoBatchStartYr" type="number" onchange="document.getElementById('ecoBatchEndYr').value = parseInt(this.value,10)+1; renderEcoBatchPeriodTable();" class="w-20 border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono font-bold" /><span>至</span><input id="ecoBatchEndYr" type="number" onchange="renderEcoBatchPeriodTable()" class="w-20 border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono font-bold" /></div><div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded"><table class="w-full text-xs border-collapse"><thead><tr><th class="p-2 text-center">分署別</th><th class="p-2 text-left">案名</th><th class="p-2 text-right">第1年核定(千元)</th><th class="p-2 text-right">第2年核定(千元)</th><th class="p-2 text-center">第1年工程編號</th></tr></thead><tbody id="tbodyEcoBatch" class="divide-y divide-slate-200"></tbody></table></div><div class="flex justify-end gap-2 pt-2"><button type="button" onclick="document.getElementById('modalV2EcoBatch').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button><button type="button" id="btnSubmitEcoBatch" onclick="submitV2EcoBatchPeriod()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">確認寫入 10 分署案件</button></div></div></div>`;
    document.body.appendChild(d.firstElementChild);
  }
  if (!document.getElementById("modalV2EcoImport")) {
    const d = document.createElement("div");
    d.innerHTML = `<div id="modalV2EcoImport" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4"><div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-3xl space-y-3 text-xs"><h2 class="text-base font-bold text-[#ED6D35]">生態檢核案件 Excel 匯入預覽</h2><p id="lblV2EcoImportSummary" class="font-bold text-[#1D3557]"></p><div class="max-h-72 overflow-y-auto bg-white border border-[#1D3557]/15 rounded"><table class="w-full text-xs border-collapse"><thead><tr><th class="p-2 text-center">年度</th><th class="p-2 text-center">分署別</th><th class="p-2 text-left">案名</th><th class="p-2 text-right">核定經費(千元)</th></tr></thead><tbody id="tbodyV2EcoImport" class="divide-y divide-slate-200"></tbody></table></div><div class="flex justify-end gap-2 pt-2"><button type="button" onclick="document.getElementById('modalV2EcoImport').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button><button type="button" id="btnConfirmV2EcoImport" onclick="confirmV2EcoExcelImport()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">確認匯入</button></div></div></div>`;
    document.body.appendChild(d.firstElementChild);
  }
}