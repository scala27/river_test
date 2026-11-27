/**
 * 治水雲庫 V2 — ② 工程進度管考（純工程案）
 */

let v2BranchContacts = [];
let v2ProgressSignoffs = [];
let v2ProgressSettings = {
  auto_enabled: "1",
  reminder_day: "1",
  deadline_day: "5",
  overdue_day: "6",
  overdue_daily_repeat: "1",
  last_reminder_sent_date: "",
  last_overdue_sent_date: ""
};

function initV2ProgressData(json) {
  v2BranchContacts = Array.isArray(json.branchContacts) ? json.branchContacts : [];
  v2ProgressSignoffs = Array.isArray(json.progressSignoffs) ? json.progressSignoffs : [];
  if (json.progressSettings && typeof json.progressSettings === "object") {
    v2ProgressSettings = Object.assign({}, v2ProgressSettings, json.progressSettings);
  }
}

function isProgressHeadquartersAdmin() {
  return v2AuthState.role === "admin" || v2AuthState.role === "progress";
}

function canEditSingleProgressCase(c) {
  if (isProgressHeadquartersAdmin()) return true;
  if (v2AuthState.role === "branch" && v2AuthState.branch) {
    return v2NormBranch(c["分署"]) === v2NormBranch(v2AuthState.branch);
  }
  return false;
}

function getTodayIsoDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function deriveClientProgressStage(c) {
  if (String(c["實際完工日"] || "").trim()) return "已完工";
  if (String(c["實際開工日"] || "").trim()) return "施工中";
  if (String(c["實際決標日"] || "").trim()) return "已決標待開工";
  if (String(c["實際上網日"] || "").trim()) return "招標中";
  return "未發包";
}

function getProgressStageBadgeHtml(stage) {
  const map = {
    "未發包": "bg-slate-100 text-slate-700 border-slate-300",
    "招標中": "bg-amber-50 text-amber-800 border-amber-300",
    "已決標待開工": "bg-sky-50 text-[#004E89] border-sky-300",
    "施工中": "bg-[#ED6D35]/15 text-[#ED6D35] border-[#ED6D35]/40",
    "已完工": "bg-emerald-50 text-emerald-700 border-emerald-300"
  };
  const cls = map[stage] || "bg-slate-100 text-slate-700 border-slate-300";
  return `<span class="inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${cls}">${escapeHtmlAttr(stage)}</span>`;
}

function checkCasePendingIssues(c, todayStr, curMonth) {
  const issues = [];
  const pBid = String(c["預定決標日"] || "").trim();
  const aBid = String(c["實際決標日"] || "").trim();
  const pEnd = String(c["預定完工日"] || "").trim();
  const aEnd = String(c["實際完工日"] || "").trim();
  const stage = deriveClientProgressStage(c);

  if (!pBid) issues.push("缺預定決標日");
  if (!pEnd) issues.push("缺預定完工日");
  if (pBid && pBid < todayStr && !aBid) issues.push("逾預定決標日");
  if (pEnd && pEnd < todayStr && !aEnd) issues.push("逾預定完工日");
  if (curMonth && String(c["最後更新月份"] || "").trim() !== curMonth && stage !== "已完工") {
    issues.push("本月未更新");
  }
  return issues;
}

function getProgressFilters() {
  const defaultBranch = (v2AuthState.role === "branch" && v2AuthState.branch)
    ? v2NormBranch(v2AuthState.branch)
    : "ALL";
  return {
    year: document.getElementById("selProgYear")?.value || "ALL",
    branch: document.getElementById("selProgBranch")?.value || defaultBranch,
    stage: document.getElementById("selProgStage")?.value || "ALL",
    alert: document.getElementById("selProgAlert")?.value || "ALL",
    kw: normalizeText(document.getElementById("txtProgKeyword")?.value || "").toLowerCase()
  };
}

function getAllPureEngActiveCases() {
  return (v2ActiveCases || []).filter(c =>
    c.lifecycle_stage !== "撤案" &&
    c.lifecycle_stage !== "已結案入庫" &&
    v2IsPureEngineering(c)
  );
}

