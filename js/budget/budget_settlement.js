/**
 * 治水雲庫 V2 — 頁籤 3 & 4：空污費退回、完工日期、最終決算與歷程作廢稽核
 */

function onSettleYearChange(newYearVal) {
  const yr = parseInt(newYearVal, 10) || (new Date().getFullYear() - 1911);
  v2BudgetDraft.settleYear = yr;
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (caseObj) {
    const comp = computeV2CaseLatestBudget(caseObj);
    const amt = getPostedAmountForYear(comp, yr);
    V2_FEE_KEYS.forEach(fk => {
      v2BudgetDraft[fk.settleField] = String(amt[fk.field] || 0);
    });
  }
  renderBudgetWorkbenchArea();
}

function updateSettleFeeField(field, val) {
  v2BudgetDraft[field] = val;
  refreshSettlementSummaryBar();
}

function refreshSettlementSummaryBar() {
  const bar = document.getElementById("settlementSummaryBar");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!bar || !caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  const cur = getPostedAmountForYear(comp, v2BudgetDraft.settleYear);

  let tot = 0;
  const diffParts = V2_FEE_KEYS.map(fk => {
    const nv = parseYuanInput(v2BudgetDraft[fk.settleField]);
    tot += nv;
    return `${fk.label} ${formatSignedYuan(nv - (cur[fk.field] || 0))}`;
  });
  const delta = tot - cur.total_fee;

  bar.innerHTML = `
    <div class="bg-[#EAF2F9] border border-[#1D3557]/15 rounded px-3 py-2 text-xs space-y-1">
      <div class="font-bold text-[#1D3557]">
        決算合計：<span class="font-mono text-[#004E89]">${tot.toLocaleString()}</span> 元
        ｜ ${v2BudgetDraft.settleYear} 年度前次合計：<span class="font-mono">${cur.total_fee.toLocaleString()}</span> 元
        ｜ 結餘／增減：<span class="font-mono text-[#ED6D35]">${formatDirectionYuan(delta)}</span>
      </div>
      <div class="text-[11px] text-[#1D3557]/75 font-mono">各費目差額：${diffParts.join(" ｜ ")}</div>
    </div>
  `;
}

async function submitAirRefund() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;
  const amt = Math.abs(parseYuanInput(v2BudgetDraft.refundAmount));
  if (amt <= 0) return alert("請輸入大於 0 的空污費退回金額");

  const btn = document.getElementById("btnSaveAirRefund");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const comp = computeV2CaseLatestBudget(caseObj);
    const yrCode = comp.yearMap?.[v2BudgetDraft.refundYear]?.year_project_code || caseObj["工程編號"] || "";
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_add_air_refund",
        passcode: adminPasscode,
        record: {
          case_uid: caseObj.case_uid,
          refund_year: parseInt(v2BudgetDraft.refundYear, 10),
          refund_date: v2BudgetDraft.refundDate,
          doc_no: v2BudgetDraft.refundDocNo,
          year_project_code: yrCode,
          refund_amount: amt,
          remark: v2BudgetDraft.refundRemark
        }
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存空污費退回"; }
  }
}

async function submitCompletionDateOnly() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;

  const btn = document.getElementById("btnSaveCompletionDate");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_set_completion_date",
        passcode: adminPasscode,
        case_uid: caseObj.case_uid,
        completion_date: v2BudgetDraft.completionDate
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存完工日期"; }
  }
}

