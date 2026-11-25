/**
 * 治水雲庫 V2 — 年度核定案件 ＋ 雙軌分權狀態管理
 */

let v2ActiveCases = [];
let v2BudgetMap = {}; // { case_uid: budgetRecord }
let v2CurrentMonth = "";
let v2LifecycleLoaded = false;
let branchSession = { branch: "", passcode: "" };
let v2PendingApprovalImport = [];

const V2_BRANCH_KEYS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "水規分署"];
const V2_PURE_ENG_CATEGORIES = ["工程", "維修改善工程"];

function v2IsPureEngineering(c) {
  return V2_PURE_ENG_CATEGORIES.includes(String(c["類別"] || "").trim());
}

function v2NormBranch(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.includes("水規")) return "水規分署";
  return s.replace(/^第/, "").replace(/河川分署$/, "").replace(/分署$/, "").trim();
}

function v2DisplayBranch(raw) {
  const k = v2NormBranch(raw);
  if (!k) return "-";
  return k === "水規分署" ? "水規分署" : `${k}分署`;
}

function switchLoginRole(role) {
  const isB = role === "branch";
  const btnA = document.getElementById("btnRoleAdmin");
  const btnB = document.getElementById("btnRoleBranch");
  if (btnA && btnB) {
    btnA.classList.toggle("bg-[#ED6D35]", !isB);
    btnA.classList.toggle("text-white", !isB);
    btnA.classList.toggle("text-[#1D3557]", isB);
    btnB.classList.toggle("bg-[#004E89]", isB);
    btnB.classList.toggle("text-white", isB);
    btnB.classList.toggle("text-[#1D3557]", !isB);
  }
  document.getElementById("adminLoginPanel")?.classList.toggle("hidden", isB);
  document.getElementById("branchLoginPanel")?.classList.toggle("hidden", !isB);
}

async function submitBranchLogin() {
  const branch = document.getElementById("selLoginBranch").value;
  const pass = document.getElementById("inputBranchPass").value.trim();
  if (!branch || !pass) return alert("請選擇分署並輸入通行碼");
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verify_branch", branch, passcode: pass })
    });
    const json = await res.json();
    if (json.status === "success") {
      if (adminPasscode && typeof logoutAdmin === "function") logoutAdmin();
      branchSession = { branch: json.branch, passcode: pass };
      closeAdminModal();
      syncV2AuthUI();
      alert(`${v2DisplayBranch(branchSession.branch)} 登入成功`);
    } else {
      alert(json.message || "通行碼錯誤");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  }
}

function logoutBranch() {
  branchSession = { branch: "", passcode: "" };
  const inp = document.getElementById("inputBranchPass");
  if (inp) inp.value = "";
  syncV2AuthUI();
}

function syncV2AuthUI() {
  const isAdmin = Boolean(adminPasscode);
  const isBranch = Boolean(branchSession.branch && branchSession.passcode);
  if (isAdmin && isBranch) branchSession = { branch: "", passcode: "" };

  document.getElementById("menuAdminLogin")?.classList.toggle("hidden", isAdmin || Boolean(branchSession.branch));
  document.getElementById("menuBranchLogout")?.classList.toggle("hidden", !branchSession.branch);
  document.getElementById("adminIndicatorDot")?.classList.toggle("hidden", !(isAdmin || Boolean(branchSession.branch)));

  const lblB = document.getElementById("lblBranchLogoutText");
  if (lblB && branchSession.branch) lblB.textContent = `${v2DisplayBranch(branchSession.branch)} 登出`;

  const badge = document.getElementById("v2AuthStatusBadge");
  if (badge) {
    if (isAdmin) badge.innerHTML = `<span class="px-2 py-0.5 rounded bg-[#ED6D35]/15 text-[#ED6D35]">署端管理者</span>`;
    else if (branchSession.branch) badge.innerHTML = `<span class="px-2 py-0.5 rounded bg-[#004E89]/15 text-[#004E89]">${v2DisplayBranch(branchSession.branch)}</span>`;
    else badge.textContent = "檢視模式";
  }

  renderApprovalView();
  if (typeof renderBudgetView === "function") renderBudgetView();
}

async function loadV2LifecycleData(forceNotify) {
  ensureV2ApprovalModals();
  const container = document.getElementById("viewApproval");
  if (container && !v2LifecycleLoaded) {
    container.innerHTML = `<div class="py-10 text-center text-xs text-[#1D3557]/60">載入中...</div>`;
  }
  try {
    const res = await fetch(`${GAS_API_URL}?type=lifecycle`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.message || "讀取失敗");

    v2ActiveCases = json.active || json.approved || [];
    v2BudgetMap = {};
    (json.budget || []).forEach(b => { v2BudgetMap[b.case_uid] = b; });
    v2CurrentMonth = json.currentMonth || "";
    v2LifecycleLoaded = true;

    if (typeof initV2BudgetData === "function") initV2BudgetData(json);

    const activeList = v2ActiveCases.filter(c => c.lifecycle_stage !== "撤案" && c.lifecycle_stage !== "已結案入庫");
    const pureEngCount = activeList.filter(v2IsPureEngineering).length;

    const navApproved = document.getElementById("navBadgeApproved");
    const navPureEng = document.getElementById("navBadgePureEng");
    const navBudget = document.getElementById("navBadgeBudget");
    const pCnt = document.getElementById("lblStage2ProgressCount");

    if (navApproved) navApproved.textContent = activeList.length;
    if (navPureEng) navPureEng.textContent = pureEngCount;
    if (navBudget) navBudget.textContent = activeList.length;
    if (pCnt) pCnt.textContent = pureEngCount;

    renderApprovalView();
    if (typeof renderBudgetView === "function") renderBudgetView();
    if (forceNotify) alert(`資料已更新（共 ${v2ActiveCases.length} 筆）`);
  } catch (err) {
    if (container) container.innerHTML = `<div class="py-8 text-center text-xs text-rose-600">載入失敗：${escapeHtmlAttr(err.message)}</div>`;
  }
}

