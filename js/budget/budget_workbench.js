/**
 * 治水雲庫 V2 — 案件經費登載主外殼與調度器
 */

function selectV2BudgetCase(uid) {
  if (v2BudgetSelectedUid !== uid) {
    v2BudgetSelectedUid = uid;
    resetV2BudgetDraftForCase(uid);
  }
  renderBudgetCaseSelector();
  renderBudgetWorkbenchArea();
}

function renderBudgetView() {
  const container = document.getElementById("viewBudget");
  if (!container) return;

  const prev = getBudgetFilters();
  const activeList = (v2ActiveCases || []).filter(c => c.lifecycle_stage !== "撤案");
  const years = Array.from(new Set(activeList.map(c => String(c["核定年度"])).filter(Boolean))).sort().reverse();

  const pendingPlannedCount = v2BudgetPlanned.filter(p => p.status === "待確認").length;
  const controlledCount = activeList.filter(c => !isV2NonControlledCase(c)).length;

  container.innerHTML = `
    <!-- 頂部子模式、帳本輸出與單位切換列 -->
    <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[#1D3557]/15 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-md border border-[#1D3557]/20 bg-white p-0.5">
          <button type="button" onclick="setV2BudgetSubMode('workbench')" class="px-3 py-1 rounded font-bold transition ${v2BudgetSubMode === "workbench" ? "bg-[#1D3557] text-white" : "text-[#1D3557] hover:bg-[#FAF3E0]"}">單案經費工作台</button>
          <button type="button" onclick="setV2BudgetSubMode('crossyear')" class="px-3 py-1 rounded font-bold transition ${v2BudgetSubMode === "crossyear" ? "bg-[#1D3557] text-white" : "text-[#1D3557] hover:bg-[#FAF3E0]"}">跨年度案件表</button>
        </div>
        <span class="px-2 py-0.5 rounded bg-[#FAF3E0] border border-[#1D3557]/15 text-[#1D3557] font-medium">
          控管案件 ${controlledCount} 筆
        </span>
        <span class="px-2 py-0.5 rounded bg-[#ED6D35]/15 text-[#ED6D35] font-bold">
          待確認通知 ${pendingPlannedCount} 筆
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        ${v2BudgetSubMode === "workbench" ? `
          <div class="inline-flex items-center gap-1 bg-[#FAF3E0] border border-[#1D3557]/15 rounded px-2 py-0.5">
            <span class="text-[#1D3557] font-bold">紙本帳本：</span>
            <select onchange="setV2LedgerExportScope(this.value)" class="border border-[#1D3557]/20 rounded px-1.5 py-0.5 bg-white text-[#1D3557] text-[11px]">
              <option value="filtered" ${v2LedgerExportScope === "filtered" ? "selected" : ""}>目前篩選控管案</option>
              <option value="current" ${v2LedgerExportScope === "current" ? "selected" : ""}>僅目前選取案件</option>
            </select>
            <button type="button" onclick="openV2LedgerPrintView()" class="px-2 py-0.5 rounded bg-[#1D3557] hover:bg-[#004E89] text-white font-bold text-[11px] transition">A4 列印 / PDF</button>
            <button type="button" onclick="exportV2LedgerExcel()" class="px-2 py-0.5 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold text-[11px] transition">下載帳本 Excel</button>
          </div>
        ` : ""}

        <div class="inline-flex items-center gap-1.5">
          <span class="text-[#1D3557]/70 font-medium">總覽單位：</span>
          <div class="inline-flex rounded border border-[#1D3557]/20 bg-white p-0.5">
            <button type="button" onclick="setV2BudgetDisplayUnit('yuan')" class="px-2.5 py-0.5 rounded font-bold transition ${v2BudgetDisplayUnit === "yuan" ? "bg-[#004E89] text-white" : "text-[#1D3557]"}">元</button>
            <button type="button" onclick="setV2BudgetDisplayUnit('thousand')" class="px-2.5 py-0.5 rounded font-bold transition ${v2BudgetDisplayUnit === "thousand" ? "bg-[#004E89] text-white" : "text-[#1D3557]"}">千元</button>
          </div>
        </div>
      </div>
    </div>

    ${v2BudgetSubMode === "crossyear" ? renderCrossYearBatchView() : `
      <!-- 案件篩選器 -->
      <div class="bg-white border border-[#1D3557]/15 rounded-lg p-2.5 mb-2.5 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <select id="selBudYear" onchange="renderBudgetCaseSelector(); renderBudgetWorkbenchArea();" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
            <option value="ALL">全部核定年度</option>
            ${years.map(y => `<option value="${y}">${y} 年度</option>`).join("")}
          </select>
          <select id="selBudBranch" onchange="renderBudgetCaseSelector(); renderBudgetWorkbenchArea();" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
            <option value="ALL">全部分署</option>
            ${V2_BRANCH_KEYS.map(b => `<option value="${b}">${v2DisplayBranch(b)}</option>`).join("")}
          </select>
          <select id="selBudControlNature" onchange="renderBudgetCaseSelector(); renderBudgetWorkbenchArea();" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557] font-medium">
            <option value="CONTROLLED">控管案件（預設）</option>
            <option value="NON_CONTROLLED">非控管案件</option>
            <option value="ALL">全部性質</option>
          </select>
          <select id="selBudHandlingStatus" onchange="renderBudgetCaseSelector(); renderBudgetWorkbenchArea();" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557]">
            <option value="ALL">全部辦理情形</option>
            <option value="一般案件">一般案件</option>
            <option value="尚未決標">尚未決標</option>
            <option value="暫緩辦理">暫緩辦理</option>
            <option value="解約">解約</option>
          </select>
          <input id="txtBudKeyword" type="text" oninput="renderBudgetCaseSelector(); renderBudgetWorkbenchArea();" placeholder="案名 / 完整工程編號（精準比對）/ 縣市" class="border border-[#1D3557]/20 rounded px-2.5 py-1 bg-white flex-1 min-w-[220px]" />
        </div>
      </div>

      <!-- 主工作版面：左側選案清單 ＋ 右側單案工作台 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-4 bg-white border border-[#1D3557]/15 rounded-lg flex flex-col max-h-[880px]">
          <div class="px-3 py-2 bg-[#1D3557] text-white text-xs font-bold flex items-center justify-between rounded-t-lg border-b-2 border-[#ED6D35]">
            <span>篩選案件清單</span>
            <span id="lblBudgetListCount" class="font-mono text-[#FAF3E0]">0 筆</span>
          </div>
          <div id="budgetCaseListContainer" class="divide-y divide-slate-200 overflow-y-auto flex-1 text-xs"></div>
        </div>

        <div id="budgetWorkbenchPanel" class="lg:col-span-8 space-y-2.5"></div>
      </div>
    `}
  `;

  if (v2BudgetSubMode === "workbench") {
    if (document.getElementById("selBudYear") && (prev.year === "ALL" || years.includes(prev.year))) document.getElementById("selBudYear").value = prev.year;
    if (document.getElementById("selBudBranch")) document.getElementById("selBudBranch").value = prev.branch;
    if (document.getElementById("selBudControlNature")) document.getElementById("selBudControlNature").value = prev.nature;
    if (document.getElementById("selBudHandlingStatus")) document.getElementById("selBudHandlingStatus").value = prev.status;
    if (document.getElementById("txtBudKeyword")) document.getElementById("txtBudKeyword").value = prev.kw;

    renderBudgetCaseSelector();
    renderBudgetWorkbenchArea();
  }
}

