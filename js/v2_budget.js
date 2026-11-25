/**
 * 治水雲庫 V2 — 案件經費登載模組
 * Phase 1：資料結構、唯讀總覽與動態疊加引擎
 * Phase 2：預計增減通知登打（雙向輸入防呆）＋ 正式變更／結算多通知勾稽與原子寫入
 * Phase 3：空污費退回、完工日期獨立維護與決算登打、歷程整批作廢與稽核、跨年度案件表批次維護與 Excel 匯出
 */

let v2BudgetEntries = [];
let v2BudgetPlanned = [];
let v2BudgetCrossYear = [];
let v2BudgetAuditLogs = [];

let v2BudgetSelectedUid = "";
let v2BudgetSubMode = "workbench"; // "workbench" | "crossyear"
let v2BudgetActiveTab = "planned"; // "planned" | "revision" | "settlement" | "history"
let v2BudgetDisplayUnit = "yuan"; // "yuan" | "thousand"

// 跨年度案件表批次維護狀態
let v2CrossYearState = {
  fromYear: new Date().getFullYear() - 1911,
  toYear: new Date().getFullYear() - 1910,
  nature: "CONTROLLED", // "CONTROLLED" | "NON_CONTROLLED" | "ALL"
  branch: "ALL",
  category: "ALL",
  rows: [] // 當前畫面可編輯列緩存
};

// 單案暫存工作狀態（切換案件時必定完整重置，杜絕跨案殘留）
let v2BudgetDraft = {
  caseUid: "",
  plannedEditId: "",
  plannedDate: "",
  plannedDocNo: "",
  plannedTargetYear: 0,
  plannedStage: "第1次變更",
  plannedStatus: "待確認",
  plannedAfter: { work: "", air: "", other: "", mgmt: "", land: "" },
  plannedInc: { work: "", air: "", other: "", mgmt: "", land: "" },
  plannedRemark: "",
  revStage: "原始登帳",
  revDocDate: "",
  revDocNo: "",
  revAffectsLatest: true,
  revRemark: "",
  revLinkedNoticeIds: [],
  revRows: [],
  // Phase 3：空污費退回、完工日期與決算暫存
  refundYear: 0,
  refundDate: "",
  refundDocNo: "",
  refundAmount: "",
  refundRemark: "",
  completionDate: "",
  settleYear: 0,
  settleDate: "",
  settleDocNo: "",
  settleWork: "",
  settleAir: "",
  settleOther: "",
  settleMgmt: "",
  settleLand: "",
  settleRemark: ""
};

const V2_FULL_CODE_REGEX = /^\d{3}-[A-Z]-\d{3}-\d{2}-\d{3}-\d{3}$/i;
const V2_PLANNED_STAGE_OPTIONS = ["第1次變更", "第2次變更", "第3次變更", "第4次變更", "第5次變更", "第6次變更", "結算", "其他"];
const V2_PLANNED_STATUS_OPTIONS = ["待確認", "已勾稽確認", "取消", "改由其他文號確認"];
const V2_REVISION_STAGE_OPTIONS = [
  { label: "原始登帳", order: 0 },
  { label: "第1次變更", order: 1 },
  { label: "第2次變更", order: 2 },
  { label: "第3次變更", order: 3 },
  { label: "第4次變更", order: 4 },
  { label: "第5次變更", order: 5 },
  { label: "第6次變更", order: 6 },
  { label: "結算", order: 8000 }
];
const V2_FEE_KEYS = [
  { key: "work", field: "work_fee", label: "工作費" },
  { key: "air", field: "air_fee", label: "空污費" },
  { key: "other", field: "other_fee", label: "其他費" },
  { key: "mgmt", field: "mgmt_fee", label: "工管費" },
  { key: "land", field: "land_fee", label: "用地費(其他)" }
];

function getTodayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getStageOrderByLabel(label) {
  const found = V2_REVISION_STAGE_OPTIONS.find(s => s.label === label);
  if (found) return found.order;
  const m = String(label || "").match(/第\s*(\d+)\s*次/);
  if (m) return parseInt(m[1], 10);
  if (String(label || "").includes("決算")) return 9000;
  return 100;
}

function parseYuanInput(raw) {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(/,/g, "").trim();
  if (s === "" || s === "-") return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

function hasYuanInputValue(raw) {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).replace(/,/g, "").trim();
  return s !== "" && s !== "-";
}

