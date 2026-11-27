/**
 * 治水雲庫 V2 — ⑤ 生態檢核案件（統計分析圖表與經費合理性預警模組）
 * 1. 圖表 1：各河川分署「工程規模 vs 生態檢核經費」關聯比較圖（雙軸柱狀折線複合圖，未決算年度自動帶入核定分年額度）
 * 2. 圖表 2：各河川分署「生態檢核經費占純工程經費比例 (%)」排行與預警（含全署平均基準線與異常預警清單）
 * 3. 圖表 3：生態檢核委託服務「承攬廠商市占率與服務量能分布」（環形圖與服務分署明細）
 */

let currentEcoChartMode = "combo"; // "combo" | "ratio" | "vendor"
let currentEcoComboMetric = "amount"; // "amount" | "count"
let chartEcoInstance = null;

function getEcoAvailableSingleYears() {
  const yrSet = new Set();
  (v2EcologicalCases || []).forEach(c => {
    const { startYr, endYr, isSingleYear } = parseEcoStartEndFromRecord(c);
    if (startYr) yrSet.add(String(startYr));
    if (!isSingleYear && endYr) yrSet.add(String(endYr));
  });
  return Array.from(yrSet).sort().reverse();
}

function setEcoChartMode(mode) {
  currentEcoChartMode = ["combo", "ratio", "vendor"].includes(mode) ? mode : "combo";
  renderEcologicalChartsWorkspace();
}

function setEcoComboMetric(metric) {
  currentEcoComboMetric = metric === "count" ? "count" : "amount";
  renderEcologicalChartInstance();
}

function getEcoChartTitleForExport() {
  const yr = document.getElementById("selEcoChartYear")?.value || "ALL";
  const yrLbl = yr === "ALL" ? "全年度累計" : `${yr}年度`;
  if (currentEcoChartMode === "ratio") return `${yrLbl}_各分署生態檢核經費占比與預警圖`;
  if (currentEcoChartMode === "vendor") return `${yrLbl}_生態檢核承攬廠商市占率分布圖`;
  return `${yrLbl}_各分署工程規模與生態檢核經費關聯圖`;
}