function getApprovalFilters() {
  return {
    stage: document.getElementById("selAppStage")?.value || "ACTIVE",
    year: document.getElementById("selAppYear")?.value || "ALL",
    phase: document.getElementById("selAppPhase")?.value || "ALL",
    branch: document.getElementById("selAppBranch")?.value || "ALL",
    kw: normalizeText(document.getElementById("txtAppKeyword")?.value || "").toLowerCase()
  };
}

function renderApprovalView() {
  const container = document.getElementById("viewApproval");
  if (!container) return;

  const prev = getApprovalFilters();
  const isAdmin = Boolean(adminPasscode);
  const activeList = v2ActiveCases.filter(c => c.lifecycle_stage !== "撤案" && c.lifecycle_stage !== "已結案入庫");
  const pureEngList = activeList.filter(v2IsPureEngineering);
  const otherList = activeList.filter(c => !v2IsPureEngineering(c));
  const totalBudgetYi = activeList.reduce((acc, c) => acc + (parseFloat(c["核定經費_千元"]) || 0), 0) / 100000;

  const years = Array.from(new Set(v2ActiveCases.map(c => String(c["核定年度"])).filter(Boolean))).sort().reverse();

  container.innerHTML = `
    <!-- 摘要卡 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2.5 text-xs">
      <div class="bg-[#ED6D35] text-white rounded-md px-3 py-2 shadow-xs">
        <div class="text-[11px] text-white/90">核定執行案件</div>
        <div class="text-base font-bold mt-0.5">${activeList.length.toLocaleString()} 筆</div>
      </div>
      <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-md px-3 py-2">
        <div class="text-[11px] text-[#1D3557]/75">純工程管考案件</div>
        <div class="text-base font-bold text-[#004E89] mt-0.5">${pureEngList.length.toLocaleString()} 筆</div>
      </div>
      <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-md px-3 py-2">
        <div class="text-[11px] text-[#1D3557]/75">設計 / 用地 / 補助</div>
        <div class="text-base font-bold text-[#1D3557] mt-0.5">${otherList.length.toLocaleString()} 筆</div>
      </div>
      <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-md px-3 py-2">
        <div class="text-[11px] text-[#1D3557]/75">核定總預算</div>
        <div class="text-base font-bold text-[#ED6D35] mt-0.5">${totalBudgetYi.toFixed(2)} 億元</div>
      </div>
    </div>

    <!-- 篩選與操作列 -->
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <select id="selAppStage" onchange="renderApprovalTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ACTIVE">執行中</option>
          <option value="撤案">已撤案</option>
          <option value="ALL">全部狀態</option>
        </select>
        <select id="selAppYear" onchange="renderApprovalTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部年度</option>
          ${years.map(y => `<option value="${y}">${y} 年</option>`).join("")}
        </select>
        <select id="selAppPhase" onchange="renderApprovalTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部梯次</option>
          <option value="先期">先期</option>
          <option value="期中">期中</option>
        </select>
        <select id="selAppBranch" onchange="renderApprovalTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部分署</option>
          ${V2_BRANCH_KEYS.map(b => `<option value="${b}">${v2DisplayBranch(b)}</option>`).join("")}
        </select>
        <input id="txtAppKeyword" type="text" oninput="renderApprovalTableBody()" placeholder="案名 / 編號 / 縣市 / 溪別" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white w-48" />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        ${isAdmin ? `
          <button type="button" onclick="openV2ApprovalCreateModal()" class="px-3 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#1D3557] border border-[#1D3557]/25 font-bold transition">＋ 新增案件</button>
          <button type="button" onclick="openV2PullFromMasterModal()" class="px-3 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/35 font-bold transition">帶入總庫年度</button>
          <button type="button" onclick="triggerV2ApprovalExcelInput()" class="px-3 py-1 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold transition">匯入核定 Excel</button>
        ` : `<button type="button" onclick="openAdminModal(); switchLoginRole('admin');" class="px-3 py-1 rounded bg-[#ED6D35] text-white font-bold">署端登入</button>`}
      </div>
    </div>

    <!-- 主表格（欄位順序：年度、性質/類別、分署別、案件名稱/縣市.溪別、核定經費、可支用經費、工程編號、地方關切、編輯） -->
    <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
      <table class="w-full text-left border-collapse text-xs">
        <thead class="sticky top-0 z-10">
          <tr>
            <th class="px-2 py-2 text-center whitespace-nowrap">年度</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">性質 / 類別</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">分署別</th>
            <th class="px-2 py-2 min-w-[230px]">案件名稱 / 縣市.溪別</th>
            <th class="px-2 py-2 text-right whitespace-nowrap">核定經費</th>
            <th class="px-2 py-2 text-right whitespace-nowrap">可支用經費</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">工程編號</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">地方關切</th>
            ${isAdmin ? `<th class="px-2 py-2 text-center whitespace-nowrap">編輯</th>` : ""}
          </tr>
        </thead>
        <tbody id="tbodyApproval" class="divide-y divide-slate-200"></tbody>
      </table>
    </div>
  `;

  if (document.getElementById("selAppStage")) document.getElementById("selAppStage").value = prev.stage;
  if (document.getElementById("selAppYear") && (prev.year === "ALL" || years.includes(prev.year))) document.getElementById("selAppYear").value = prev.year;
  if (document.getElementById("selAppPhase")) document.getElementById("selAppPhase").value = prev.phase;
  if (document.getElementById("selAppBranch")) document.getElementById("selAppBranch").value = prev.branch;
  if (document.getElementById("txtAppKeyword")) document.getElementById("txtAppKeyword").value = prev.kw;

  renderApprovalTableBody();
}

