const ECL = {
  L: { format: 1, ecc: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  M: { format: 0, ecc: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
  Q: { format: 3, ecc: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], blocks: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8] },
  H: { format: 2, ecc: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28], blocks: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] },
};

const ALIGNMENT_POSITIONS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const encoder = new TextEncoder();

const els = {
  form: document.querySelector("#qrForm"),
  status: document.querySelector("#statusText"),
  text: document.querySelector("#qrText"),
  textCount: document.querySelector("#textCount"),
  size: document.querySelector("#qrSize"),
  sizeOutput: document.querySelector("#sizeOutput"),
  margin: document.querySelector("#qrMargin"),
  marginOutput: document.querySelector("#marginOutput"),
  fgColor: document.querySelector("#fgColor"),
  bgColor: document.querySelector("#bgColor"),
  fgText: document.querySelector("#fgText"),
  bgText: document.querySelector("#bgText"),
  live: document.querySelector("#livePreview"),
  canvas: document.querySelector("#qrCanvas"),
  meta: document.querySelector("#qrMeta"),
  message: document.querySelector("#messageBox"),
  reset: document.querySelector("#resetButton"),
  png: document.querySelector("#downloadPng"),
  svg: document.querySelector("#downloadSvg"),
  copy: document.querySelector("#copyImage"),
  wifiSsid: document.querySelector("#wifiSsid"),
  wifiPassword: document.querySelector("#wifiPassword"),
  wifiSecurity: document.querySelector("#wifiSecurity"),
  wifiHidden: document.querySelector("#wifiHidden"),
};

let currentQr = null;
let currentSvg = "";
let activeTab = "text";

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

class BitBuffer {
  constructor() {
    this.bits = [];
  }

  append(value, length) {
    if (length < 0 || value >>> length !== 0) throw new RangeError("Invalid bit append");
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  appendByte(byte) {
    this.append(byte, 8);
  }

  toCodewords() {
    const result = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j++) value = (value << 1) | (this.bits[i + j] || 0);
      result.push(value);
    }
    return result;
  }
}

class QrMatrix {
  constructor(version, eclKey, dataCodewords) {
    this.version = version;
    this.eclKey = eclKey;
    this.size = 17 + version * 4;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.functionModules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.drawFunctionPatterns();
    this.drawCodewords(dataCodewords);
    this.applyBestMask();
  }

  setFunctionModule(x, y, black) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.modules[y][x] = black;
    this.functionModules[y][x] = true;
  }

  drawFunctionPatterns() {
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    for (let i = 8; i < this.size - 8; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    const positions = ALIGNMENT_POSITIONS[this.version];
    const last = positions.length - 1;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.drawAlignmentPattern(positions[i], positions[j]);
      }
    }

    for (let i = 0; i < 8; i++) {
      this.setFunctionModule(8, i, false);
      this.setFunctionModule(i, 8, false);
      this.setFunctionModule(this.size - 1 - i, 8, false);
      this.setFunctionModule(8, this.size - 1 - i, false);
    }
    this.setFunctionModule(8, 8, false);
    this.setFunctionModule(8, this.size - 8, true);

    if (this.version >= 7) this.drawVersion();
  }

  drawFinderPattern(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        this.setFunctionModule(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignmentPattern(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunctionModule(cx + dx, cy + dy, dist !== 1);
      }
    }
  }

  drawVersion() {
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  drawFormat(mask) {
    const data = (ECL[this.eclKey].format << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  }

  drawCodewords(data) {
    let bitIndex = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        const y = ((right + 1) & 2) === 0 ? this.size - 1 - vert : vert;
        for (let x = right; x > right - 2; x--) {
          if (this.functionModules[y][x]) continue;
          const black = bitIndex < data.length * 8 && getBit(data[Math.floor(bitIndex / 8)], 7 - (bitIndex % 8));
          this.modules[y][x] = black;
          bitIndex++;
        }
      }
    }
  }

  applyBestMask() {
    const original = this.modules.map((row) => row.slice());
    let bestMask = 0;
    let bestPenalty = Infinity;
    let bestModules = null;

    for (let mask = 0; mask < 8; mask++) {
      this.modules = original.map((row) => row.slice());
      this.applyMask(mask);
      this.drawFormat(mask);
      const penalty = this.getPenaltyScore();
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestModules = this.modules.map((row) => row.slice());
      }
    }

    this.modules = bestModules;
    this.drawFormat(bestMask);
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.functionModules[y][x] && maskCondition(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  getPenaltyScore() {
    let result = 0;

    for (let y = 0; y < this.size; y++) result += penaltyRuns(this.modules[y]);
    for (let x = 0; x < this.size; x++) result += penaltyRuns(this.modules.map((row) => row[x]));

    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) {
          result += 3;
        }
      }
    }

    for (let y = 0; y < this.size; y++) result += penaltyFinder(this.modules[y]);
    for (let x = 0; x < this.size; x++) result += penaltyFinder(this.modules.map((row) => row[x]));

    const dark = this.modules.flat().filter(Boolean).length;
    result += Math.floor(Math.abs(dark * 20 - this.size * this.size * 10) / (this.size * this.size)) * 10;
    return result;
  }
}