function renderEcologicalChartsWorkspace() {
  const ws = document.getElementById("ecoChartsWorkspace");
  if (!ws) return;

  const prevYr = document.getElementById("selEcoChartYear")?.value || "";
  const years = getEcoAvailableSingleYears();
  const defaultYr = (prevYr && (prevYr === "ALL" || years.includes(prevYr)))
    ? prevYr
    : (years.includes("115") ? "115" : (years[0] || "ALL"));

  ws.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-md border border-[#1D3557]/20 bg-white p-0.5">
          <button type="button" onclick="setEcoChartMode('combo')" class="px-2.5 py-1 rounded font-bold transition ${currentEcoChartMode === "combo" ? "bg-[#ED6D35] text-white" : "text-[#1D3557] hover:bg-[#FAF3E0]"}">1. 工程規模 vs 生態檢核經費</button>
          <button type="button" onclick="setEcoChartMode('ratio')" class="px-2.5 py-1 rounded font-bold transition ${currentEcoChartMode === "ratio" ? "bg-[#ED6D35] text-white" : "text-[#1D3557] hover:bg-[#FAF3E0]"}">2. 經費占比合理性與預警</button>
          <button type="button" onclick="setEcoChartMode('vendor')" class="px-2.5 py-1 rounded font-bold transition ${currentEcoChartMode === "vendor" ? "bg-[#ED6D35] text-white" : "text-[#1D3557] hover:bg-[#FAF3E0]"}">3. 承攬廠商市占率分布</button>
        </div>

        <div class="flex items-center gap-1">
          <label class="font-bold text-[#1D3557]">統計年度：</label>
          <select id="selEcoChartYear" onchange="renderEcologicalChartInstance()" class="border border-[#1D3557]/20 rounded px-2 py-1 bg-white text-[#1D3557] font-bold">
            <option value="ALL">全部年度累計</option>
            ${years.map(y => `<option value="${y}">${y} 年度</option>`).join("")}
          </select>
        </div>

        ${currentEcoChartMode === "combo" ? `
          <div class="inline-flex rounded border border-[#004E89]/25 bg-white p-0.5">
            <button type="button" id="btnEcoMetricAmt" onclick="setEcoComboMetric('amount')" class="px-2 py-0.5 rounded font-bold ${currentEcoComboMetric === "amount" ? "bg-[#004E89] text-white" : "text-[#004E89]"}">對比工程經費(億元)</button>
            <button type="button" id="btnEcoMetricCnt" onclick="setEcoComboMetric('count')" class="px-2 py-0.5 rounded font-bold ${currentEcoComboMetric === "count" ? "bg-[#004E89] text-white" : "text-[#004E89]"}">對比工程件數(件)</button>
          </div>
        ` : ""}
      </div>

      <div class="flex items-center gap-2">
        <button type="button" onclick="copyChartToClipboard(chartEcoInstance, getEcoChartTitleForExport())" class="px-3 py-1 rounded bg-[#ED6D35] text-white font-bold">複製圖片</button>
        <button type="button" onclick="downloadChartPng(chartEcoInstance, getEcoChartTitleForExport())" class="px-3 py-1 rounded bg-[#1D3557] text-white font-bold">另存 PNG</button>
      </div>
    </div>

    <div id="chartEcologyMain" class="w-full h-[460px] bg-white rounded border border-[#1D3557]/15"></div>
    <div id="ecoAnomalyDiagnosticPanel" class="mt-2.5"></div>
  `;

  if (document.getElementById("selEcoChartYear")) {
    document.getElementById("selEcoChartYear").value = defaultYr;
  }

  setTimeout(() => renderEcologicalChartInstance(), 30);
}

function getPureEngStatsByBranchForYear(targetYearStr) {
  const map = {};
  V2_ECO_TEN_BRANCHES.forEach(k => { map[k] = { count: 0, approvedThousand: 0 }; });

  const seenKeys = new Set();
  const pushRec = (yr, br, cat, code, name, amt) => {
    const yStr = String(yr || "").trim();
    if (!yStr) return;
    if (targetYearStr !== "ALL" && yStr !== targetYearStr) return;
    if (!V2_PURE_ENG_CATEGORIES.includes(String(cat || "").trim())) return;
    const bKey = v2NormBranch(br);
    if (!map[bKey]) return;
    const val = parseFloat(amt) || 0;
    if (val <= 0) return;

    const cleanCode = String(code || "").trim();
    const coreNm = typeof getCoreProjectName === "function" ? getCoreProjectName(name) : String(name || "").trim();
    const dedupKey = (cleanCode && cleanCode !== "-")
      ? `${yStr}__CODE__${cleanCode}`
      : `${yStr}__${bKey}__${coreNm}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);

    map[bKey].count += 1;
    map[bKey].approvedThousand += val;
  };

  (v2ActiveCases || []).forEach(c => {
    if (c.lifecycle_stage === "撤案") return;
    pushRec(c["核定年度"], c["分署"], c["類別"], c["工程編號"], c["案件名稱"], c["核定經費_千元"]);
  });
  (allRecords || []).forEach(r => {
    pushRec(r["年度"], r["分署"], r["類別"], r["工程編號"], r["案件名稱"], r["核定經費_千元"]);
  });

  return map;
}

function getEcoAnnualCostByBranch(targetYearStr) {
  const map = {};
  V2_ECO_TEN_BRANCHES.forEach(k => {
    map[k] = { ecoThousand: 0, hasUnsettledFallback: false };
  });

  (v2EcologicalCases || []).forEach(c => {
    const bKey = v2NormBranch(c["分署別"]);
    if (!map[bKey]) return;
    const { startYr, endYr, isSingleYear } = parseEcoStartEndFromRecord(c);
    const life = getEcoLifecycleInfo(c);
    const { a1, a2 } = getEcoApprovedBreakdown(c);
    const { y1, y2 } = getEcoExecBreakdown(c);

    // 未決算（執行中且尚無執行經費）年度自動帶入核定分年額度
    const yr1Cost = (life.status === "執行中" && y1 <= 0) ? a1 : y1;
    const yr1Fallback = (life.status === "執行中" && y1 <= 0 && a1 > 0);

    const yr2Cost = isSingleYear ? 0 : ((life.status === "執行中" && y2 <= 0) ? a2 : y2);
    const yr2Fallback = (!isSingleYear && life.status === "執行中" && y2 <= 0 && a2 > 0);

    if (targetYearStr === "ALL" || String(startYr) === targetYearStr) {
      map[bKey].ecoThousand += yr1Cost;
      if (yr1Fallback) map[bKey].hasUnsettledFallback = true;
    }
    if (!isSingleYear && (targetYearStr === "ALL" || String(endYr) === targetYearStr)) {
      map[bKey].ecoThousand += yr2Cost;
      if (yr2Fallback) map[bKey].hasUnsettledFallback = true;
    }
  });

  return map;
}

function buildEcoBranchComparisonDataset(targetYearStr) {
  const engMap = getPureEngStatsByBranchForYear(targetYearStr);
  const ecoMap = getEcoAnnualCostByBranch(targetYearStr);

  let sumAllEngThousand = 0;
  let sumAllEcoThousand = 0;
  let sumAllEngCount = 0;

  const list = V2_ECO_TEN_BRANCHES.map(k => {
    const engCnt = engMap[k].count;
    const engTh = engMap[k].approvedThousand;
    const ecoTh = ecoMap[k].ecoThousand;
    sumAllEngThousand += engTh;
    sumAllEcoThousand += ecoTh;
    sumAllEngCount += engCnt;

    const ratioPct = engTh > 0 ? Number(((ecoTh / engTh) * 100).toFixed(2)) : 0;
    const avgPerCaseThousand = engCnt > 0 ? Math.round(ecoTh / engCnt) : 0;

    return {
      branchKey: k,
      branchLabel: `${k}分署`,
      engCount: engCnt,
      engThousand: engTh,
      engYi: Number((engTh / 100000).toFixed(2)),
      ecoThousand: Math.round(ecoTh),
      isApprovedFallback: ecoMap[k].hasUnsettledFallback,
      ratioPct,
      avgPerCaseThousand
    };
  });

  const avgRatioPct = sumAllEngThousand > 0 ? Number(((sumAllEcoThousand / sumAllEngThousand) * 100).toFixed(2)) : 0;
  const avgEngCount = sumAllEngCount / V2_ECO_TEN_BRANCHES.length;
  const avgEcoThousand = sumAllEcoThousand / V2_ECO_TEN_BRANCHES.length;

  return { list, avgRatioPct, avgEngCount, avgEcoThousand };
}

function buildEcoVendorDataset(targetYearStr) {
  const vendorMap = {};
  (v2EcologicalCases || []).forEach(c => {
    const { startYr, endYr, isSingleYear } = parseEcoStartEndFromRecord(c);
    if (targetYearStr !== "ALL" && String(startYr) !== targetYearStr && (isSingleYear || String(endYr) !== targetYearStr)) {
      return;
    }
    const vendorName = String(c["執行廠商"] || "").trim() || "尚未決標／未填廠商";
    const award = parseFloat(c["決標金額_千元"]) || 0;
    const appr = getEcoApprovedBreakdown(c).total;
    const val = award > 0 ? award : appr;

    if (!vendorMap[vendorName]) {
      vendorMap[vendorName] = { name: vendorName, value: 0, caseCount: 0, branches: new Set() };
    }
    vendorMap[vendorName].value += val;
    vendorMap[vendorName].caseCount += 1;
    vendorMap[vendorName].branches.add(v2DisplayBranch(c["分署別"]));
  });

  const list = Object.values(vendorMap)
    .map(v => ({
      name: v.name,
      value: Math.round(v.value),
      caseCount: v.caseCount,
      branchesText: Array.from(v.branches).join("、")
    }))
    .sort((a, b) => b.value - a.value);

  const grandTotal = list.reduce((acc, x) => acc + x.value, 0);
  list.forEach(x => {
    x.sharePct = grandTotal > 0 ? Number(((x.value / grandTotal) * 100).toFixed(1)) : 0;
  });
  return { list, grandTotal };
}

function renderEcologicalChartInstance() {
  const dom = document.getElementById("chartEcologyMain");
  if (!dom || typeof echarts === "undefined") return;

  const btnAmt = document.getElementById("btnEcoMetricAmt");
  const btnCnt = document.getElementById("btnEcoMetricCnt");
  if (btnAmt && btnCnt) {
    btnAmt.className = `px-2 py-0.5 rounded font-bold ${currentEcoComboMetric === "amount" ? "bg-[#004E89] text-white" : "text-[#004E89]"}`;
    btnCnt.className = `px-2 py-0.5 rounded font-bold ${currentEcoComboMetric === "count" ? "bg-[#004E89] text-white" : "text-[#004E89]"}`;
  }

  if (chartEcoInstance) {
    chartEcoInstance.dispose();
  }
  chartEcoInstance = echarts.init(dom);

  const yrStr = document.getElementById("selEcoChartYear")?.value || "ALL";
  const yrTitle = yrStr === "ALL" ? "全部年度累計" : `${yrStr}年度`;
  const diagPanel = document.getElementById("ecoAnomalyDiagnosticPanel");

  if (currentEcoChartMode === "combo") {
    const { list } = buildEcoBranchComparisonDataset(yrStr);
    const isAmt = currentEcoComboMetric === "amount";
    const leftName = isAmt ? "純工程核定經費 (億元)" : "純工程案件數 (件)";

    chartEcoInstance.setOption({
      title: {
        text: `${yrTitle} 各河川分署「工程規模 vs 生態檢核經費」關聯比較圖`,
        subtext: "註：未決算年度之生態檢核經費自動帶入該年度核定分年額度",
        left: "center",
        top: 8,
        textStyle: { color: "#1D3557", fontSize: 15, fontWeight: "bold" },
        subtextStyle: { color: "#004E89", fontSize: 11 }
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: params => {
          const idx = params[0].dataIndex;
          const row = list[idx];
          const srcTag = row.isApprovedFallback ? "（採核定分年額度）" : "（實際執行經費）";
          return `
            <div style="font-size:12px;line-height:1.6;">
              <strong>${row.branchLabel}（${yrTitle}）</strong><br/>
              純工程案件數：<strong>${row.engCount}</strong> 件<br/>
              純工程核定經費：<strong>${row.engYi.toFixed(2)}</strong> 億元<br/>
              生態檢核經費：<strong>${row.ecoThousand.toLocaleString()}</strong> 千元 ${srcTag}<br/>
              生態檢核占比：<strong>${row.ratioPct.toFixed(2)}%</strong>
            </div>
          `;
        }
      },
      legend: { top: 54, data: [leftName, "生態檢核經費 (千元)"] },
      grid: { left: 65, right: 75, top: 92, bottom: 42 },
      xAxis: {
        type: "category",
        data: list.map(x => x.branchLabel),
        axisLabel: { color: "#1D3557", fontWeight: "bold" }
      },
      yAxis: [
        {
          type: "value",
          name: leftName,
          nameTextStyle: { color: "#004E89", fontWeight: "bold" },
          axisLabel: { color: "#004E89" }
        },
        {
          type: "value",
          name: "生態檢核經費 (千元)",
          nameTextStyle: { color: "#ED6D35", fontWeight: "bold" },
          axisLabel: { color: "#ED6D35" },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: leftName,
          type: "bar",
          barMaxWidth: 34,
          itemStyle: { color: "#004E89", borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", fontSize: 10, color: "#004E89" },
          data: list.map(x => (isAmt ? x.engYi : x.engCount))
        },
        {
          name: "生態檢核經費 (千元)",
          type: "line",
          yAxisIndex: 1,
          symbolSize: 8,
          lineStyle: { width: 3, color: "#ED6D35" },
          itemStyle: { color: "#ED6D35" },
          label: { show: true, position: "top", fontSize: 10, color: "#ED6D35", formatter: p => p.value.toLocaleString() },
          data: list.map(x => x.ecoThousand)
        }
      ]
    });

    if (diagPanel) diagPanel.innerHTML = "";
  } else if (currentEcoChartMode === "ratio") {
    const { list, avgRatioPct, avgEngCount, avgEcoThousand } = buildEcoBranchComparisonDataset(yrStr);
    const sorted = [...list].sort((a, b) => a.ratioPct - b.ratioPct);
    const warnThreshold = Number((avgRatioPct * 1.5).toFixed(3));

    chartEcoInstance.setOption({
      title: {
        text: `${yrTitle} 各河川分署「生態檢核經費占純工程經費比例 (%)」排行與預警`,
        subtext: `全署平均占比：${avgRatioPct.toFixed(2)}%｜預警門檻（1.5倍平均）：${warnThreshold.toFixed(2)}%`,
        left: "center",
        top: 8,
        textStyle: { color: "#1D3557", fontSize: 15, fontWeight: "bold" },
        subtextStyle: { color: "#ED6D35", fontSize: 11, fontWeight: "bold" }
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: params => {
          const row = sorted[params[0].dataIndex];
          return `
            <div style="font-size:12px;line-height:1.6;">
              <strong>${row.branchLabel}（${yrTitle}）</strong><br/>
              生態檢核經費占比：<strong>${row.ratioPct.toFixed(2)}%</strong><br/>
              生態檢核經費：${row.ecoThousand.toLocaleString()} 千元<br/>
              純工程經費：${row.engYi.toFixed(2)} 億元（${row.engCount} 件）<br/>
              平均每件工程分攤生態經費：<strong>${row.avgPerCaseThousand.toLocaleString()}</strong> 千元/件
            </div>
          `;
        }
      },
      grid: { left: 75, right: 65, top: 68, bottom: 36 },
      xAxis: {
        type: "value",
        name: "占比 (%)",
        axisLabel: { formatter: "{value}%" }
      },
      yAxis: {
        type: "category",
        data: sorted.map(x => x.branchLabel),
        axisLabel: { color: "#1D3557", fontWeight: "bold" }
      },
      series: [
        {
          name: "生態檢核經費占比 (%)",
          type: "bar",
          barMaxWidth: 24,
          label: { show: true, position: "right", formatter: p => `${p.value.toFixed(2)}%`, fontSize: 11, fontWeight: "bold" },
          data: sorted.map(x => ({
            value: x.ratioPct,
            itemStyle: {
              color: (warnThreshold > 0 && x.ratioPct >= warnThreshold) ? "#ED6D35" : "#004E89",
              borderRadius: [0, 4, 4, 0]
            }
          })),
          markLine: avgRatioPct > 0 ? {
            symbol: "none",
            lineStyle: { color: "#ED6D35", type: "dashed", width: 2 },
            label: { formatter: `全署平均 ${avgRatioPct.toFixed(2)}%`, color: "#ED6D35", fontWeight: "bold" },
            data: [{ xAxis: avgRatioPct }]
          } : undefined
        }
      ]
    });

    if (diagPanel) {
      const warnings = [];
      list.forEach(x => {
        const flags = [];
        if (warnThreshold > 0 && x.ratioPct >= warnThreshold) {
          flags.push(`生態經費占比 ${x.ratioPct.toFixed(2)}%（逾全署平均 1.5 倍）`);
        }
        if (avgEngCount > 0 && avgEcoThousand > 0 && x.engCount < avgEngCount * 0.75 && x.ecoThousand > avgEcoThousand) {
          flags.push(`工程案件僅 ${x.engCount} 件（低於全署均量 ${avgEngCount.toFixed(1)} 件），但生態經費高達 ${x.ecoThousand.toLocaleString()} 千元`);
        }
        if (x.engCount > 0 && x.ecoThousand === 0) {
          flags.push(`有 ${x.engCount} 件工程案，但尚未登載生態檢核經費`);
        }
        if (flags.length) {
          warnings.push({ ...x, alertText: flags.join("；") });
        }
      });

      diagPanel.innerHTML = `
        <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-lg p-3 text-xs">
          <div class="font-bold text-[#1D3557] mb-1.5 flex items-center justify-between">
            <span>系統自動診斷 — ${yrTitle}各分署生態檢核經費合理性預警清單</span>
            <span class="text-[11px] text-[#004E89]">全署平均占比：${avgRatioPct.toFixed(2)}%</span>
          </div>
          ${warnings.length ? `
            <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th class="p-1.5 text-center">分署別</th>
                    <th class="p-1.5 text-right">純工程件數 / 經費</th>
                    <th class="p-1.5 text-right">生態檢核經費(千元)</th>
                    <th class="p-1.5 text-right">平均每件分攤(千元)</th>
                    <th class="p-1.5 text-left">預警研判說明</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${warnings.map(w => `
                    <tr>
                      <td class="p-1.5 text-center font-bold text-[#1D3557]">${w.branchLabel}</td>
                      <td class="p-1.5 text-right font-mono">${w.engCount} 件 / ${w.engYi.toFixed(2)} 億元</td>
                      <td class="p-1.5 text-right font-mono font-bold text-[#004E89]">${w.ecoThousand.toLocaleString()}</td>
                      <td class="p-1.5 text-right font-mono">${w.avgPerCaseThousand.toLocaleString()}</td>
                      <td class="p-1.5 font-bold text-[#ED6D35]">${escapeHtmlAttr(w.alertText)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="text-[#004E89] font-medium">目前 ${yrTitle} 各分署生態檢核經費占比均在合理區間，無異常偏高預警。</div>`}
        </div>
      `;
    }
  } else if (currentEcoChartMode === "vendor") {
    const { list, grandTotal } = buildEcoVendorDataset(yrStr);
    const palette = ["#1D3557", "#ED6D35", "#004E89", "#2A9D8F", "#E9C46A", "#F4A261", "#457B9D", "#6D597A", "#B56576", "#8D99AE"];

    chartEcoInstance.setOption({
      title: {
        text: `${yrTitle} 生態檢核委託服務「承攬廠商市占率與服務量能分布」`,
        subtext: `統計總金額：${grandTotal.toLocaleString()} 千元（依決標金額統計，未決標則採核定額度）`,
        left: "center",
        top: 8,
        textStyle: { color: "#1D3557", fontSize: 15, fontWeight: "bold" },
        subtextStyle: { color: "#004E89", fontSize: 11 }
      },
      tooltip: {
        trigger: "item",
        formatter: p => {
          const item = list[p.dataIndex];
          return `
            <div style="font-size:12px;line-height:1.6;">
              <strong>${escapeHtmlAttr(item.name)}</strong><br/>
              承攬金額：<strong>${item.value.toLocaleString()}</strong> 千元（市占率 <strong>${item.sharePct}%</strong>）<br/>
              承接件數：${item.caseCount} 件<br/>
              服務分署：${escapeHtmlAttr(item.branchesText)}
            </div>
          `;
        }
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 16,
        top: 68,
        bottom: 20,
        textStyle: { color: "#1D3557", fontSize: 11 }
      },
      series: [
        {
          name: "承攬廠商市占率",
          type: "pie",
          radius: ["42%", "70%"],
          center: ["36%", "56%"],
          color: palette,
          itemStyle: { borderRadius: 5, borderColor: "#fff", borderWidth: 2 },
          label: {
            formatter: "{b}\n{d}%",
            fontSize: 11,
            color: "#1D3557"
          },
          data: list.map(v => ({ name: v.name, value: v.value }))
        }
      ]
    });

    if (diagPanel) {
      diagPanel.innerHTML = `
        <div class="bg-[#FAF3E0] border border-[#1D3557]/15 rounded-lg p-3 text-xs">
          <div class="font-bold text-[#1D3557] mb-1.5">各承攬廠商服務量能與集中度明細（${yrTitle}）</div>
          <div class="overflow-x-auto bg-white border border-[#1D3557]/15 rounded">
            <table class="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th class="p-1.5 text-center">排名</th>
                  <th class="p-1.5 text-left">執行廠商</th>
                  <th class="p-1.5 text-center">承接件數</th>
                  <th class="p-1.5 text-left">服務河川分署</th>
                  <th class="p-1.5 text-right">承攬金額(千元)</th>
                  <th class="p-1.5 text-right">市占率</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${list.map((v, idx) => `
                  <tr>
                    <td class="p-1.5 text-center font-mono">${idx + 1}</td>
                    <td class="p-1.5 font-bold text-[#1D3557]">${escapeHtmlAttr(v.name)}</td>
                    <td class="p-1.5 text-center font-mono">${v.caseCount} 件</td>
                    <td class="p-1.5 text-[#004E89]">${escapeHtmlAttr(v.branchesText)}</td>
                    <td class="p-1.5 text-right font-mono font-bold">${v.value.toLocaleString()}</td>
                    <td class="p-1.5 text-right font-mono font-bold ${v.sharePct >= 30 ? "text-[#ED6D35]" : "text-[#1D3557]"}">${v.sharePct}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  }
}