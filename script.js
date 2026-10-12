"use strict";

// =====================================================
// 基本設定
// =====================================================
const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "personal-decision-wheel-v1";

// 100% = 1,000,000 單位，百分比可輸入最多四位小數。
const TOTAL_UNITS = 1000000;

const colors = [
  "#8dbfff",
  "#75dfce",
  "#f4cd88",
  "#b8b0f4",
  "#f0afc6",
  "#7bd6e9",
  "#b7d994",
  "#a5c5e9"
];

const canvas = $("#wheel");
const ctx = canvas.getContext("2d");

let options = [];
let eligible = [];
let inputError = "";
let busy = false;
let rotation = 0;
let result = null;
let storageBlocked = false;
let storageError = "";
let saveTimer;

// =====================================================
// 共用函式
// =====================================================
function makeNode(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function formatPercent(probability) {
  return (probability * 100).toLocaleString("zh-TW", {
    maximumFractionDigits: 4
  }) + "%";
}

function shorten(text, limit) {
  const chars = Array.from(text);

  return chars.length > limit
    ? chars.slice(0, limit).join("") + "…"
    : text;
}

function prefersReducedMotion() {
  return window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
}

// =====================================================
// 解析選項
// 支援：
// 吃拉麵(40%)
// 吃火鍋（30%）
// 吃咖哩
// 使用換行、英文逗號或中文逗號分隔。
// =====================================================
function parseOptions() {
  const entries = $("#options").value
    .split(/[\r\n,，]+/)
    .map((text) => text.trim())
    .filter(Boolean);

  if (entries.length > 100) {
    return { error: "最多支援 100 個選項。" };
  }

  const parsed = [];
  const seen = new Set();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];

    let name = entry;
    let units = null;

    const match = entry.match(
      /^(.*?)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*[%％]\s*\)|（\s*(\d+(?:\.\d+)?)\s*[%％]\s*）)\s*$/
    );

    if (match) {
      name = match[1].trim();

      const value = match[2] ?? match[3];
      const decimals = (value.split(".")[1] || "").length;

      if (Number(value) > 100 || decimals > 4) {
        return {
          error: `「${name}」的機率須介於 0%～100%，最多四位小數。`
        };
      }

      const [whole, fraction = ""] = value.split(".");

      units =
        Number(whole) * 10000 +
        Number(fraction.padEnd(4, "0"));
    } else if (/[()（）%％]/.test(entry)) {
      return {
        error: `第 ${index + 1} 個選項格式不正確，請使用「選項」或「選項(40%)」。`
      };
    }

    if (!name || /[()（）%％]/.test(name)) {
      return {
        error: `第 ${index + 1} 個選項名稱或格式不正確。`
      };
    }

    if (seen.has(name)) {
      return {
        error: `「${name}」重複了，請保留一個或使用不同名稱。`
      };
    }

    seen.add(name);

    parsed.push({
      name,
      units,
      custom: units !== null,
      number: parsed.length + 1,
      color: colors[parsed.length % colors.length]
    });
  }

  const specifiedTotal = parsed.reduce(
    (sum, option) => sum + (option.units ?? 0),
    0
  );

  const automatic = parsed.filter(
    (option) => !option.custom
  );

  if (specifiedTotal > TOTAL_UNITS) {
    return {
      error: "自訂機率總和不能超過 100%。"
    };
  }

  if (
    parsed.length &&
    !automatic.length &&
    specifiedTotal !== TOTAL_UNITS
  ) {
    return {
      error: "每個選項都有填機率時，總和必須等於 100%。"
    };
  }

  // 放大整數權重，讓剩餘機率能完全平均分配。
  const multiplier = automatic.length || 1;
  const remaining = TOTAL_UNITS - specifiedTotal;

  for (const option of parsed) {
    option.weight = option.custom
      ? option.units * multiplier
      : remaining;

    option.probability =
      option.weight / (TOTAL_UNITS * multiplier);
  }

  return { options: parsed };
}

// =====================================================
// 更新選項與機率列表
// =====================================================
function refreshOptions() {
  const parsed = parseOptions();

  inputError = parsed.error || "";
  options = parsed.options || [];
  eligible = options.filter((option) => option.weight > 0);

  $("#option-count").textContent = inputError
    ? "—"
    : `${options.length} 個`;

  renderProbabilities();
  drawWheel();
  updateSpinButton();
}

