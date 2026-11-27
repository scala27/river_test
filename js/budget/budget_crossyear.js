/**
 * 治水雲庫 V2 — 跨年度案件表批次維護與 Excel 匯出模組
 */

function updateCrossYearFilter(field, val) {
  if (field === "fromYear") {
    v2CrossYearState.fromYear = parseInt(val, 10) || (new Date().getFullYear() - 1911);
    if (v2CrossYearState.toYear <= v2CrossYearState.fromYear) {
      v2CrossYearState.toYear = v2CrossYearState.fromYear + 1;
    }
  } else if (field === "toYear") {
    const ty = parseInt(val, 10) || (v2CrossYearState.fromYear + 1);
    v2CrossYearState.toYear = ty > v2CrossYearState.fromYear ? ty : (v2CrossYearState.fromYear + 1);
  } else {
    v2CrossYearState[field] = val;
  }
  renderBudgetView();
}

function buildCrossYearCandidateRows() {
  const fy = v2CrossYearState.fromYear;
  const ty = v2CrossYearState.toYear;
  const activeList = (v2ActiveCases || []).filter(c => c.lifecycle_stage !== "撤案");

  const cyLookup = {};
  v2BudgetCrossYear.forEach(x => {
    if (parseInt(x.from_year, 10) === fy && parseInt(x.to_year, 10) === ty) {
      cyLookup[x.case_uid] = x;
    }
  });

  const rows = [];
  activeList.forEach(c => {
    const isNonCtrl = isV2NonControlledCase(c);
    if (v2CrossYearState.nature === "CONTROLLED" && isNonCtrl) return;
    if (v2CrossYearState.nature === "NON_CONTROLLED" && !isNonCtrl) return;
    if (v2CrossYearState.branch !== "ALL" && v2NormBranch(c["分署"]) !== v2CrossYearState.branch) return;
    if (v2CrossYearState.category !== "ALL" && String(c["性質"] || "-") !== v2CrossYearState.category) return;

    const comp = computeV2CaseLatestBudget(c);
    const isSettled = comp.isSettled && comp.settledYear && fy >= comp.settledYear;
    const cy = cyLookup[c.case_uid];

    if (isSettled && !cy) return;

    const fromAmt = getPostedAmountForYear(comp, fy);
    const toAmt = getPostedAmountForYear(comp, ty);

    let mode = cy ? String(cy.cross_mode || "未納入") : "未納入";
    if (isSettled) mode = "已決算";

    const relistYr = cy && Number(cy.relist_year) > fy ? Number(cy.relist_year) : ty;
    const nextCode = cy?.next_year_code || comp.yearMap?.[ty]?.year_project_code || "";

    rows.push({
      case_uid: c.case_uid,
      branch: v2DisplayBranch(c["分署"]),
      branchOrder: CHINESE_NUM_ORDER[v2NormBranch(c["分署"])] || 99,
      nature: String(c["性質"] || "-"),
      category: String(c["類別"] || "-"),
      name: c["案件名稱"],
      county: c["縣市"] || "",
      stream: c["溪別"] || "",
      fromCode: comp.yearMap?.[fy]?.year_project_code || c["工程編號"] || "",
      nextCode,
      fromTotal: fromAmt.total_fee,
      toTotal: toAmt.total_fee,
      approvedYuan: comp.approvedYuan,
      isSettled,
      crossMode: mode,
      relistYear: relistYr,
      remark: cy?.remark || ""
    });
  });

  rows.sort((a, b) => (a.nature.localeCompare(b.nature)) || (a.branchOrder - b.branchOrder) || a.fromCode.localeCompare(b.fromCode));
  v2CrossYearState.rows = rows;
  return rows;
}

function updateCrossYearRowMode(idx, newMode) {
  const row = v2CrossYearState.rows[idx];
  if (!row || row.isSettled) return;
  row.crossMode = row.crossMode === newMode ? "未納入" : newMode;
  renderBudgetView();
}

function updateCrossYearRowField(idx, field, val) {
  const row = v2CrossYearState.rows[idx];
  if (!row || row.isSettled) return;
  if (field === "relistYear") {
    const yr = parseInt(val, 10) || v2CrossYearState.toYear;
    row.relistYear = yr > v2CrossYearState.fromYear ? yr : v2CrossYearState.toYear;
  } else {
    row[field] = val;
  }
}

function batchCheckCrossYearScope(targetMode) {
  v2CrossYearState.rows.forEach(r => {
    if (!r.isSettled) r.crossMode = targetMode;
  });
  renderBudgetView();
}

async function submitBatchCrossYear() {
  if (!adminPasscode) return alert("請先登入署端管理者帳號");
  const editableRows = v2CrossYearState.rows.filter(r => !r.isSettled);
  if (!editableRows.length) return alert("目前範圍內無可儲存的未決算案件");

  const btn = document.getElementById("btnSaveCrossYearBatch");
  if (btn) { btn.disabled = true; btn.textContent = "儲存中..."; }
  try {
    const updates = editableRows.map(r => ({
      case_uid: r.case_uid,
      from_year: v2CrossYearState.fromYear,
      to_year: v2CrossYearState.toYear,
      cross_mode: r.crossMode,
      relist_year: r.relistYear,
      next_year_code: r.nextCode,
      remark: r.remark
    }));
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "v2_budget_batch_save_cross_year",
        passcode: adminPasscode,
        updates
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
    if (btn) { btn.disabled = false; btn.textContent = "儲存跨年度設定"; }
  }
}