function initV2BudgetData(json) {
  v2BudgetEntries = Array.isArray(json.budgetEntries) ? json.budgetEntries : [];
  v2BudgetPlanned = Array.isArray(json.budgetPlanned) ? json.budgetPlanned : [];
  v2BudgetCrossYear = Array.isArray(json.budgetCrossYear) ? json.budgetCrossYear : [];
  v2BudgetAuditLogs = Array.isArray(json.budgetAuditLogs) ? json.budgetAuditLogs : [];
  if (v2BudgetSelectedUid) {
    resetV2BudgetDraftForCase(v2BudgetSelectedUid);
  }
}

function isV2NonControlledCase(c) {
  const nature = String(c["性質"] || "").trim();
  const cat = String(c["類別"] || "").trim();
  const combined = `${nature} ${cat}`;
  return ["維修改善", "構造物", "歲修", "復建"].some(k => combined.includes(k));
}

function getV2CaseControlNature(c) {
  return isV2NonControlledCase(c) ? "非控管案件" : "控管案件";
}

function formatBudgetAmount(yuanVal, blankZero = false) {
  const n = Number(yuanVal) || 0;
  if (Math.abs(n) < 0.0001) return blankZero ? "" : "-";
  if (v2BudgetDisplayUnit === "thousand") {
    const k = n / 1000;
    return Number.isInteger(k) ? k.toLocaleString() : k.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 3 });
  }
  return Math.round(n).toLocaleString();
}

function formatSignedYuan(val) {
  const n = Math.round(Number(val) || 0);
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `${n.toLocaleString()}`;
  return "0";
}

function formatDirectionYuan(val) {
  const n = Math.round(Number(val) || 0);
  if (n > 0) return `增加 ${n.toLocaleString()} 元`;
  if (n < 0) return `減少 ${Math.abs(n).toLocaleString()} 元`;
  return "無增減 (0 元)";
}

function getBudgetUnitLabel() {
  return v2BudgetDisplayUnit === "thousand" ? "千元" : "元";
}

function setV2BudgetDisplayUnit(unit) {
  v2BudgetDisplayUnit = unit === "thousand" ? "thousand" : "yuan";
  renderBudgetView();
}

function setV2BudgetSubMode(mode) {
  v2BudgetSubMode = mode === "crossyear" ? "crossyear" : "workbench";
  renderBudgetView();
}

function setV2BudgetActiveTab(tab) {
  v2BudgetActiveTab = tab;
  renderBudgetWorkbenchArea();
}

/**
 * 單案動態疊加引擎：
 * 1. 同年度有效分錄（status !== '作廢' 且 affects_latest === 1）優先序：決算 > 最高 stage_order 正式變更/結算 > 原始登帳
 * 2. 空污費退回（entry_type === '空污費退回'）獨立列為負數列（列於空污費與合計）
 * 3. 尚無任何分錄之控管案件，以核定經費_千元 * 1000 暫代顯示一次（不寫回資料庫）
 */
