/**
 * 治水雲庫 V2 — Phase 4：紙本帳本雙軌輸出模組
 * 方案 A：瀏覽器 A4 橫式列印／另存 PDF（每頁 4 案、每案 9 列、不同類型換頁、超過 6 筆自動延續「續上案」）
 * 方案 B：ExcelJS .xlsx 正式帳本下載（完整框線、千分位、0 留空、橫式 A4 強制每 36 列分頁）
 */

function getLedgerTypeGroupLabel(caseObj) {
  const nature = String(caseObj["性質"] || "").trim();
  const cat = String(caseObj["類別"] || "").trim();
  if (cat.includes("用地取得") || cat.includes("用地先期")) {
    return `${nature || ""}用地取得及用地先期`.trim();
  }
  return [nature, cat].filter(Boolean).join("-") || "未分類";
}

function getV2LedgerExportCases() {
  if (v2LedgerExportScope === "current") {
    const cur = (v2ActiveCases || []).find(c => c.case_uid === v2BudgetSelectedUid);
    if (!cur) return [];
    if (isV2NonControlledCase(cur)) return [];
    return [cur];
  }
  return getFilteredBudgetCases().filter(c => !isV2NonControlledCase(c));
}

/**
 * 將案件轉換為帳本分頁結構：
 * - 依類型分群，不同類型強制換頁
 * - 單案明細超過 6 列時，自動拆為多個 6 列區塊，後續區塊標註「（續上案）」不截斷
 * - 每頁固定 4 案區塊，不足補空白格式區塊供手寫
 */
function buildV2LedgerPages(cases) {
  const sorted = cases.slice().sort((a, b) => {
    const ta = getLedgerTypeGroupLabel(a);
    const tb = getLedgerTypeGroupLabel(b);
    if (ta !== tb) return ta.localeCompare(tb);
    const ca = String(a["工程編號"] || "");
    const cb = String(b["工程編號"] || "");
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a["案件名稱"] || "").localeCompare(String(b["案件名稱"] || ""));
  });

  const groupsByType = {};
  const typeOrder = [];

  sorted.forEach(c => {
    const typeLabel = getLedgerTypeGroupLabel(c);
    if (!groupsByType[typeLabel]) {
      groupsByType[typeLabel] = [];
      typeOrder.push(typeLabel);
    }

    const comp = computeV2CaseLatestBudget(c);
    const rows = comp.rows || [];
    const totalRowsCount = rows.length;
    const latestRow = rows.length ? rows[rows.length - 1] : null;
    const latestCode = String(latestRow?.year_project_code || c["工程編號"] || "").trim();
    const singleRowCase = totalRowsCount === 1;

    const chunkSize = 6;
    const chunkCount = Math.max(1, Math.ceil(totalRowsCount / chunkSize));

    for (let idx = 0; idx < chunkCount; idx++) {
      const slice = rows.slice(idx * chunkSize, (idx + 1) * chunkSize);
      const isContinuation = idx > 0;
      groupsByType[typeLabel].push({
        isBlank: false,
        typeLabel,
        importYear: String(c["核定年度"] || ""),
        headerCodePrefix: latestCode.slice(0, 17),
        projectName: isContinuation ? `${c["案件名稱"]}（續上案）` : String(c["案件名稱"] || ""),
        approvedYuan: isContinuation ? 0 : comp.approvedYuan,
        singleRowCase: singleRowCase && !isContinuation,
        detailRows: slice
      });
    }
  });

  const pages = [];
  typeOrder.forEach(typeLabel => {
    const blocks = groupsByType[typeLabel];
    for (let offset = 0; offset < blocks.length; offset += 4) {
      const pageBlocks = blocks.slice(offset, offset + 4);
      while (pageBlocks.length < 4) {
        pageBlocks.push({
          isBlank: true,
          typeLabel,
          importYear: "",
          headerCodePrefix: "",
          projectName: "",
          approvedYuan: 0,
          singleRowCase: false,
          detailRows: []
        });
      }
      pages.push({ typeLabel, blocks: pageBlocks });
    }
  });

  return pages;
}