function renderProgressView() {
  const container = document.getElementById("viewProgress");
  if (!container) return;

  ensureV2ProgressModals();

  const prev = getProgressFilters();
  const isHq = isProgressHeadquartersAdmin();
  const isBranchUser = v2AuthState.role === "branch" && Boolean(v2AuthState.branch);
  const myBranchKey = isBranchUser ? v2NormBranch(v2AuthState.branch) : "";

  const allEng = getAllPureEngActiveCases();
  const scopedEng = isBranchUser
    ? allEng.filter(c => v2NormBranch(c["分署"]) === myBranchKey)
    : allEng;

  const todayStr = getTodayIsoDateStr();
  const curMonth = v2CurrentMonth || `${new Date().getFullYear() - 1911}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const mParts = curMonth.split("-");
  const monthLabel = mParts.length === 2 ? `${mParts[0]}年${parseInt(mParts[1], 10)}月` : curMonth;
  const deadlineDay = parseInt(v2ProgressSettings.deadline_day, 10) || 5;
  const reminderDay = parseInt(v2ProgressSettings.reminder_day, 10) || 1;
  const overdueDay = parseInt(v2ProgressSettings.overdue_day, 10) || 6;
  const isAutoEnabled = String(v2ProgressSettings.auto_enabled) === "1";

  let preBidCnt = 0, biddingCnt = 0, ongoingCnt = 0, completedCnt = 0, lagCnt = 0, pendingCnt = 0;

  scopedEng.forEach(c => {
    const st = deriveClientProgressStage(c);
    if (st === "未發包") preBidCnt++;
    else if (st === "招標中") biddingCnt++;
    else if (st === "已決標待開工" || st === "施工中") ongoingCnt++;
    else if (st === "已完工") completedCnt++;

    const planP = parseFloat(c["預定進度_%"]) || 0;
    const actP = parseFloat(c["實際進度_%"]) || 0;
    if (actP < planP && st !== "已完工") lagCnt++;
    if (checkCasePendingIssues(c, todayStr, curMonth).length > 0) pendingCnt++;
  });

  const signedBranchSet = new Set(
    (v2ProgressSignoffs || [])
      .filter(s => String(s.roc_month).trim() === curMonth)
      .map(s => v2NormBranch(s.branch_key))
  );
  const activeBranches = V2_BRANCH_KEYS.filter(b => allEng.some(c => v2NormBranch(c["分署"]) === b));
  const signedCount = activeBranches.filter(b => signedBranchSet.has(b)).length;

  let bannerHtml = "";
  if (isBranchUser) {
    const mySignRecord = (v2ProgressSignoffs || []).find(
      s => String(s.roc_month).trim() === curMonth && v2NormBranch(s.branch_key) === myBranchKey
    );
    const isMySigned = Boolean(mySignRecord);
    bannerHtml = `
      <div class="bg-[#FAF3E0] border border-[#1D3557]/20 rounded-md px-3 py-2 mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-[#1D3557] text-white font-bold">${v2DisplayBranch(myBranchKey)}</span>
          <span class="font-bold text-[#1D3557]">${monthLabel}進度填報期限：每月 ${deadlineDay} 日</span>
          <span class="text-[#1D3557]/80">｜待補齊／本月未更新：<strong class="text-[#ED6D35]">${pendingCnt}</strong> 件</span>
          ${isMySigned
            ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">✅ 本月已簽認完成（${escapeHtmlAttr(mySignRecord.signed_at || "")}）</span>`
            : `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">⏳ 本月尚未簽認</span>`
          }
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="quickFilterProgressAlert('PENDING')" class="px-2.5 py-1 rounded bg-white hover:bg-[#1D3557] text-[#1D3557] hover:text-white border border-[#1D3557]/25 font-bold transition">篩選待處理 (${pendingCnt})</button>
          <button type="button" onclick="submitBranchMonthSignoff()" class="px-3 py-1 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold transition">✅ 確認完成本月填報</button>
        </div>
      </div>
    `;
  } else {
    const unsignedNames = activeBranches.filter(b => !signedBranchSet.has(b)).map(b => v2DisplayBranch(b));
    bannerHtml = `
      <div class="bg-[#FAF3E0] border border-[#1D3557]/20 rounded-md px-3 py-2 mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-[#004E89] text-white font-bold">${monthLabel}月報管考</span>
          <span class="font-bold text-[#1D3557]">簽認進度：<strong class="text-[#ED6D35]">${signedCount} / ${activeBranches.length}</strong> 分署已完成</span>
          <span class="px-2 py-0.5 rounded ${isAutoEnabled ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-slate-200 text-slate-600 border-slate-300"} border text-[11px]">
            ${isAutoEnabled ? `排程：${reminderDay}日提醒 / ${deadlineDay}日截止 / ${overdueDay}日稽催` : "自動排程已暫停"}
          </span>
          ${unsignedNames.length
            ? `<span class="text-[11px] text-[#1D3557]/75">（未簽認：${escapeHtmlAttr(unsignedNames.join("、"))}）</span>`
            : `<span class="text-[11px] text-emerald-700 font-bold">（全數分署皆已完成本月簽認）</span>`
          }
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" onclick="copyLineProgressReminder()" class="px-2.5 py-1 rounded bg-white hover:bg-[#1D3557] text-[#1D3557] hover:text-white border border-[#1D3557]/25 font-bold transition">📋 複製本月 LINE 催報摘要</button>
          ${isHq ? `
            <button type="button" onclick="triggerSendProgressEmail('reminder')" class="px-2.5 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold transition">📧 寄發提醒信</button>
            <button type="button" onclick="triggerSendProgressEmail('overdue')" class="px-2.5 py-1 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold transition">⚠️ 寄發逾期稽催</button>
            <button type="button" onclick="openBranchContactsModal()" class="px-2.5 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#1D3557] border border-[#1D3557]/25 font-bold transition">⚙️ 通報排程與窗口設定</button>
          ` : ""}
        </div>
      </div>
    `;
  }

  const years = Array.from(new Set(allEng.map(c => String(c["核定年度"])).filter(Boolean))).sort().reverse();
  const branchSelectDisabled = isBranchUser ? "disabled" : "";
  const effectiveBranchVal = isBranchUser ? myBranchKey : prev.branch;

  container.innerHTML = `
    ${bannerHtml}

    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-2.5 text-xs">
      <div onclick="quickFilterProgressAlert('ALL')" class="cursor-pointer bg-[#ED6D35] text-white rounded-md px-3 py-2 shadow-xs">
        <div class="text-[11px] text-white/90">納管純工程總件數</div>
        <div class="text-base font-bold mt-0.5">${scopedEng.length.toLocaleString()} 筆</div>
      </div>
      <div onclick="quickFilterProgressAlert('PENDING')" class="cursor-pointer bg-[#FAF3E0] hover:border-[#ED6D35] border border-[#1D3557]/15 rounded-md px-3 py-2 transition">
        <div class="text-[11px] text-[#1D3557]/75">待補期程 / 本月未更新</div>
        <div class="text-base font-bold text-[#ED6D35] mt-0.5">${pendingCnt.toLocaleString()} 筆</div>
      </div>
      <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-md px-3 py-2">
        <div class="text-[11px] text-[#1D3557]/75">未發包 / 招標中</div>
        <div class="text-base font-bold text-[#1D3557] mt-0.5">${preBidCnt} / ${biddingCnt} 筆</div>
      </div>
      <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-md px-3 py-2">
        <div class="text-[11px] text-[#1D3557]/75">決標及施工中 / 已完工</div>
        <div class="text-base font-bold text-[#004E89] mt-0.5">${ongoingCnt} / ${completedCnt} 筆</div>
      </div>
      <div onclick="quickFilterProgressAlert('LAG')" class="cursor-pointer bg-[#FAF3E0] hover:border-[#ED6D35] border border-[#1D3557]/15 rounded-md px-3 py-2 transition">
        <div class="text-[11px] text-[#1D3557]/75">進度落後預警（實際＜預定）</div>
        <div class="text-base font-bold ${lagCnt > 0 ? "text-rose-600" : "text-emerald-700"} mt-0.5">${lagCnt.toLocaleString()} 筆</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <select id="selProgYear" onchange="renderProgressTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部年度</option>
          ${years.map(y => `<option value="${y}">${y} 年</option>`).join("")}
        </select>
        <select id="selProgBranch" onchange="renderProgressTableBody()" ${branchSelectDisabled} class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557] disabled:bg-slate-100">
          <option value="ALL">全部分署</option>
          ${V2_BRANCH_KEYS.map(b => `<option value="${b}">${v2DisplayBranch(b)}</option>`).join("")}
        </select>
        <select id="selProgStage" onchange="renderProgressTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部執行狀態</option>
          <option value="未發包">未發包</option>
          <option value="招標中">招標中</option>
          <option value="已決標待開工">已決標待開工</option>
          <option value="施工中">施工中</option>
          <option value="已完工">已完工</option>
        </select>
        <select id="selProgAlert" onchange="renderProgressTableBody()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
          <option value="ALL">全部預警篩選</option>
          <option value="PENDING">待補期程 / 本月未更新</option>
          <option value="LAG">進度落後（實際 ＜ 預定）</option>
          <option value="NO_PLAN_DATE">尚未填預定決標/完工日</option>
        </select>
        <input id="txtProgKeyword" type="text" oninput="renderProgressTableBody()" placeholder="案名 / 工程編號 / PCC案號" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white w-48" />
      </div>

      <div class="flex items-center gap-2">
        <button type="button" onclick="exportProgressExcel()" class="px-3 py-1 rounded bg-white hover:bg-[#FAF3E0] text-[#004E89] border border-[#004E89]/35 font-bold transition">📥 匯出進度管考表</button>
      </div>
    </div>

    <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
      <table class="w-full text-left border-collapse text-xs">
        <thead class="sticky top-0 z-10">
          <tr>
            <th class="px-2 py-2 text-center whitespace-nowrap">年度</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">分署</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">工程編號</th>
            <th class="px-2 py-2 min-w-[210px]">案件名稱</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">執行狀態</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">上網日<br><span class="text-[10px] font-normal opacity-80">預定 / 實際</span></th>
            <th class="px-2 py-2 text-center whitespace-nowrap">決標日<br><span class="text-[10px] font-normal opacity-80">預定 / 實際</span></th>
            <th class="px-2 py-2 text-center whitespace-nowrap">開工日<br><span class="text-[10px] font-normal opacity-80">預定 / 實際</span></th>
            <th class="px-2 py-2 text-center whitespace-nowrap">完工日<br><span class="text-[10px] font-normal opacity-80">預定 / 實際</span></th>
            <th class="px-2 py-2 text-right whitespace-nowrap">預定進度</th>
            <th class="px-2 py-2 text-right whitespace-nowrap">實際進度</th>
            <th class="px-2 py-2 text-right whitespace-nowrap">進度差異</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">更新狀態</th>
            <th class="px-2 py-2 text-center whitespace-nowrap">操作</th>
          </tr>
        </thead>
        <tbody id="tbodyProgress" class="divide-y divide-slate-200"></tbody>
      </table>
    </div>
  `;

  if (document.getElementById("selProgYear") && (prev.year === "ALL" || years.includes(prev.year))) {
    document.getElementById("selProgYear").value = prev.year;
  }
  if (document.getElementById("selProgBranch")) document.getElementById("selProgBranch").value = effectiveBranchVal;
  if (document.getElementById("selProgStage")) document.getElementById("selProgStage").value = prev.stage;
  if (document.getElementById("selProgAlert")) document.getElementById("selProgAlert").value = prev.alert;
  if (document.getElementById("txtProgKeyword")) document.getElementById("txtProgKeyword").value = prev.kw;

  renderProgressTableBody();
}

function quickFilterProgressAlert(alertMode) {
  const sel = document.getElementById("selProgAlert");
  if (sel) { sel.value = alertMode; renderProgressTableBody(); }
}

function getFilteredProgressRows() {
  const { year, branch, stage, alert, kw } = getProgressFilters();
  const todayStr = getTodayIsoDateStr();
  const curMonth = v2CurrentMonth || `${new Date().getFullYear() - 1911}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  return getAllPureEngActiveCases().filter(c => {
    if (year !== "ALL" && String(c["核定年度"]) !== year) return false;
    if (branch !== "ALL" && v2NormBranch(c["分署"]) !== branch) return false;
    const derivedSt = deriveClientProgressStage(c);
    if (stage !== "ALL" && derivedSt !== stage) return false;

    const planP = parseFloat(c["預定進度_%"]) || 0;
    const actP = parseFloat(c["實際進度_%"]) || 0;
    const issues = checkCasePendingIssues(c, todayStr, curMonth);

    if (alert === "PENDING" && issues.length === 0) return false;
    if (alert === "LAG" && !(actP < planP && derivedSt !== "已完工")) return false;
    if (alert === "NO_PLAN_DATE" && (String(c["預定決標日"] || "").trim() && String(c["預定完工日"] || "").trim())) return false;

    if (kw) {
      const hay = `${c.case_uid} ${c["工程編號"]} ${c["案件名稱"]} ${c["pcc_tender_id"] || ""} ${c["縣市"]} ${c["溪別"] || ""}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function formatDualDateCell(planDate, actDate, todayStr) {
  const p = String(planDate || "").trim();
  const a = String(actDate || "").trim();
  const isOverduePlan = Boolean(p && p < todayStr && !a);
  const pHtml = p
    ? `<div class="text-[11px] font-mono ${isOverduePlan ? "text-rose-600 font-bold" : "text-[#1D3557]/65"}">預：${escapeHtmlAttr(p)}</div>`
    : `<div class="text-[11px] text-slate-400">預：-</div>`;
  const aHtml = a
    ? `<div class="text-[11px] font-mono font-bold text-[#004E89]">實：${escapeHtmlAttr(a)}</div>`
    : `<div class="text-[11px] text-slate-400">實：-</div>`;
  return `${pHtml}${aHtml}`;
}

function renderProgressTableBody() {
  const tbody = document.getElementById("tbodyProgress");
  if (!tbody) return;
  const rows = getFilteredProgressRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14" class="py-8 text-center text-slate-400">無符合條件的工程管考案件</td></tr>`;
    return;
  }

  const todayStr = getTodayIsoDateStr();
  const curMonth = v2CurrentMonth || `${new Date().getFullYear() - 1911}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  tbody.innerHTML = rows.map((c, idx) => {
    const bg = idx % 2 === 0 ? "bg-[#F7F5F0]/75" : "bg-white";
    const derivedSt = deriveClientProgressStage(c);
    const planP = parseFloat(c["預定進度_%"]) || 0;
    const actP = parseFloat(c["實際進度_%"]) || 0;
    const diffP = Number((actP - planP).toFixed(2));
    const isLag = diffP < 0 && derivedSt !== "已完工";
    const diffCls = isLag ? "text-rose-600 font-bold" : (diffP > 0 ? "text-emerald-700 font-bold" : "text-[#1D3557]/75");
    const diffPrefix = diffP > 0 ? "+" : "";
    const issues = checkCasePendingIssues(c, todayStr, curMonth);
    const isUpdatedThisMonth = String(c["最後更新月份"] || "").trim() === curMonth;
    const canEdit = canEditSingleProgressCase(c);
    const pccId = String(c["pcc_tender_id"] || "").trim();

    return `
      <tr class="${bg} hover:bg-[#FAF3E0]/75">
        <td class="px-2 py-2 text-center font-bold text-[#1D3557] whitespace-nowrap">${escapeHtmlAttr(c["核定年度"])}</td>
        <td class="px-2 py-2 text-center font-bold whitespace-nowrap">${v2DisplayBranch(c["分署"])}</td>
        <td class="px-2 py-2 text-center font-mono whitespace-nowrap">
          <div>${escapeHtmlAttr(c["工程編號"] || "-")}</div>
          ${pccId ? `<div class="text-[10px] text-[#004E89]">PCC:${escapeHtmlAttr(pccId)}</div>` : ""}
        </td>
        <td class="px-2 py-2">
          <div class="font-bold text-[#1D3557]">${escapeHtmlAttr(c["案件名稱"])}</div>
          <div class="text-[10px] text-[#1D3557]/60">${escapeHtmlAttr([c["縣市"], c["溪別"]].filter(Boolean).join(".") || "-")}｜核定 ${formatIntThousand(c["核定經費_千元"])} 千元</div>
        </td>
        <td class="px-2 py-2 text-center whitespace-nowrap">${getProgressStageBadgeHtml(derivedSt)}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">${formatDualDateCell(c["預定上網日"], c["實際上網日"], todayStr)}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">${formatDualDateCell(c["預定決標日"], c["實際決標日"], todayStr)}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">${formatDualDateCell(c["預定開工日"], c["實際開工日"], todayStr)}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">${formatDualDateCell(c["預定完工日"], c["實際完工日"], todayStr)}</td>
        <td class="px-2 py-2 text-right font-mono whitespace-nowrap">${planP.toFixed(2)}%</td>
        <td class="px-2 py-2 text-right font-mono font-bold text-[#1D3557] whitespace-nowrap">${actP.toFixed(2)}%</td>
        <td class="px-2 py-2 text-right font-mono whitespace-nowrap ${diffCls}">${diffPrefix}${diffP.toFixed(2)}%</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          ${isUpdatedThisMonth
            ? `<span class="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">本月已更</span>`
            : `<span class="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">待更新</span>`
          }
          ${issues.length ? `<div class="text-[10px] text-rose-600 mt-0.5" title="${escapeHtmlAttr(issues.join("、"))}">${escapeHtmlAttr(issues[0])}${issues.length > 1 ? `(+${issues.length - 1})` : ""}</div>` : ""}
        </td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          <button type="button" onclick="openProgressEditModal('${c.case_uid}')" class="px-2.5 py-1 rounded ${canEdit ? "bg-[#FAF3E0] hover:bg-[#ED6D35] text-[#1D3557] hover:text-white border-[#1D3557]/20" : "bg-white text-[#004E89] border-[#004E89]/25"} border font-bold text-[11px] transition">
            ${canEdit ? "填報" : "檢視"}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function openProgressEditModal(uid) {
  ensureV2ProgressModals();
  const c = getAllPureEngActiveCases().find(x => x.case_uid === uid);
  if (!c) return;

  const canEdit = canEditSingleProgressCase(c);
  document.getElementById("progEdModalTitle").textContent = canEdit ? "工程進度管考填報" : "工程進度管考檢視（唯讀）";
  document.getElementById("progEdUid").value = uid;
  document.getElementById("progEdCaseHeader").innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <span class="font-mono text-[#004E89] font-bold">${escapeHtmlAttr(c["工程編號"] || uid)}</span>
        <span class="ml-1.5 px-1.5 py-0.5 rounded bg-[#1D3557] text-white text-[10px]">${v2DisplayBranch(c["分署"])}</span>
      </div>
      <div>${getProgressStageBadgeHtml(deriveClientProgressStage(c))}</div>
    </div>
    <div class="font-bold text-[#1D3557] text-sm mt-1">${escapeHtmlAttr(c["案件名稱"])}</div>
  `;

  document.getElementById("progEdPlanBid").value = c["預定決標日"] || "";
  document.getElementById("progEdActBid").value = c["實際決標日"] || "";
  document.getElementById("progEdPlanEnd").value = c["預定完工日"] || "";
  document.getElementById("progEdActEnd").value = c["實際完工日"] || "";
  document.getElementById("progEdPlanTender").value = c["預定上網日"] || "";
  document.getElementById("progEdActTender").value = c["實際上網日"] || "";
  document.getElementById("progEdPlanStart").value = c["預定開工日"] || "";
  document.getElementById("progEdActStart").value = c["實際開工日"] || "";
  document.getElementById("progEdPccId").value = c["pcc_tender_id"] || "";
  document.getElementById("progEdPrevPct").textContent = `${(parseFloat(c["上月實際進度_%"]) || 0).toFixed(2)}%`;
  document.getElementById("progEdPlanPct").value = parseFloat(c["預定進度_%"]) || 0;
  document.getElementById("progEdActPct").value = parseFloat(c["實際進度_%"]) || 0;
  updateModalProgressDiffPreview();

  [
    "progEdPlanBid", "progEdActBid", "progEdPlanEnd", "progEdActEnd",
    "progEdPlanTender", "progEdActTender", "progEdPlanStart", "progEdActStart",
    "progEdPccId", "progEdPlanPct", "progEdActPct"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canEdit;
  });

  document.getElementById("btnSaveProgressEdit")?.classList.toggle("hidden", !canEdit);
  document.getElementById("modalV2ProgressEdit").classList.remove("hidden");
}

function updateModalProgressDiffPreview() {
  const planP = parseFloat(document.getElementById("progEdPlanPct")?.value) || 0;
  const actP = parseFloat(document.getElementById("progEdActPct")?.value) || 0;
  const diff = Number((actP - planP).toFixed(2));
  const lbl = document.getElementById("progEdDiffPreview");
  if (!lbl) return;
  lbl.textContent = `${diff > 0 ? "+" : ""}${diff.toFixed(2)}%`;
  lbl.className = diff < 0 ? "font-mono font-bold text-rose-600" : (diff > 0 ? "font-mono font-bold text-emerald-700" : "font-mono font-bold text-[#1D3557]");
}

async function saveV2ProgressEdit() {
  const uid = document.getElementById("progEdUid").value.trim();
  if (!uid) return;
  const record = {
    case_uid: uid,
    "預定決標日": document.getElementById("progEdPlanBid").value.trim(),
    "實際決標日": document.getElementById("progEdActBid").value.trim(),
    "預定完工日": document.getElementById("progEdPlanEnd").value.trim(),
    "實際完工日": document.getElementById("progEdActEnd").value.trim(),
    "預定上網日": document.getElementById("progEdPlanTender").value.trim(),
    "實際上網日": document.getElementById("progEdActTender").value.trim(),
    "預定開工日": document.getElementById("progEdPlanStart").value.trim(),
    "實際開工日": document.getElementById("progEdActStart").value.trim(),
    "pcc_tender_id": document.getElementById("progEdPccId").value.trim(),
    "預定進度_%": parseFloat(document.getElementById("progEdPlanPct").value) || 0,
    "實際進度_%": parseFloat(document.getElementById("progEdActPct").value) || 0
  };

  const btn = document.getElementById("btnSaveProgressEdit");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_progress_update", role: v2AuthState.role, branch: v2AuthState.branch, passcode: v2AuthState.passcode, record })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalV2ProgressEdit").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("儲存失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存進度"; }
  }
}

async function submitBranchMonthSignoff() {
  if (v2AuthState.role !== "branch" || !v2AuthState.branch) return;
  const bKey = v2NormBranch(v2AuthState.branch);
  const curMonth = v2CurrentMonth || `${new Date().getFullYear() - 1911}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const myCases = getAllPureEngActiveCases().filter(c => v2NormBranch(c["分署"]) === bKey);
  if (!confirm(`確認 ${v2DisplayBranch(bKey)} 已完成 ${curMonth} 月份共 ${myCases.length} 件純工程案件之期程與進度填報？`)) return;

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_branch_signoff_month", role: "branch", branch: bKey, passcode: v2AuthState.passcode, roc_month: curMonth, total_eng_count: myCases.length })
    });
    const json = await res.json();
    if (json.status === "success") { alert(json.message); await loadV2LifecycleData(false); }
    else alert(json.message || "簽認失敗");
  } catch (err) {
    alert("簽認失敗：" + err.message);
  }
}

function copyLineProgressReminder() {
  const curMonth = v2CurrentMonth || `${new Date().getFullYear() - 1911}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const mParts = curMonth.split("-");
  const monthLabel = mParts.length === 2 ? `${mParts[0]}年${parseInt(mParts[1], 10)}月` : curMonth;
  const deadlineDay = parseInt(v2ProgressSettings.deadline_day, 10) || 5;
  const todayStr = getTodayIsoDateStr();
  const allEng = getAllPureEngActiveCases();

  const signedSet = new Set(
    (v2ProgressSignoffs || []).filter(s => String(s.roc_month).trim() === curMonth).map(s => v2NormBranch(s.branch_key))
  );

  const lines = [];
  V2_BRANCH_KEYS.forEach(bKey => {
    const bCases = allEng.filter(c => v2NormBranch(c["分署"]) === bKey);
    if (!bCases.length) return;
    const isSigned = signedSet.has(bKey);
    const pending = bCases.filter(c => checkCasePendingIssues(c, todayStr, curMonth).length > 0).length;
    if (!isSigned || pending > 0) {
      lines.push(`・${v2DisplayBranch(bKey)}：${!isSigned ? "未簽認" : "已簽認"}${pending > 0 ? `（待補/未更新 ${pending} 件）` : ""}`);
    }
  });

  const sysUrl = window.location.href.split("#")[0];
  const msg = lines.length
    ? `【治水雲庫 V2｜${monthLabel}工程進度管考提醒】\n請各分署於每月 ${deadlineDay} 日前完成純工程案件期程及進度填報，並點擊「確認完成本月填報」：\n${lines.join("\n")}\n系統網址：${sysUrl}`
    : `【治水雲庫 V2｜${monthLabel}工程進度管考通報】\n感謝各分署配合，全數分署皆已完成本月工程進度填報與簽認！`;

  navigator.clipboard.writeText(msg).then(() => {
    alert("已複製 LINE 群組催報摘要，可直接貼上群組發送！\n\n" + msg);
  }).catch(() => {
    prompt("請手動複製以下 LINE 催報摘要：", msg);
  });
}

async function triggerSendProgressEmail(mode) {
  if (!isProgressHeadquartersAdmin()) return;
  const label = mode === "overdue" ? "逾期稽催信（CC 署本部管考）" : "每月例行填報提醒信";
  if (!confirm(`確定立即向各分署窗口寄發「${label}」？`)) return;
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_send_progress_emails", passcode: v2AuthState.passcode, mode })
    });
    const json = await res.json();
    alert(json.message || "發送完成");
  } catch (err) {
    alert("發送失敗：" + err.message);
  }
}

function buildDayOptionsHtml(selectedVal) {
  const sel = parseInt(selectedVal, 10) || 1;
  let out = "";
  for (let d = 1; d <= 28; d++) {
    out += `<option value="${d}" ${d === sel ? "selected" : ""}>每月 ${d} 日</option>`;
  }
  return out;
}

function openBranchContactsModal() {
  if (!isProgressHeadquartersAdmin()) return;
  ensureV2ProgressModals();

  document.getElementById("selSchedAutoEnabled").value = String(v2ProgressSettings.auto_enabled) === "0" ? "0" : "1";
  document.getElementById("selSchedReminderDay").innerHTML = buildDayOptionsHtml(v2ProgressSettings.reminder_day || 1);
  document.getElementById("selSchedDeadlineDay").innerHTML = buildDayOptionsHtml(v2ProgressSettings.deadline_day || 5);
  document.getElementById("selSchedOverdueDay").innerHTML = buildDayOptionsHtml(v2ProgressSettings.overdue_day || 6);
  document.getElementById("chkSchedOverdueRepeat").checked = String(v2ProgressSettings.overdue_daily_repeat) !== "0";

  const tbody = document.getElementById("tbodyBranchContacts");
  if (tbody) {
    tbody.innerHTML = V2_BRANCH_KEYS.map(k => {
      const found = (v2BranchContacts || []).find(x => v2NormBranch(x.branch_key) === k) || {};
      return `
        <tr>
          <td class="p-1.5 font-bold text-center whitespace-nowrap">${v2DisplayBranch(k)}</td>
          <td class="p-1.5"><input data-bkey="${k}" data-field="contact_name" type="text" value="${escapeHtmlAttr(found.contact_name || "")}" placeholder="承辦人姓名" class="w-full border border-[#1D3557]/20 rounded px-2 py-1" /></td>
          <td class="p-1.5"><input data-bkey="${k}" data-field="contact_email" type="email" value="${escapeHtmlAttr(found.contact_email || "")}" placeholder="分署窗口 Email" class="w-full border border-[#1D3557]/20 rounded px-2 py-1 font-mono" /></td>
          <td class="p-1.5"><input data-bkey="${k}" data-field="cc_email" type="text" value="${escapeHtmlAttr(found.cc_email || "")}" placeholder="署本部稽催 CC Email" class="w-full border border-[#1D3557]/20 rounded px-2 py-1 font-mono" /></td>
        </tr>
      `;
    }).join("");
  }

  const defaultUrl = (v2BranchContacts[0] && v2BranchContacts[0].system_url) || window.location.href.split("#")[0];
  const urlInp = document.getElementById("txtBranchContactSysUrl");
  if (urlInp) urlInp.value = defaultUrl;

  document.getElementById("modalBranchContacts").classList.remove("hidden");
}

async function saveBranchContactsSettings() {
  if (!isProgressHeadquartersAdmin()) return;
  const sysUrl = document.getElementById("txtBranchContactSysUrl")?.value.trim() || "";
  const contacts = V2_BRANCH_KEYS.map(k => {
    const getVal = f => document.querySelector(`#tbodyBranchContacts input[data-bkey="${k}"][data-field="${f}"]`)?.value.trim() || "";
    return {
      branch_key: k,
      contact_name: getVal("contact_name"),
      contact_email: getVal("contact_email"),
      cc_email: getVal("cc_email"),
      system_url: sysUrl
    };
  });

  const settings = {
    auto_enabled: document.getElementById("selSchedAutoEnabled")?.value || "1",
    reminder_day: document.getElementById("selSchedReminderDay")?.value || "1",
    deadline_day: document.getElementById("selSchedDeadlineDay")?.value || "5",
    overdue_day: document.getElementById("selSchedOverdueDay")?.value || "6",
    overdue_daily_repeat: document.getElementById("chkSchedOverdueRepeat")?.checked ? "1" : "0"
  };

  const btn = document.getElementById("btnSaveBranchContacts");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "v2_save_branch_contacts", passcode: v2AuthState.passcode, contacts, settings })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalBranchContacts").classList.add("hidden");
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("儲存失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存設定"; }
  }
}

