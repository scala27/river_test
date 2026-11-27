/**
 * 治水雲庫 V2 — 歷年總庫編輯與查詢明細匯出輔助模組
 */

function openEditModal(rec) {
  if (typeof canEditHistory === "function" && !canEditHistory()) {
    return alert("僅「系統管理」身分可編輯歷年資料庫案件");
  }
  if (!rec) return;
  document.getElementById("editId").value = rec.id || "";
  document.getElementById("editYear").value = rec["年度"] || "";
  document.getElementById("editBranch").value = rec["分署"] || "";
  document.getElementById("editCounty").value = rec["縣市"] || "";
  document.getElementById("editWater").value = rec["水系"] || "";
  document.getElementById("editName").value = rec["案件名稱"] || "";
  document.getElementById("editApproved").value = rec["核定經費_千元"] || 0;
  document.getElementById("editUsable").value = rec["可支用經費_千元"] || 0;
  document.getElementById("editCode").value = rec["工程編號"] || "";
  document.getElementById("editCoords").value = rec["座標點位"] || "";
  document.getElementById("editConcern").value = rec["地方關切"] || "";
  document.getElementById("editRemark").value = rec["備註資訊"] || "";
  document.getElementById("modalEdit")?.classList.remove("hidden");
}

async function saveEditedProject() {
  if (typeof canEditHistory === "function" && !canEditHistory()) {
    return alert("僅「系統管理」身分可儲存歷年資料庫異動");
  }
  const pass = (typeof v2AuthState !== "undefined" && v2AuthState.passcode) ? v2AuthState.passcode : adminPasscode;
  if (!pass) return alert("請先登入系統管理帳號");

  const id = document.getElementById("editId")?.value.trim() || "";
  const orig = (typeof allRecords !== "undefined" ? allRecords : []).find(r => String(r.id).trim() === id) || {};

  const record = {
    ...orig,
    id,
    "年度": document.getElementById("editYear")?.value.trim() || "",
    "分署": document.getElementById("editBranch")?.value.trim() || "",
    "縣市": (document.getElementById("editCounty")?.value.trim() || "").replace(/台/g, "臺"),
    "水系": document.getElementById("editWater")?.value.trim() || "",
    "案件名稱": document.getElementById("editName")?.value.trim() || "",
    "核定經費_千元": parseFloat(document.getElementById("editApproved")?.value) || 0,
    "可支用經費_千元": parseFloat(document.getElementById("editUsable")?.value) || 0,
    "工程編號": document.getElementById("editCode")?.value.trim() || "",
    "座標點位": document.getElementById("editCoords")?.value.trim() || "",
    "地方關切": document.getElementById("editConcern")?.value.trim() || "",
    "備註資訊": document.getElementById("editRemark")?.value.trim() || ""
  };

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "update_project",
        passcode: pass,
        record
      })
    });
    const json = await res.json();
    if (json.status === "success") {
      document.getElementById("modalEdit")?.classList.add("hidden");
      alert(json.message || "歷史案件已更新");
      if (typeof loadAllData === "function") await loadAllData(false);
    } else {
      alert(json.message || "更新失敗");
    }
  } catch (err) {
    alert("更新失敗：" + err.message);
  }
}

function exportCurrentExcel() {
  if (typeof XLSX === "undefined") return alert("尚未載入 SheetJS 元件，無法匯出 Excel");
  const rows = (typeof filteredRecords !== "undefined" && Array.isArray(filteredRecords)) ? filteredRecords : [];
  if (!rows.length) return alert("目前無可匯出的查詢明細資料");

  const sheetData = rows.map(r => ({
    "年度": r["年度"] || "",
    "類別": r["類別"] || "",
    "性質": typeof formatAppendixToNature === "function" ? formatAppendixToNature(r["附表"]) : (r["附表"] || ""),
    "分署": r["分署"] || "",
    "縣市": r["縣市"] || "",
    "鄉鎮": r["鄉鎮"] || "",
    "水系": r["水系"] || "",
    "溪別": r["溪別"] || "",
    "案件名稱": r["案件名稱"] || "",
    "核定經費_千元": Number(r["核定經費_千元"]) || 0,
    "可支用經費_千元": Number(r["可支用經費_千元"]) || 0,
    "工程編號": r["工程編號"] || "",
    "座標點位": r["座標點位"] || "",
    "地方關切": r["地方關切"] || "",
    "備註資訊": r["備註資訊"] || ""
  }));

  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "歷年查詢明細");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `治水雲庫_歷年查詢明細_${stamp}.xlsx`);
}