async function submitFinalSettlement() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;

  const yr = parseInt(v2BudgetDraft.settleYear, 10);
  if (!yr || yr < 90 || yr > 150) return alert("請輸入合法決算年度");
  if (!confirm(`確定儲存 ${yr} 年度決算資料？\n儲存後系統將自動取消 ${yr} 年度（含）以後的跨年度續列設定。`)) return;

  const btn = document.getElementById("btnSaveFinalSettlement");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const comp = computeV2CaseLatestBudget(caseObj);
    const yrCode = comp.yearMap?.[yr]?.year_project_code || caseObj["工程編號"] || "";
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_save_settlement",
        passcode: adminPasscode,
        record: {
          case_uid: caseObj.case_uid,
          settlement_year: yr,
          settlement_date: v2BudgetDraft.settleDate,
          doc_no: v2BudgetDraft.settleDocNo,
          year_project_code: yrCode,
          work_fee: parseYuanInput(v2BudgetDraft.settleWork),
          air_fee: parseYuanInput(v2BudgetDraft.settleAir),
          other_fee: parseYuanInput(v2BudgetDraft.settleOther),
          mgmt_fee: parseYuanInput(v2BudgetDraft.settleMgmt),
          land_fee: parseYuanInput(v2BudgetDraft.settleLand),
          remark: v2BudgetDraft.settleRemark
        }
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "儲存失敗");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "儲存最終決算"; }
  }
}

