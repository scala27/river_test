/**
 * 治水雲庫 V2 — 頁籤 1：預計增減通知登打（雙向互斥換算與清單管理）
 */

function calcPlannedDraftPreview(comp) {
  const curAmt = getPostedAmountForYear(comp, v2BudgetDraft.plannedTargetYear);
  const conflicts = [];
  const after = {};
  const delta = {};

  V2_FEE_KEYS.forEach(fk => {
    const rawAfter = v2BudgetDraft.plannedAfter[fk.key];
    const rawInc = v2BudgetDraft.plannedInc[fk.key];
    const hasAfter = hasYuanInputValue(rawAfter);
    const hasInc = hasYuanInputValue(rawInc);
    const curVal = Number(curAmt[fk.field]) || 0;

    if (hasAfter && hasInc) {
      conflicts.push(fk.label);
      const aVal = parseYuanInput(rawAfter);
      after[fk.key] = aVal;
      delta[fk.key] = aVal - curVal;
    } else if (hasInc) {
      const iVal = parseYuanInput(rawInc);
      delta[fk.key] = iVal;
      after[fk.key] = curVal + iVal;
    } else if (hasAfter) {
      const aVal = parseYuanInput(rawAfter);
      after[fk.key] = aVal;
      delta[fk.key] = aVal - curVal;
    } else {
      after[fk.key] = curVal;
      delta[fk.key] = 0;
    }
  });

  const afterTotal = V2_FEE_KEYS.reduce((s, fk) => s + after[fk.key], 0);
  const deltaTotal = V2_FEE_KEYS.reduce((s, fk) => s + delta[fk.key], 0);
  return { curAmt, conflicts, after, delta, afterTotal, deltaTotal };
}

function updatePlannedDraftField(field, value, rerenderFull = false) {
  v2BudgetDraft[field] = value;
  if (rerenderFull) {
    renderBudgetWorkbenchArea();
  } else {
    refreshPlannedPreviewBar();
  }
}

function updatePlannedMoneyField(mode, feeKey, value) {
  if (mode === "after") v2BudgetDraft.plannedAfter[feeKey] = value;
  else v2BudgetDraft.plannedInc[feeKey] = value;
  refreshPlannedPreviewBar();
}

function refreshPlannedPreviewBar() {
  const bar = document.getElementById("plannedPreviewBar");
  const btn = document.getElementById("btnSavePlannedNotice");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!bar || !caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  const prev = calcPlannedDraftPreview(comp);

  if (prev.conflicts.length) {
    bar.innerHTML = `<div class="bg-rose-50 border border-rose-300 text-rose-700 rounded px-3 py-2 font-bold">同一費目不可同時填寫「預計修正後金額」與「預計增加金額」：${prev.conflicts.join("、")}</div>`;
    if (btn) btn.disabled = true;
    return;
  }

  if (btn) btn.disabled = false;
  const detailText = V2_FEE_KEYS.map(fk => `${fk.label} ${formatSignedYuan(prev.delta[fk.key])}`).join(" ｜ ");
  bar.innerHTML = `
    <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded px-3 py-2 space-y-1">
      <div class="font-bold text-[#1D3557]">
        預計修正後合計：<span class="font-mono text-[#004E89]">${prev.afterTotal.toLocaleString()}</span> 元
        ｜ 目前額度合計：<span class="font-mono">${prev.curAmt.total_fee.toLocaleString()}</span> 元
        ｜ 預計增減：<span class="font-mono text-[#ED6D35]">${formatDirectionYuan(prev.deltaTotal)}</span>
      </div>
      <div class="text-[11px] text-[#1D3557]/75 font-mono">增減明細：${detailText}</div>
    </div>
  `;
}