function penaltyRuns(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;
  for (let i = 1; i < line.length; i++) {
    if (line[i] === runColor) {
      runLength++;
    } else {
      if (runLength >= 5) penalty += 3 + runLength - 5;
      runColor = line[i];
      runLength = 1;
    }
  }
  if (runLength >= 5) penalty += 3 + runLength - 5;
  return penalty;
}

function penaltyFinder(line) {
  let penalty = 0;
  const patterns = ["10111010000", "00001011101"];
  const text = line.map((value) => (value ? "1" : "0")).join("");
  for (const pattern of patterns) {
    let index = text.indexOf(pattern);
    while (index !== -1) {
      penalty += 40;
      index = text.indexOf(pattern, index + 1);
    }
  }
  return penalty;
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new RangeError("Invalid mask");
  }
}

function getDataCodewords(version, eclKey) {
  const ecl = ECL[eclKey];
  return TOTAL_CODEWORDS[version] - ecl.ecc[version] * ecl.blocks[version];
}

function encodeData(text, eclKey) {
  const bytes = Array.from(encoder.encode(text));
  if (bytes.length === 0) throw new Error("内容を入力してください。");

  let version = 1;
  for (; version <= 10; version++) {
    const countBits = version < 10 ? 8 : 16;
    const neededBits = 4 + countBits + bytes.length * 8;
    if (neededBits <= getDataCodewords(version, eclKey) * 8) break;
  }
  if (version > 10) {
    throw new Error("このアプリはバージョン10まで対応しています。内容を短くするか、誤り訂正レベルを下げてください。");
  }

  const dataCapacityBits = getDataCodewords(version, eclKey) * 8;
  const bb = new BitBuffer();
  bb.append(0x4, 4);
  bb.append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) bb.appendByte(byte);
  bb.append(0, Math.min(4, dataCapacityBits - bb.bits.length));
  while (bb.bits.length % 8 !== 0) bb.append(0, 1);

  const padBytes = [0xec, 0x11];
  for (let i = 0; bb.bits.length < dataCapacityBits; i++) bb.appendByte(padBytes[i % 2]);

  return {
    version,
    bytes,
    codewords: addErrorCorrectionAndInterleave(bb.toCodewords(), version, eclKey),
  };
}

function addErrorCorrectionAndInterleave(data, version, eclKey) {
  const ecl = ECL[eclKey];
  const numBlocks = ecl.blocks[version];
  const blockEccLen = ecl.ecc[version];
  const rawCodewords = TOTAL_CODEWORDS[version];
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const generator = reedSolomonGenerator(blockEccLen);
  const blocks = [];

  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(offset, offset + dataLen);
    offset += dataLen;
    const ecc = reedSolomonRemainder(dat, generator);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (const block of blocks) {
      if (i !== shortBlockLen - blockEccLen || block.length !== shortBlockLen) result.push(block[i]);
    }
  }
  return result;
}