function renderSettlementAndRefundTab(caseObj, comp, unitLbl) {
  const isAdmin = Boolean(adminPasscode);
  const curSettleAmt = getPostedAmountForYear(comp, v2BudgetDraft.settleYear);
  const curSettleText = V2_FEE_KEYS.map(fk => `${fk.label} ${(curSettleAmt[fk.field] || 0).toLocaleString()}`).join(" ｜ ");

  const refundListHtml = comp.refundEntries.map(r => `
    <tr class="bg-white">
      <td class="px-2 py-1.5 text-center font-bold">${escapeHtmlAttr(r.fund_year)}</td>
      <td class="px-2 py-1.5 font-mono">${escapeHtmlAttr(r.doc_date || "-")}</td>
      <td class="px-2 py-1.5 font-mono">${escapeHtmlAttr(r.doc_no || "-")}</td>
      <td class="px-2 py-1.5 text-right font-mono font-bold text-rose-700">${formatBudgetAmount(r.air_fee)}</td>
      <td class="px-2 py-1.5">${escapeHtmlAttr(r.remark || "-")}</td>
      ${isAdmin ? `<td class="px-2 py-1.5 text-center"><button type="button" onclick="voidBudgetVersionGroup('${escapeHtmlAttr(r.version_group_id)}','空污費退回')" class="text-rose-600 hover:text-rose-800 font-bold">作廢</button></td>` : ""}
    </tr>
  `).join("");

  setTimeout(refreshSettlementSummaryBar, 0);

  return `
    <div class="space-y-4 text-xs">
      <!-- 區塊 A：空污費退回 -->
      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2.5">
        <div class="flex items-center justify-between border-b border-[#1D3557]/12 pb-1">
          <div class="font-bold text-[#1D3557]">A. 空污費退回登打（獨立負數列，不扣抵其他費）</div>
          <span class="text-[11px] text-[#1D3557]/65">單位：元</span>
        </div>
        ${isAdmin ? `
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label class="font-bold block mb-1">退回年度</label>
              <input type="number" min="90" max="150" value="${v2BudgetDraft.refundYear}" onchange="updateRevDraftField('refundYear', parseInt(this.value,10)||115)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
            </div>
            <div>
              <label class="font-bold block mb-1">登打日期</label>
              <input type="date" value="${escapeHtmlAttr(v2BudgetDraft.refundDate)}" onchange="updateRevDraftField('refundDate', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
            </div>
            <div>
              <label class="font-bold block mb-1">內部文號</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.refundDocNo)}" oninput="updateRevDraftField('refundDocNo', this.value)" placeholder="輸入文號" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
            </div>
            <div>
              <label class="font-bold block mb-1 text-rose-700">退回金額（輸入正數）</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.refundAmount)}" oninput="updateRevDraftField('refundAmount', this.value)" placeholder="例：12500" class="w-full border border-rose-300 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.refundRemark)}" oninput="updateRevDraftField('refundRemark', this.value)" placeholder="空污費退回備註說明" class="flex-1 min-w-[200px] border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
            <button type="button" id="btnSaveAirRefund" onclick="submitAirRefund()" class="px-3.5 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold">儲存空污費退回</button>
          </div>
        ` : ""}
        <div class="overflow-x-auto border border-[#1D3557]/15 rounded bg-white">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th class="px-2 py-1 text-center">退回年度</th><th class="px-2 py-1">登打日期</th><th class="px-2 py-1">內部文號</th>
                <th class="px-2 py-1 text-right">退回金額（${unitLbl}）</th><th class="px-2 py-1">備註</th>
                ${isAdmin ? `<th class="px-2 py-1 text-center">操作</th>` : ""}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${refundListHtml || `<tr><td colspan="${isAdmin ? 6 : 5}" class="py-3 text-center text-slate-400">尚無空污費退回紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 區塊 B：完工日期獨立維護 -->
      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2">
        <div class="font-bold text-[#1D3557] border-b border-[#1D3557]/12 pb-1">B. 完工日期維護（已完工不等同已決算，獨立儲存不動經費）</div>
        ${isAdmin ? `
          <div class="flex flex-wrap items-center gap-2">
            <label class="font-bold text-[#1D3557]">實際完工日期：</label>
            <input type="date" value="${escapeHtmlAttr(v2BudgetDraft.completionDate)}" onchange="updateRevDraftField('completionDate', this.value)" class="border border-[#1D3557]/20 bg-white rounded px-2.5 py-1" />
            <button type="button" onclick="updateRevDraftField('completionDate', ''); renderBudgetWorkbenchArea();" class="px-2.5 py-1 rounded bg-white border border-[#1D3557]/20 text-[#1D3557] hover:bg-[#FAF3E0] font-bold">清空日期</button>
            <button type="button" id="btnSaveCompletionDate" onclick="submitCompletionDateOnly()" class="px-3.5 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold">儲存完工日期</button>
          </div>
        ` : `<div class="text-[#1D3557]/80">目前實際完工日期：<b>${escapeHtmlAttr(v2BudgetDraft.completionDate || "尚未填寫")}</b></div>`}
      </div>

      <!-- 區塊 C：最終決算登打 -->
      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2.5">
        <div class="flex items-center justify-between border-b border-[#1D3557]/12 pb-1">
          <div class="font-bold text-[#1D3557]">C. 最終決算登打（允許 0 元決算；儲存後自動關閉決算年度起後續跨年）</div>
          <span class="text-[11px] text-[#1D3557]/65">單位：元</span>
        </div>
        ${isAdmin ? `
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label class="font-bold block mb-1">決算發生年度</label>
              <input type="number" min="90" max="150" value="${v2BudgetDraft.settleYear}" onchange="onSettleYearChange(this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
            </div>
            <div>
              <label class="font-bold block mb-1">決算日期</label>
              <input type="date" value="${escapeHtmlAttr(v2BudgetDraft.settleDate)}" onchange="updateRevDraftField('settleDate', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
            </div>
            <div>
              <label class="font-bold block mb-1">決算文號</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleDocNo)}" oninput="updateRevDraftField('settleDocNo', this.value)" placeholder="輸入決算公文文號" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
            </div>
          </div>

          <div class="bg-white border border-[#1D3557]/15 rounded px-2.5 py-1.5 text-[11px] text-[#1D3557] font-mono">
            ${v2BudgetDraft.settleYear} 年度前次有效額度：${curSettleText} ｜ 合計 ${curSettleAmt.total_fee.toLocaleString()} 元
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
            ${V2_FEE_KEYS.map(fk => `
              <div>
                <label class="block text-[11px] mb-0.5">決算${fk.label}</label>
                <input type="text" value="${escapeHtmlAttr(v2BudgetDraft[fk.settleField])}" oninput="updateSettleFeeField('${fk.settleField}', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
              </div>
            `).join("")}
          </div>

          <div id="settlementSummaryBar"></div>

          <div>
            <label class="font-bold block mb-1">決算備註</label>
            <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleRemark)}" oninput="updateRevDraftField('settleRemark', this.value)" placeholder="填寫決算說明" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
          </div>
          <div class="flex justify-end">
            <button type="button" id="btnSaveFinalSettlement" onclick="submitFinalSettlement()" class="px-4 py-1.5 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold">儲存最終決算</button>
          </div>
        ` : `<div class="text-[#1D3557]/75">請登入署端管理者帳號以登打決算資料。</div>`}
      </div>
    </div>
  `;
}

async function voidBudgetVersionGroup(verGroupId, stageName) {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  if (!verGroupId) return alert("缺少版本識別碼");
  if (!confirm(`確定作廢「${stageName}」（版本 ${verGroupId}）？\n作廢後將不再納入最新有效金額計算，且若有勾稽預計增減通知將自動釋放回「待確認」。`)) return;

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_void_version",
        passcode: adminPasscode,
        case_uid: v2BudgetSelectedUid,
        version_group_id: verGroupId
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "作廢失敗");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  }
}

function renderHistoryAndAuditTab(caseObj, comp, caseAudits, unitLbl) {
  const isAdmin = Boolean(adminPasscode);
  const sorted = comp.allValidEntries
    .slice()
    .sort((a, b) => (Number(a.stage_order) - Number(b.stage_order)) || (Number(a.fund_year) - Number(b.fund_year)));

  const groupOrder = [];
  const groupRowsMap = {};
  sorted.forEach(e => {
    const vg = String(e.version_group_id || e.entry_id).trim();
    if (!groupRowsMap[vg]) {
      groupOrder.push(vg);
      groupRowsMap[vg] = [];
    }
    groupRowsMap[vg].push(e);
  });

  let prevStageTotal = null;
  const groupDeltaText = {};
  const groupPaletteIdx = {};
  groupOrder.forEach((vg, idx) => {
    const gRows = groupRowsMap[vg];
    const gTotal = gRows.reduce((s, r) => s + (Number(r.total_fee) || 0), 0);
    const stOrder = Number(gRows[0]?.stage_order) || 0;
    const isRefund = gRows[0]?.entry_type === "空污費退回";
    if (isRefund) {
      groupDeltaText[vg] = `退回扣減：${formatBudgetAmount(gTotal)} ${unitLbl}`;
    } else if (prevStageTotal === null || stOrder === 0) {
      groupDeltaText[vg] = "基準登帳 (0)";
      prevStageTotal = gTotal;
    } else {
      const diff = gTotal - prevStageTotal;
      groupDeltaText[vg] = `較前次：${formatDirectionYuan(diff)}`;
      prevStageTotal = gTotal;
    }
    groupPaletteIdx[vg] = idx;
  });

  const renderedGroups = new Set();
  const entryRowsHtml = sorted.map(e => {
    const vg = String(e.version_group_id || e.entry_id).trim();
    const isFirstInGroup = !renderedGroups.has(vg);
    renderedGroups.add(vg);
    const bgCls = groupPaletteIdx[vg] % 2 === 0 ? "bg-white" : "bg-[#F7F5F0]/80";

    return `
      <tr class="${bgCls}">
        <td class="px-2 py-1.5 font-bold text-[#1D3557] whitespace-nowrap">${escapeHtmlAttr(e.entry_type)}</td>
        <td class="px-2 py-1.5 text-center font-mono">${escapeHtmlAttr(e.fund_year)}</td>
        <td class="px-2 py-1.5 font-mono whitespace-nowrap">${escapeHtmlAttr(e.doc_date || "-")}</td>
        <td class="px-2 py-1.5 font-mono">${escapeHtmlAttr(e.doc_no || "-")}</td>
        ${V2_FEE_KEYS.map(fk => `<td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e[fk.field])}</td>`).join("")}
        <td class="px-2 py-1.5 text-right font-mono font-bold bg-[#EAF2F9]/50">${formatBudgetAmount(e.total_fee)}</td>
        <td class="px-2 py-1.5 text-[11px] font-medium text-[#004E89] whitespace-nowrap">${isFirstInGroup ? escapeHtmlAttr(groupDeltaText[vg]) : ""}</td>
        <td class="px-2 py-1.5 text-center">${Number(e.affects_latest) === 1 ? "是" : "僅歷程"}</td>
        <td class="px-2 py-1.5">${escapeHtmlAttr(e.remark || "-")}</td>
        ${isAdmin ? `
          <td class="px-2 py-1.5 text-center whitespace-nowrap">
            ${isFirstInGroup && e.version_group_id ? `<button type="button" onclick="voidBudgetVersionGroup('${escapeHtmlAttr(e.version_group_id)}','${escapeHtmlAttr(e.entry_type)}')" class="text-rose-600 hover:text-rose-800 font-bold">作廢版本</button>` : ""}
          </td>
        ` : ""}
      </tr>
    `;
  }).join("");

  const auditRowsHtml = caseAudits.slice().reverse().map(a => `
    <tr class="bg-white">
      <td class="px-2 py-1 font-mono whitespace-nowrap">${escapeHtmlAttr(a.timestamp)}</td>
      <td class="px-2 py-1 font-bold text-[#1D3557] whitespace-nowrap">${escapeHtmlAttr(a.action_type)}</td>
      <td class="px-2 py-1 text-[#1D3557]/75">${escapeHtmlAttr(a.summary_before || "-")}</td>
      <td class="px-2 py-1 text-[#1D3557]">${escapeHtmlAttr(a.summary_after || "-")}</td>
      <td class="px-2 py-1 text-[#1D3557]/70">${escapeHtmlAttr(a.remark || "-")}</td>
    </tr>
  `).join("");

  return `
    <div class="space-y-3 text-xs">
      <div class="overflow-x-auto border border-[#1D3557]/15 rounded">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr>
              <th class="px-2 py-1.5 whitespace-nowrap">階段類型</th>
              <th class="px-2 py-1.5 text-center whitespace-nowrap">年度</th>
              <th class="px-2 py-1.5 whitespace-nowrap">確認日期</th>
              <th class="px-2 py-1.5 whitespace-nowrap">內部文號</th>
              ${V2_FEE_KEYS.map(fk => `<th class="px-2 py-1.5 text-right whitespace-nowrap">${fk.label}</th>`).join("")}
              <th class="px-2 py-1.5 text-right whitespace-nowrap">合計（${unitLbl}）</th>
              <th class="px-2 py-1.5 whitespace-nowrap">整案增減</th>
              <th class="px-2 py-1.5 text-center whitespace-nowrap">影響最新</th>
              <th class="px-2 py-1.5">備註</th>
              ${isAdmin ? `<th class="px-2 py-1.5 text-center whitespace-nowrap">操作</th>` : ""}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${entryRowsHtml || `<tr><td colspan="${isAdmin ? 14 : 13}" class="py-5 text-center text-slate-400">本案尚無正式經費分錄歷程</td></tr>`}
          </tbody>
        </table>
      </div>

      <details class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-2.5">
        <summary class="cursor-pointer font-bold text-[#1D3557]">展開本案異動稽核紀錄（共 ${caseAudits.length} 筆）</summary>
        <div class="overflow-x-auto border border-[#1D3557]/15 rounded bg-white mt-2">
          <table class="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr>
                <th class="px-2 py-1">異動時間</th><th class="px-2 py-1">操作類型</th>
                <th class="px-2 py-1">異動前</th><th class="px-2 py-1">異動後</th><th class="px-2 py-1">備註</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${auditRowsHtml || `<tr><td colspan="5" class="py-3 text-center text-slate-400">尚無異動紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;
}