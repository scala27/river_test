function exportCurrentExcel() {
  if (!filteredRecords.length) {
    alert("目前畫面上無可匯出的數據！");
    return;
  }
  const ws = XLSX.utils.json_to_sheet(filteredRecords.map(({ id, ...rest }) => rest));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工程統計明細");
  XLSX.writeFile(wb, `防洪工程統計明細${getYearRangeLabel()}.xlsx`);
}

function openAdminModal() {
  document.getElementById("modalAdmin").classList.remove("hidden");
  document.getElementById("inputAdminPass").focus();
}

function closeAdminModal() {
  document.getElementById("modalAdmin").classList.add("hidden");
}

async function submitAdminLogin() {
  const pass = document.getElementById("inputAdminPass").value.trim();
  if (!pass) return;
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verify_admin", passcode: pass })
    });
    const json = await res.json();
    if (json.status === "success") {
      adminPasscode = pass;
      document.getElementById("menuAdminLogin").classList.add("hidden");
      document.getElementById("menuAdminLogout").classList.remove("hidden");
      document.getElementById("menuImportExcel").classList.remove("hidden");
      document.getElementById("adminIndicatorDot").classList.remove("hidden");
      closeAdminModal();
      renderDetailTable();
    } else {
      alert(json.message || "密碼錯誤");
    }
  } catch (err) {
    alert("驗證連線失敗：" + err.message);
  }
}

function logoutAdmin() {
  adminPasscode = "";
  document.getElementById("inputAdminPass").value = "";
  document.getElementById("menuAdminLogin").classList.remove("hidden");
  document.getElementById("menuAdminLogout").classList.add("hidden");
  document.getElementById("menuImportExcel").classList.add("hidden");
  document.getElementById("adminIndicatorDot").classList.add("hidden");
  renderDetailTable();
}

function openEditModal(rec) {
  document.getElementById("editId").value = rec.id;
  document.getElementById("editYear").value = rec["年度"];
  document.getElementById("editBranch").value = rec["分署"];
  document.getElementById("editCounty").value = rec["縣市"];
  document.getElementById("editWater").value = rec["水系"];
  document.getElementById("editName").value = rec["案件名稱"];
  document.getElementById("editApproved").value = rec["核定經費_千元"];
  document.getElementById("editUsable").value = rec["可支用經費_千元"];
  document.getElementById("editCode").value = rec["工程編號"];
  document.getElementById("editCoords").value = rec["座標點位"];
  document.getElementById("editConcern").value = rec["地方關切"] || "";
  document.getElementById("editRemark").value = rec["備註資訊"];
  document.getElementById("modalEdit").classList.remove("hidden");
}

async function saveEditedProject() {
  const id = document.getElementById("editId").value;
  const orig = allRecords.find(r => r.id === id) || {};
  const updated = {
    ...orig,
    id,
    "年度": normalizeText(document.getElementById("editYear").value),
    "分署": normalizeText(document.getElementById("editBranch").value).replace("水規所", "水規分署"),
    "縣市": normalizeText(document.getElementById("editCounty").value).replace(/台/g, "臺"),
    "水系": normalizeText(document.getElementById("editWater").value),
    "案件名稱": normalizeText(document.getElementById("editName").value),
    "核定經費_千元": parseFloat(document.getElementById("editApproved").value) || 0,
    "可支用經費_千元": parseFloat(document.getElementById("editUsable").value) || 0,
    "工程編號": normalizeText(document.getElementById("editCode").value),
    "座標點位": normalizeText(document.getElementById("editCoords").value),
    "地方關切": normalizeText(document.getElementById("editConcern").value),
    "備註資訊": normalizeText(document.getElementById("editRemark").value)
  };

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "update_project", passcode: adminPasscode, record: updated })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalEdit").classList.add("hidden");
      alert("已成功更新至 Google 試算表！");
      loadAllData(false);
    } else {
      alert(json.message);
    }
  } catch (err) {
    alert("更新失敗：" + err.message);
  }
}

function triggerExcelInput() {
  document.getElementById("fileExcelInput").click();
}