function reedSolomonGenerator(degree) {
  let result = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    result.push(0);
    for (let j = result.length - 1; j > 0; j--) {
      result[j] = result[j - 1] ^ gfMultiply(result[j], root);
    }
    result[0] = gfMultiply(result[0], root);
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, generator) {
  const result = Array(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    generator.forEach((coef, index) => {
      result[index] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function makeQr(text, eclKey) {
  const encoded = encodeData(text, eclKey);
  const matrix = new QrMatrix(encoded.version, eclKey, encoded.codewords);
  return { ...encoded, size: matrix.size, modules: matrix.modules };
}

function getPayload() {
  if (activeTab === "wifi") {
    const ssid = els.wifiSsid.value.trim();
    if (!ssid) throw new Error("Wi-Fiのネットワーク名を入力してください。");
    const security = els.wifiSecurity.value;
    const password = security === "nopass" ? "" : els.wifiPassword.value;
    return `WIFI:T:${security};S:${escapeWifi(ssid)};P:${escapeWifi(password)};H:${els.wifiHidden.checked ? "true" : "false"};;`;
  }
  return els.text.value.trim();
}

function escapeWifi(value) {
  return value.replace(/([\\;,:\"])/g, "\\$1");
}

function render() {
  const payload = getPayload();
  const ecl = document.querySelector("input[name='ecl']:checked").value;
  const fg = normalizeColor(els.fgText.value);
  const bg = normalizeColor(els.bgText.value);
  const pixels = Number(els.size.value);
  const margin = Number(els.margin.value);

  currentQr = makeQr(payload, ecl);
  drawCanvas(currentQr, pixels, margin, fg, bg);
  currentSvg = buildSvg(currentQr, pixels, margin, fg, bg);

  els.textCount.textContent = String(encoder.encode(payload).length);
  els.meta.textContent = `${pixels} x ${pixels} px | QRコード バージョン ${currentQr.version} | ${currentQr.size}マス`;
  setMessage("QRコードを更新しました。");
  setStatus("準備完了", false);
}

function drawCanvas(qr, pixels, margin, fg, bg) {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  canvas.width = pixels;
  canvas.height = pixels;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pixels, pixels);

  const totalModules = qr.size + margin * 2;
  const scale = pixels / totalModules;
  ctx.fillStyle = fg;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      const left = Math.round((x + margin) * scale);
      const top = Math.round((y + margin) * scale);
      const right = Math.round((x + margin + 1) * scale);
      const bottom = Math.round((y + margin + 1) * scale);
      ctx.fillRect(left, top, right - left, bottom - top);
    }
  }
}

function buildSvg(qr, pixels, margin, fg, bg) {
  const total = qr.size + margin * 2;
  const rects = [];
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < qr.size && qr.modules[y][x]) x++;
      rects.push(`<rect x="${start + margin}" y="${y + margin}" width="${x - start}" height="1"/>`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
    `<g fill="${fg}">`,
    rects.join(""),
    `</g></svg>`,
  ].join("");
}

function normalizeColor(value) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  throw new Error("色は #000000 の形式で入力してください。");
}

function setMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

function setStatus(text, isError) {
  els.status.innerHTML = `<span class="status-dot"></span>${text}`;
  els.status.classList.toggle("error", isError);
}

function safeRender() {
  try {
    render();
  } catch (error) {
    setMessage(error.message, true);
    setStatus("要確認", true);
  }
}

function download(filename, href) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function timestampedName(extension) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `qr-code-${stamp}.${extension}`;
}

function syncColor(source, target) {
  target.value = source.value.toLowerCase();
  safeRender();
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    document.querySelectorAll(".segment").forEach((el) => {
      el.classList.toggle("active", el === button);
      el.setAttribute("aria-selected", String(el === button));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === activeTab);
    });
    safeRender();
  });
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  safeRender();
});

document.querySelectorAll("input, textarea, select").forEach((input) => {
  input.addEventListener("input", () => {
    els.sizeOutput.textContent = `${els.size.value}px`;
    els.marginOutput.textContent = `${els.margin.value}マス`;
    if (input === els.fgColor) syncColor(els.fgColor, els.fgText);
    else if (input === els.bgColor) syncColor(els.bgColor, els.bgText);
    else if (els.live.checked) safeRender();
  });
});

els.fgText.addEventListener("change", () => {
  try {
    els.fgColor.value = normalizeColor(els.fgText.value);
    safeRender();
  } catch (error) {
    setMessage(error.message, true);
  }
});

els.bgText.addEventListener("change", () => {
  try {
    els.bgColor.value = normalizeColor(els.bgText.value);
    safeRender();
  } catch (error) {
    setMessage(error.message, true);
  }
});

els.reset.addEventListener("click", () => {
  els.text.value = "https://www.example.com";
  els.wifiSsid.value = "";
  els.wifiPassword.value = "";
  els.wifiSecurity.value = "WPA";
  els.wifiHidden.checked = false;
  els.size.value = "512";
  els.margin.value = "4";
  els.fgColor.value = "#000000";
  els.bgColor.value = "#ffffff";
  els.fgText.value = "#000000";
  els.bgText.value = "#ffffff";
  document.querySelector("input[name='ecl'][value='M']").checked = true;
  els.sizeOutput.textContent = "512px";
  els.marginOutput.textContent = "4マス";
  safeRender();
});

els.png.addEventListener("click", () => {
  safeRender();
  if (currentQr) {
    download(timestampedName("png"), els.canvas.toDataURL("image/png"));
    setMessage("PNG保存を開始しました。ブラウザのダウンロードフォルダを確認してください。");
  }
});

els.svg.addEventListener("click", () => {
  safeRender();
  if (!currentSvg) return;
  const blob = new Blob([currentSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download(timestampedName("svg"), url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setMessage("SVG保存を開始しました。ブラウザのダウンロードフォルダを確認してください。");
});

els.copy.addEventListener("click", async () => {
  safeRender();
  if (!navigator.clipboard || !window.ClipboardItem) {
    setMessage("このブラウザでは画像コピーに対応していません。PNG保存を使ってください。", true);
    return;
  }
  els.canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage("画像をクリップボードにコピーしました。");
    } catch {
      setMessage("画像コピーに失敗しました。PNG保存を使ってください。", true);
    }
  }, "image/png");
});

safeRender();