function exportCrossYearExcel() {
  const fy = v2CrossYearState.fromYear;
  const ty = v2CrossYearState.toYear;
  const included = v2CrossYearState.rows.filter(r => !r.isSettled && r.crossMode !== "未納入");
  if (!included.length) {
    return alert("目前篩選範圍內沒有已勾選納入（續列／次年無經費／改列）的案件可供匯出。");
  }

  const sheetData = included.map((r, i) => ({
    "項次": i + 1,
    "性質": r.nature,
    "分署別": r.branch,
    "類別": r.category,
    "案件名稱": r.name,
    "縣市": r.county,
    "溪別": r.stream,
    [`${fy}年度工程編號`]: r.fromCode,
    [`${ty}年度工程編號`]: r.nextCode,
    [`${fy}年度經費(元)`]: r.fromTotal,
    [`${ty}年度經費(元)`]: r.toTotal,
    "核定經費(元)": r.approvedYuan,
    "跨年度處理方式": r.crossMode === "改列其他年度新案" ? `改列${r.relistYear}年度新案` : r.crossMode,
    "備註": r.remark
  }));

  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${fy}跨${ty}年度案件表`);
  XLSX.writeFile(wb, `${fy}年度跨${ty}年度工程案件表.xlsx`);
}

function renderCrossYearBatchView() {
  const isAdmin = Boolean(adminPasscode);
  const unitLbl = getBudgetUnitLabel();
  const rows = buildCrossYearCandidateRows();
  const natures = Array.from(new Set((v2ActiveCases || []).map(c => String(c["性質"] || "-")).filter(Boolean)));

  const relistYearOptions = [];
  for (let y = v2CrossYearState.fromYear + 1; y <= v2CrossYearState.fromYear + 6; y++) {
    relistYearOptions.push(y);
  }

  const tbodyHtml = rows.map((r, idx) => {
    const disabledAttr = (!isAdmin || r.isSettled) ? "disabled" : "";
    const rowBg = r.isSettled ? "bg-slate-100 opacity-65" : (idx % 2 === 0 ? "bg-white" : "bg-[#F7F5F0]/75");

    return `
      <tr class="${rowBg}">
        <td class="px-2 py-1.5 text-center font-bold whitespace-nowrap">${escapeHtmlAttr(r.branch)}</td>
        <td class="px-2 py-1.5 whitespace-nowrap">${escapeHtmlAttr(r.nature)}</td>
        <td class="px-2 py-1.5 font-bold text-[#1D3557] min-w-[200px]">${escapeHtmlAttr(r.name)}</td>
        <td class="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">${escapeHtmlAttr(r.fromCode || "-")}</td>
        <td class="px-2 py-1.5">
          <input type="text" value="${escapeHtmlAttr(r.nextCode)}" ${disabledAttr} oninput="updateCrossYearRowField(${idx},'nextCode',this.value)" placeholder="次年編號" class="w-32 border border-[#1D3557]/20 bg-white rounded px-1.5 py-0.5 font-mono text-[11px]" />
        </td>
        <td class="px-2 py-1.5 text-right font-mono whitespace-nowrap">${formatBudgetAmount(r.fromTotal)}</td>
        <td class="px-2 py-1.5 text-right font-mono whitespace-nowrap">${formatBudgetAmount(r.toTotal)}</td>
        <td class="px-2 py-1.5 text-center bg-[#eaf4ff]/80">
          <input type="checkbox" ${r.crossMode === "續列後續年度" ? "checked" : ""} ${disabledAttr} onchange="updateCrossYearRowMode(${idx},'續列後續年度')" class="rounded accent-[#004E89]" />
        </td>
        <td class="px-2 py-1.5 text-center bg-[#fff4e8]/80">
          <input type="checkbox" ${r.crossMode === "次年無經費未決算" ? "checked" : ""} ${disabledAttr} onchange="updateCrossYearRowMode(${idx},'次年無經費未決算')" class="rounded accent-[#ED6D35]" />
        </td>
        <td class="px-2 py-1.5 text-center bg-[#f2ecff]/80 whitespace-nowrap">
          <div class="inline-flex items-center gap-1">
            <input type="checkbox" ${r.crossMode === "改列其他年度新案" ? "checked" : ""} ${disabledAttr} onchange="updateCrossYearRowMode(${idx},'改列其他年度新案')" class="rounded accent-purple-700" />
            <select ${disabledAttr || r.crossMode !== "改列其他年度新案" ? "disabled" : ""} onchange="updateCrossYearRowField(${idx},'relistYear',this.value)" class="border border-[#1D3557]/20 bg-white rounded px-1 py-0.5 text-[11px] font-mono">
              ${relistYearOptions.map(y => `<option value="${y}" ${r.relistYear === y ? "selected" : ""}>${y}年</option>`).join("")}
            </select>
          </div>
        </td>
        <td class="px-2 py-1.5">
          <input type="text" value="${escapeHtmlAttr(r.remark)}" ${disabledAttr} oninput="updateCrossYearRowField(${idx},'remark',this.value)" placeholder="跨年度備註" class="w-28 border border-[#1D3557]/20 bg-white rounded px-1.5 py-0.5 text-[11px]" />
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="space-y-2.5 text-xs">
      <div class="bg-white border border-[#1D3557]/15 rounded-lg p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <label class="font-bold text-[#1D3557]">來源年度：</label>
            <input type="number" min="90" max="150" value="${v2CrossYearState.fromYear}" onchange="updateCrossYearFilter('fromYear', this.value)" class="w-16 border border-[#1D3557]/25 rounded px-2 py-1 font-mono font-bold" />
            <label class="font-bold text-[#1D3557]">跨到年度：</label>
            <input type="number" min="91" max="151" value="${v2CrossYearState.toYear}" onchange="updateCrossYearFilter('toYear', this.value)" class="w-16 border border-[#1D3557]/25 rounded px-2 py-1 font-mono font-bold" />
            <select onchange="updateCrossYearFilter('nature', this.value)" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white">
              <option value="CONTROLLED" ${v2CrossYearState.nature === "CONTROLLED" ? "selected" : ""}>控管案件（預設）</option>
              <option value="NON_CONTROLLED" ${v2CrossYearState.nature === "NON_CONTROLLED" ? "selected" : ""}>非控管案件</option>
              <option value="ALL" ${v2CrossYearState.nature === "ALL" ? "selected" : ""}>全部性質</option>
            </select>
            <select onchange="updateCrossYearFilter('branch', this.value)" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white">
              <option value="ALL" ${v2CrossYearState.branch === "ALL" ? "selected" : ""}>全部分署</option>
              ${V2_BRANCH_KEYS.map(b => `<option value="${b}" ${v2CrossYearState.branch === b ? "selected" : ""}>${v2DisplayBranch(b)}</option>`).join("")}
            </select>
            <select onchange="updateCrossYearFilter('category', this.value)" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white">
              <option value="ALL" ${v2CrossYearState.category === "ALL" ? "selected" : ""}>全部工程性質</option>
              ${natures.map(n => `<option value="${escapeHtmlAttr(n)}" ${v2CrossYearState.category === n ? "selected" : ""}>${escapeHtmlAttr(n)}</option>`).join("")}
            </select>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick="exportCrossYearExcel()" class="px-3 py-1 rounded bg-[#004E89] hover:bg-[#1D3557] text-white font-bold">匯出跨年度 Excel</button>
            ${isAdmin ? `
              <button type="button" onclick="batchCheckCrossYearScope('續列後續年度')" class="px-2.5 py-1 rounded bg-white border border-[#1D3557]/25 text-[#1D3557] hover:bg-[#FAF3E0] font-bold">全選續列</button>
              <button type="button" onclick="batchCheckCrossYearScope('未納入')" class="px-2.5 py-1 rounded bg-white border border-[#1D3557]/25 text-[#1D3557] hover:bg-[#FAF3E0] font-bold">全部取消</button>
              <button type="button" id="btnSaveCrossYearBatch" onclick="submitBatchCrossYear()" class="px-3.5 py-1 rounded bg-[#ED6D35] hover:bg-[#D65A24] text-white font-bold">儲存跨年度設定</button>
            ` : ""}
          </div>
        </div>
        <div class="text-[11px] text-[#1D3557]/70">
          目前維護：<b>${v2CrossYearState.fromYear} 年度跨 ${v2CrossYearState.toYear} 年度案件表</b>（共 ${rows.length} 筆；金額顯示單位：${unitLbl}）。已決算案件自動鎖定不可續列，改列年度強制必須大於 ${v2CrossYearState.fromYear} 年。
        </div>
      </div>

      <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr>
              <th class="px-2 py-2 text-center whitespace-nowrap">分署別</th>
              <th class="px-2 py-2 whitespace-nowrap">性質</th>
              <th class="px-2 py-2 whitespace-nowrap">案件名稱</th>
              <th class="px-2 py-2 whitespace-nowrap">${v2CrossYearState.fromYear}年度編號</th>
              <th class="px-2 py-2 whitespace-nowrap">${v2CrossYearState.toYear}年度編號</th>
              <th class="px-2 py-2 text-right whitespace-nowrap">${v2CrossYearState.fromYear}年經費</th>
              <th class="px-2 py-2 text-right whitespace-nowrap">${v2CrossYearState.toYear}年經費</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">續列至${v2CrossYearState.toYear}</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">次年無經費</th>
              <th class="px-2 py-2 text-center whitespace-nowrap">改列其他年度新案</th>
              <th class="px-2 py-2 whitespace-nowrap">跨年度備註</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${tbodyHtml || `<tr><td colspan="11" class="py-8 text-center text-slate-400">目前條件下無未決算或已列入本表之案件</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}