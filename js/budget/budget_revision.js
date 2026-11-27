/**
 * 治水雲庫 V2 — 頁籤 2：正式變更／結算多通知勾稽與多年度表格寫入
 */

function onRevStageChange(newStage) {
  v2BudgetDraft.revStage = newStage;
  v2BudgetDraft.revLinkedNoticeIds = getActiveStageLinkedNoticeIds(v2BudgetSelectedUid, newStage);
  renderBudgetWorkbenchArea();
}

function toggleRevNoticeLink(noticeId, checked) {
  const set = new Set(v2BudgetDraft.revLinkedNoticeIds);
  if (checked) set.add(noticeId);
  else set.delete(noticeId);
  v2BudgetDraft.revLinkedNoticeIds = Array.from(set);
  refreshRevisionSummaryBar();
}

function updateRevDraftField(field, val) {
  v2BudgetDraft[field] = val;
}

function updateRevRowField(idx, field, val) {
  if (!v2BudgetDraft.revRows[idx]) return;
  v2BudgetDraft.revRows[idx][field] = val;
  if (V2_FEE_KEYS.some(fk => fk.field === field)) {
    const r = v2BudgetDraft.revRows[idx];
    const rowTot = V2_FEE_KEYS.reduce((s, fk) => s + parseYuanInput(r[fk.field]), 0);
    const cell = document.getElementById(`revRowTotal_${idx}`);
    if (cell) cell.textContent = rowTot.toLocaleString();
  }
  refreshRevisionSummaryBar();
}

function addRevYearRow() {
  const inp = document.getElementById("inpRevAddYear");
  const yr = parseInt(inp?.value, 10);
  if (!yr || yr < 90 || yr > 150) return alert("請輸入合法年度（90 至 150）");
  if (v2BudgetDraft.revRows.some(r => parseInt(r.fund_year, 10) === yr)) {
    return alert(`${yr} 年度已在表格中`);
  }
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  const comp = caseObj ? computeV2CaseLatestBudget(caseObj) : { yearMap: {} };
  const cur = getPostedAmountForYear(comp, yr);

  let suggestedCode = comp.yearMap?.[yr]?.year_project_code || "";
  if (!suggestedCode && caseObj?.["工程編號"]) {
    const m = String(caseObj["工程編號"]).trim().match(/^(\d{3})(-.+)$/);
    suggestedCode = m ? `${yr}${m[2]}` : caseObj["工程編號"];
  }

  v2BudgetDraft.revRows.push({
    fund_year: yr,
    year_project_code: suggestedCode,
    work_fee: String(cur.work_fee),
    other_fee: String(cur.other_fee),
    air_fee: String(cur.air_fee),
    mgmt_fee: String(cur.mgmt_fee),
    land_fee: String(cur.land_fee),
    remark: ""
  });
  v2BudgetDraft.revRows.sort((a, b) => Number(a.fund_year) - Number(b.fund_year));
  renderBudgetWorkbenchArea();
}

function removeRevYearRow(idx) {
  if (v2BudgetDraft.revRows.length <= 1) return alert("至少須保留一列年度明細");
  v2BudgetDraft.revRows.splice(idx, 1);
  renderBudgetWorkbenchArea();
}

function resetRevRowsToLatest() {
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  v2BudgetDraft.revRows = buildInitialRevisionRows(caseObj, comp);
  renderBudgetWorkbenchArea();
}

function computeRevisionSummary(comp) {
  let newTotal = 0;
  let prevTotal = 0;
  const deltaByFee = { work: 0, other: 0, air: 0, mgmt: 0, land: 0 };
  const seenYears = new Set();
  let error = "";

  for (let i = 0; i < v2BudgetDraft.revRows.length; i++) {
    const r = v2BudgetDraft.revRows[i];
    const y = parseInt(r.fund_year, 10);
    if (!y || y < 90 || y > 150) {
      error = `第 ${i + 1} 列年度不合法`;
      break;
    }
    if (seenYears.has(y)) {
      error = `年度 ${y} 重複`;
      break;
    }
    seenYears.add(y);
    const cur = getPostedAmountForYear(comp, y);
    V2_FEE_KEYS.forEach(fk => {
      const nv = parseYuanInput(r[fk.field]);
      const ov = Number(cur[fk.field]) || 0;
      newTotal += nv;
      prevTotal += ov;
      deltaByFee[fk.key] += (nv - ov);
    });
  }

  const deltaTotal = newTotal - prevTotal;
  const linkedNotices = v2BudgetPlanned.filter(p => v2BudgetDraft.revLinkedNoticeIds.includes(p.notice_id));
  const plannedDeltaTotal = linkedNotices.reduce((s, p) => s + (Number(p.delta_total) || 0), 0);
  const plannedByFee = {};
  V2_FEE_KEYS.forEach(fk => {
    plannedByFee[fk.key] = linkedNotices.reduce((s, p) => s + (Number(p[fk.plannedDelta]) || 0), 0);
  });
  const exceedsLimit = linkedNotices.length > 0 && !isRevisionDeltaAllowed(deltaTotal, plannedDeltaTotal);

  return { newTotal, prevTotal, deltaTotal, deltaByFee, linkedNotices, plannedDeltaTotal, plannedByFee, exceedsLimit, error };
}