function startEditPlannedNotice(noticeId) {
  const item = v2BudgetPlanned.find(p => p.notice_id === noticeId && p.case_uid === v2BudgetSelectedUid);
  if (!item) return;
  v2BudgetDraft.plannedEditId = item.notice_id;
  v2BudgetDraft.plannedDate = item.notice_date || getTodayIsoDate();
  v2BudgetDraft.plannedDocNo = item.doc_no || "";
  v2BudgetDraft.plannedTargetYear = parseInt(item.target_year, 10) || v2BudgetDraft.plannedTargetYear;
  v2BudgetDraft.plannedStage = item.planned_stage || "第1次變更";
  v2BudgetDraft.plannedStatus = item.status || "待確認";
  v2BudgetDraft.plannedAfter = { work: "", other: "", air: "", mgmt: "", land: "" };
  v2BudgetDraft.plannedInc = {
    work: item.delta_work ? String(item.delta_work) : "",
    other: item.delta_other ? String(item.delta_other) : "",
    air: item.delta_air ? String(item.delta_air) : "",
    mgmt: item.delta_mgmt ? String(item.delta_mgmt) : "",
    land: item.delta_land ? String(item.delta_land) : ""
  };
  v2BudgetDraft.plannedRemark = item.remark || "";
  renderBudgetWorkbenchArea();
}

function cancelEditPlannedNotice() {
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  const comp = caseObj ? computeV2CaseLatestBudget(caseObj) : { yearMap: {} };
  const postedYears = Object.keys(comp.yearMap || {}).map(Number).sort((a, b) => a - b);
  const baseYear = postedYears.length ? postedYears[postedYears.length - 1] : (parseInt(caseObj?.["核定年度"], 10) || (new Date().getFullYear() - 1911));

  v2BudgetDraft.plannedEditId = "";
  v2BudgetDraft.plannedDate = getTodayIsoDate();
  v2BudgetDraft.plannedDocNo = "";
  v2BudgetDraft.plannedTargetYear = baseYear;
  v2BudgetDraft.plannedStage = "第1次變更";
  v2BudgetDraft.plannedStatus = "待確認";
  v2BudgetDraft.plannedAfter = { work: "", other: "", air: "", mgmt: "", land: "" };
  v2BudgetDraft.plannedInc = { work: "", other: "", air: "", mgmt: "", land: "" };
  v2BudgetDraft.plannedRemark = "";
  renderBudgetWorkbenchArea();
}

async function submitPlannedNotice() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  const prev = calcPlannedDraftPreview(comp);
  if (prev.conflicts.length) return alert("同一費目不可同時輸入預計修正後金額與預計增加金額");

  const btn = document.getElementById("btnSavePlannedNotice");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_save_planned",
        passcode: adminPasscode,
        record: {
          notice_id: v2BudgetDraft.plannedEditId || "",
          case_uid: caseObj.case_uid,
          notice_date: v2BudgetDraft.plannedDate,
          doc_no: v2BudgetDraft.plannedDocNo,
          target_year: parseInt(v2BudgetDraft.plannedTargetYear, 10),
          planned_stage: v2BudgetDraft.plannedStage,
          status: v2BudgetDraft.plannedEditId ? v2BudgetDraft.plannedStatus : "待確認",
          delta_work: prev.delta.work,
          delta_air: prev.delta.air,
          delta_other: prev.delta.other,
          delta_mgmt: prev.delta.mgmt,
          delta_land: prev.delta.land,
          delta_total: prev.deltaTotal,
          after_work: prev.after.work,
          after_air: prev.after.air,
          after_other: prev.after.other,
          after_mgmt: prev.after.mgmt,
          after_land: prev.after.land,
          after_total: prev.afterTotal,
          remark: v2BudgetDraft.plannedRemark
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
    if (btn) { btn.disabled = false; btn.textContent = v2BudgetDraft.plannedEditId ? "更新預計增減通知" : "儲存預計增減通知"; }
  }
}

async function deletePlannedNotice(noticeId) {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  if (!confirm(`確定刪除預計增減通知 ${noticeId}？`)) return;
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_delete_planned",
        passcode: adminPasscode,
        case_uid: v2BudgetSelectedUid,
        notice_id: noticeId
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      alert(json.message);
      await loadV2LifecycleData(false);
    } else {
      alert(json.message || "刪除失敗");
    }
  } catch (err) {
    alert("連線失敗：" + err.message);
  }
}