function formatLedgerMoneyBlankZero(v) {
  const n = Math.round(Number(v) || 0);
  return Math.abs(n) < 0.0001 ? "" : n.toLocaleString();
}

// =========================================================================
// 方案 A：瀏覽器 A4 橫式列印／PDF 檢視
// =========================================================================

function openV2LedgerPrintView() {
  const cases = getV2LedgerExportCases();
  if (!cases.length) {
    return alert("目前匯出範圍內無控管案件可產生帳本（非控管案件不建立正式帳本）。");
  }

  const pages = buildV2LedgerPages(cases);
  const feeHeadersHtml = V2_FEE_KEYS.map(fk => `<th class="num">${fk.label}</th>`).join("");

  const pagesHtml = pages.map((page, pIdx) => {
    const blocksHtml = page.blocks.map((blk, bIdx) => {
      const isPageFirst = bIdx === 0;
      const headRow = isPageFirst ? `
        <tr class="page-meta-row">
          <td class="lbl">年度</td>
          <td class="val">${escapeHtmlAttr(blk.importYear)}</td>
          <td></td>
          <td class="lbl">工程編號：</td>
          <td colspan="2" class="val mono">${escapeHtmlAttr(blk.headerCodePrefix)}</td>
          <td colspan="2"></td>
          <td colspan="3" class="val right">${escapeHtmlAttr(blk.typeLabel)}</td>
        </tr>
      ` : `<tr class="spacer-row"><td colspan="11"></td></tr>`;

      const detailTrs = [];
      for (let i = 0; i < 6; i++) {
        const dr = blk.detailRows[i];
        if (!dr) {
          detailTrs.push(`
            <tr class="detail-row">
              <td>&nbsp;</td><td colspan="2"></td>
              <td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>
              <td colspan="2"></td>
            </tr>
          `);
        } else {
          const rawCode = String(dr.year_project_code || "").trim();
          const dispCode = blk.singleRowCase && rawCode.length >= 3 ? rawCode.slice(-3) : rawCode;
          const feeCells = V2_FEE_KEYS.map(fk => `<td class="num mono">${formatLedgerMoneyBlankZero(dr[fk.field])}</td>`).join("");
          detailTrs.push(`
            <tr class="detail-row">
              <td class="mono left">${escapeHtmlAttr(dispCode)}</td>
              <td colspan="2" class="left stage-note">${escapeHtmlAttr(dr.year_label || "")}</td>
              ${feeCells}
              <td class="num mono bold">${formatLedgerMoneyBlankZero(dr.total_fee)}</td>
              <td colspan="2" class="mono left">${escapeHtmlAttr(dr.doc_no || "")}</td>
            </tr>
          `);
        }
      }

      return `
        ${headRow}
        <tr class="hdr-row">
          <td class="center bold">編號</td>
          <td class="center bold">工程名稱</td>
          <td class="left bold name-cell">${escapeHtmlAttr(blk.projectName)}</td>
          <td colspan="6" class="center bold">預算動支（單位：元）</td>
          <td colspan="2" class="center bold">公文字號</td>
        </tr>
        <tr class="subhdr-row">
          <td></td>
          <td class="center">概算(核定金額)</td>
          <td class="num mono bold">${formatLedgerMoneyBlankZero(blk.approvedYuan)}</td>
          ${feeHeadersHtml}
          <th class="num">合計</th>
          <td colspan="2"></td>
        </tr>
        ${detailTrs.join("")}
      `;
    }).join("");

    return `
      <section class="ledger-page ${pIdx < pages.length - 1 ? "page-break" : ""}">
        <table class="ledger-table">
          <colgroup>
            <col style="width:11%;" /><col style="width:9%;" /><col style="width:22%;" />
            <col style="width:7.5%;" /><col style="width:7.5%;" /><col style="width:7.5%;" /><col style="width:7.5%;" /><col style="width:7.5%;" /><col style="width:8.5%;" />
            <col style="width:6%;" /><col style="width:6%;" />
          </colgroup>
          <tbody>${blocksHtml}</tbody>
        </table>
        <div class="page-foot">第 ${pIdx + 1} / ${pages.length} 頁 ｜ 類型：${escapeHtmlAttr(page.typeLabel)}</div>
      </section>
    `;
  }).join("");

  const win = window.open("", "_blank");
  if (!win) return alert("瀏覽器封鎖了彈出視窗，請允許彈出視窗後再試一次。");

  win.document.write(`
    <!DOCTYPE html>
    <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8" />
      <title>河川海岸區排預算帳本列印</title>
      <style>
        @page { size: A4 landscape; margin: 6mm; }
        * { box-sizing: border-box; }
        body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; margin: 0; padding: 10px; background: #e5e7eb; color: #111; }
        .no-print { position: sticky; top: 0; z-index: 10; background: #1D3557; color: #fff; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-radius: 6px; font-size: 13px; }
        .no-print button { background: #ED6D35; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-left: 8px; }
        .no-print button.sec { background: #fff; color: #1D3557; }
        .ledger-page { width: 285mm; background: #fff; margin: 0 auto 14px; padding: 4mm; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        .ledger-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5pt; }
        .ledger-table td, .ledger-table th { border: 1px solid #222; padding: 2px 4px; height: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .page-meta-row td { border: none; font-weight: bold; font-size: 10.5pt; height: 22px; padding-bottom: 3px; }
        .spacer-row td { border: none; height: 8px; padding: 0; }
        .hdr-row td { background: #f3f6fa; }
        .subhdr-row td, .subhdr-row th { background: #f9fafb; font-weight: bold; font-size: 9pt; }
        .name-cell { white-space: normal !important; line-height: 1.15; font-size: 9pt; }
        .stage-note { color: #475569; font-size: 8.5pt; }
        .mono { font-family: Consolas, "Courier New", monospace; }
        .num { text-align: right; }
        .center { text-align: center; }
        .left { text-align: left; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .page-foot { text-align: right; font-size: 8pt; color: #555; margin-top: 3px; }
        @media print {
          body { background: #fff; padding: 0; }
          .no-print { display: none; }
          .ledger-page { width: 100%; margin: 0; padding: 0; box-shadow: none; }
          .page-break { page-break-after: always; }
        }
      </style>
    </head>
    <body>
      <div class="no-print">
        <div>紙本帳本預覽（共 ${pages.length} 頁，含 ${cases.length} 件控管案件；每頁 4 案、超過 6 筆自動延續）</div>
        <div>
          <button onclick="window.print()">列印 / 另存 PDF</button>
          <button class="sec" onclick="window.close()">關閉視窗</button>
        </div>
      </div>
      ${pagesHtml}
    </body>
    </html>
  `);
  win.document.close();
}