function renderProbabilities() {
  const list = $("#probability-list");
  const message = $("#validation-message");

  list.replaceChildren();
  message.classList.toggle("error", Boolean(inputError));

  if (inputError) {
    message.textContent = inputError;
    return;
  }

  if (!options.length) {
    message.textContent = "填入選項後，這裡會顯示每個選項的機率。";
    return;
  }

  message.textContent =
    `共 ${options.length} 個選項，${eligible.length} 個可被選中，機率總和為 100%。`;

  for (const option of options) {
    const row = makeNode("div", "option-row");
    const top = makeNode("div", "option-top");

    const dot = makeNode("span", "color-dot");
    dot.style.backgroundColor = option.color;

    top.append(
      dot,
      makeNode(
        "span",
        "option-name",
        `${option.number}. ${option.name}`
      ),
      makeNode(
        "span",
        "option-percent",
        formatPercent(option.probability)
      )
    );

    const track = makeNode("div", "option-track");
    const fill = makeNode("span", "option-fill");

    fill.style.width = `${option.probability * 100}%`;
    fill.style.backgroundColor = option.color;

    track.append(fill);
    row.append(top, track);
    list.append(row);
  }
}

// =====================================================
// 本地保存
// =====================================================
function renderStorageStatus(saved = false) {
  const status = $("#storage-status");

  status.classList.toggle("error", Boolean(storageError));

  if (storageError) {
    status.textContent = storageError;
  } else if (saved) {
    status.textContent = "✓ 選項已儲存，下次開啟會自動帶入。";
  } else {
    status.textContent = "";
  }
}

function saveData() {
  clearTimeout(saveTimer);

  if (storageBlocked) {
    renderStorageStatus();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      text: $("#options").value,
      result
    }));

    storageError = "";
    renderStorageStatus(true);
  } catch {
    storageError =
      "瀏覽器無法保存資料；本次仍可使用，但關閉後可能無法保留。";

    renderStorageStatus();
  }
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);

    if (
      data?.version !== 1 ||
      typeof data.text !== "string"
    ) {
      throw new Error("Invalid saved data");
    }

    if (
      data.result !== null &&
      data.result !== undefined &&
      (
        typeof data.result.name !== "string" ||
        typeof data.result.probability !== "number" ||
        !Number.isFinite(data.result.probability) ||
        data.result.probability < 0 ||
        data.result.probability > 1
      )
    ) {
      throw new Error("Invalid saved result");
    }

    $("#options").value = data.text;
    result = data.result || null;
  } catch {
    storageBlocked = true;
    storageError =
      "原有資料無法讀取，已暫停保存以避免覆蓋。";

    renderStorageStatus();
  }
}

// =====================================================
// 輪盤繪製
// =====================================================
function getSectors() {
  const total = eligible.reduce(
    (sum, option) => sum + option.weight,
    0
  );

  let currentAngle = 0;

  return eligible.map((option) => {
    const start = currentAngle;
    const size = option.weight / total * Math.PI * 2;

    currentAngle += size;

    return {
      option,
      start,
      end: currentAngle,
      size,
      middle: start + size / 2
    };
  });
}

function drawWheel() {
  const center = canvas.width / 2;
  const radius = center - 6;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!eligible.length) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#2f4361";
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#b2c9df";
    ctx.font = "600 28px sans-serif";
    ctx.fillText("填入你的選項", center, center - 95);
    return;
  }

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(rotation);

  for (const sector of getSectors()) {
    const { option, start, end, size, middle } = sector;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = option.color;
    ctx.fill();

    ctx.strokeStyle = "#eff8ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(middle);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#233e58";

    if (size >= 0.24) {
      ctx.font = `700 ${size >= 0.5 ? 27 : 20}px sans-serif`;

      ctx.fillText(
        shorten(option.name, size >= 0.5 ? 9 : 6),
        radius * 0.59,
        0,
        radius * 0.5
      );

      if (size >= 0.45) {
        ctx.font = "600 17px sans-serif";
        ctx.fillText(
          formatPercent(option.probability),
          radius * 0.84,
          0
        );
      }
    } else if (size >= 0.025) {
      // 小區塊以編號對應左側機率列表。
      ctx.font = `700 ${size >= 0.08 ? 16 : 11}px sans-serif`;

      ctx.fillText(
        String(option.number),
        radius * 0.84,
        0
      );
    }

    ctx.restore();
  }

  ctx.restore();
}

// =====================================================
// 加權隨機選擇
// =====================================================

// 使用拒絕抽樣避免餘數偏差。
// 100 個選項上限下，權重總和小於 2^32。
function randomBelow(limit) {
  const range = 4294967296;
  const cutoff = range - range % limit;
  const buffer = new Uint32Array(1);

  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= cutoff);

  return buffer[0] % limit;
}