function renderBudgetCaseSelector() {
  const listEl = document.getElementById("budgetCaseListContainer");
  const cntEl = document.getElementById("lblBudgetListCount");
  if (!listEl) return;

  const list = getFilteredBudgetCases();
  if (cntEl) cntEl.textContent = `${list.length.toLocaleString()} 筆`;

  if (!list.length) {
    v2BudgetSelectedUid = "";
    listEl.innerHTML = `<div class="py-10 text-center text-slate-400">查無符合條件之案件</div>`;
    return;
  }

  if (!list.some(c => c.case_uid === v2BudgetSelectedUid)) {
    v2BudgetSelectedUid = list[0].case_uid;
    resetV2BudgetDraftForCase(v2BudgetSelectedUid);
  } else if (v2BudgetDraft.caseUid !== v2BudgetSelectedUid) {
    resetV2BudgetDraftForCase(v2BudgetSelectedUid);
  }

  const unitLbl = getBudgetUnitLabel();

  listEl.innerHTML = list.map(c => {
    const selected = c.case_uid === v2BudgetSelectedUid;
    const comp = computeV2CaseLatestBudget(c);
    const hStatus = calcV2HandlingStatus(c, comp);
    const isNonCtrl = isV2NonControlledCase(c);
    const pendingCnt = v2BudgetPlanned.filter(p => p.case_uid === c.case_uid && p.status === "待確認").length;

    const statusBadgeCls = hStatus === "解約"
      ? "bg-rose-100 text-rose-700"
      : (hStatus === "暫緩辦理" ? "bg-amber-100 text-amber-800" : (hStatus === "尚未決標" ? "bg-slate-200 text-slate-700" : "bg-[#004E89]/10 text-[#004E89]"));

    return `
      <div onclick="selectV2BudgetCase('${escapeHtmlAttr(c.case_uid)}')"
           class="p-2.5 cursor-pointer transition ${selected ? "bg-[#FAF3E0] border-l-4 border-[#ED6D35]" : "hover:bg-[#F7F5F0] border-l-4 border-transparent"}">
        <div class="flex items-center justify-between gap-1.5 mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-bold text-[#1D3557] shrink-0">${escapeHtmlAttr(c["核定年度"])}年</span>
            <span class="font-bold text-[#004E89] shrink-0">${v2DisplayBranch(c["分署"])}</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${statusBadgeCls}">${hStatus}</span>
            ${comp.isSettled ? `<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">已決算</span>` : ""}
            ${isNonCtrl ? `<span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 border border-slate-300">非控管</span>` : ""}
          </div>
          ${pendingCnt > 0 ? `<span class="px-1.5 py-0.2 rounded bg-[#ED6D35] text-white text-[10px] font-bold shrink-0">通知 ${pendingCnt}</span>` : ""}
        </div>
        <div class="font-bold text-[#1D3557] leading-snug break-words">${escapeHtmlAttr(c["案件名稱"])}</div>
        <div class="flex items-center justify-between gap-2 mt-1 text-[11px] text-[#1D3557]/70">
          <span class="font-mono truncate">${escapeHtmlAttr(c["工程編號"] || "編號待補")}</span>
          <span class="font-mono font-bold text-[#1D3557] shrink-0">${formatBudgetAmount(comp.summary.total_fee)} ${unitLbl}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderBudgetWorkbenchArea() {
  const panel = document.getElementById("budgetWorkbenchPanel");
  if (!panel) return;

  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) {
    panel.innerHTML = `
      <div class="bg-white border border-[#1D3557]/15 rounded-lg p-10 text-center text-xs text-slate-400">
        請由左側選取案件以檢視經費帳本
      </div>
    `;
    return;
  }

  if (v2BudgetDraft.caseUid !== caseObj.case_uid) {
    resetV2BudgetDraftForCase(caseObj.case_uid);
  }

  const comp = computeV2CaseLatestBudget(caseObj);
  const hStatus = calcV2HandlingStatus(caseObj, comp);
  const isNonCtrl = isV2NonControlledCase(caseObj);
  const unitLbl = getBudgetUnitLabel();
  const canEditBase = typeof canEditApproval === "function" ? canEditApproval() : Boolean(adminPasscode);

  const casePlanned = v2BudgetPlanned.filter(p => p.case_uid === caseObj.case_uid);
  const pendingPlanned = casePlanned.filter(p => p.status === "待確認");
  const caseCross = v2BudgetCrossYear.filter(x => x.case_uid === caseObj.case_uid);
  const caseAudits = v2BudgetAuditLogs.filter(a => a.case_uid === caseObj.case_uid);

  const locText = [caseObj["縣市"], caseObj["鄉鎮"], caseObj["水系"], caseObj["溪別"]].filter(Boolean).join(" / ") || "-";
  const completionDate = String(caseObj["實際完工日"] || "").trim();
  const prevCodesStr = String(caseObj["前次工程編號"] || "").trim();
  const reapprLogStr = String(caseObj["重新核定歷程"] || "").trim();

  // 1. 常駐當前案件摘要條
  const summaryBarHtml = `
    <div class="bg-[#1D3557] text-white rounded-lg p-3 shadow-xs border-l-4 border-[#ED6D35] space-y-2 text-xs">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5 mb-1">
            <span class="px-1.5 py-0.5 rounded bg-white/15 font-mono text-[11px]">${escapeHtmlAttr(caseObj.case_uid)}</span>
            <span class="px-1.5 py-0.5 rounded bg-[#ED6D35] text-white font-bold text-[10px]">${getV2CaseControlNature(caseObj)}</span>
            <span class="px-1.5 py-0.5 rounded bg-white/15 text-[#FAF3E0] font-bold text-[10px]">${hStatus}</span>
            ${comp.isSettled ? `<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold text-[10px]">已決算</span>` : ""}
            ${completionDate ? `<span class="px-1.5 py-0.5 rounded bg-[#004E89] text-white text-[10px]">完工日：${escapeHtmlAttr(completionDate)}</span>` : ""}
          </div>
          <div class="text-sm font-bold leading-snug">${escapeHtmlAttr(caseObj["案件名稱"])}</div>
          <div class="text-[11px] text-white/80 mt-0.5">
            ${v2DisplayBranch(caseObj["分署"])} ｜ ${escapeHtmlAttr(caseObj["性質"] || "-")} / ${escapeHtmlAttr(caseObj["類別"] || "-")} ｜ ${escapeHtmlAttr(locText)}
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#FAF3E0] font-mono mt-0.5">
            <span>主工程編號：${escapeHtmlAttr(caseObj["工程編號"] || "待補登")}</span>
            ${prevCodesStr ? `<span class="px-1.5 py-0.2 rounded bg-white/15 text-slate-200 text-[10px]" title="${escapeHtmlAttr(reapprLogStr)}">原編號：${escapeHtmlAttr(prevCodesStr)}</span>` : ""}
            ${caseObj["核定文號"] ? `<span>｜ 核定文號：${escapeHtmlAttr(caseObj["核定文號"])}</span>` : ""}
          </div>
          ${reapprLogStr ? `<div class="text-[10px] text-[#FAF3E0]/85 mt-0.5">跨年重核定歷程：${escapeHtmlAttr(reapprLogStr)}</div>` : ""}
        </div>

        <div class="flex flex-col items-end gap-1.5 shrink-0">
          ${canEditBase ? `<button type="button" onclick="openV2ApprovalEditModal('${escapeHtmlAttr(caseObj.case_uid)}')" class="px-2.5 py-1 rounded bg-white/15 hover:bg-[#ED6D35] text-white font-bold text-[11px] transition">編輯基本資料</button>` : ""}
          <div class="text-right">
            <div class="text-[10px] text-white/70">核定經費（${unitLbl}）</div>
            <div class="text-sm font-bold font-mono text-[#FAF3E0]">${formatBudgetAmount(comp.approvedYuan)}</div>
          </div>
        </div>
      </div>

      ${!isNonCtrl ? `
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-2 border-t border-white/15 text-[11px]">
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">目前總經費</div>
            <div class="font-mono font-bold text-[#FAF3E0]">${formatBudgetAmount(comp.summary.total_fee)}</div>
          </div>
          ${V2_FEE_KEYS.map(fk => `
            <div class="bg-white/10 rounded px-2 py-1">
              <div class="text-white/70 text-[10px]">${fk.label}</div>
              <div class="font-mono">${formatBudgetAmount(comp.summary[fk.field])}</div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="pt-2 border-t border-white/15 text-[11px] text-[#FAF3E0]">
          本案為「非控管案件（維修改善 / 構造物 / 歲修復建）」，僅統計案件數、工程長度與參考經費，不建立正式五費目帳本。
        </div>
      `}
    </div>
  `;

  // 2. 各年度最新有效經費與跨年度整合表
  let annualTableHtml = "";
  if (isNonCtrl) {
    const usableYuan = Math.round((parseFloat(caseObj["可支用經費_千元"]) || 0) * 1000);
    annualTableHtml = `
      <div class="bg-white border border-[#1D3557]/15 rounded-lg p-3 text-xs space-y-2">
        <div class="font-bold text-[#1D3557] flex items-center justify-between">
          <span>非控管案件參考經費摘要（單位：${unitLbl}）</span>
          <span class="text-[11px] text-[#1D3557]/60">不計入正式預算帳本</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-[#F7F5F0] border border-[#1D3557]/12 rounded p-2.5">
            <div class="text-[#1D3557]/70">核定參考經費</div>
            <div class="text-base font-bold font-mono text-[#1D3557] mt-0.5">${formatBudgetAmount(comp.approvedYuan)} ${unitLbl}</div>
          </div>
          <div class="bg-[#F7F5F0] border border-[#1D3557]/12 rounded p-2.5">
            <div class="text-[#1D3557]/70">當年度可支用參考經費</div>
            <div class="text-base font-bold font-mono text-[#004E89] mt-0.5">${formatBudgetAmount(usableYuan)} ${unitLbl}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    const crossByFromYear = {};
    caseCross.forEach(x => { crossByFromYear[parseInt(x.from_year, 10)] = x; });

    const tableRowsHtml = comp.rows.map(r => {
      const cy = crossByFromYear[r.fund_year];
      const isSettledYr = comp.isSettled && comp.settledYear && r.fund_year >= comp.settledYear;

      let cyContinue = "-";
      let cyNoBudget = "-";
      let cyRelist = "-";
      if (isSettledYr) {
        cyContinue = "已決算";
      } else if (cy) {
        if (cy.cross_mode === "續列後續年度") cyContinue = `續列 → ${cy.to_year}`;
        else if (cy.cross_mode === "次年無經費未決算") cyNoBudget = "次年無經費";
        else if (cy.cross_mode === "改列其他年度新案") cyRelist = `改列 ${cy.relist_year || cy.to_year}`;
      }

      const rowBg = r.is_placeholder
        ? "bg-[#FAF3E0]/70"
        : (r.is_refund ? "bg-rose-50/70" : "bg-white");

      const feeCellsHtml = V2_FEE_KEYS.map(fk => {
        const val = r[fk.field];
        const negCls = fk.key === "air" && val < 0 ? "text-rose-700 font-bold" : "";
        return `<td class="px-2 py-1.5 text-right font-mono ${negCls}">${formatBudgetAmount(val)}</td>`;
      }).join("");

      return `
        <tr class="${rowBg} hover:bg-[#FAF3E0]/50">
          <td class="px-2 py-1.5 font-bold text-[#1D3557] whitespace-nowrap">${escapeHtmlAttr(r.year_label)}</td>
          <td class="px-2 py-1.5 font-mono text-[#1D3557]/85 whitespace-nowrap">${escapeHtmlAttr(r.year_project_code || "-")}</td>
          ${feeCellsHtml}
          <td class="px-2 py-1.5 text-right font-mono font-bold bg-[#EAF2F9]/60 text-[#1D3557]">${formatBudgetAmount(r.total_fee)}</td>
          <td class="px-2 py-1.5 text-center text-[11px] bg-[#eaf4ff]/70 text-[#1f4d73] whitespace-nowrap">${escapeHtmlAttr(cyContinue)}</td>
          <td class="px-2 py-1.5 text-center text-[11px] bg-[#fff4e8]/70 text-[#6a4a10] whitespace-nowrap">${escapeHtmlAttr(cyNoBudget)}</td>
          <td class="px-2 py-1.5 text-center text-[11px] bg-[#f2ecff]/70 text-[#50357e] whitespace-nowrap">${escapeHtmlAttr(cyRelist)}</td>
        </tr>
      `;
    }).join("");

    annualTableHtml = `
      <div class="bg-white border border-[#1D3557]/15 rounded-lg p-3 space-y-2 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-[#1D3557]">各年度最新有效經費與跨年度整合表（單位：${unitLbl}）</div>
          ${comp.isUsingPlaceholder ? `<span class="px-2 py-0.5 rounded bg-[#FAF3E0] text-[#ED6D35] border border-[#ED6D35]/35 font-bold text-[11px]">核定經費暫代顯示（尚無分錄登帳）</span>` : ""}
        </div>
        <div class="overflow-x-auto border border-[#1D3557]/15 rounded">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th class="px-2 py-2 whitespace-nowrap">年度 / 階段</th>
                <th class="px-2 py-2 whitespace-nowrap">年度工程編號</th>
                ${V2_FEE_KEYS.map(fk => `<th class="px-2 py-2 text-right whitespace-nowrap">${fk.label}</th>`).join("")}
                <th class="px-2 py-2 text-right whitespace-nowrap">合計</th>
                <th class="px-2 py-2 text-center whitespace-nowrap">延續續列</th>
                <th class="px-2 py-2 text-center whitespace-nowrap">次年無經費</th>
                <th class="px-2 py-2 text-center whitespace-nowrap">改列新案</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${tableRowsHtml || `<tr><td colspan="11" class="py-6 text-center text-slate-400">尚無年度經費資料</td></tr>`}
              <tr class="bg-[#F7F5F0] font-bold text-[#1D3557]">
                <td class="px-2 py-2" colspan="2">合計</td>
                ${V2_FEE_KEYS.map(fk => `<td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary[fk.field])}</td>`).join("")}
                <td class="px-2 py-2 text-right font-mono bg-[#EAF2F9] text-[#1D3557]">${formatBudgetAmount(comp.summary.total_fee)}</td>
                <td class="px-2 py-2" colspan="3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 3. 四大作業頁籤區
  const tabsHtml = !isNonCtrl ? renderBudgetWorkbenchTabs(caseObj, comp, casePlanned, pendingPlanned, caseAudits, unitLbl) : "";

  panel.innerHTML = summaryBarHtml + annualTableHtml + tabsHtml;
}

function renderBudgetWorkbenchTabs(caseObj, comp, casePlanned, pendingPlanned, caseAudits, unitLbl) {
  const tabDefs = [
    { key: "planned", label: "1. 預計增減通知", badge: pendingPlanned.length },
    { key: "revision", label: "2. 正式變更／結算", badge: 0 },
    { key: "settlement", label: "3. 空污退回與決算", badge: comp.refundEntries.length + comp.settlementEntries.length },
    { key: "history", label: "4. 經費歷程與稽核", badge: comp.allValidEntries.length }
  ];

  const tabBar = tabDefs.map(t => {
    const active = v2BudgetActiveTab === t.key;
    const activeCls = t.key === "planned"
      ? (active ? "bg-[#ED6D35] text-white" : "bg-white text-[#1D3557] hover:bg-[#FAF3E0]")
      : (active ? "bg-[#1D3557] text-white" : "bg-white text-[#1D3557] hover:bg-[#FAF3E0]");
    return `
      <button type="button" onclick="setV2BudgetActiveTab('${t.key}')"
              class="px-3 py-1.5 rounded-t text-xs font-bold border border-b-0 border-[#1D3557]/15 transition inline-flex items-center gap-1.5 ${activeCls}">
        <span>${t.label}</span>
        ${t.badge > 0 ? `<span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${active ? "bg-white/25 text-white" : "bg-[#ED6D35]/15 text-[#ED6D35]"}">${t.badge}</span>` : ""}
      </button>
    `;
  }).join("");

  let bodyHtml = "";
  if (v2BudgetActiveTab === "planned") {
    bodyHtml = renderPlannedNoticeTab(caseObj, comp, casePlanned, unitLbl);
  } else if (v2BudgetActiveTab === "revision") {
    bodyHtml = renderOfficialRevisionTab(caseObj, comp);
  } else if (v2BudgetActiveTab === "settlement") {
    bodyHtml = renderSettlementAndRefundTab(caseObj, comp, unitLbl);
  } else {
    bodyHtml = renderHistoryAndAuditTab(caseObj, comp, caseAudits, unitLbl);
  }

  return `
    <div class="pt-1">
      <div class="flex flex-wrap items-center gap-1">${tabBar}</div>
      <div class="bg-white border border-[#1D3557]/15 rounded-b-lg rounded-tr-lg p-3">
        ${bodyHtml}
      </div>
    </div>
  `;
}