// =========================================================================
// 方案 B：ExcelJS .xlsx 正式帳本下載
// =========================================================================

async function exportV2LedgerExcel() {
  if (typeof ExcelJS === "undefined") {
    return alert("ExcelJS 函式庫尚未載入完成，請重新整理頁面後再試。");
  }
  const cases = getV2LedgerExportCases();
  if (!cases.length) {
    return alert("目前匯出範圍內無控管案件可匯出帳本（非控管案件不建立正式帳本）。");
  }

  const pages = buildV2LedgerPages(cases);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("匯出帳本", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: pages.length,
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 }
    }
  });

  ws.columns = [
    { width: 19 }, { width: 14 }, { width: 32 },
    { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 },
    { width: 11 }, { width: 11 }
  ];

  const thinBorder = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" }
  };
  const baseFont = { name: "Microsoft JhengHei", size: 10 };
  const boldFont = { name: "Microsoft JhengHei", size: 10, bold: true };
  const numFmt = '#,##0;-#,##0;""';

  let currentRow = 1;

  pages.forEach((page, pIdx) => {
    page.blocks.forEach((blk, bIdx) => {
      const r1 = currentRow;
      const r2 = currentRow + 1;
      const r3 = currentRow + 2;

      // 第 1 列：頁首（僅每頁第 1 案填值）
      ws.getRow(r1).height = bIdx === 0 ? 20 : 10;
      if (bIdx === 0) {
        ws.getCell(r1, 1).value = "年度";
        ws.getCell(r1, 2).value = blk.importYear;
        ws.getCell(r1, 4).value = "工程編號：";
        ws.mergeCells(r1, 5, r1, 6);
        ws.getCell(r1, 5).value = blk.headerCodePrefix;
        ws.mergeCells(r1, 9, r1, 11);
        ws.getCell(r1, 9).value = blk.typeLabel;
        ws.getCell(r1, 9).alignment = { horizontal: "right", vertical: "middle" };
        for (let c = 1; c <= 11; c++) {
          ws.getCell(r1, c).font = boldFont;
        }
      }

      // 第 2 列：工程名稱與預算動支表頭
      ws.getRow(r2).height = 22;
      ws.getCell(r2, 1).value = "編號";
      ws.getCell(r2, 2).value = "工程名稱";
      ws.getCell(r2, 3).value = blk.projectName;
      ws.mergeCells(r2, 4, r2, 9);
      ws.getCell(r2, 4).value = "預算動支（元）";
      ws.mergeCells(r2, 10, r2, 11);
      ws.getCell(r2, 10).value = "公文字號";

      for (let c = 1; c <= 11; c++) {
        const cell = ws.getCell(r2, c);
        cell.font = boldFont;
        cell.border = thinBorder;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FA" } };
        cell.alignment = { horizontal: c === 3 ? "left" : "center", vertical: "middle", wrapText: c === 3 };
      }

      // 第 3 列：核定金額與五費目表頭（依 V2_FEE_KEYS 順序：工作費、其他費、空污費、工管費、用地費）
      ws.getRow(r3).height = 20;
      ws.getCell(r3, 2).value = "概算(核定金額)";
      ws.getCell(r3, 3).value = blk.approvedYuan > 0 ? blk.approvedYuan : null;
      ws.getCell(r3, 3).numFmt = numFmt;
      V2_FEE_KEYS.forEach((fk, fIdx) => {
        ws.getCell(r3, 4 + fIdx).value = fk.label;
      });
      ws.getCell(r3, 9).value = "合計";
      ws.mergeCells(r3, 10, r3, 11);

      for (let c = 1; c <= 11; c++) {
        const cell = ws.getCell(r3, c);
        cell.font = boldFont;
        cell.border = thinBorder;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
        cell.alignment = { horizontal: c === 3 ? "right" : "center", vertical: "middle" };
      }

      // 第 4～9 列：6 列明細空間
      for (let i = 0; i < 6; i++) {
        const rr = currentRow + 3 + i;
        ws.getRow(rr).height = 19;
        const dr = blk.detailRows[i];
        ws.mergeCells(rr, 2, rr, 3);
        ws.mergeCells(rr, 10, rr, 11);

        if (dr) {
          const rawCode = String(dr.year_project_code || "").trim();
          ws.getCell(rr, 1).value = blk.singleRowCase && rawCode.length >= 3 ? rawCode.slice(-3) : rawCode;
          ws.getCell(rr, 2).value = dr.year_label || "";
          V2_FEE_KEYS.forEach((fk, fIdx) => {
            const val = Math.round(Number(dr[fk.field]) || 0);
            ws.getCell(rr, 4 + fIdx).value = Math.abs(val) < 0.0001 ? null : val;
          });
          const tot = Math.round(Number(dr.total_fee) || 0);
          ws.getCell(rr, 9).value = Math.abs(tot) < 0.0001 ? null : tot;
          ws.getCell(rr, 10).value = dr.doc_no || "";
        }

        for (let c = 1; c <= 11; c++) {
          const cell = ws.getCell(rr, c);
          cell.font = c === 9 ? boldFont : baseFont;
          cell.border = thinBorder;
          if (c >= 4 && c <= 9) {
            cell.numFmt = numFmt;
            cell.alignment = { horizontal: "right", vertical: "middle" };
          } else {
            cell.alignment = { horizontal: "left", vertical: "middle" };
          }
        }
      }

      currentRow += 9;
    });

    if (pIdx < pages.length - 1) {
      ws.getRow(currentRow - 1).addPageBreak();
    }
  });

  ws.pageSetup.printArea = `A1:K${currentRow - 1}`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  a.href = url;
  a.download = `治水雲庫_預算帳本_${stamp}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}