function chooseIndex() {
  const total = eligible.reduce(
    (sum, option) => sum + option.weight,
    0
  );

  const target = randomBelow(total);
  let cumulative = 0;

  for (let index = 0; index < eligible.length; index++) {
    cumulative += eligible[index].weight;

    if (target < cumulative) {
      return index;
    }
  }

  throw new Error("Invalid weights");
}

// =====================================================
// 旋轉動畫
// =====================================================
function animateWheel(index) {
  const full = Math.PI * 2;

  // 讓中選區塊中心對準頂端指針。
  const target =
    -Math.PI / 2 - getSectors()[index].middle;

  const normalized =
    ((target % full) + full) % full;

  const current =
    ((rotation % full) + full) % full;

  const distance =
    full * 5 +
    (normalized - current + full) % full;

  const initial = rotation;
  const duration = prefersReducedMotion() ? 0 : 3300;

  return new Promise((resolve) => {
    if (!duration) {
      rotation = normalized;
      drawWheel();
      resolve();
      return;
    }

    const started = performance.now();

    function frame(now) {
      const progress = Math.min(
        (now - started) / duration,
        1
      );

      const eased =
        1 - Math.pow(1 - progress, 4);

      rotation = initial + distance * eased;
      drawWheel();

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = normalized;
        drawWheel();
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

// =====================================================
// 結果與按鈕狀態
// =====================================================
function renderResult(animate = false) {
  const box = $("#result");
  box.classList.remove("reveal");

  if (busy) {
    $("#result-name").textContent = "正在替你選擇…";
    $("#result-detail").textContent = "深呼吸，答案就快出來了。";
  } else if (result) {
    $("#result-name").textContent = result.name;
    $("#result-detail").textContent =
      `上次抽取時的機率：${formatPercent(result.probability)}`;
  } else {
    $("#result-name").textContent = "準備好，轉一下！";
    $("#result-detail").textContent = "讓輪盤幫你選擇。";
  }

  if (animate) {
    void box.offsetWidth;
    box.classList.add("reveal");
  }
}

function updateSpinButton() {
  $("#spin").disabled =
    busy || Boolean(inputError) || !eligible.length;

  $("#spin-label").textContent =
    busy ? "輪盤轉動中…" : "幫我決定";
}

function setBusy(value) {
  busy = value;

  [
    "#options",
    "#save-options",
    "#sample-options"
  ].forEach((selector) => {
    $(selector).disabled = value;
  });

  updateSpinButton();
}

function setSpinMessage(text, error = false) {
  $("#spin-message").textContent = text;
  $("#spin-message").classList.toggle("error", error);
}

// =====================================================
// 開始選擇
// =====================================================
async function spin() {
  if (busy) return;

  refreshOptions();

  if (inputError) {
    setSpinMessage(inputError, true);
    return;
  }

  if (!eligible.length) {
    setSpinMessage("請先填入至少一個有正機率的選項。", true);
    return;
  }

  if (!globalThis.crypto?.getRandomValues) {
    setSpinMessage(
      "此瀏覽器無法使用安全隨機抽取，請使用新版 Chrome、Edge 或 Safari。",
      true
    );
    return;
  }

  saveData();

  setBusy(true);
  renderResult();
  setSpinMessage("運氣正在替你安排答案…");

  try {
    const index = chooseIndex();
    const selected = eligible[index];

    await animateWheel(index);

    result = {
      name: selected.name,
      probability: selected.probability
    };

    setSpinMessage("答案出來了！");
    saveData();
  } catch {
    setSpinMessage("這次轉動中斷，請再試一次。", true);
  } finally {
    setBusy(false);
    renderResult(true);
  }
}

// =====================================================
// 輸入與操作事件
// =====================================================
$("#options").addEventListener("input", () => {
  rotation = 0;
  refreshOptions();
  setSpinMessage("");

  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 350);
});

$("#options").addEventListener("change", saveData);

$("#save-options").addEventListener("click", () => {
  refreshOptions();
  saveData();
});

$("#sample-options").addEventListener("click", () => {
  $("#options").value =
    "吃拉麵(40%)\n吃火鍋\n吃咖哩";

  rotation = 0;
  refreshOptions();
  saveData();
  setSpinMessage("");
});

$("#spin").addEventListener("click", spin);

// =====================================================
// 啟動
// =====================================================
loadData();
refreshOptions();
renderResult();