function computeV2CaseLatestBudget(caseObj) {
  const uid = caseObj.case_uid;
  const isNonControlled = isV2NonControlledCase(caseObj);
  const approvedYuan = Math.round((parseFloat(caseObj["核定經費_千元"]) || 0) * 1000);

  const validEntries = v2BudgetEntries.filter(e => e.case_uid === uid && String(e.status || "有效") !== "作廢");
  const effectiveEntries = validEntries.filter(e => Number(e.affects_latest) === 1 && e.entry_type !== "空污費退回");
  const refundEntries = validEntries.filter(e => e.entry_type === "空污費退回");
  const settlementEntries = validEntries.filter(e => e.entry_type === "決算");

  const yearMap = {};
  effectiveEntries.forEach(e => {
    const y = parseInt(e.fund_year, 10) || 0;
    if (!y) return;
    const priority = e.entry_type === "決算" ? 90000 : (Number(e.stage_order) || 0);
    const prev = yearMap[y];
    if (!prev || priority > prev._priority || (priority === prev._priority && String(e.updated_at || "") >= String(prev.updated_at || ""))) {
      const w = Number(e.work_fee) || 0;
      const a = Number(e.air_fee) || 0;
      const o = Number(e.other_fee) || 0;
      const m = Number(e.mgmt_fee) || 0;
      const l = Number(e.land_fee) || 0;
      const tot = Number(e.total_fee) || (w + a + o + m + l);
      yearMap[y] = {
        fund_year: y,
        year_label: e.entry_type === "原始登帳" ? String(y) : `${y} (${e.entry_type})`,
        year_project_code: e.year_project_code || caseObj["工程編號"] || "",
        entry_type: e.entry_type,
        doc_no: e.doc_no || "",
        work_fee: w,
        air_fee: a,
        other_fee: o,
        mgmt_fee: m,
        land_fee: l,
        total_fee: tot,
        remark: e.remark || "",
        is_placeholder: false,
        is_refund: false,
        _priority: priority,
        updated_at: e.updated_at || ""
      };
    }
  });

  const rows = Object.keys(yearMap).map(Number).sort((a, b) => a - b).map(y => yearMap[y]);

  const refundByYear = {};
  refundEntries.forEach(r => {
    const y = parseInt(r.fund_year, 10) || 0;
    if (!y) return;
    const amt = Math.abs(Number(r.air_fee) || Number(r.total_fee) || 0);
    if (!refundByYear[y]) {
      refundByYear[y] = { amt: 0, docs: [], remarks: [] };
    }
    refundByYear[y].amt += amt;
    if (r.doc_no) refundByYear[y].docs.push(r.doc_no);
    if (r.remark) refundByYear[y].remarks.push(r.remark);
  });

  Object.keys(refundByYear).map(Number).sort((a, b) => a - b).forEach(y => {
    const item = refundByYear[y];
    if (item.amt <= 0) return;
    rows.push({
      fund_year: y,
      year_label: `${y} 空污費退回`,
      year_project_code: yearMap[y]?.year_project_code || caseObj["工程編號"] || "",
      entry_type: "空污費退回",
      doc_no: item.docs.join("、"),
      work_fee: 0,
      air_fee: -item.amt,
      other_fee: 0,
      mgmt_fee: 0,
      land_fee: 0,
      total_fee: -item.amt,
      remark: item.remarks.join("；"),
      is_placeholder: false,
      is_refund: true,
      _sort: y + 0.5
    });
  });

  rows.sort((a, b) => (a._sort || a.fund_year) - (b._sort || b.fund_year));

  let isUsingPlaceholder = false;
  if (rows.length === 0 && !isNonControlled && approvedYuan > 0) {
    isUsingPlaceholder = true;
    const baseYr = parseInt(caseObj["核定年度"], 10) || (new Date().getFullYear() - 1911);
    rows.push({
      fund_year: baseYr,
      year_label: `${baseYr} (核定暫代)`,
      year_project_code: caseObj["工程編號"] || "",
      entry_type: "核定經費暫代",
      doc_no: caseObj["核定文號"] || "",
      work_fee: 0,
      air_fee: 0,
      other_fee: 0,
      mgmt_fee: 0,
      land_fee: 0,
      total_fee: approvedYuan,
      remark: "尚無正式登帳紀錄，合計暫以核定經費顯示一次（不寫入分錄表）",
      is_placeholder: true,
      is_refund: false
    });
  }

  const summary = {
    work_fee: rows.reduce((s, r) => s + r.work_fee, 0),
    air_fee: rows.reduce((s, r) => s + r.air_fee, 0),
    other_fee: rows.reduce((s, r) => s + r.other_fee, 0),
    mgmt_fee: rows.reduce((s, r) => s + r.mgmt_fee, 0),
    land_fee: rows.reduce((s, r) => s + r.land_fee, 0),
    total_fee: rows.reduce((s, r) => s + r.total_fee, 0)
  };

  const hasPostedFees = validEntries.some(e => Math.abs(Number(e.total_fee) || 0) > 0);
  const isSettled = settlementEntries.length > 0;
  const settledYear = isSettled ? Math.min(...settlementEntries.map(s => parseInt(s.fund_year, 10) || 999)) : null;

  return {
    rows,
    yearMap,
    summary,
    approvedYuan,
    isUsingPlaceholder,
    hasPostedFees,
    isSettled,
    settledYear,
    allValidEntries: validEntries,
    refundEntries,
    settlementEntries
  };
}

function getPostedAmountForYear(comp, fundYear) {
  const y = parseInt(fundYear, 10);
  const rec = comp.yearMap ? comp.yearMap[y] : null;
  if (!rec) {
    return { work_fee: 0, air_fee: 0, other_fee: 0, mgmt_fee: 0, land_fee: 0, total_fee: 0 };
  }
  return {
    work_fee: Number(rec.work_fee) || 0,
    air_fee: Number(rec.air_fee) || 0,
    other_fee: Number(rec.other_fee) || 0,
    mgmt_fee: Number(rec.mgmt_fee) || 0,
    land_fee: Number(rec.land_fee) || 0,
    total_fee: Number(rec.total_fee) || 0
  };
}

