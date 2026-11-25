const GAS_API_URL = "https://script.google.com/macros/s/AKfycby3I7fiP5uEJB4Hr2aMcNJ7kGpRFINxSEu78836RyAhCOA9ZrGBVB4CfRZTGxQg7moBOQ/exec";

const CHINESE_NUM_ORDER = {
  "一": 1, "一分署": 1, "第一河川分署": 1,
  "二": 2, "二分署": 2, "第二河川分署": 2,
  "三": 3, "三分署": 3, "第三河川分署": 3,
  "四": 4, "四分署": 4, "第四河川分署": 4,
  "五": 5, "五分署": 5, "第五河川分署": 5,
  "六": 6, "六分署": 6, "第六河川分署": 6,
  "七": 7, "七分署": 7, "第七河川分署": 7,
  "八": 8, "八分署": 8, "第八河川分署": 8,
  "九": 9, "九分署": 9, "第九河川分署": 9,
  "十": 10, "十分署": 10, "第十河川分署": 10,
  "水規分署": 11, "水規所": 11
};

const STD_22_COUNTIES = [
  "宜蘭縣", "基隆市", "臺北市", "新北市", "桃園市", "新竹縣", "新竹市",
  "苗栗縣", "臺中市", "南投縣", "彰化縣", "雲林縣", "嘉義縣", "嘉義市",
  "臺南市", "高雄市", "屏東縣", "臺東縣", "花蓮縣", "澎湖縣", "金門縣", "連江縣"
];

const CATEGORIES_LIST = [
  "工程", "委託設計/監造", "用地先期作業", "用地取得", "橋梁改建/補助", "逕流分擔/補助", "維修改善工程", "補助案件"
];

function normalizeText(val) {
  return String(val || "").normalize("NFKC").trim();
}

function normalizeCategoryName(rawCat) {
  const c = normalizeText(rawCat);
  if (c === "用地先期" || c === "用地先期作業") return "用地先期作業";
  if (c === "委託測設監造" || c.includes("委託測設") || c.includes("委託設計")) return "委託設計/監造";
  if (c === "橋梁改建" || c === "橋梁改建/補助") return "橋梁改建/補助";
  if (c === "逕流分擔" || c === "逕流分擔/補助" || c === "逕流分擔設施建置") return "逕流分擔/補助";
  return c || "工程";
}

function getMajorCategory(cat) {
  if (["工程", "委託設計/監造", "維修改善工程"].includes(cat)) return "工程類";
  if (["用地先期作業", "用地取得"].includes(cat)) return "用地類";
  return "補助類";
}

function extractPrimaryCounty(raw) {
  const clean = normalizeText(raw).replace(/[\r\n]/g, "").replace(/台/g, "臺").replace(/、/g, "/");
  const parts = clean.split("/").map(s => s.trim()).filter(Boolean);
  if (parts.length && STD_22_COUNTIES.includes(parts[0])) return parts[0];
  return "全國性或未分配";
}

/**
 * 萃取核心案名：剝除括號內的年度、期別、修正/追加附註，提升跨年度延續案件比對準確度
 */
function getCoreProjectName(rawName) {
  let name = normalizeText(rawName).replace(/台/g, "臺");
  name = name.replace(/[（(][^）)]*(?:年度|第[一二三四五六七八九十\d]+期|期|修正|追加|調整|延續|併案)[^）)]*[）)]/g, "");
  name = name.replace(/[-－—](?:1\d{2}年度?|第[一二三四五六七八九十\d]+期)$/g, "");
  return name.trim() || normalizeText(rawName);
}

/**
 * 將原始附表名稱轉換為對應的「性質」名稱
 * 優先比對關鍵字（相容 116 年起「附表5-構造物維修」），再比對附表編號（相容 110-115 年舊命名）
 */
function formatAppendixToNature(rawAppendix) {
  const s = normalizeText(rawAppendix);
  if (!s || s === "-") return "-";
  if (s.includes("構造物維修") || s.includes("維修改善") || s.includes("維修")) return "維修改善";
  if (s.includes("整體環境") || s.includes("環境營造")) return "環境營造";
  if (s.includes("土地") || s.includes("海岸")) return "土地調適";
  if (s.includes("整建")) return "整建";
  if (s.includes("區排")) return "區排";
  if (s.includes("河川")) return "河川";

  if (/附表\s*[1一]/.test(s)) return "河川";
  if (/附表\s*[2二]/.test(s)) return "區排";
  if (/附表\s*[3三]/.test(s)) return "土地調適";
  if (/附表\s*[4四]/.test(s)) return "環境營造";
  if (/附表\s*[5五]/.test(s)) return "整建";
  if (/附表\s*[6六7七]/.test(s)) return "維修改善";
  return s;
}