function renderPlannedNoticeTab(caseObj, comp, casePlanned, unitLbl) {
  const isAdmin = Boolean(adminPasscode);
  const prev = calcPlannedDraftPreview(comp);
  const isEdit = Boolean(v2BudgetDraft.plannedEditId);
  const curAmtText = V2_FEE_KEYS.map(fk => `${fk.label} ${(prev.curAmt[fk.field] || 0).toLocaleString()}`).join(" ｜ ");

  const formHtml = isAdmin ? `
    <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2.5 text-xs">
      <div class="flex items-center justify-between border-b border-[#1D3557]/12 pb-1.5">
        <div class="font-bold text-[#1D3557]">${isEdit ? `修改預計增減通知（${escapeHtmlAttr(v2BudgetDraft.plannedEditId)}）` : "新增預計增減通知（登打單位：元）"}</div>
        ${isEdit ? `<button type="button" onclick="cancelEditPlannedNotice()" class="text-[11px] text-[#004E89] underline font-bold">取消編輯並切回新增</button>` : `<span class="text-[11px] text-[#1D3557]/65">僅記錄預計增減與提醒，不變更正式帳本</span>`}
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label class="font-bold block mb-1">通知日期</label>
          <input type="date" value="${escapeHtmlAttr(v2BudgetDraft.plannedDate)}" onchange="updatePlannedDraftField('plannedDate', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
        </div>
        <div>
          <label class="font-bold block mb-1">內部文號</label>
          <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.plannedDocNo)}" oninput="updatePlannedDraftField('plannedDocNo', this.value)" placeholder="輸入公文或內部文號" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
        </div>
        <div>
          <label class="font-bold block mb-1">預計增減年度</label>
          <input type="number" min="90" max="150" value="${v2BudgetDraft.plannedTargetYear}" onchange="updatePlannedDraftField('plannedTargetYear', parseInt(this.value,10)||115, true)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
        </div>
        <div>
          <label class="font-bold block mb-1">預計階段</label>
          <select onchange="updatePlannedDraftField('plannedStage', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1">
            ${V2_PLANNED_STAGE_OPTIONS.map(s => `<option value="${s}" ${v2BudgetDraft.plannedStage === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>

      ${isEdit ? `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label class="font-bold block mb-1 text-[#ED6D35]">通知狀態</label>
            <select onchange="updatePlannedDraftField('plannedStatus', this.value)" class="w-full border border-[#ED6D35]/50 bg-white rounded px-2 py-1 font-bold text-[#1D3557]">
              ${V2_PLANNED_STATUS_OPTIONS.map(s => `<option value="${s}" ${v2BudgetDraft.plannedStatus === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>
      ` : ""}

      <div class="bg-[#EAF2F9] border-l-4 border-[#004E89] px-2.5 py-1.5 text-[11px] text-[#1D3557] font-mono">
        目前額度（${v2BudgetDraft.plannedTargetYear} 年）：${curAmtText} ｜ 合計 ${prev.curAmt.total_fee.toLocaleString()} 元
      </div>

      <div class="space-y-1.5">
        <div class="font-bold text-[#1D3557] text-[11px] bg-[#FFF3DE] border-l-4 border-[#ED6D35] px-2 py-1">方式 A：預計修正後金額（元）— 空白表示不採此欄</div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
          ${V2_FEE_KEYS.map(fk => `
            <div>
              <label class="block text-[11px] text-[#1D3557]/80 mb-0.5">${fk.label}</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.plannedAfter[fk.key])}" oninput="updatePlannedMoneyField('after','${fk.key}',this.value)" placeholder="尚未輸入" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
          `).join("")}
        </div>
      </div>

      <div class="space-y-1.5">
        <div class="font-bold text-[#1D3557] text-[11px] bg-[#FFF3DE] border-l-4 border-[#ED6D35] px-2 py-1">方式 B：預計增加金額／增減額（元，可輸入負數）— 與方式 A 擇一填寫</div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
          ${V2_FEE_KEYS.map(fk => `
            <div>
              <label class="block text-[11px] text-[#1D3557]/80 mb-0.5">${fk.label}</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.plannedInc[fk.key])}" oninput="updatePlannedMoneyField('inc','${fk.key}',this.value)" placeholder="尚未輸入" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
          `).join("")}
        </div>
      </div>

      <div id="plannedPreviewBar"></div>

      <div>
        <label class="font-bold block mb-1">備註</label>
        <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.plannedRemark)}" oninput="updatePlannedDraftField('plannedRemark', this.value)" placeholder="填寫核定或通知說明" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
      </div>

      <div class="flex justify-end gap-2">
        <button type="button" id="btnSavePlannedNotice" onclick="submitPlannedNotice()" class="px-4 py-1.5 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold transition">
          ${isEdit ? "更新預計增減通知" : "儲存預計增減通知"}
        </button>
      </div>
    </div>
  ` : `
    <div class="bg-[#FAF3E0] border-l-4 border-[#ED6D35] px-3 py-2 text-[11px] text-[#1D3557]">
      目前為檢視模式；請由右上角選單登入「署端管理者」以新增或修改預計增減通知。
    </div>
  `;

  const rows = casePlanned.slice().reverse().map(p => `
    <tr class="bg-white hover:bg-[#FAF3E0]/50">
      <td class="px-2 py-1.5 font-mono whitespace-nowrap">${escapeHtmlAttr(p.notice_date || "-")}</td>
      <td class="px-2 py-1.5 font-mono">${escapeHtmlAttr(p.doc_no || "-")}</td>
      <td class="px-2 py-1.5 text-center">${escapeHtmlAttr(p.target_year)}</td>
      <td class="px-2 py-1.5 whitespace-nowrap">${escapeHtmlAttr(p.planned_stage)}</td>
      <td class="px-2 py-1.5 text-right font-mono font-bold ${Number(p.delta_total) < 0 ? "text-rose-700" : "text-[#1D3557]"}">${formatBudgetAmount(p.delta_total)}</td>
      <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(p.after_total)}</td>
      <td class="px-2 py-1.5 text-center whitespace-nowrap">
        <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${p.status === "待確認" ? "bg-[#ED6D35]/15 text-[#ED6D35]" : (p.status === "已勾稽確認" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}">${escapeHtmlAttr(p.status)}</span>
      </td>
      <td class="px-2 py-1.5">${escapeHtmlAttr(p.remark || "-")}</td>
      ${isAdmin ? `
        <td class="px-2 py-1.5 text-center whitespace-nowrap space-x-1">
          <button type="button" onclick="startEditPlannedNotice('${escapeHtmlAttr(p.notice_id)}')" class="text-[#004E89] hover:text-[#ED6D35] font-bold">編輯</button>
          <button type="button" onclick="deletePlannedNotice('${escapeHtmlAttr(p.notice_id)}')" class="text-rose-600 hover:text-rose-800 font-bold">刪除</button>
        </td>
      ` : ""}
    </tr>
  `).join("");

  setTimeout(refreshPlannedPreviewBar, 0);

  return `
    <div class="space-y-3">
      ${formHtml}
      <div class="space-y-1.5">
        <div class="font-bold text-[#1D3557] text-xs">本案預計增減通知清單（顯示單位：${unitLbl}）</div>
        <div class="overflow-x-auto border border-[#1D3557]/15 rounded">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th class="px-2 py-1.5">通知日期</th>
                <th class="px-2 py-1.5">內部文號</th>
                <th class="px-2 py-1.5 text-center">年度</th>
                <th class="px-2 py-1.5">階段</th>
                <th class="px-2 py-1.5 text-right">增減合計</th>
                <th class="px-2 py-1.5 text-right">修正後合計</th>
                <th class="px-2 py-1.5 text-center">狀態</th>
                <th class="px-2 py-1.5">備註</th>
                ${isAdmin ? `<th class="px-2 py-1.5 text-center">操作</th>` : ""}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${rows || `<tr><td colspan="${isAdmin ? 9 : 8}" class="py-5 text-center text-slate-400">本案尚無預計增減通知</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}