function resetV2BudgetDraftForCase(uid) {
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === uid);
  const today = getTodayIsoDate();
  if (!caseObj) {
    v2BudgetDraft.caseUid = "";
    return;
  }

  const comp = computeV2CaseLatestBudget(caseObj);
  const postedYears = Object.keys(comp.yearMap || {}).map(Number).sort((a, b) => a - b);
  const baseYear = postedYears.length
    ? postedYears[postedYears.length - 1]
    : (parseInt(caseObj["核定年度"], 10) || (new Date().getFullYear() - 1911));

  let suggestedStage = "原始登帳";
  if (postedYears.length > 0) {
    const nonSettleOrders = comp.allValidEntries
      .filter(e => e.entry_type !== "空污費退回" && e.entry_type !== "決算")
      .map(e => Number(e.stage_order) || 0);
    const maxStageOrder = nonSettleOrders.length ? Math.max(...nonSettleOrders) : 0;
    if (maxStageOrder === 0) suggestedStage = "第1次變更";
    else if (maxStageOrder < 6) suggestedStage = `第${maxStageOrder + 1}次變更`;
    else suggestedStage = "結算";
  }

  const baseAmt = getPostedAmountForYear(comp, baseYear);

  v2BudgetDraft = {
    caseUid: uid,
    plannedEditId: "",
    plannedDate: today,
    plannedDocNo: "",
    plannedTargetYear: baseYear,
    plannedStage: "第1次變更",
    plannedStatus: "待確認",
    plannedAfter: { work: "", air: "", other: "", mgmt: "", land: "" },
    plannedInc: { work: "", air: "", other: "", mgmt: "", land: "" },
    plannedRemark: "",
    revStage: suggestedStage,
    revDocDate: today,
    revDocNo: "",
    revAffectsLatest: true,
    revRemark: "",
    revLinkedNoticeIds: getActiveStageLinkedNoticeIds(uid, suggestedStage),
    revRows: buildInitialRevisionRows(caseObj, comp),
    refundYear: baseYear,
    refundDate: today,
    refundDocNo: "",
    refundAmount: "",
    refundRemark: "",
    completionDate: String(caseObj["實際完工日"] || "").trim(),
    settleYear: baseYear,
    settleDate: today,
    settleDocNo: "",
    settleWork: String(baseAmt.work_fee),
    settleAir: String(baseAmt.air_fee),
    settleOther: String(baseAmt.other_fee),
    settleMgmt: String(baseAmt.mgmt_fee),
    settleLand: String(baseAmt.land_fee),
    settleRemark: ""
  };
}

function buildInitialRevisionRows(caseObj, comp) {
  const postedYears = Object.keys(comp.yearMap || {}).map(Number).sort((a, b) => a - b);
  if (postedYears.length > 0) {
    return postedYears.map(y => {
      const r = comp.yearMap[y];
      return {
        fund_year: y,
        year_project_code: r.year_project_code || caseObj["工程編號"] || "",
        work_fee: String(Math.round(r.work_fee || 0)),
        air_fee: String(Math.round(r.air_fee || 0)),
        other_fee: String(Math.round(r.other_fee || 0)),
        mgmt_fee: String(Math.round(r.mgmt_fee || 0)),
        land_fee: String(Math.round(r.land_fee || 0)),
        remark: ""
      };
    });
  }
  const baseYear = parseInt(caseObj["核定年度"], 10) || (new Date().getFullYear() - 1911);
  return [{
    fund_year: baseYear,
    year_project_code: caseObj["工程編號"] || "",
    work_fee: "0",
    air_fee: "0",
    other_fee: "0",
    mgmt_fee: "0",
    land_fee: "0",
    remark: ""
  }];
}

function getActiveStageVersionGroupIds(uid, stageLabel) {
  return new Set(
    v2BudgetEntries
      .filter(e => e.case_uid === uid && e.entry_type === stageLabel && String(e.status || "有效") !== "作廢")
      .map(e => String(e.version_group_id || "").trim())
      .filter(Boolean)
  );
}

function getActiveStageLinkedNoticeIds(uid, stageLabel) {
  const activeVerIds = getActiveStageVersionGroupIds(uid, stageLabel);
  if (!activeVerIds.size) return [];
  return v2BudgetPlanned
    .filter(p => p.case_uid === uid && activeVerIds.has(String(p.linked_version_group_id || "").trim()))
    .map(p => p.notice_id);
}

function getLinkablePlannedNotices(uid, stageLabel) {
  const activeVerIds = getActiveStageVersionGroupIds(uid, stageLabel);
  return v2BudgetPlanned.filter(p => {
    if (p.case_uid !== uid) return false;
    const st = String(p.status || "待確認").trim();
    if (st === "取消" || st === "改由其他文號確認") return false;
    const lv = String(p.linked_version_group_id || "").trim();
    return (st === "待確認" && !lv) || (lv && activeVerIds.has(lv));
  });
}

function isRevisionDeltaAllowed(actualDelta, plannedDelta) {
  if (Math.abs(plannedDelta) < 0.0001) return true;
  if (plannedDelta >= 0) return actualDelta <= plannedDelta + 0.0001;
  return actualDelta >= plannedDelta - 0.0001;
}