function refreshRevisionSummaryBar() {
  const bar = document.getElementById("revisionSummaryBar");
  const btn = document.getElementById("btnSaveOfficialRevision");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!bar || !caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  const s = computeRevisionSummary(comp);

  if (s.error) {
    bar.innerHTML = `<div class="bg-rose-50 border border-rose-300 text-rose-700 rounded px-3 py-2 font-bold">表格資料有誤：${escapeHtmlAttr(s.error)}</div>`;
    if (btn) btn.disabled = true;
    return;
  }

  const feeDetail = V2_FEE_KEYS.map(fk => `${fk.label} ${formatSignedYuan(s.deltaByFee[fk.key])}`).join(" ｜ ");
  const noticeFeeDetail = V2_FEE_KEYS.map(fk => `${fk.label} ${formatSignedYuan(s.plannedByFee[fk.key])}`).join("｜");

  const noticeLimitHtml = s.linkedNotices.length > 0 ? `
    <div class="pt-1.5 mt-1.5 border-t border-[#1D3557]/12 text-[11px]">
      <span class="font-bold text-[#004E89]">已勾稽 ${s.linkedNotices.length} 筆通知合併額度：${formatDirectionYuan(s.plannedDeltaTotal)}</span>
      <span class="text-[#1D3557]/75 font-mono ml-2">（${noticeFeeDetail}）</span>
    </div>
  ` : "";

  const warnHtml = s.exceedsLimit ? `
    <div class="mt-2 bg-rose-50 border border-rose-300 text-rose-700 rounded px-2.5 py-1.5 font-bold">
      本次表格增減（${formatDirectionYuan(s.deltaTotal)}）超過所勾稽通知合併額度（${formatDirectionYuan(s.plannedDeltaTotal)}），請調整金額或改選通知後再儲存。
    </div>
  ` : "";

  if (btn) btn.disabled = s.exceedsLimit;

  bar.innerHTML = `
    <div class="bg-[#EAF2F9] border border-[#1D3557]/15 rounded px-3 py-2 text-xs">
      <div class="font-bold text-[#1D3557]">
        本次表格合計：<span class="font-mono text-[#004E89]">${s.newTotal.toLocaleString()}</span> 元
        ｜ 同年度前次合計：<span class="font-mono">${s.prevTotal.toLocaleString()}</span> 元
        ｜ 本次增減：<span class="font-mono text-[#ED6D35]">${formatDirectionYuan(s.deltaTotal)}</span>
      </div>
      <div class="text-[11px] text-[#1D3557]/75 font-mono mt-0.5">增減明細：${feeDetail}</div>
      ${noticeLimitHtml}
      ${warnHtml}
    </div>
  `;
}

async function submitOfficialRevision() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (!caseObj) return;
  const comp = computeV2CaseLatestBudget(caseObj);
  const s = computeRevisionSummary(comp);
  if (s.error) return alert(`無法儲存：${s.error}`);
  if (s.exceedsLimit) return alert("本次增減超過所勾稽通知合併額度，無法儲存。");

  const existingSameStage = getActiveStageVersionGroupIds(caseObj.case_uid, v2BudgetDraft.revStage);
  if (existingSameStage.size > 0) {
    if (!confirm(`本案已有「${v2BudgetDraft.revStage}」有效分錄，確定以本次表格覆蓋取代並作廢同階段舊版本？`)) return;
  }

  const btn = document.getElementById("btnSaveOfficialRevision");
  if (btn) { btn.disabled = true; btn.textContent = "寫入中..."; }
  try {
    const payloadRows = v2BudgetDraft.revRows.map(r => {
      const w = parseYuanInput(r.work_fee);
      const o = parseYuanInput(r.other_fee);
      const a = parseYuanInput(r.air_fee);
      const m = parseYuanInput(r.mgmt_fee);
      const l = parseYuanInput(r.land_fee);
      return {
        fund_year: parseInt(r.fund_year, 10),
        year_project_code: String(r.year_project_code || "").trim(),
        work_fee: w,
        air_fee: a,
        other_fee: o,
        mgmt_fee: m,
        land_fee: l,
        total_fee: w + o + a + m + l,
        remark: String(r.remark || "").trim()
      };
    });

    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_save_revision",
        passcode: adminPasscode,
        record: {
          case_uid: caseObj.case_uid,
          entry_type: v2BudgetDraft.revStage,
          stage_order: getStageOrderByLabel(v2BudgetDraft.revStage),
          doc_date: v2BudgetDraft.revDocDate,
          doc_no: v2BudgetDraft.revDocNo,
          affects_latest: Boolean(v2BudgetDraft.revAffectsLatest),
          remark: v2BudgetDraft.revRemark,
          linked_notice_ids: v2BudgetDraft.revLinkedNoticeIds,
          rows: payloadRows
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
    if (btn) { btn.disabled = false; btn.textContent = "儲存正式變更／結算"; }
  }
}