function cleanExcelHeaderText(val) {
  return normalizeText(val).replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

function parseExcelNumber(val) {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 從備註欄智慧摘錄標準化「地方關切」標籤（人名在前、頭銜在後，去除冗詞；保留原備註全文不動）
 */
function extractConcernFromRemark(rawRemark) {
  if (!rawRemark) return "";
  const text = String(rawRemark).replace(/（/g, "(").replace(/）/g, ")");
  const rawLines = text.split(/[\r\n]+/);
  const results = [];

  const addUnique = (tag) => {
    const t = String(tag || "").trim();
    if (t && !results.includes(t)) results.push(t);
  };

  const normTitle = (t) => (t === "立法委員" || t === "立委" ? "立委" : t);

  const STOP_WORDS = new Set([
    "關切", "服務", "辦公", "追蹤", "會勘", "現勘", "陳情", "反映", "建議", "交辦",
    "案件", "事項", "辦理", "表示", "指出", "立法", "市府", "縣府", "政府", "本案",
    "地方", "副市長", "副縣長", "市長", "縣長", "署長", "副署長", "部長", "次長",
    "院長", "副院長", "里長", "村長", "鄉長", "鎮長", "顧問", "議員", "立委", "委員",
    "民眾", "人民", "其他", "定期", "不定期", "改善", "工程"
  ]);

  const ORG_SKIP_SUBSTR = ["市府", "縣府", "政府", "本案", "地方", "辦理", "新北", "臺北", "高雄", "臺中", "臺南", "桃園"];

  const splitNames = (nameStr) => {
    const parts = String(nameStr || "").split(/[、,，及與和]/);
    const valid = [];
    parts.forEach(raw => {
      let p = raw.trim();
      p = p.replace(/^(?:本案|屬|及|與|和|由|依|其他[:：]?)/, "").trim();
      p = p.replace(/(?:服務處|辦公室|關切.*|追蹤.*|陳情.*|反映.*|建議.*|現勘.*|會勘.*|案件.*|事項.*)$/, "").trim();
      if (p.length >= 2 && p.length <= 3 && /^[\u4e00-\u9fff]{2,3}$/.test(p) && !STOP_WORDS.has(p)) {
        valid.push(p);
      }
    });
    return valid;
  };

  rawLines.forEach(line => {
    let s = line.trim();
    if (!s) return;
    s = s.replace(/^(?:\([一二三四五六七八九十\d]+\)|\d+[\.、\)])\s*/, "");
    s = s.replace(/^其他[:：]\s*/, "").trim();
    if (!s) return;

    const lineHits = [];
    let work = s.replace(/(?:行政院|高雄市政府|臺南市政府|臺北市政府|新北市政府|桃園市政府|臺中市政府|市政府|縣政府)/g, "");

    // 1. 縣市長 / 副首長 / 鄉鎮村里長（相容 1 字姓氏，如：林副市長）
    work = work.replace(/([\u4e00-\u9fff]{1,3})(副市長|副縣長|市長|縣長|里長|村長|鄉長|鎮長)/g, (m, g1, g2) => {
      const nm = g1.replace(/^(?:由|及|與|和|屬)/, "").trim();
      if (nm && !STOP_WORDS.has(nm) && !ORG_SKIP_SUBSTR.some(sw => nm.includes(sw))) {
        lineHits.push(`${nm}${g2}`);
        return " ";
      }
      return m;
    });

    // 2. 頭銜在前、人名在後（如：立法委員何欣純服務處、立法委員蔡易餘、王美惠關切）
    work = work.replace(/(立法委員|立委|議員|顧問)([\u4e00-\u9fff]{2,3}(?:[、及與和][\u4e00-\u9fff]{2,3})*)/g, (m, g1, g2) => {
      const title = normTitle(g1);
      for (const sw of STOP_WORDS) {
        if (g2.startsWith(sw)) return m;
      }
      const nms = splitNames(g2);
      if (nms.length) {
        nms.forEach(nm => lineHits.push(`${nm}${title}`));
        return " ";
      }
      return m;
    });

    // 3. 人名在前、頭銜在後（如：張嘉郡、劉建國立法委員、李孟諺顧問、邱議瑩立委）
    work = work.replace(/([\u4e00-\u9fff]{2,3}(?:[、及與和][\u4e00-\u9fff]{2,3})*)(立法委員|立委|議員|顧問|委員)/g, (m, g1, g2) => {
      const title = normTitle(g2);
      const nms = splitNames(g1);
      if (nms.length) {
        nms.forEach(nm => lineHits.push(`${nm}${title}`));
        return " ";
      }
      return m;
    });

    // 4. 長官交辦與民眾陳情
    const dirRe = /(署長|副署長|部長|次長|院長|副院長)交辦/g;
    let dm;
    while ((dm = dirRe.exec(s)) !== null) {
      lineHits.push(`${dm[1]}交辦`);
    }
    if (/(?:人民|民眾|地方)陳情/.test(s)) {
      lineHits.push("民眾陳情");
    } else if (s.includes("陳情")) {
      lineHits.push("地方陳情");
    }

    // 5. 無具名人名時的通用關切歸類
    if (!lineHits.length) {
      if (/(?:立法委員|立委)關切/.test(s)) lineHits.push("立委關切");
      else if (/議員關切/.test(s)) lineHits.push("議員關切");
      else if (/民代關切/.test(s)) lineHits.push("民代關切");
    }

    lineHits.forEach(addUnique);
  });

  return results.join("、");
}

function handleExcelFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const yearMatch = file.name.match(/(1\d{2})/);
  const defaultYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear() - 1911);

  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
    const parsed = [];
    let fallbackToReqCount = 0;
    let autoConcernCount = 0;

    wb.SheetNames.forEach((sheetName, sheetIdx) => {
      const sheetMeta = (wb.Workbook && wb.Workbook.Sheets) ? wb.Workbook.Sheets[sheetIdx] : null;
      if (sheetMeta && sheetMeta.Hidden && sheetMeta.Hidden !== 0) return;
      if (sheetName.includes("總表") || sheetName.includes("目錄")) return;

      let defaultCat = "工程";
      if (sheetName.includes("委託") || sheetName.includes("設計")) defaultCat = "委託設計/監造";
      else if (sheetName.includes("先期")) defaultCat = "用地先期作業";
      else if (sheetName.includes("用地")) defaultCat = "用地取得";
      else if (sheetName.includes("橋梁")) defaultCat = "橋梁改建/補助";
      else if (sheetName.includes("逕流")) defaultCat = "逕流分擔/補助";

      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      if (!matrix.length) return;

      let headerIdx = -1;
      for (let i = 0; i < Math.min(10, matrix.length); i++) {
        const cleanedRow = (matrix[i] || []).map(cleanExcelHeaderText);
        if (cleanedRow.some(h => h.includes("案件名稱") || h.includes("工程名稱"))) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) return;

      let isDualHeader = false;
      if (headerIdx + 1 < matrix.length) {
        const nextRowClean = (matrix[headerIdx + 1] || []).map(cleanExcelHeaderText);
        const subHeaderKeywords = ["核定經費", "可支用", "建造物名稱", "堤防", "護岸", "改善長度", "改善面積", "意見", "116年", "115年", "114年"];
        if (nextRowClean.some(h => subHeaderKeywords.some(k => h.includes(k)))) {
          isDualHeader = true;
        }
      }

      const row1 = matrix[headerIdx] || [];
      const row2 = isDualHeader ? (matrix[headerIdx + 1] || []) : [];
      const colCount = Math.max(row1.length, row2.length);
      const headers = [];
      for (let c = 0; c < colCount; c++) {
        const h1 = cleanExcelHeaderText(row1[c]);
        const h2 = cleanExcelHeaderText(row2[c]);
        headers.push({ comb: h2 || h1, h1, h2 });
      }

      const findCol = (predicates) => {
        for (const pred of predicates) {
          for (let c = 0; c < headers.length; c++) {
            if (pred(headers[c])) return c;
          }
        }
        return -1;
      };

      const cYear = findCol([h => h.comb === "年度"]);
      const cCat = findCol([h => h.comb === "類別"]);
      const cAppendix = findCol([h => h.comb === "附表"]);
      const cBranch = findCol([h => ["分署", "分署別", "執行單位"].includes(h.comb)]);
      const cCounty = findCol([h => h.comb === "縣市"]);
      const cWater = findCol([
        h => h.comb === "水系",
        h => h.comb === "排水名稱" || h.comb === "海岸名稱",
        h => h.h1.includes("溪別") || h.h1.includes("排水名稱") || h.h1.includes("海岸名稱")
      ]);
      const cName = findCol([h => h.comb === "案件名稱" || h.comb === "工程名稱"]);
      const cApproved = findCol([h => h.comb.includes("核定經費")]);
      const cReq = findCol([h => h.comb.includes("經費需求")]);
      const cUsable = findCol([h => h.comb.includes("可支用經費")]);
      const cCode = findCol([h => h.comb.includes("工程編號")]);
      const cCoords = findCol([h => h.comb.includes("座標點位")]);
      const cLevee = findCol([h => h.comb === "堤防_m", h => h.comb.includes("堤防")]);
      const cRevet = findCol([h => h.comb === "護岸_m", h => h.comb.includes("護岸")]);
      const cGate = findCol([h => h.comb === "水門_座", h => h.comb.includes("水門")]);
      const cRoad = findCol([h => h.comb === "水防道路_m2", h => h.comb.includes("水防道路")]);
      const cOther = findCol([h => h.comb === "其他結構說明", h => h.comb === "其他"]);
      const cRemark = findCol([h => h.comb === "備註資訊" || h.comb === "備註"]);
      const cConcern = findCol([h => h.comb.includes("地方關切") || h.comb.includes("民代關切")]);

      const startRow = headerIdx + (isDualHeader ? 2 : 1);
      for (let r = startRow; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const getVal = idx => (idx >= 0 && idx < row.length ? row[idx] : "");

        const pName = normalizeText(getVal(cName));
        const bName = normalizeText(getVal(cBranch)).replace("水規所", "水規分署");
        if (!pName || !bName) continue;
        if (["合計", "小計", "總計"].some(k => pName.includes(k) || bName.includes(k))) continue;

        let approvedVal = parseExcelNumber(getVal(cApproved));
        const reqVal = parseExcelNumber(getVal(cReq));
        if (approvedVal <= 0 && reqVal > 0) {
          approvedVal = reqVal;
          fallbackToReqCount++;
        }

        const remarkText = normalizeText(getVal(cRemark));
        let concernText = normalizeText(getVal(cConcern));
        if (!concernText && remarkText) {
          concernText = extractConcernFromRemark(remarkText);
          if (concernText) autoConcernCount++;
        }

        parsed.push({
          "年度": normalizeText(getVal(cYear) || defaultYear),
          "類別": normalizeCategoryName(getVal(cCat) || defaultCat),
          "附表": normalizeText(getVal(cAppendix) || sheetName),
          "分署": bName,
          "縣市": normalizeText(getVal(cCounty)).replace(/台/g, "臺"),
          "水系": normalizeText(getVal(cWater)),
          "案件名稱": pName,
          "核定經費_千元": approvedVal,
          "可支用經費_千元": parseExcelNumber(getVal(cUsable)),
          "工程編號": normalizeText(getVal(cCode)),
          "座標點位": normalizeText(getVal(cCoords)),
          "堤防_m": parseExcelNumber(getVal(cLevee)),
          "護岸_m": parseExcelNumber(getVal(cRevet)),
          "水門_座": Math.round(parseExcelNumber(getVal(cGate))),
          "水防道路_m2": parseExcelNumber(getVal(cRoad)),
          "其他結構說明": normalizeText(getVal(cOther)),
          "備註資訊": remarkText,
          "地方關切": concernText
        });
      }
    });

    pendingImportRecords = parsed;
    const notes = [];
    if (fallbackToReqCount > 0) notes.push(`其中 ${fallbackToReqCount} 筆核定經費空白已暫以經費需求帶入`);
    if (autoConcernCount > 0) notes.push(`自動摘錄地方關切 ${autoConcernCount} 筆`);
    const extraNote = notes.length ? `；${notes.join("，")}` : "";

    document.getElementById("lblImportSummary").textContent =
      `檔案《${file.name}》共解析出 ${parsed.length} 筆有效案件（寫入時自動執行防重複合併${extraNote}）：`;
    document.getElementById("tbodyImportPreview").innerHTML = parsed.slice(0, 100).map(r => `
      <tr>
        <td class="p-1.5 text-center">${r["年度"]}</td>
        <td class="p-1.5 text-center">${r["分署"]}</td>
        <td class="p-1.5 text-center">${r["類別"]}</td>
        <td class="p-1.5">${r["案件名稱"]}</td>
        <td class="p-1.5 text-right font-mono">${r["核定經費_千元"].toLocaleString()}</td>
        <td class="p-1.5 text-center">${r["地方關切"] ? `<span class="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">${r["地方關切"]}</span>` : "-"}</td>
        <td class="p-1.5 text-center">${r["工程編號"] || "-"}</td>
      </tr>
    `).join("");
    document.getElementById("modalImportPreview").classList.remove("hidden");
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}

async function confirmUploadImportRecords() {
  if (!pendingImportRecords.length) return;
  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "upsert_batch", passcode: adminPasscode, records: pendingImportRecords })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalImportPreview").classList.add("hidden");
      alert(json.message);
      loadAllData(false);
    } else {
      alert(json.message);
    }
  } catch (err) {
    alert("雲端寫入失敗：" + err.message);
  }
}