function calcV2HandlingStatus(caseObj, computedBudget) {
  const execStatus = String(caseObj["執行狀態"] || "").trim();
  if (execStatus.includes("解約")) return "解約";
  if (execStatus.includes("暫緩")) return "暫緩辦理";
  const hasAward = Boolean(String(caseObj["實際決標日"] || "").trim());
  const hasBasis = (parseFloat(caseObj["核定經費_千元"]) || 0) > 0 || Boolean(String(caseObj["工程編號"] || "").trim());
  if (hasBasis && !hasAward && !computedBudget.hasPostedFees) {
    return "尚未決標";
  }
  return "一般案件";
}

function getBudgetFilters() {
  return {
    year: document.getElementById("selBudYear")?.value || "ALL",
    branch: document.getElementById("selBudBranch")?.value || "ALL",
    nature: document.getElementById("selBudControlNature")?.value || "CONTROLLED",
    status: document.getElementById("selBudHandlingStatus")?.value || "ALL",
    kw: normalizeText(document.getElementById("txtBudKeyword")?.value || "").trim()
  };
}

function getFilteredBudgetCases() {
  const { year, branch, nature, status, kw } = getBudgetFilters();
  const kwUpper = kw.toUpperCase();
  const isFullCode = V2_FULL_CODE_REGEX.test(kwUpper);

  const activeList = (v2ActiveCases || []).filter(c => c.lifecycle_stage !== "撤案");

  return activeList.filter(c => {
    if (year !== "ALL" && String(c["核定年度"]) !== year) return false;
    if (branch !== "ALL" && v2NormBranch(c["分署"]) !== branch) return false;

    const isNonCtrl = isV2NonControlledCase(c);
    if (nature === "CONTROLLED" && isNonCtrl) return false;
    if (nature === "NON_CONTROLLED" && !isNonCtrl) return false;

    if (status !== "ALL") {
      const comp = computeV2CaseLatestBudget(c);
      if (calcV2HandlingStatus(c, comp) !== status) return false;
    }

    if (kw) {
      const caseCodes = [String(c["工程編號"] || "").trim().toUpperCase()];
      v2BudgetEntries.forEach(e => {
        if (e.case_uid === c.case_uid && e.year_project_code) {
          caseCodes.push(String(e.year_project_code).trim().toUpperCase());
        }
      });

      if (isFullCode) {
        if (!caseCodes.includes(kwUpper)) return false;
      } else {
        const kwLower = kw.toLowerCase();
        const hay = `${c.case_uid} ${c["案件名稱"]} ${caseCodes.join(" ")} ${c["縣市"]} ${c["溪別"] || ""} ${c["水系"]}`.toLowerCase();
        if (!hay.includes(kwLower)) return false;
      }
    }
    return true;
  });
}

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
    <!-- 頂部子模式切換與單位切換列 -->
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

      <div class="flex items-center gap-2">
        <span class="text-[#1D3557]/70 font-medium">總覽顯示單位：</span>
        <div class="inline-flex rounded border border-[#1D3557]/20 bg-white p-0.5">
          <button type="button" onclick="setV2BudgetDisplayUnit('yuan')" class="px-2.5 py-0.5 rounded font-bold transition ${v2BudgetDisplayUnit === "yuan" ? "bg-[#004E89] text-white" : "text-[#1D3557]"}">元</button>
          <button type="button" onclick="setV2BudgetDisplayUnit('thousand')" class="px-2.5 py-0.5 rounded font-bold transition ${v2BudgetDisplayUnit === "thousand" ? "bg-[#004E89] text-white" : "text-[#1D3557]"}">千元</button>
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
  const isAdmin = Boolean(adminPasscode);

  const casePlanned = v2BudgetPlanned.filter(p => p.case_uid === caseObj.case_uid);
  const pendingPlanned = casePlanned.filter(p => p.status === "待確認");
  const caseCross = v2BudgetCrossYear.filter(x => x.case_uid === caseObj.case_uid);
  const caseAudits = v2BudgetAuditLogs.filter(a => a.case_uid === caseObj.case_uid);

  const locText = [caseObj["縣市"], caseObj["鄉鎮"], caseObj["水系"], caseObj["溪別"]].filter(Boolean).join(" / ") || "-";
  const completionDate = String(caseObj["實際完工日"] || "").trim();

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
          <div class="text-[11px] text-[#FAF3E0] font-mono mt-0.5">
            主工程編號：${escapeHtmlAttr(caseObj["工程編號"] || "待補登")}
            ${caseObj["核定文號"] ? ` ｜ 核定文號：${escapeHtmlAttr(caseObj["核定文號"])}` : ""}
          </div>
        </div>

        <div class="flex flex-col items-end gap-1.5 shrink-0">
          ${isAdmin ? `<button type="button" onclick="openV2ApprovalEditModal('${escapeHtmlAttr(caseObj.case_uid)}')" class="px-2.5 py-1 rounded bg-white/15 hover:bg-[#ED6D35] text-white font-bold text-[11px] transition">編輯基本資料</button>` : ""}
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
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">工作費</div>
            <div class="font-mono">${formatBudgetAmount(comp.summary.work_fee)}</div>
          </div>
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">空污費</div>
            <div class="font-mono">${formatBudgetAmount(comp.summary.air_fee)}</div>
          </div>
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">其他費</div>
            <div class="font-mono">${formatBudgetAmount(comp.summary.other_fee)}</div>
          </div>
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">工管費</div>
            <div class="font-mono">${formatBudgetAmount(comp.summary.mgmt_fee)}</div>
          </div>
          <div class="bg-white/10 rounded px-2 py-1">
            <div class="text-white/70 text-[10px]">用地費(其他)</div>
            <div class="font-mono">${formatBudgetAmount(comp.summary.land_fee)}</div>
          </div>
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

      return `
        <tr class="${rowBg} hover:bg-[#FAF3E0]/50">
          <td class="px-2 py-1.5 font-bold text-[#1D3557] whitespace-nowrap">${escapeHtmlAttr(r.year_label)}</td>
          <td class="px-2 py-1.5 font-mono text-[#1D3557]/85 whitespace-nowrap">${escapeHtmlAttr(r.year_project_code || "-")}</td>
          <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(r.work_fee)}</td>
          <td class="px-2 py-1.5 text-right font-mono ${r.air_fee < 0 ? "text-rose-700 font-bold" : ""}">${formatBudgetAmount(r.air_fee)}</td>
          <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(r.other_fee)}</td>
          <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(r.mgmt_fee)}</td>
          <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(r.land_fee)}</td>
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
                <th class="px-2 py-2 text-right whitespace-nowrap">工作費</th>
                <th class="px-2 py-2 text-right whitespace-nowrap">空污費</th>
                <th class="px-2 py-2 text-right whitespace-nowrap">其他費</th>
                <th class="px-2 py-2 text-right whitespace-nowrap">工管費</th>
                <th class="px-2 py-2 text-right whitespace-nowrap">用地費(其他)</th>
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
                <td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary.work_fee)}</td>
                <td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary.air_fee)}</td>
                <td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary.other_fee)}</td>
                <td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary.mgmt_fee)}</td>
                <td class="px-2 py-2 text-right font-mono">${formatBudgetAmount(comp.summary.land_fee)}</td>
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

// =========================================================================
// Phase 2 — 頁籤 1：預計增減通知登打（雙向互斥換算與清單管理）
// =========================================================================

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
  v2BudgetDraft.plannedAfter = { work: "", air: "", other: "", mgmt: "", land: "" };
  v2BudgetDraft.plannedInc = {
    work: item.delta_work ? String(item.delta_work) : "",
    air: item.delta_air ? String(item.delta_air) : "",
    other: item.delta_other ? String(item.delta_other) : "",
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
  v2BudgetDraft.plannedAfter = { work: "", air: "", other: "", mgmt: "", land: "" };
  v2BudgetDraft.plannedInc = { work: "", air: "", other: "", mgmt: "", land: "" };
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
        目前額度（${v2BudgetDraft.plannedTargetYear} 年）：工作費 ${prev.curAmt.work_fee.toLocaleString()} ｜ 空污費 ${prev.curAmt.air_fee.toLocaleString()} ｜ 其他費 ${prev.curAmt.other_fee.toLocaleString()} ｜ 工管費 ${prev.curAmt.mgmt_fee.toLocaleString()} ｜ 用地費(其他) ${prev.curAmt.land_fee.toLocaleString()} ｜ 合計 ${prev.curAmt.total_fee.toLocaleString()} 元
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

// =========================================================================
// Phase 2 — 頁籤 2：正式變更／結算多通知勾稽與多年度表格寫入
// =========================================================================

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
  if (["work_fee", "air_fee", "other_fee", "mgmt_fee", "land_fee"].includes(field)) {
    const r = v2BudgetDraft.revRows[idx];
    const rowTot = parseYuanInput(r.work_fee) + parseYuanInput(r.air_fee) + parseYuanInput(r.other_fee) + parseYuanInput(r.mgmt_fee) + parseYuanInput(r.land_fee);
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
    air_fee: String(cur.air_fee),
    other_fee: String(cur.other_fee),
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
  const deltaByFee = { work: 0, air: 0, other: 0, mgmt: 0, land: 0 };
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
  const plannedByFee = {
    work: linkedNotices.reduce((s, p) => s + (Number(p.delta_work) || 0), 0),
    air: linkedNotices.reduce((s, p) => s + (Number(p.delta_air) || 0), 0),
    other: linkedNotices.reduce((s, p) => s + (Number(p.delta_other) || 0), 0),
    mgmt: linkedNotices.reduce((s, p) => s + (Number(p.delta_mgmt) || 0), 0),
    land: linkedNotices.reduce((s, p) => s + (Number(p.delta_land) || 0), 0)
  };
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
  const noticeLimitHtml = s.linkedNotices.length > 0 ? `
    <div class="pt-1.5 mt-1.5 border-t border-[#1D3557]/12 text-[11px]">
      <span class="font-bold text-[#004E89]">已勾稽 ${s.linkedNotices.length} 筆通知合併額度：${formatDirectionYuan(s.plannedDeltaTotal)}</span>
      <span class="text-[#1D3557]/75 font-mono ml-2">（工作費 ${formatSignedYuan(s.plannedByFee.work)}｜空污費 ${formatSignedYuan(s.plannedByFee.air)}｜其他費 ${formatSignedYuan(s.plannedByFee.other)}｜工管費 ${formatSignedYuan(s.plannedByFee.mgmt)}｜用地費 ${formatSignedYuan(s.plannedByFee.land)}）</span>
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
      const a = parseYuanInput(r.air_fee);
      const o = parseYuanInput(r.other_fee);
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
        total_fee: w + a + o + m + l,
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
    return `
      <label class="flex items-start gap-2 p-2 rounded border ${checked ? "bg-[#FFF3DE] border-[#ED6D35]" : "bg-white border-[#1D3557]/15"} cursor-pointer text-[11px]">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleRevNoticeLink('${escapeHtmlAttr(n.notice_id)}', this.checked)" class="mt-0.5 rounded accent-[#ED6D35]" />
        <div class="flex-1 min-w-0">
          <div class="font-bold text-[#1D3557]">
            ${escapeHtmlAttr(n.notice_date || "-")} ｜ 文號：${escapeHtmlAttr(n.doc_no || "-")} ｜ ${escapeHtmlAttr(n.target_year)}年 ${escapeHtmlAttr(n.planned_stage)}
            <span class="ml-1.5 text-[#ED6D35]">${formatDirectionYuan(n.delta_total)}</span>
          </div>
          <div class="text-[#1D3557]/70 font-mono truncate">
            修正後參考：工作費 ${(Number(n.after_work) || 0).toLocaleString()}｜空污費 ${(Number(n.after_air) || 0).toLocaleString()}｜其他費 ${(Number(n.after_other) || 0).toLocaleString()}｜工管費 ${(Number(n.after_mgmt) || 0).toLocaleString()}｜用地費 ${(Number(n.after_land) || 0).toLocaleString()}
          </div>
        </div>
      </label>
    `;
  }).join("") : `<div class="text-[11px] text-[#1D3557]/60 px-2 py-1.5 bg-white border border-dashed border-[#1D3557]/20 rounded">本案目前無待確認之預計增減通知，可直接登打並儲存正式變更。</div>`;

  const tableRowsHtml = v2BudgetDraft.revRows.map((r, idx) => {
    const rowTot = parseYuanInput(r.work_fee) + parseYuanInput(r.air_fee) + parseYuanInput(r.other_fee) + parseYuanInput(r.mgmt_fee) + parseYuanInput(r.land_fee);
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
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">工作費</th>
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">空污費</th>
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">其他費</th>
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">工管費</th>
                <th class="px-1.5 py-1.5 text-right whitespace-nowrap">用地費(其他)</th>
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

// =========================================================================
// Phase 3 — 頁籤 3：空污費退回、完工日期獨立維護與最終決算登打
// =========================================================================

function onSettleYearChange(newYearVal) {
  const yr = parseInt(newYearVal, 10) || (new Date().getFullYear() - 1911);
  v2BudgetDraft.settleYear = yr;
  const caseObj = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
  if (caseObj) {
    const comp = computeV2CaseLatestBudget(caseObj);
    const amt = getPostedAmountForYear(comp, yr);
    v2BudgetDraft.settleWork = String(amt.work_fee);
    v2BudgetDraft.settleAir = String(amt.air_fee);
    v2BudgetDraft.settleOther = String(amt.other_fee);
    v2BudgetDraft.settleMgmt = String(amt.mgmt_fee);
    v2BudgetDraft.settleLand = String(amt.land_fee);
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

  const w = parseYuanInput(v2BudgetDraft.settleWork);
  const a = parseYuanInput(v2BudgetDraft.settleAir);
  const o = parseYuanInput(v2BudgetDraft.settleOther);
  const m = parseYuanInput(v2BudgetDraft.settleMgmt);
  const l = parseYuanInput(v2BudgetDraft.settleLand);
  const tot = w + a + o + m + l;
  const delta = tot - cur.total_fee;

  bar.innerHTML = `
    <div class="bg-[#EAF2F9] border border-[#1D3557]/15 rounded px-3 py-2 text-xs space-y-1">
      <div class="font-bold text-[#1D3557]">
        決算合計：<span class="font-mono text-[#004E89]">${tot.toLocaleString()}</span> 元
        ｜ ${v2BudgetDraft.settleYear} 年度前次合計：<span class="font-mono">${cur.total_fee.toLocaleString()}</span> 元
        ｜ 結餘／增減：<span class="font-mono text-[#ED6D35]">${formatDirectionYuan(delta)}</span>
      </div>
      <div class="text-[11px] text-[#1D3557]/75 font-mono">
        各費目差額：工作費 ${formatSignedYuan(w - cur.work_fee)} ｜ 空污費 ${formatSignedYuan(a - cur.air_fee)} ｜ 其他費 ${formatSignedYuan(o - cur.other_fee)} ｜ 工管費 ${formatSignedYuan(m - cur.mgmt_fee)} ｜ 用地費 ${formatSignedYuan(l - cur.land_fee)}
      </div>
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
            ${v2BudgetDraft.settleYear} 年度前次有效額度：工作費 ${curSettleAmt.work_fee.toLocaleString()} ｜ 空污費 ${curSettleAmt.air_fee.toLocaleString()} ｜ 其他費 ${curSettleAmt.other_fee.toLocaleString()} ｜ 工管費 ${curSettleAmt.mgmt_fee.toLocaleString()} ｜ 用地費 ${curSettleAmt.land_fee.toLocaleString()} ｜ 合計 ${curSettleAmt.total_fee.toLocaleString()} 元
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div>
              <label class="block text-[11px] mb-0.5">決算工作費</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleWork)}" oninput="updateSettleFeeField('settleWork', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
            <div>
              <label class="block text-[11px] mb-0.5">決算空污費</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleAir)}" oninput="updateSettleFeeField('settleAir', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
            <div>
              <label class="block text-[11px] mb-0.5">決算其他費</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleOther)}" oninput="updateSettleFeeField('settleOther', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
            <div>
              <label class="block text-[11px] mb-0.5">決算工管費</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleMgmt)}" oninput="updateSettleFeeField('settleMgmt', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
            <div>
              <label class="block text-[11px] mb-0.5">決算用地費(其他)</label>
              <input type="text" value="${escapeHtmlAttr(v2BudgetDraft.settleLand)}" oninput="updateSettleFeeField('settleLand', this.value)" class="w-full border border-[#1D3557]/20 bg-white rounded px-2 py-1 text-right font-mono" />
            </div>
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

// =========================================================================
// Phase 3 — 頁籤 4：經費歷程整合視圖、版本整批作廢與異動稽核
// =========================================================================

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

  // 依 version_group_id 分組計算各階段整案合計與前次差額
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
        <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e.work_fee)}</td>
        <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e.air_fee)}</td>
        <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e.other_fee)}</td>
        <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e.mgmt_fee)}</td>
        <td class="px-2 py-1.5 text-right font-mono">${formatBudgetAmount(e.land_fee)}</td>
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
              <th class="px-2 py-1.5 text-right whitespace-nowrap">工作費</th>
              <th class="px-2 py-1.5 text-right whitespace-nowrap">空污費</th>
              <th class="px-2 py-1.5 text-right whitespace-nowrap">其他費</th>
              <th class="px-2 py-1.5 text-right whitespace-nowrap">工管費</th>
              <th class="px-2 py-1.5 text-right whitespace-nowrap">用地費</th>
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

// =========================================================================
// Phase 3 — 跨年度案件表批次維護視圖與 Excel 匯出
// =========================================================================

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

    // 未決算案件或已列入本表之案件才納入候選
    if (isSettled && !cy) return;

    const fromAmt = getPostedAmountForYear(comp, fy);
    const toAmt = getPostedAmountForYear(comp, ty);

    let mode = cy ? String(cy.cross_mode || "未納入") : "未納入";
    if (isSettled) mode = "已決算";

    let relistYr = cy && Number(cy.relist_year) > fy ? Number(cy.relist_year) : ty;
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