function getFilteredApprovalRows() {
  const { stage, year, phase, branch, kw } = getApprovalFilters();
  return v2ActiveCases.filter(c => {
    if (stage === "ACTIVE") {
      if (c.lifecycle_stage === "撤案" || c.lifecycle_stage === "已結案入庫") return false;
    } else if (stage !== "ALL") {
      if (c.lifecycle_stage !== stage) return false;
    }
    if (year !== "ALL" && String(c["核定年度"]) !== year) return false;
    if (phase !== "ALL" && c["核定梯次"] !== phase) return false;
    if (branch !== "ALL" && v2NormBranch(c["分署"]) !== branch) return false;
    if (kw) {
      const hay = `${c.case_uid} ${c["案件名稱"]} ${c["工程編號"]} ${c["縣市"]} ${c["鄉鎮"] || ""} ${c["水系"]} ${c["溪別"] || ""} ${c["地方關切"]}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function startInlineCodeEdit(uid) {
  if (!adminPasscode) return;
  const c = v2ActiveCases.find(x => x.case_uid === uid);
  if (!c) return;
  const cell = document.getElementById(`codeCell_${uid}`);
  if (!cell) return;
  const curVal = (c["工程編號"] && c["工程編號"] !== "-") ? c["工程編號"] : "";
  cell.innerHTML = `
    <input id="inlineCodeInput_${uid}" type="text" value="${escapeHtmlAttr(curVal)}"
      placeholder="輸入後按 Enter"
      onkeydown="handleInlineCodeKey(event, '${uid}')"
      onblur="renderApprovalTableBody()"
      class="w-36 border border-[#ED6D35] rounded px-1.5 py-0.5 text-center font-mono text-xs bg-white text-[#1D3557] focus:outline-none" />
  `;
  const inp = document.getElementById(`inlineCodeInput_${uid}`);
  if (inp) { inp.focus(); inp.select(); }
}

async function handleInlineCodeKey(event, uid) {
  if (event.key === "Escape") {
    renderApprovalTableBody();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const inp = document.getElementById(`inlineCodeInput_${uid}`);
  if (!inp) return;
  const newCode = inp.value.trim();
  inp.disabled = true;

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_update_approval",
        passcode: adminPasscode,
        record: { case_uid: uid, "工程編號": newCode }
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      const target = v2ActiveCases.find(x => x.case_uid === uid);
      if (target) target["工程編號"] = newCode;
      renderApprovalView();
      if (typeof renderBudgetView === "function") renderBudgetView();
    } else {
      alert(json.message || "儲存失敗");
      renderApprovalTableBody();
    }
  } catch (err) {
    alert("儲存失敗：" + err.message);
    renderApprovalTableBody();
  }
}

function renderApprovalTableBody() {
  const tbody = document.getElementById("tbodyApproval");
  if (!tbody) return;
  const isAdmin = Boolean(adminPasscode);
  const rows = getFilteredApprovalRows();
  const colSpan = isAdmin ? 9 : 8;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-slate-400">無符合條件的案件</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((c, idx) => {
    const bg = idx % 2 === 0 ? "bg-[#F7F5F0]/75" : "bg-white";
    const isCancelled = c.lifecycle_stage === "撤案";

    const countyText = String(c["縣市"] || "").trim();
    const streamText = String(c["溪別"] || "").trim();
    const locSubText = [countyText, streamText].filter(Boolean).join(".") || "-";

    const hasCode = Boolean(c["工程編號"] && c["工程編號"] !== "-");
    const codeInner = hasCode
      ? `<span class="font-mono text-[#1D3557]">${escapeHtmlAttr(c["工程編號"])}</span>`
      : `<span class="text-[11px] text-rose-600 font-medium">待補登</span>`;

    const codeCellHtml = isAdmin
      ? `<div id="codeCell_${c.case_uid}" onclick="startInlineCodeEdit('${c.case_uid}')" title="點擊快速編輯工程編號" class="cursor-pointer px-1.5 py-0.5 rounded hover:bg-[#FAF3E0] inline-block transition">${codeInner}</div>`
      : `<div>${codeInner}</div>`;

    return `
      <tr class="${bg} hover:bg-[#FAF3E0]/70 ${isCancelled ? "opacity-55" : ""}">
        <td class="px-2 py-2 text-center whitespace-nowrap">
          <div class="font-bold text-[#1D3557]">${escapeHtmlAttr(c["核定年度"])}</div>
          <div class="text-[10px] ${c["核定梯次"] === "期中" ? "text-[#ED6D35]" : "text-[#1D3557]/55"}">${escapeHtmlAttr(c["核定梯次"] || "先期")}</div>
        </td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          <div>${escapeHtmlAttr(c["性質"] || "-")}</div>
          <div class="text-[10px] text-[#1D3557]/60">${escapeHtmlAttr(c["類別"] || "-")}</div>
        </td>
        <td class="px-2 py-2 text-center font-bold whitespace-nowrap">${v2DisplayBranch(c["分署"])}</td>
        <td class="px-2 py-2">
          <div class="font-bold text-[#1D3557]">
            ${escapeHtmlAttr(c["案件名稱"])}
            ${isCancelled ? `<span class="ml-1 px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 text-[10px]">撤案</span>` : ""}
          </div>
          <div class="text-[10px] text-[#1D3557]/65">${escapeHtmlAttr(locSubText)}</div>
        </td>
        <td class="px-2 py-2 text-right font-mono font-bold text-[#1D3557] whitespace-nowrap">${formatIntThousand(c["核定經費_千元"])}</td>
        <td class="px-2 py-2 text-right font-mono text-[#1D3557] whitespace-nowrap">${formatIntThousand(c["可支用經費_千元"])}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          ${codeCellHtml}
          ${c["核定文號"] ? `<div class="text-[10px] text-[#1D3557]/55">${escapeHtmlAttr(c["核定文號"])}</div>` : ""}
        </td>
        <td class="px-2 py-2 text-center">${c["地方關切"] ? `<span class="inline-block px-1.5 py-0.5 rounded bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/25 text-[11px]">${escapeHtmlAttr(c["地方關切"])}</span>` : "-"}</td>
        ${isAdmin ? `<td class="px-2 py-2 text-center whitespace-nowrap"><button type="button" onclick="openV2ApprovalEditModal('${c.case_uid}')" class="px-2.5 py-1 rounded bg-[#FAF3E0] hover:bg-[#ED6D35] text-[#1D3557] hover:text-white border border-[#1D3557]/20 font-bold text-[11px] transition">編輯</button></td>` : ""}
      </tr>
    `;
  }).join("");
}

function openV2PullFromMasterModal() {
  if (!adminPasscode) return alert("請先登入署端帳號");
  ensureV2ApprovalModals();
  const years = Array.from(new Set((allRecords || []).map(r => String(r["年度"])).filter(Boolean))).sort().reverse();
  const sel = document.getElementById("selV2PullMasterYear");
  sel.innerHTML = years.map(y => `<option value="${y}">${y} 年度</option>`).join("");
  if (years.includes("115")) sel.value = "115";
  updateV2PullMasterPreview();
  document.getElementById("modalV2PullMaster").classList.remove("hidden");
}

function updateV2PullMasterPreview() {
  const yr = document.getElementById("selV2PullMasterYear")?.value || "";
  const list = (allRecords || []).filter(r => String(r["年度"]) === yr && (parseFloat(r["核定經費_千元"]) || 0) > 0);
  const sumYi = list.reduce((acc, r) => acc + (parseFloat(r["核定經費_千元"]) || 0), 0) / 100000;
  const lbl = document.getElementById("lblV2PullMasterCount");
  if (lbl) lbl.textContent = `${yr} 年度共 ${list.length} 筆（合計 ${sumYi.toFixed(2)} 億元）`;
}

async function confirmV2PullFromMaster() {
  const yr = document.getElementById("selV2PullMasterYear")?.value || "";
  const phase = document.getElementById("selV2PullMasterPhase")?.value || "先期";
  const list = (allRecords || []).filter(r => String(r["年度"]) === yr && (parseFloat(r["核定經費_千元"]) || 0) > 0);
  if (!list.length) return alert("無可帶入案件");

  const payloadRecords = list.map(r => ({
    "核定年度": String(r["年度"]),
    "分署": r["分署"],
    "性質": typeof formatAppendixToNature === "function" ? formatAppendixToNature(r["附表"]) : r["附表"],
    "類別": normalizeCategoryName(r["類別"]),
    "縣市": r["縣市"],
    "鄉鎮": "",
    "水系": r["水系"],
    "溪別": "",
    "案件名稱": r["案件名稱"],
    "核定經費_千元": parseFloat(r["核定經費_千元"]) || 0,
    "可支用經費_千元": parseFloat(r["可支用經費_千元"]) || 0,
    "工程編號": r["工程編號"] || "",
    "座標點位": r["座標點位"] || "",
    "堤防_m": parseFloat(r["堤防_m"]) || 0,
    "護岸_m": parseFloat(r["護岸_m"]) || 0,
    "水門_座": Math.round(parseFloat(r["水門_座"]) || 0),
    "水防道路_m2": parseFloat(r["水防道路_m2"]) || 0,
    "其他結構說明": r["其他結構說明"] || "",
    "備註資訊": r["備註資訊"] || "",
    "地方關切": r["地方關切"] || ""
  }));

  const btn = document.getElementById("btnConfirmV2PullMaster");
  if (btn) { btn.disabled = true; btn.textContent = "寫入中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_import_approval",
        passcode: adminPasscode,
        phase,
        records: payloadRecords
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2PullMaster").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "帶入失敗");
    }
  } catch (err) {
    alert("帶入失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "確認帶入"; }
  }
}

function triggerV2ApprovalExcelInput() {
  if (!adminPasscode) return alert("請先登入署端帳號");
  const inp = document.getElementById("fileV2ApprovalExcel");
  if (!inp) return alert("找不到檔案上傳元件");
  inp.click();
}

function handleV2ApprovalExcelSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const yearMatch = file.name.match(/(1\d{2})/);
  const defaultYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear() - 1911);

  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
    const parsed = [];
    let fallbackCnt = 0;
    let concernCnt = 0;

    wb.SheetNames.forEach((sheetName, idx) => {
      const meta = wb.Workbook?.Sheets?.[idx];
      if (meta && meta.Hidden && meta.Hidden !== 0) return;
      if (sheetName.includes("總表") || sheetName.includes("目錄")) return;

      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      if (!matrix.length) return;

      let headerIdx = -1;
      for (let i = 0; i < Math.min(10, matrix.length); i++) {
        if ((matrix[i] || []).map(cleanExcelHeaderText).some(h => h.includes("案件名稱") || h.includes("工程名稱"))) {
          headerIdx = i; break;
        }
      }
      if (headerIdx === -1) return;

      let isDual = false;
      if (headerIdx + 1 < matrix.length) {
        const nextClean = (matrix[headerIdx + 1] || []).map(cleanExcelHeaderText);
        if (nextClean.some(h => ["核定經費", "可支用", "建造物名稱", "堤防", "護岸", "改善長度", "意見", "116年", "115年"].some(k => h.includes(k)))) {
          isDual = true;
        }
      }

      const r1 = matrix[headerIdx] || [];
      const r2 = isDual ? (matrix[headerIdx + 1] || []) : [];
      const headers = [];
      for (let c = 0; c < Math.max(r1.length, r2.length); c++) {
        const h1 = cleanExcelHeaderText(r1[c]);
        const h2 = cleanExcelHeaderText(r2[c]);
        headers.push({ comb: h2 || h1, h1, h2 });
      }
      const findCol = (preds, excludeIndices = []) => {
        for (const p of preds) {
          for (let c = 0; c < headers.length; c++) {
            if (excludeIndices.includes(c)) continue;
            if (p(headers[c])) return c;
          }
        }
        return -1;
      };

      const cYear = findCol([h => h.comb === "年度"]);
      const cCat = findCol([h => h.comb === "類別"]);
      const cApp = findCol([h => h.comb === "附表"]);
      const cBranch = findCol([h => ["分署", "分署別", "執行單位"].includes(h.comb)]);
      const cCounty = findCol([h => h.comb === "縣市" || h.comb === "縣市別"]);
      const cTown = findCol([
        h => ["鄉鎮", "鄉鎮市區", "鄉鎮別", "鄉鎮市", "行政區"].includes(h.comb),
        h => h.comb.includes("鄉鎮") || h.h1.includes("鄉鎮")
      ], [cCounty]);

      const cWater = findCol([
        h => h.comb === "水系" || h.h1 === "水系" || h.h2 === "水系",
        h => h.comb.includes("水系") && !h.comb.includes("溪別")
      ]);
      const cStream = findCol([
        h => h.comb === "溪別" || h.h1 === "溪別" || h.h2 === "溪別",
        h => h.comb.includes("溪別") || h.h1.includes("溪別"),
        h => ["排水名稱", "海岸名稱", "河川名稱"].includes(h.comb)
      ], [cWater]);

      const cName = findCol([h => h.comb === "案件名稱" || h.comb === "工程名稱"]);
      const cApproved = findCol([h => h.comb.includes("核定經費")]);
      const cReq = findCol([h => h.comb.includes("經費需求")]);
      const cUsable = findCol([h => h.comb.includes("可支用經費")]);
      const cCode = findCol([h => h.comb.includes("工程編號")]);
      const cCoords = findCol([h => h.comb.includes("座標點位")]);
      const cLevee = findCol([h => h.comb === "堤防_m", h => h.comb.includes("堤防")]);
      const cRevet = findCol([h => h.comb === "護岸_m", h => h.comb.includes("護岸")]);
      const cGate = findCol([h => h.comb === "水門_座", h => h.comb.includes("水門")]);
      const cRoad = findCol([h => h.comb === "水防道路_m2", h => h.comb.includes("水防道路")]);
      const cOther = findCol([h => h.comb === "其他結構說明", h => h.comb === "其他"]);
      const cRemark = findCol([h => h.comb === "備註資訊" || h.comb === "備註"]);
      const cConcern = findCol([h => h.comb.includes("地方關切") || h.comb.includes("民代關切")]);

      for (let r = headerIdx + (isDual ? 2 : 1); r < matrix.length; r++) {
        const row = matrix[r] || [];
        const getV = i => (i >= 0 && i < row.length ? row[i] : "");
        const pName = normalizeText(getV(cName));
        const bName = normalizeText(getV(cBranch)).replace("水規所", "水規分署");
        if (!pName || !bName || ["合計", "小計", "總計"].some(k => pName.includes(k) || bName.includes(k))) continue;

        let approvedVal = parseExcelNumber(getV(cApproved));
        const reqVal = parseExcelNumber(getV(cReq));
        if (approvedVal <= 0 && reqVal > 0) { approvedVal = reqVal; fallbackCnt++; }

        const remarkText = normalizeText(getV(cRemark));
        let concernText = normalizeText(getV(cConcern));
        if (!concernText && remarkText && typeof extractConcernFromRemark === "function") {
          concernText = extractConcernFromRemark(remarkText);
          if (concernText) concernCnt++;
        }

        parsed.push({
          "核定年度": normalizeText(getV(cYear) || defaultYear),
          "分署": bName,
          "性質": formatAppendixToNature(normalizeText(getV(cApp) || sheetName)),
          "類別": normalizeCategoryName(getV(cCat) || "工程"),
          "縣市": normalizeText(getV(cCounty)).replace(/台/g, "臺"),
          "鄉鎮": normalizeText(getV(cTown)).replace(/台/g, "臺"),
          "水系": normalizeText(getV(cWater)),
          "溪別": normalizeText(getV(cStream)),
          "案件名稱": pName,
          "核定經費_千元": approvedVal,
          "可支用經費_千元": parseExcelNumber(getV(cUsable)),
          "工程編號": normalizeText(getV(cCode)),
          "座標點位": normalizeText(getV(cCoords)),
          "堤防_m": parseExcelNumber(getV(cLevee)),
          "護岸_m": parseExcelNumber(getV(cRevet)),
          "水門_座": Math.round(parseExcelNumber(getV(cGate))),
          "水防道路_m2": parseExcelNumber(getV(cRoad)),
          "其他結構說明": normalizeText(getV(cOther)),
          "備註資訊": remarkText,
          "地方關切": concernText
        });
      }
    });

    v2PendingApprovalImport = parsed;
    ensureV2ApprovalModals();
    document.getElementById("lblV2AppImportSummary").textContent =
      `《${file.name}》共 ${parsed.length} 筆（需求代核定 ${fallbackCnt} 筆、地方關切 ${concernCnt} 筆）`;
    document.getElementById("tbodyV2AppImport").innerHTML = parsed.slice(0, 100).map(r => `
      <tr>
        <td class="p-1.5 text-center">${r["核定年度"]}</td>
        <td class="p-1.5 text-center">${r["分署"]}</td>
        <td class="p-1.5 text-center">${escapeHtmlAttr(r["縣市"] || "")}${escapeHtmlAttr(r["鄉鎮"] || "")}</td>
        <td class="p-1.5 text-center">${escapeHtmlAttr(r["水系"] || "-")} / ${escapeHtmlAttr(r["溪別"] || "-")}</td>
        <td class="p-1.5">${escapeHtmlAttr(r["案件名稱"])}</td>
        <td class="p-1.5 text-right font-mono">${r["核定經費_千元"].toLocaleString()}</td>
        <td class="p-1.5 text-center">${r["地方關切"] ? `<span class="px-1.5 py-0.5 rounded bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/25">${escapeHtmlAttr(r["地方關切"])}</span>` : "-"}</td>
      </tr>
    `).join("");
    document.getElementById("modalV2AppImport").classList.remove("hidden");
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}

async function confirmV2ApprovalImport() {
  if (!v2PendingApprovalImport.length) return;
  const phase = document.getElementById("selV2ImportPhase")?.value || "先期";
  const btn = document.getElementById("btnConfirmV2AppImport");
  if (btn) { btn.disabled = true; btn.textContent = "寫入中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_import_approval",
        passcode: adminPasscode,
        phase,
        records: v2PendingApprovalImport
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2AppImport").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "匯入失敗");
    }
  } catch (err) {
    alert("寫入失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "確認匯入"; }
  }
}

function openV2ApprovalCreateModal() {
  if (!adminPasscode) return alert("請先登入署端帳號");
  ensureV2ApprovalModals();
  const rocYear = String(new Date().getFullYear() - 1911);
  document.getElementById("v2EdModalTitle").textContent = "新增核定案件";
  document.getElementById("v2EdUid").value = "";
  document.getElementById("v2EdUidBadge").textContent = "存檔後自動配發";
  document.getElementById("v2EdStage").value = "執行管考中";
  document.getElementById("v2EdYear").value = rocYear;
  document.getElementById("v2EdPhase").value = "先期";
  document.getElementById("v2EdDocNo").value = "";
  document.getElementById("v2EdCode").value = "";
  document.getElementById("v2EdBranch").value = "一分署";
  document.getElementById("v2EdNature").value = "河川";
  document.getElementById("v2EdCategory").value = "工程";
  document.getElementById("v2EdCounty").value = "";
  document.getElementById("v2EdTown").value = "";
  document.getElementById("v2EdWater").value = "";
  document.getElementById("v2EdStream").value = "";
  document.getElementById("v2EdName").value = "";
  document.getElementById("v2EdCoords").value = "";
  document.getElementById("v2EdApproved").value = 0;
  document.getElementById("v2EdUsable").value = 0;
  document.getElementById("v2EdLevee").value = 0;
  document.getElementById("v2EdRevet").value = 0;
  document.getElementById("v2EdGate").value = 0;
  document.getElementById("v2EdRoad").value = 0;
  document.getElementById("v2EdOther").value = "";
  document.getElementById("v2EdConcern").value = "";
  document.getElementById("v2EdRemark").value = "";
  document.getElementById("modalV2AppEdit").classList.remove("hidden");
}

function openV2ApprovalEditModal(uid) {
  if (!adminPasscode) return alert("請先登入署端帳號");
  ensureV2ApprovalModals();
  const c = v2ActiveCases.find(x => x.case_uid === uid);
  if (!c) return;
  document.getElementById("v2EdModalTitle").textContent = "編輯核定案件（完整資料）";
  document.getElementById("v2EdUid").value = uid;
  document.getElementById("v2EdUidBadge").textContent = uid;
  document.getElementById("v2EdStage").value = c.lifecycle_stage === "撤案" ? "撤案" : "執行管考中";
  document.getElementById("v2EdYear").value = c["核定年度"] || "";
  document.getElementById("v2EdPhase").value = c["核定梯次"] || "先期";
  document.getElementById("v2EdDocNo").value = c["核定文號"] || "";
  document.getElementById("v2EdCode").value = c["工程編號"] || "";
  document.getElementById("v2EdBranch").value = v2DisplayBranch(c["分署"]) === "-" ? "一分署" : v2DisplayBranch(c["分署"]);
  document.getElementById("v2EdNature").value = c["性質"] || "河川";
  document.getElementById("v2EdCategory").value = c["類別"] || "工程";
  document.getElementById("v2EdCounty").value = c["縣市"] || "";
  document.getElementById("v2EdTown").value = c["鄉鎮"] || "";
  document.getElementById("v2EdWater").value = c["水系"] || "";
  document.getElementById("v2EdStream").value = c["溪別"] || "";
  document.getElementById("v2EdName").value = c["案件名稱"] || "";
  document.getElementById("v2EdCoords").value = c["座標點位"] || "";
  document.getElementById("v2EdApproved").value = c["核定經費_千元"] || 0;
  document.getElementById("v2EdUsable").value = c["可支用經費_千元"] || 0;
  document.getElementById("v2EdLevee").value = c["堤防_m"] || 0;
  document.getElementById("v2EdRevet").value = c["護岸_m"] || 0;
  document.getElementById("v2EdGate").value = c["水門_座"] || 0;
  document.getElementById("v2EdRoad").value = c["水防道路_m2"] || 0;
  document.getElementById("v2EdOther").value = c["其他結構說明"] || "";
  document.getElementById("v2EdConcern").value = c["地方關切"] || "";
  document.getElementById("v2EdRemark").value = c["備註資訊"] || "";
  document.getElementById("modalV2AppEdit").classList.remove("hidden");
}

async function saveV2ApprovalEdit() {
  const uid = document.getElementById("v2EdUid").value.trim();
  const isCreate = !uid;
  const nameVal = document.getElementById("v2EdName").value.trim();
  if (!nameVal) return alert("請輸入案件名稱");

  const record = {
    lifecycle_stage: document.getElementById("v2EdStage").value,
    "核定年度": document.getElementById("v2EdYear").value.trim(),
    "核定梯次": document.getElementById("v2EdPhase").value,
    "核定文號": document.getElementById("v2EdDocNo").value.trim(),
    "工程編號": document.getElementById("v2EdCode").value.trim(),
    "分署": document.getElementById("v2EdBranch").value.trim(),
    "性質": document.getElementById("v2EdNature").value.trim(),
    "類別": document.getElementById("v2EdCategory").value.trim(),
    "縣市": document.getElementById("v2EdCounty").value.trim().replace(/台/g, "臺"),
    "鄉鎮": document.getElementById("v2EdTown").value.trim().replace(/台/g, "臺"),
    "水系": document.getElementById("v2EdWater").value.trim(),
    "溪別": document.getElementById("v2EdStream").value.trim(),
    "案件名稱": nameVal,
    "座標點位": document.getElementById("v2EdCoords").value.trim(),
    "核定經費_千元": parseFloat(document.getElementById("v2EdApproved").value) || 0,
    "可支用經費_千元": parseFloat(document.getElementById("v2EdUsable").value) || 0,
    "堤防_m": parseFloat(document.getElementById("v2EdLevee").value) || 0,
    "護岸_m": parseFloat(document.getElementById("v2EdRevet").value) || 0,
    "水門_座": Math.round(parseFloat(document.getElementById("v2EdGate").value) || 0),
    "水防道路_m2": parseFloat(document.getElementById("v2EdRoad").value) || 0,
    "其他結構說明": document.getElementById("v2EdOther").value.trim(),
    "地方關切": document.getElementById("v2EdConcern").value.trim(),
    "備註資訊": document.getElementById("v2EdRemark").value.trim()
  };
  if (!isCreate) record.case_uid = uid;

  const btn = document.getElementById("btnSaveV2ApprovalEdit");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: isCreate ? "v2_create_approval" : "v2_update_approval",
        passcode: adminPasscode,
        record
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2AppEdit").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("儲存失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存"; }
  }
}

function ensureV2ApprovalModals() {
  if (!document.getElementById("modalV2PullMaster")) {
    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalV2PullMaster" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-md space-y-3 text-xs">
          <h2 class="text-base font-bold text-[#1D3557]">帶入總庫年度案件</h2>
          <div>
            <label class="font-bold text-[#1D3557] block mb-1">年度</label>
            <select id="selV2PullMasterYear" onchange="updateV2PullMasterPreview()" class="w-full border border-[#1D3557]/20 rounded px-2 py-1.5 bg-white text-[#1D3557] font-bold"></select>
          </div>
          <div>
            <label class="font-bold text-[#1D3557] block mb-1">梯次</label>
            <select id="selV2PullMasterPhase" class="w-full border border-[#1D3557]/20 rounded px-2 py-1.5 bg-white text-[#1D3557]">
              <option value="先期">先期</option>
              <option value="期中">期中</option>
            </select>
          </div>
          <div id="lblV2PullMasterCount" class="bg-[#FAF3E0] text-[#1D3557] border border-[#1D3557]/15 rounded p-2 font-medium"></div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" onclick="document.getElementById('modalV2PullMaster').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button>
            <button type="button" id="btnConfirmV2PullMaster" onclick="confirmV2PullFromMaster()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">確認帶入</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(d.firstElementChild);
  }

  if (!document.getElementById("modalV2AppImport")) {
    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalV2AppImport" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-4xl space-y-3 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-bold text-[#ED6D35]">核定 Excel 匯入預覽</h2>
            <div class="flex items-center gap-1.5">
              <label class="font-bold text-[#1D3557]">梯次：</label>
              <select id="selV2ImportPhase" class="border border-[#1D3557]/25 rounded px-2 py-1 bg-white text-[#1D3557] font-bold">
                <option value="先期">先期</option>
                <option value="期中">期中</option>
              </select>
            </div>
          </div>
          <p id="lblV2AppImportSummary" class="font-bold text-[#1D3557]"></p>
          <div class="max-h-[340px] overflow-y-auto bg-white border border-[#1D3557]/15 rounded">
            <table class="w-full text-xs border-collapse">
              <thead><tr><th class="p-2">年度</th><th class="p-2">分署</th><th class="p-2">縣市鄉鎮</th><th class="p-2">水系 / 溪別</th><th class="p-2">案件名稱</th><th class="p-2 text-right">核定經費</th><th class="p-2 text-center">地方關切</th></tr></thead>
              <tbody id="tbodyV2AppImport" class="divide-y divide-slate-200"></tbody>
            </table>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button onclick="document.getElementById('modalV2AppImport').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button>
            <button id="btnConfirmV2AppImport" onclick="confirmV2ApprovalImport()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">確認匯入</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(d.firstElementChild);
  }

  if (!document.getElementById("modalV2AppEdit")) {
    const branchOpts = V2_BRANCH_KEYS.map(b => `<option value="${v2DisplayBranch(b)}">${v2DisplayBranch(b)}</option>`).join("");
    const catOpts = (typeof CATEGORIES_LIST !== "undefined" ? CATEGORIES_LIST : ["工程", "維修改善工程", "委託設計/監造", "用地", "用地先期作業", "補助", "補助案件", "其他"])
      .map(c => `<option value="${c}">${c}</option>`).join("");

    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalV2AppEdit" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3 text-xs">
          <div class="flex items-center justify-between border-b border-[#1D3557]/15 pb-2">
            <h2 id="v2EdModalTitle" class="text-base font-bold text-[#1D3557]">編輯核定案件</h2>
            <span id="v2EdUidBadge" class="font-mono font-bold text-[#004E89]"></span>
          </div>
          <input type="hidden" id="v2EdUid" />

          <!-- 區段 1：案件資訊 -->
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">1. 案件資訊</div>
            <div class="grid grid-cols-3 gap-2.5">
              <div>
                <label class="font-bold block mb-1">核定年度</label>
                <input id="v2EdYear" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">梯次</label>
                <select id="v2EdPhase" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1">
                  <option value="先期">先期</option>
                  <option value="期中">期中</option>
                </select>
              </div>
              <div>
                <label class="font-bold block mb-1">案件狀態</label>
                <select id="v2EdStage" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-bold text-[#1D3557]">
                  <option value="執行管考中">執行中</option>
                  <option value="撤案">撤案</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="font-bold block mb-1 text-[#ED6D35]">工程編號</label>
                <input id="v2EdCode" type="text" placeholder="輸入工程編號" class="w-full border border-[#ED6D35]/50 bg-white rounded px-2 py-1 font-mono" />
              </div>
              <div>
                <label class="font-bold block mb-1">核定文號</label>
                <input id="v2EdDocNo" type="text" placeholder="例：經水河字第..." class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
            </div>
          </div>

          <!-- 區段 2：基本資料 -->
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">2. 基本資料</div>
            <div class="grid grid-cols-3 gap-2.5">
              <div>
                <label class="font-bold block mb-1">分署別</label>
                <select id="v2EdBranch" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1">${branchOpts}</select>
              </div>
              <div>
                <label class="font-bold block mb-1">性質</label>
                <input id="v2EdNature" type="text" placeholder="河川 / 區域排水 / 海岸" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">類別</label>
                <select id="v2EdCategory" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1">${catOpts}</select>
              </div>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <div>
                <label class="font-bold block mb-1">縣市</label>
                <input id="v2EdCounty" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">鄉鎮</label>
                <input id="v2EdTown" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">水系</label>
                <input id="v2EdWater" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">溪別</label>
                <input id="v2EdStream" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2.5">
              <div class="col-span-2">
                <label class="font-bold block mb-1">案件名稱</label>
                <input id="v2EdName" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">座標點位</label>
                <input id="v2EdCoords" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
            </div>
          </div>

          <!-- 區段 3：經費支用（單位：千元） -->
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">3. 經費支用（單位：千元）</div>
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="font-bold block mb-1">核定經費 (千元)</label>
                <input id="v2EdApproved" type="number" step="0.001" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
              <div>
                <label class="font-bold block mb-1">可支用經費 (千元)</label>
                <input id="v2EdUsable" type="number" step="0.001" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
            </div>
          </div>

          <!-- 區段 4：工程內容及備註 -->
          <div class="bg-white border border-[#1D3557]/12 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#004E89] border-b border-slate-100 pb-1">4. 工程內容及備註</div>
            <div class="grid grid-cols-4 gap-2">
              <div>
                <label class="font-bold block mb-1">堤防 (m)</label>
                <input id="v2EdLevee" type="number" step="0.1" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
              <div>
                <label class="font-bold block mb-1">護岸 (m)</label>
                <input id="v2EdRevet" type="number" step="0.1" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
              <div>
                <label class="font-bold block mb-1">水門 (座)</label>
                <input id="v2EdGate" type="number" step="1" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
              <div>
                <label class="font-bold block mb-1">水防道路 (m²)</label>
                <input id="v2EdRoad" type="number" step="0.1" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="font-bold block mb-1">其他結構說明</label>
                <input id="v2EdOther" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
              <div>
                <label class="font-bold block mb-1">地方關切</label>
                <input id="v2EdConcern" type="text" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
              </div>
            </div>
            <div>
              <label class="font-bold block mb-1">備註資訊</label>
              <textarea id="v2EdRemark" rows="2" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1"></textarea>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button type="button" onclick="document.getElementById('modalV2AppEdit').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button>
            <button type="button" id="btnSaveV2ApprovalEdit" onclick="saveV2ApprovalEdit()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">儲存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(d.firstElementChild);
  }
}