function exportProgressExcel() {
  const rows = getFilteredProgressRows();
  if (!rows.length) return alert("目前無可匯出的案件資料");
  const data = rows.map(c => {
    const planP = parseFloat(c["預定進度_%"]) || 0;
    const actP = parseFloat(c["實際進度_%"]) || 0;
    return {
      "核定年度": c["核定年度"], "分署": v2DisplayBranch(c["分署"]),
      "工程編號": c["工程編號"] || "", "PCC標案案號": c["pcc_tender_id"] || "",
      "案件名稱": c["案件名稱"], "核定經費_千元": parseFloat(c["核定經費_千元"]) || 0,
      "執行狀態": deriveClientProgressStage(c),
      "預定上網日": c["預定上網日"] || "", "實際上網日": c["實際上網日"] || "",
      "預定決標日": c["預定決標日"] || "", "實際決標日": c["實際決標日"] || "",
      "預定開工日": c["預定開工日"] || "", "實際開工日": c["實際開工日"] || "",
      "預定完工日": c["預定完工日"] || "", "實際完工日": c["實際完工日"] || "",
      "預定進度_%": planP, "實際進度_%": actP, "進度差異_%": Number((actP - planP).toFixed(2)),
      "最後更新月份": c["最後更新月份"] || "", "最後更新者": c["最後更新者"] || ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工程進度管考");
  XLSX.writeFile(wb, `治水雲庫V2_工程進度管考表_${getTodayIsoDateStr()}.xlsx`);
}

function ensureV2ProgressModals() {
  if (!document.getElementById("modalV2ProgressEdit")) {
    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalV2ProgressEdit" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3 text-xs">
          <div class="flex items-center justify-between border-b border-[#1D3557]/15 pb-2">
            <h2 id="progEdModalTitle" class="text-base font-bold text-[#1D3557]">工程進度管考填報</h2>
            <button type="button" onclick="document.getElementById('modalV2ProgressEdit').classList.add('hidden')" class="text-xs font-bold text-[#1D3557]/60 hover:text-[#1D3557]">✕</button>
          </div>
          <input type="hidden" id="progEdUid" />
          <div id="progEdCaseHeader" class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded p-2.5"></div>

          <div class="bg-white border border-[#1D3557]/15 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#ED6D35] border-b border-slate-100 pb-1">1. 決標與完工期程（分署核心填報項目）</div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="font-bold block mb-1 text-[#1D3557]">預定決標日期</label><input id="progEdPlanBid" type="date" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#004E89]">實際決標日期</label><input id="progEdActBid" type="date" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#1D3557]">預定完工日期</label><input id="progEdPlanEnd" type="date" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#004E89]">實際完工日期</label><input id="progEdActEnd" type="date" class="w-full border border-[#004E89]/35 bg-white rounded px-2 py-1 font-mono" /></div>
            </div>
          </div>

          <div class="bg-white border border-[#1D3557]/15 rounded p-3 space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1">
              <span class="font-bold text-[#004E89]">2. 上網與開工期程</span>
              <div class="flex items-center gap-1.5">
                <label class="text-[11px] text-[#1D3557]/70">PCC標案案號(選填)：</label>
                <input id="progEdPccId" type="text" placeholder="保留供後續API界接" class="border border-[#1D3557]/20 rounded px-2 py-0.5 font-mono text-[11px] w-40" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="font-bold block mb-1">預定上網日期</label><input id="progEdPlanTender" type="date" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1">實際上網日期</label><input id="progEdActTender" type="date" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1">預定開工日期</label><input id="progEdPlanStart" type="date" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1">實際開工日期</label><input id="progEdActStart" type="date" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" /></div>
            </div>
          </div>

          <div class="bg-white border border-[#1D3557]/15 rounded p-3 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-100 pb-1">
              <span class="font-bold text-[#004E89]">3. 工程累計進度（%）</span>
              <span class="text-[11px] text-[#1D3557]/65">上月實際進度：<strong id="progEdPrevPct" class="font-mono">0.00%</strong></span>
            </div>
            <div class="grid grid-cols-3 gap-3 items-end">
              <div><label class="font-bold block mb-1">累計預定進度 (%)</label><input id="progEdPlanPct" type="number" step="0.01" min="0" max="100" oninput="updateModalProgressDiffPreview()" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-mono" /></div>
              <div><label class="font-bold block mb-1 text-[#ED6D35]">累計實際進度 (%)</label><input id="progEdActPct" type="number" step="0.01" min="0" max="100" oninput="updateModalProgressDiffPreview()" class="w-full border border-[#ED6D35]/50 bg-white rounded px-2 py-1 font-mono font-bold" /></div>
              <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded px-3 py-1.5 text-right">
                <div class="text-[10px] text-[#1D3557]/70">進度差異（實際－預定）</div>
                <div id="progEdDiffPreview" class="font-mono font-bold text-sm">0.00%</div>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button type="button" onclick="document.getElementById('modalV2ProgressEdit').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">關閉</button>
            <button type="button" id="btnSaveProgressEdit" onclick="saveV2ProgressEdit()" class="px-4 py-1.5 bg-[#ED6D35] hover:bg-[#D65A24] text-white rounded font-bold">儲存進度</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(d.firstElementChild);
  }

  if (!document.getElementById("modalBranchContacts")) {
    const d = document.createElement("div");
    d.innerHTML = `
      <div id="modalBranchContacts" class="hidden fixed inset-0 bg-[#1D3557]/65 flex items-center justify-center z-50 p-4">
        <div class="bg-[#F7F5F0] rounded-lg shadow-xl p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto space-y-3 text-xs">
          <div class="flex items-center justify-between border-b border-[#1D3557]/15 pb-2">
            <h2 class="text-base font-bold text-[#1D3557]">月報自動通報排程與各分署窗口 Email 設定</h2>
            <button type="button" onclick="document.getElementById('modalBranchContacts').classList.add('hidden')" class="text-xs font-bold text-[#1D3557]/60 hover:text-[#1D3557]">✕</button>
          </div>

          <!-- 前端排程日期與總開關設定區 -->
          <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded p-3 space-y-2.5">
            <div class="font-bold text-[#ED6D35]">1. 每月自動通報與稽催日期規則（管考人員可隨時調整）</div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label class="font-bold block mb-1 text-[#1D3557]">自動發信排程狀態</label>
                <select id="selSchedAutoEnabled" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-bold text-[#1D3557]">
                  <option value="1">啟用自動排程</option>
                  <option value="0">暫停（僅手動發信）</option>
                </select>
              </div>
              <div>
                <label class="font-bold block mb-1 text-[#004E89]">每月例行提醒日</label>
                <select id="selSchedReminderDay" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1"></select>
              </div>
              <div>
                <label class="font-bold block mb-1 text-[#1D3557]">每月填報截止日</label>
                <select id="selSchedDeadlineDay" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1"></select>
              </div>
              <div>
                <label class="font-bold block mb-1 text-[#ED6D35]">每月逾期稽催日</label>
                <select id="selSchedOverdueDay" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1"></select>
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label class="inline-flex items-center gap-1.5 cursor-pointer font-medium text-[#1D3557]">
                <input id="chkSchedOverdueRepeat" type="checkbox" class="rounded accent-[#ED6D35]" />
                <span>逾期稽催日後，每日持續自動稽催尚未完成簽認之分署（直到該分署簽認完成為止）</span>
              </label>
            </div>
            <div class="flex items-center gap-2 pt-1 border-t border-[#1D3557]/10">
              <label class="font-bold shrink-0">信件內附系統網址：</label>
              <input id="txtBranchContactSysUrl" type="text" class="flex-1 border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
            </div>
          </div>

          <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
            <table class="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th class="p-2 text-center">分署別</th>
                  <th class="p-2 text-left">承辦窗口姓名</th>
                  <th class="p-2 text-left">收件人 Email（必填才會發信）</th>
                  <th class="p-2 text-left">副本 CC Email（署本部管考人員）</th>
                </tr>
              </thead>
              <tbody id="tbodyBranchContacts" class="divide-y divide-slate-200"></tbody>
            </table>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" onclick="document.getElementById('modalBranchContacts').classList.add('hidden')" class="px-3 py-1.5 bg-white border border-[#1D3557]/20 rounded font-bold">取消</button>
            <button type="button" id="btnSaveBranchContacts" onclick="saveBranchContactsSettings()" class="px-4 py-1.5 bg-[#ED6D35] text-white rounded font-bold">儲存設定</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(d.firstElementChild);
  }
}