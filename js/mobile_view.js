/**
 * 手機出差專用介面與個案快報模組（與桌面核心邏輯解耦）
 * 專責：手機版初始配置、進階篩選摺疊、個案資訊卡、個案詳情視窗、一鍵複製 LINE 回報摘要
 */

let mobileFiltersExpanded = false;
let currentDetailModalRecordId = "";
let copyToastTimer = null;

function initMobileLayout() {
  ensureMobileOverlays();

  // 手機螢幕（< 768px）進入時預設收合 KPI 卡片，讓搜尋列與案件結果優先進入首屏
  if (window.innerWidth < 768) {
    const sec = document.getElementById("kpiSection");
    const lbl = document.getElementById("menuToggleKpiLabel");
    if (sec) sec.classList.add("hidden");
    if (lbl) lbl.textContent = "顯示統計卡片";
  }
}

function ensureMobileOverlays() {
  if (!document.getElementById("modalDetailView")) {
    const modalWrap = document.createElement("div");
    modalWrap.innerHTML = `
      <div id="modalDetailView" onclick="if(event.target===this) closeDetailModal()" class="hidden fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
        <div class="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">
          <div class="px-4 py-3 bg-[#1a365d] text-white flex items-center justify-between gap-2 shrink-0">
            <span id="detailModalHeader" class="text-sm font-bold truncate">個案詳細資訊</span>
            <button type="button" onclick="closeDetailModal()" aria-label="關閉" class="p-1 rounded hover:bg-white/10 transition">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div id="detailModalBody" class="p-4 overflow-y-auto space-y-3 text-xs text-slate-700"></div>
          <div class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
            <button id="btnDetailModalEdit" type="button" onclick="editFromDetailModal()" class="hidden px-3 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded font-bold transition">編輯此案</button>
            <div class="flex items-center gap-2 ml-auto">
              <button type="button" onclick="copyFromDetailModal()" class="px-3.5 py-1.5 text-xs bg-[#1f538d] hover:bg-[#14375e] text-white rounded font-bold inline-flex items-center gap-1.5 transition">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>複製 LINE 摘要</span>
              </button>
              <button type="button" onclick="closeDetailModal()" class="px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-bold transition">關閉</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalWrap.firstElementChild);
  }

  if (!document.getElementById("copyToast")) {
    const toast = document.createElement("div");
    toast.id = "copyToast";
    toast.className = "hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg whitespace-nowrap";
    toast.textContent = "已複製摘要，可直接貼至 LINE";
    document.body.appendChild(toast);
  }
}

function toggleMobileFilters() {
  mobileFiltersExpanded = !mobileFiltersExpanded;
  document.querySelectorAll(".mobile-adv-filter").forEach(el => {
    if (mobileFiltersExpanded) {
      el.classList.remove("hidden");
      el.classList.add("flex");
    } else {
      el.classList.add("hidden");
      el.classList.remove("flex");
    }
  });
  const lbl = document.getElementById("lblToggleMobileFilters");
  if (lbl) lbl.textContent = mobileFiltersExpanded ? "收合進階篩選" : "進階篩選";
}

function getMobileBranchLabel(rawBranch) {
  if (typeof formatBranchDisplayName === "function") {
    return formatBranchDisplayName(rawBranch);
  }
  return String(rawBranch || "-").trim() || "-";
}

function buildLineSummaryText(rec) {
  const branchDisplay = getMobileBranchLabel(rec["分署"]);
  const countyWater = [rec["縣市"], rec["水系"]].filter(Boolean).join("／") || "-";
  const lines = [
    `【${rec["年度"]}年度｜${branchDisplay}】${rec["案件名稱"]}`,
    `- 縣市／水系：${countyWater}`,
    `- 類別：${rec["類別"] || "-"}`,
    `- 核定經費：${formatIntThousand(rec["核定經費_千元"])} 千元（可支用：${formatIntThousand(rec["可支用經費_千元"])} 千元）`
  ];
  if (rec["工程編號"] && rec["工程編號"] !== "-") {
    lines.push(`- 工程編號：${rec["工程編號"]}`);
  }
  if (rec["地方關切"] && rec["地方關切"] !== "-") {
    lines.push(`- 地方關切：${rec["地方關切"]}`);
  }
  if (rec["備註資訊"] && rec["備註資訊"] !== "-") {
    lines.push(`- 備註：${rec["備註資訊"]}`);
  }
  return lines.join("\n");
}

function showCopyToast(msg) {
  ensureMobileOverlays();
  const toast = document.getElementById("copyToast");
  if (!toast) return;
  toast.textContent = msg || "已複製摘要，可直接貼至 LINE";
  toast.classList.remove("hidden");
  if (copyToastTimer) clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
}

function copyTextFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    showCopyToast("已複製摘要，可直接貼至 LINE");
  } catch (err) {
    alert("複製失敗，請手動選取內容複製。");
  }
  document.body.removeChild(ta);
}

function copyProjectSummary(recId, event) {
  if (event) event.stopPropagation();
  const rec = allRecords.find(r => r.id === recId);
  if (!rec) return;
  const text = buildLineSummaryText(rec);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showCopyToast("已複製摘要，可直接貼至 LINE"))
      .catch(() => copyTextFallback(text));
  } else {
    copyTextFallback(text);
  }
}

function openDetailModal(recId) {
  ensureMobileOverlays();
  const rec = allRecords.find(r => r.id === recId);
  if (!rec) return;
  currentDetailModalRecordId = recId;

  const header = document.getElementById("detailModalHeader");
  const body = document.getElementById("detailModalBody");
  const btnEdit = document.getElementById("btnDetailModalEdit");
  if (header) header.textContent = `${rec["年度"]}年度｜${getMobileBranchLabel(rec["分署"])}`;
  if (btnEdit) btnEdit.classList.toggle("hidden", !adminPasscode);

  if (body) {
    const safe = v => escapeHtmlAttr(v || "-");
    const natureText = typeof formatAppendixToNature === "function" ? formatAppendixToNature(rec["附表"]) : rec["附表"];
    const concernHtml = rec["地方關切"]
      ? `<span class="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">${safe(rec["地方關切"])}</span>`
      : `<span class="text-slate-400">-</span>`;

    body.innerHTML = `
      <div class="font-bold text-sm text-slate-900 leading-snug border-b border-slate-100 pb-2.5">${safe(rec["案件名稱"])}</div>
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-blue-50/70 border border-blue-100 rounded p-2">
          <div class="text-[11px] text-slate-500">核定經費</div>
          <div class="text-sm font-bold text-[#0d47a1] font-mono mt-0.5">${formatIntThousand(rec["核定經費_千元"])} 千元</div>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded p-2">
          <div class="text-[11px] text-slate-500">可支用經費</div>
          <div class="text-sm font-bold text-slate-800 font-mono mt-0.5">${formatIntThousand(rec["可支用經費_千元"])} 千元</div>
        </div>
      </div>
      <dl class="divide-y divide-slate-100">
        <div class="py-1.5 flex justify-between gap-3"><dt class="text-slate-500 shrink-0">縣市／水系</dt><dd class="text-right font-medium text-slate-800">${safe(rec["縣市"])} ／ ${safe(rec["水系"])}</dd></div>
        <div class="py-1.5 flex justify-between gap-3"><dt class="text-slate-500 shrink-0">案件類別</dt><dd class="text-right font-medium text-slate-800">${safe(rec["類別"])}</dd></div>
        <div class="py-1.5 flex justify-between gap-3"><dt class="text-slate-500 shrink-0">性質</dt><dd class="text-right text-slate-700">${safe(natureText)}</dd></div>
        <div class="py-1.5 flex justify-between gap-3"><dt class="text-slate-500 shrink-0">工程編號</dt><dd class="text-right font-mono text-slate-700 break-all">${safe(rec["工程編號"])}</dd></div>
        <div class="py-1.5 flex justify-between items-center gap-3"><dt class="text-slate-500 shrink-0">地方關切</dt><dd class="text-right">${concernHtml}</dd></div>
        <div class="py-1.5 flex justify-between gap-3"><dt class="text-slate-500 shrink-0">座標點位</dt><dd class="text-right font-mono text-slate-600 break-all">${safe(rec["座標點位"])}</dd></div>
        <div class="py-1.5 space-y-1"><dt class="text-slate-500">備註資訊</dt><dd class="text-slate-700 bg-slate-50 rounded p-2 whitespace-pre-wrap break-words">${safe(rec["備註資訊"])}</dd></div>
      </dl>
    `;
  }

  const modal = document.getElementById("modalDetailView");
  if (modal) modal.classList.remove("hidden");
}

function closeDetailModal() {
  const modal = document.getElementById("modalDetailView");
  if (modal) modal.classList.add("hidden");
}

function copyFromDetailModal() {
  if (currentDetailModalRecordId) {
    copyProjectSummary(currentDetailModalRecordId);
  }
}

function editFromDetailModal() {
  const rec = allRecords.find(r => r.id === currentDetailModalRecordId);
  if (!rec) return;
  closeDetailModal();
  if (typeof openEditModal === "function") {
    openEditModal(rec);
  }
}

function renderMobileDetailCards(displayRows) {
  const container = document.getElementById("mobileDetailCards");
  if (!container) return;

  if (!displayRows.length) {
    container.innerHTML = `<div class="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">查無符合條件的工程案件</div>`;
    return;
  }

  container.innerHTML = displayRows.map(r => {
    const idSafe = escapeHtmlAttr(r.id);
    const branchLbl = escapeHtmlAttr(getMobileBranchLabel(r["分署"]));
    const locStr = [r["縣市"], r["水系"]].filter(Boolean).join("・");
    const concernBadge = r["地方關切"]
      ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px] truncate max-w-[120px]">${escapeHtmlAttr(r["地方關切"])}</span>`
      : "";
    const remarkLine = r["備註資訊"]
      ? `<div class="text-[11px] text-slate-500 truncate mt-1">備註：${escapeHtmlAttr(r["備註資訊"])}</div>`
      : "";

    return `
      <div onclick="openDetailModal('${idSafe}')" class="bg-white border border-slate-200 rounded-lg p-3 shadow-xs active:bg-sky-50/70 transition cursor-pointer">
        <div class="flex items-center justify-between gap-1.5 mb-1">
          <div class="flex items-center gap-1.5 min-w-0 text-[11px]">
            <span class="px-1.5 py-0.5 rounded bg-[#1a365d]/10 text-[#1a365d] font-bold shrink-0">${escapeHtmlAttr(r["年度"])}年</span>
            <span class="font-bold text-slate-700 shrink-0">${branchLbl}</span>
            <span class="text-slate-500 truncate">${escapeHtmlAttr(locStr)}</span>
          </div>
          ${concernBadge}
        </div>
        <div class="text-sm font-bold text-slate-800 leading-snug break-words">${escapeHtmlAttr(r["案件名稱"])}</div>
        <div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 text-xs">
          <div>
            <span class="text-[11px] text-slate-500">核定：</span>
            <span class="font-bold text-[#0d47a1] font-mono">${formatIntThousand(r["核定經費_千元"])}</span>
          </div>
          <div class="text-right">
            <span class="text-[11px] text-slate-500">可支用：</span>
            <span class="font-medium text-slate-700 font-mono">${formatIntThousand(r["可支用經費_千元"])}</span>
          </div>
        </div>
        ${remarkLine}
        <div class="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-100">
          <span class="text-[11px] text-slate-400 truncate">${escapeHtmlAttr(r["類別"])}</span>
          <button type="button" onclick="copyProjectSummary('${idSafe}', event)" class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-[11px] transition">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>複製摘要</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}