function renderOfficialRevisionTab(caseObj, comp) {
  const isAdmin = Boolean(adminPasscode);
  if (!isAdmin) {
    return `
      <div class="bg-[#FAF3E0] border-l-4 border-[#1D3557] px-3 py-2 text-xs text-[#1D3557]">
        目前為檢視模式；請由右上角選單登入「署端管理者」以登打正式變更／結算分錄。
      </div>
    `;
  }

  const linkableNotices = getLinkablePlannedNotices(caseObj.case_uid, v2BudgetDraft.revStage);
  const nextSuggestYear = v2BudgetDraft.revRows.length
    ? Math.max(...v2BudgetDraft.revRows.map(r => parseInt(r.fund_year, 10) || 115)) + 1
    : (new Date().getFullYear() - 1911);

  const noticesHtml = linkableNotices.length ? linkableNotices.map(n => {
    const checked = v2BudgetDraft.revLinkedNoticeIds.includes(n.notice_id);
    const refText = V2_FEE_KEYS.map(fk => `${fk.label} ${(Number(n[fk.plannedAfter]) || 0).toLocaleString()}`).join("｜");
    return `
      <label class="flex items-start gap-2 p-2 rounded border ${checked ? "bg-[#FFF3DE] border-[#ED6D35]" : "bg-white border-[#1D3557]/15"} cursor-pointer text-[11px]">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleRevNoticeLink('${escapeHtmlAttr(n.notice_id)}', this.checked)" class="mt-0.5 rounded accent-[#ED6D35]" />
        <div class="flex-1 min-w-0">
          <div class="font-bold text-[#1D3557]">
            ${escapeHtmlAttr(n.notice_date || "-")} ｜ 文號：${escapeHtmlAttr(n.doc_no || "-")} ｜ ${escapeHtmlAttr(n.target_year)}年 ${escapeHtmlAttr(n.planned_stage)}
            <span class="ml-1.5 text-[#ED6D35]">${formatDirectionYuan(n.delta_total)}</span>
          </div>
          <div class="text-[#1D3557]/70 font-mono truncate">修正後參考：${refText}</div>
        </div>
      </label>
    `;
  }).join("") : `<div class="text-[11px] text-[#1D3557]/60 px-2 py-1.5 bg-white border border-dashed border-[#1D3557]/20 rounded">本案目前無待確認之預計增減通知，可直接登打並儲存正式變更。</div>`;

  const tableRowsHtml = v2BudgetDraft.revRows.map((r, idx) => {
    const rowTot = V2_FEE_KEYS.reduce((s, fk) => s + parseYuanInput(r[fk.field]), 0);
    return `
      <tr class="bg-white">
        <td class="px-1.5 py-1.5 text-center font-bold font-mono text-[#1D3557]">${escapeHtmlAttr(r.fund_year)}</td>
        <td class="px-1.5 py-1.5">
          <input type="text" value="${escapeHtmlAttr(r.year_project_code)}" oninput="updateRevRowField(${idx},'year_project_code',this.value)" class="w-36 border border-[#1D3557]/20 rounded px-1.5 py-0.5 font-mono text-[11px]" />
        </td>
        ${V2_FEE_KEYS.map(fk => `
          <td class="px-1 py-1.5">
            <input type="text" value="${escapeHtmlAttr(r[fk.field])}" oninput="updateRevRowField(${idx},'${fk.field}',this.value)" class="w-24 border border-[#1D3557]/20 rounded px-1.5 py-0.5 text-right font-mono text-[11px]" />
          </td>
        `).join("")}
        <td id="revRowTotal_${idx}" class="px-1.5 py-1.5 text-right font-mono font-bold bg-[#EAF2F9]/60 text-[#1D3557] whitespace-nowrap">${rowTot.toLocaleString()}</td>
        <td class="px-1.5 py-1.5">
          <input type="text" value="${escapeHtmlAttr(r.remark)}" oninput="updateRevRowField(${idx},'remark',this.value)" placeholder="列備註" class="w-24 border border-[#1D3557]/20 rounded px-1.5 py-0.5 text-[11px]" />
        </td>
        <td class="px-1.5 py-1.5 text-center">
          <button type="button" onclick="removeRevYearRow(${idx})" class="text-rose-600 hover:text-rose-800 font-bold text-[11px]">移除</button>
        </td>
      </tr>
    `;
  }).join("");

  setTimeout(refreshRevisionSummaryBar, 0);

  return `
    <div class="space-y-3 text-xs">
      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2">
        <div class="font-bold text-[#1D3557]">步驟 1：選擇本案階段與公文資訊（登打單位：元）</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label class="font-bold block mb-1">本案階段</label>
            <select onchange="onRevStageChange(this.value)" class="w-full border border-[#1D3557]/25 bg-white rounded px-2 py-1 font-bold text-[#1D3557]">
              ${V2_REVISION_STAGE_OPTIONS.map(s => `<option value="${s.label}" ${v2BudgetDraft.revStage === s.label ? "selected" : ""}>${s.label}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="font-bold block mb-1">確認日期</label>
            <input type="date" value="${escapeHtmlAttr(v2BudgetDraft.revDocDate)}" onchange="updateRevDraftField('revDocDate', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
          </div>
          <div>
            <label class="font-bold block mb-1">內部文號</label>
            <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.revDocNo)}" oninput="updateRevDraftField('revDocNo', this.value)" placeholder="輸入公文或內部文號" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 font-mono" />
          </div>
        </div>
        <label class="inline-flex items-center gap-1.5 cursor-pointer select-none pt-1 text-[#1D3557]">
          <input type="checkbox" ${v2BudgetDraft.revAffectsLatest ? "checked" : ""} onchange="updateRevDraftField('revAffectsLatest', this.checked)" class="rounded accent-[#1D3557]" />
          <span class="font-bold">設為目前最新有效金額</span>
          <span class="text-[11px] text-[#1D3557]/65">（取消勾選則僅作為歷史補登歷程，不覆蓋目前最新經費）</span>
        </label>
      </div>

      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="font-bold text-[#1D3557]">步驟 2：勾稽預計增減通知（可複選，核銷後轉為已勾稽確認）</div>
          <span class="text-[11px] text-[#1D3557]/65">可選 ${linkableNotices.length} 筆</span>
        </div>
        <div class="space-y-1.5">${noticesHtml}</div>
      </div>

      <div class="bg-[#F7F5F0] border border-[#1D3557]/15 rounded-lg p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-[#1D3557]">步驟 3：編輯各年度經費分配（單位：元）</div>
          <div class="flex items-center gap-1.5">
            <input id="inpRevAddYear" type="number" min="90" max="150" value="${nextSuggestYear}" class="w-16 border border-[#1D3557]/20 bg-white rounded px-1.5 py-0.5 text-center font-mono" />
            <button type="button" onclick="addRevYearRow()" class="px-2.5 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold text-[11px]">＋ 加入年度列</button>
            <button type="button" onclick="resetRevRowsToLatest()" class="px-2.5 py-1 rounded bg-white border border-[#1D3557]/25 text-[#1D3557] hover:bg-[#FAF3E0] font-bold text-[11px]">重設為目前最新</button>
          </div>
        </div>
        <div class="overflow-x-auto border border-[#1D3557]/15 rounded bg-white">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th class="px-1.5 py-1.5 text-center whitespace-nowrap">年度</th>
                <th class="px-1.5 py-1.5 whitespace-nowrap">年度工程編號</th>
                ${V2_FEE_KEYS.map(fk => `<th class="px-1.5 py-1.5 text-right whitespace-nowrap">${fk.label}</th>`).join("")}
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">小計</th>
                <th class="px-1.5 py-1.5 whitespace-nowrap">備註</th>
                <th class="px-1.5 py-1.5 text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">${tableRowsHtml}</tbody>
          </table>
        </div>

        <div id="revisionSummaryBar"></div>

        <div>
          <label class="font-bold block mb-1">本階段總備註</label>
          <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.revRemark)}" oninput="updateRevDraftField('revRemark', this.value)" placeholder="填寫變更原因或核定說明" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1" />
        </div>

        <div class="flex justify-end pt-1">
          <button type="button" id="btnSaveOfficialRevision" onclick="submitOfficialRevision()" class="px-4 py-1.5 rounded bg-[#1D3557] hover:bg-[#004E89] text-white font-bold transition">
            儲存正式變更／結算
          </button>
        </div>
      </div>
    </div>
  `;
}