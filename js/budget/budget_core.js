/**
 * 治水雲庫 V2 — 案件經費登載核心模組（狀態、單一費目順序與動態疊加引擎）
 */

let v2BudgetEntries = [];
let v2BudgetPlanned = [];
let v2BudgetCrossYear = [];
let v2BudgetAuditLogs = [];

let v2BudgetSelectedUid = "";
let v2BudgetSubMode = "workbench"; // "workbench" | "crossyear"
let v2BudgetActiveTab = "planned"; // "planned" | "revision" | "settlement" | "history"
let v2BudgetDisplayUnit = "yuan"; // "yuan" | "thousand"
let v2LedgerExportScope = "filtered"; // "filtered" | "current"

let v2CrossYearState = {
  fromYear: new Date().getFullYear() - 1911,
  toYear: new Date().getFullYear() - 1910,
  nature: "CONTROLLED",
  branch: "ALL",
  category: "ALL",
  rows: []
};

let v2BudgetDraft = {
  caseUid: "",
  plannedEditId: "",
  plannedDate: "",
  plannedDocNo: "",
  plannedTargetYear: 0,
  plannedStage: "第1次變更",
  plannedStatus: "待確認",
  plannedAfter: { work: "", other: "", air: "", mgmt: "", land: "" },
  plannedInc: { work: "", other: "", air: "", mgmt: "", land: "" },
  plannedRemark: "",
  revStage: "原始登帳",
  revDocDate: "",
  revDocNo: "",
  revAffectsLatest: true,
  revRemark: "",
  revLinkedNoticeIds: [],
  revRows: [],
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
  settleOther: "",
  settleAir: "",
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

// 單一費目順序來源：工作費 → 其他費 → 空污費 → 工管費 → 用地費(其他)
const V2_FEE_KEYS = [
  { key: "work", field: "work_fee", label: "工作費", plannedDelta: "delta_work", plannedAfter: "after_work", settleField: "settleWork" },
  { key: "other", field: "other_fee", label: "其他費", plannedDelta: "delta_other", plannedAfter: "after_other", settleField: "settleOther" },
  { key: "air", field: "air_fee", label: "空污費", plannedDelta: "delta_air", plannedAfter: "after_air", settleField: "settleAir" },
  { key: "mgmt", field: "mgmt_fee", label: "工管費", plannedDelta: "delta_mgmt", plannedAfter: "after_mgmt", settleField: "settleMgmt" },
  { key: "land", field: "land_fee", label: "用地費(其他)", plannedDelta: "delta_land", plannedAfter: "after_land", settleField: "settleLand" }
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

function setV2LedgerExportScope(scope) {
  v2LedgerExportScope = scope === "current" ? "current" : "filtered";
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
      const o = Number(e.other_fee) || 0;
      const a = Number(e.air_fee) || 0;
      const m = Number(e.mgmt_fee) || 0;
      const l = Number(e.land_fee) || 0;
      const tot = Number(e.total_fee) || (w + o + a + m + l);
      yearMap[y] = {
        fund_year: y,
        year_label: e.entry_type === "原始登帳" ? String(y) : `${y} (${e.entry_type})`,
        year_project_code: e.year_project_code || caseObj["工程編號"] || "",
        entry_type: e.entry_type,
        doc_no: e.doc_no || "",
        work_fee: w,
        other_fee: o,
        air_fee: a,
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
      other_fee: 0,
      air_fee: -item.amt,
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
      other_fee: 0,
      air_fee: 0,
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
    other_fee: rows.reduce((s, r) => s + r.other_fee, 0),
    air_fee: rows.reduce((s, r) => s + r.air_fee, 0),
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
    return { work_fee: 0, other_fee: 0, air_fee: 0, mgmt_fee: 0, land_fee: 0, total_fee: 0 };
  }
  return {
    work_fee: Number(rec.work_fee) || 0,
    other_fee: Number(rec.other_fee) || 0,
    air_fee: Number(rec.air_fee) || 0,
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
    plannedAfter: { work: "", other: "", air: "", mgmt: "", land: "" },
    plannedInc: { work: "", other: "", air: "", mgmt: "", land: "" },
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
    settleOther: String(baseAmt.other_fee),
    settleAir: String(baseAmt.air_fee),
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
        other_fee: String(Math.round(r.other_fee || 0)),
        air_fee: String(Math.round(r.air_fee || 0)),
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
    other_fee: "0",
    air_fee: "0",
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
