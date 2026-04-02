// Короткий хелпер: получить элемент по id
const $ = (id) => document.getElementById(id);

// Кэшируем элементы интерфейса popup'а
const logEl = $("log");        // контейнер лога
const autoBtn = $("auto");     // кнопка "Авто"
const stepEl = $("step");      // input шага скролла
const waitEl = $("wait");      // input задержки
const imgEl = $("img");        // input размера картинки

// Добавляет строку в лог внутри popup'а
// msg — текст сообщения, cls — CSS‑класс (\"ok\", \"err\" и т.п.)
function log(msg, cls="") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight; // скроллим лог вниз
}

// Выполняет fn с id активной вкладки (используется для отправки сообщений content‑script'у)
async function withActiveTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Активная вкладка не найдена");
  return fn(tab);
}

// Отправляет сообщение в content‑script на вкладке
// type — \"WB_1688_AUTO\" или \"WB_1688_EXPORT\"
// вместе с ним передаём step и wait из полей настроек
function is1688Tab(tab) {
  return /^https:\/\/([^/]+\.)?1688\.com\//i.test(String(tab?.url || ""));
}

function isMissingReceiverError(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || ""));
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["content.js"]
  });
}

async function send(tab, type) {
  const step = Number(stepEl.value || 900);
  const wait = Number(waitEl.value || 650);
  const payload = { type, step, wait };

  try {
    return await chrome.tabs.sendMessage(tab.id, payload, { frameId: 0 });
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    if (!is1688Tab(tab)) {
      throw new Error("Открой страницу 1688 с заказами или корзиной и повтори.");
    }

    await ensureContentScript(tab.id);
    return chrome.tabs.sendMessage(tab.id, payload, { frameId: 0 });
  }
}

// Универсальный парсер числа из строки (учитывает запятую и точку)
function parseNumber(value) {
  const cleaned = String(value || "").replace(/,/g, ".");
  const match = cleaned.match(/(\d+[.]\d+|\d+)/);
  return match ? Number(match[1]) : 0;
}

// Определяет разделитель столбцов в первой строке (таб, ; или ,)
function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

// Распаковывает ZIP (XLSX) в Map<имя файла, Uint8Array>
// Минимальный парсер структуры ZIP: ищет End of Central Directory, затем Central Directory и локальные заголовки
async function unzipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;

  // Ищем EOCD с конца файла (ограничение 64К — спецификация ZIP)
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (view.getUint32(i, true) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  
  if (eocdOffset === -1) throw new Error("Не удалось найти конец ZIP.");
  
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);

  const entries = [];
  let offset = centralDirOffset;

  // Читаем центральный каталог (описания всех файлов)
  for (let i = 0; i < totalEntries; i++) {
    const sig = view.getUint32(offset, true);
    
    if (sig !== 0x02014b50) break; // сигнатура центрального заголовка
    
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    
    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    
    offset += 46 + nameLen + extraLen + commentLen;
  }

  const files = new Map();

  // По каждой записи из центрального каталога читаем локальный заголовок и данные файла
  for (const entry of entries) {
    const localSig = view.getUint32(entry.localHeaderOffset, true);
    if (localSig !== 0x04034b50) continue; // сигнатура локального заголовка
    
    const nameLen = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLen = view.getUint16(entry.localHeaderOffset + 28, true);
    const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
    
    const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
    let data;
    
    if (entry.compression === 0) {
      // Без сжатия (store)
      data = compressed;
    } else if (entry.compression === 8) {
      // Deflate (используем DecompressionStream)
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      data = new Uint8Array(buffer);
    } else {
      // Другие типы сжатия не поддерживаются
      throw new Error(`Неподдерживаемое сжатие: ${entry.compression}`);
    }
    
    files.set(entry.name, data);
  }
  
  return files;
}

// Переводит буквенное имя колонки Excel (A, B, AA, AB) в индекс (0-based)
function columnLettersToIndex(letters) {
  let result = 0;
  
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  
  return result - 1;
}

// Разбирает sharedStrings.xml из XLSX в массив строк sharedStrings[index]
function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const items = Array.from(doc.getElementsByTagName("si"));
  
  return items.map((item) => {
    const texts = Array.from(item.getElementsByTagName("t")).map((t) => t.textContent || "");
    
    return texts.join("");
  });
}

// Разбирает XML листа (sheetN.xml) в двумерный массив строк (ячейки строк/колонок)
// Использует sharedStrings для t="s"
function parseSheetXml(xmlText, sharedStrings) {
  const rows = [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const rowEls = Array.from(doc.getElementsByTagName("row"));
  
  rowEls.forEach((rowEl) => {
    const cells = Array.from(rowEl.getElementsByTagName("c"));
    if (!cells.length) return;
    
    const row = [];
    
    cells.forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const match = ref.match(/([A-Z]+)\d+/);
      if (!match) return;
      
      const colIndex = columnLettersToIndex(match[1]);
      const type = cell.getAttribute("t") || "n";
      let value = "";
      
      const vEl = cell.getElementsByTagName("v")[0];
      const isEl = cell.getElementsByTagName("is")[0];
      
      if (type === "s") {
        // Ссылка на sharedStrings
        const idx = vEl ? Number(vEl.textContent || 0) : 0;
        value = sharedStrings[idx] || "";
      } else if (type === "inlineStr") {
        // Встроенная строка в <is><t>
        const tEl = isEl ? isEl.getElementsByTagName("t")[0] : null;
        value = tEl ? tEl.textContent || "" : "";
      } else {
        // Число/обычное значение
        value = vEl ? vEl.textContent || "" : "";
      }
      
      row[colIndex] = value;
    });

    // Добавляем строку только если в ней есть хоть что-то непустое
    if (row.some((cell) => String(cell || "").trim())) {
      rows.push(row.map((cell) => String(cell ?? "")));
    }
  });
  
  return rows;
}

// Проверка, что файл — XLSX/XLSM
function isXlsxFile(file) {
  return /\.(xlsx|xlsm)$/i.test(file.name || "");
}

// Экранирует спецсимволы для вставки в XML
function xmlEscape(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }

// Переводит номер колонки (1-based) в имя A, B, ..., AA, AB
function colName(n){ let s=""; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; }

// Конвертирует Blob картинки в PNG‑байты через canvas
function toPngBytes(blob){
  return createImageBitmap(blob).then((bmp) => {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    return new Promise((res) => canvas.toBlob(res, "image/png", 0.92));
  }).then((pngBlob) => pngBlob.arrayBuffer()).then((buf) => new Uint8Array(buf)).catch(() => null);
}

// Загружает картинку по URL, определяет тип и возвращает { bytes, ext }.
// Если тип не PNG/JPEG — пытается перекодировать в PNG.
async function fetchImageAsBytes(url){
  if (!url) return null;
  try{
    const res = await fetch(url, { credentials:"omit", cache:"force-cache" });
    if (!res.ok) return null;
    
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const blob = await res.blob();
    
    if (ct.includes("png")){
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext:"png" };
    }
    
    if (ct.includes("jpeg") || ct.includes("jpg")){
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext:"jpg" };
    }
    
    const pngBytes = await toPngBytes(blob);
    if (pngBytes) return { bytes: pngBytes, ext:"png" };
    return null;
  } catch { return null; }
}

// Таблица для расчёта CRC32 (используется при сборке ZIP)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { 
    let c= i;
    
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    
    t[i]=c>>>0; 
  }
  
  return t;
})();

// Вычисляет CRC32 для массива байт (ZIP‑совместимый)
function crc32(buf) {
  let crc = 0 ^ (-1); 
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF]
  } 
  
  return (crc ^ (-1))>>>0; 
}

// Утилиты для записи чисел little-endian
function u16(n){ return new Uint8Array([n & 255, (n>>>8)&255]); }
function u32(n){ return new Uint8Array([n & 255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255]); }

// Кодирует строку в UTF‑8
function encodeUTF8(s){ return new TextEncoder().encode(s); }

// Конкатенация нескольких Uint8Array в один
function concat(parts){
  let total = 0;
  for(const p of parts) total += p.length; 
  
  const out=new Uint8Array(total);
  let off=0;
  
  for(const p of parts) {
    out.set(p,off); off+=p.length;
  }
  
  return out; 
}

// Собирает ZIP‑архив без сжатия из списка файлов [{name, data}]
function zipStore(files){
  let offset=0;
  const localParts=[];
  const centralParts=[];
  
  for(const f of files){
    const nameBytes=encodeUTF8(f.name);
    const data=f.data;
    const crc=crc32(data);
    const size=data.length;

    // Локальный заголовок файла
    const localHeader=concat([
        u32(0x04034b50), // сигнатура
      u16(20),         // версия
      u16(0),          // флаги
      u16(0),          // метод сжатия (0 = store)
      u16(0), u16(0),  // время/дата
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),          // extra length
      nameBytes
    ]);
    localParts.push(localHeader,data);

    // Запись в центральном каталоге
    const centralHeader=concat([
        u32(0x02014b50), // сигнатура
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);
    
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  
  const centralDir=concat(centralParts);
  const end=concat([
      u32(0x06054b50), // EOCD
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);
  
  return concat([...localParts, centralDir, end]);
}

// Формирует XML листа Excel (sheet) с данными заказов
// rows       — массив объектов (title, imgUrl, qty и т.п.)
// hasDrawing — есть ли привязанные картинки
// imgPx      — размер картинки в px (для высоты строки/ширины колонки)
// drawingRelId — Id связи на drawing в .rels (если есть)
function makeSheetXMLLegacy(rows, hasDrawing, imgPx, drawingRelId="rId2"){
  const rowHeightPt = imgPx ? (imgPx * 0.75) : null;      // примерная конверсия px в 
  const imgColWidth = imgPx ? Math.max((imgPx - 5) / 7, 3) : null; // ширина колонки с картинкой
  let rowsXml="";

  // Первая строка: заголовки колонок (contentHeaders предполагается задан где‑то выше)
  let r1 = `<row r="1">`;
  for (let c = 1; c <= contentHeaders.length; c++) {
    const v = contentHeaders[c - 1] || "";
    const ref = colName(c) + "1";
    r1 += `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(v)}</t></is></c>`;
  }
  r1 += `</row>`;
  rowsXml += r1;

  // Дальше строки с данными (каждому объекту rows соответствует одна строка)
  for(let i=0;i<rows.length;i++){
    const r=2+i; const d=rows[i]; // данные начинаются со 2-й строки
    const cells=[];

    // Колонки: можно видеть по коду, что где (например, A — title, B — link, C — variant, и т.д.)
    // B: Ссылка (обычный стиль)
    cells.push({c:2,t:"inlineStr",v:d.link||"", s:"1"});
    // C: Название на 1688 (обычный стиль)
    cells.push({c:3,t:"inlineStr",v:d.variant||"", s:"1"});
    // D: Количество (обычный стиль)
    cells.push({c:4,t:"n",v:Number(d.qty||0), s:"0"});
    // E: Цена за ед. (юань)
    cells.push({c:5,t:"n",v:Number(d.unitPrice||0), s:"2"});
    // F: Доставка по Китаю (юань)
    cells.push({c:6,t:"n",v:Number(d.shippingShare||0), s:"2"});
    // G: Скидка (юань)
    cells.push({c:7,t:"n",v:Number(d.discountShare||0), s:"2"});

    // 8‑я колонка — totalYuan: либо число, либо формула H*I
    // if(Number(d.totalYuan||0)>0) cells.push({c:8,t:"n",v:Number(d.totalYuan)});
    // else cells.push({c:8,t:"f",f:`H${rr}*I${rr}`});

    // H: Итого юань = Количество * Цена + Доставка - Скидка (формула, юань)
    cells.push({c:8, t:"f", f:`D${r}*E${r}+F${r}-G${r}`, s:"2"});

    let rx=`<row r="${r}"`;
    if (rowHeightPt) rx += ` ht="${rowHeightPt.toFixed(2)}" customHeight="1"`;
    rx += `>`;

    for (const cell of cells) {
      const ref = colName(cell.c) + r;
      if (cell.t === "n")
        rx += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      else if (cell.t === "f")
        rx += `<c r="${ref}" s="${cell.s}"><f>${cell.f}</f></c>`;
      else
        rx += `<c r="${ref}" t="inlineStr" s="${cell.s}"><is><t>${xmlEscape(cell.v)}</t></is></c>`;
    }
    rx += `</row>`;
    rowsXml += rx;
  }
  
  const colsXml = `<cols>
  <col min="1" max="1" width="${imgColWidth ? imgColWidth.toFixed(2) : '30'}" customWidth="1"/>
  <col min="2" max="2" width="24" customWidth="1"/>
  <col min="3" max="3" width="24" customWidth="1"/>
  <col min="4" max="4" width="11.5" customWidth="1"/>
  <col min="5" max="5" width="11.5" customWidth="1"/>
  <col min="6" max="6" width="17.3" customWidth="1"/>
  <col min="7" max="7" width="8.3" customWidth="1"/>
  <col min="8" max="8" width="11" customWidth="1"/>
</cols>\n`;
  const drawingTag = hasDrawing ? `<drawing r:id="${drawingRelId}"/>\n` : "";

  // Обёртка всего листа в стандартный XML sheet
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n`+
    colsXml+
    `  <sheetData>\n${rowsXml}\n  </sheetData>\n`+
    drawingTag+
    `</worksheet>`;
}

// Генерирует XML отношений для drawing (drawingN.xml.rels) — связи с картинками imageN.ext
function makeDrawingRels(imageNames){
  let rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n`;
  for(let i=0;i<imageNames.length;i++){
    const rId="rId"+(i+1);
    rels += `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${imageNames[i]}"/>\n`;
  }
  rels += `</Relationships>`;
  return rels;
}

// Формирует XML отношений листа (sheetX.xml.rels) с drawing (или пустой,
// если drawingTarget не задан)
function makeSheetRelsXml(drawingTarget, drawingRelId="rId1") {
  if (!drawingTarget) {
    // Нет рисунков — пустой контейнер Relationships
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`+
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }

  // Один Relationship на drawing
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`+
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n`+
    `  <Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${drawingTarget}"/>\n`+
    `</Relationships>`;
}

// Обновляет/создаёт sheetX.xml.rels, правильно добавляя/обновляя ссылку на drawing
function updateSheetRels(xmlText, drawingTarget, desiredRelId="rId2") {
  const parser = new DOMParser();
  const namespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  
  const doc = xmlText
    ? parser.parseFromString(xmlText, "application/xml")
    : document.implementation.createDocument(namespace, "Relationships", null);
  
  if (doc.getElementsByTagName("parsererror").length) {
    // Если парсинг не удался — возвращаем исходный XML без изменений
    return { xml: xmlText, relId: desiredRelId };
  }
  
  const relsEl = doc.getElementsByTagName("Relationships")[0] || doc.documentElement;
  relsEl.setAttribute("xmlns", namespace);
  
  const rels = Array.from(relsEl.getElementsByTagName("Relationship"));
  const drawingType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
  const drawingRels = rels.filter((rel) => rel.getAttribute("Type") === drawingType);
  const existingDrawing = drawingRels[0] || null;

  // Если нужно удалить связь с drawing
  if (!drawingTarget) {
    drawingRels.forEach((rel) => rel.remove());
    return { xml: new XMLSerializer().serializeToString(doc), relId: null };
  }
  
  if (existingDrawing) {
    // Обновляем существующую связь на новый Target и, при необходимости, Id
    const usedIds = new Set(rels.map((rel) => rel.getAttribute("Id")));
    let relId = existingDrawing.getAttribute("Id") || desiredRelId;
    
    if (desiredRelId && relId !== desiredRelId && !usedIds.has(desiredRelId)) {
      relId = desiredRelId;
      existingDrawing.setAttribute("Id", desiredRelId);
    }
    
    existingDrawing.setAttribute("Target", drawingTarget);
    // Удаляем все остальные связи drawing, оставляя одну
    drawingRels.slice(1).forEach((rel) => rel.remove());
    
    return { xml: new XMLSerializer().serializeToString(doc), relId };
  }

  // Иначе создаём новую связь
  const maxId = rels.reduce((max, rel) => {
    const match = (rel.getAttribute("Id") || "").match(/rId(\d+)/);
    const num = match ? Number(match[1]) : 0;
    return Math.max(max, num);
  }, 0);
  const usedIds = new Set(rels.map((rel) => rel.getAttribute("Id")));
  const relId = desiredRelId && !usedIds.has(desiredRelId) ? desiredRelId : `rId${maxId + 1}`;
  
  const relEl = doc.createElementNS(namespace, "Relationship");
  relEl.setAttribute("Id", relId);
  relEl.setAttribute("Type", drawingType);
  relEl.setAttribute("Target", drawingTarget);
  relsEl.appendChild(relEl);
  
  return { xml: new XMLSerializer().serializeToString(doc), relId };
}

// Обновляет [Content_Types].xml: добавляет типы для картинок и drawing,
// если их ещё нет
function updateContentTypes(xmlText, drawingPartName, imageExts) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText || "", "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    return xmlText;
  }
  
  const typesEl = doc.getElementsByTagName("Types")[0];
  if (!typesEl) return xmlText;
  
  const defaults = Array.from(typesEl.getElementsByTagName("Default"));
  const overrides = Array.from(typesEl.getElementsByTagName("Override"));
  const namespace = "http://schemas.openxmlformats.org/package/2006/content-types";
  
  const hasDefault = (ext) => defaults.some((el) => el.getAttribute("Extension") === ext);
  const hasOverride = (part) => overrides.some((el) => el.getAttribute("PartName") === part);

  // Добавляем записи для расширений картинок (png/jpg)
  imageExts.forEach((ext) => {
    if (!hasDefault(ext)) {
      const el = doc.createElementNS(namespace, "Default");
      el.setAttribute("Extension", ext);
      el.setAttribute("ContentType", ext === "png" ? "image/png" : "image/jpeg");
      typesEl.appendChild(el);
    }
  });

  // Добавляем Override для drawingN.xml
  if (drawingPartName && !hasOverride(drawingPartName)) {
    const el = doc.createElementNS(namespace, "Override");
    el.setAttribute("PartName", drawingPartName);
    el.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.drawing+xml");
    typesEl.appendChild(el);
  }
  
  return new XMLSerializer().serializeToString(doc);
}

// Собирает XLSX с данными rows и, опционально, картинками.
// imgPx        — размер картинки в px (для ячеек)
async function buildAndDownload(rows, imgPx, pageType="orders"){
  const images = [];
  const maxImages = Math.min(rows.length, 300); // ограничиваем число встраиваемых картинок

  // Загружаем картинки для первых maxImages строк
  for(let i=0;i<maxImages;i++){
    const imgUrl = rows[i].imgUrl;
    const img = await fetchImageAsBytes(imgUrl);
    if(img){
      //images.push(img);
      images.push({rowIndex: i, ...img});
    } else {
      images.push(null);
    }
  }

  // формируем структуру для привязки картинок к строкам (embedded, embeddedRowIdx и т.п.)
  const embedded = [];
  const embeddedRowIdx = [];
  
  for(let i=0;i<images.length;i++){
    if(images[i]) {
      embedded.push(images[i]); 
      embeddedRowIdx.push(i); 
    }
  }

  // создаёт рисунки-анкеры
  // в листе, привязывая каждую картинку к своей строке.
  function makeDrawingXMLMapped(imgCount, imgPx, rowIdx){
    const cx=Math.round(imgPx*9525), cy=Math.round(imgPx*9525);
    let anchors="";
    for(let i=0;i<imgCount;i++){
      const row0=1 + rowIdx[i]; // 0‑based, но у нас первая строка — заголовки
      const col0 = 0;             // колонка A = 0
      const picId= 1000 + i;
      const rId = "rId" + (i + 1);
      
      anchors +=
`  <xdr:twoCellAnchor>
    <xdr:from>
      <xdr:col>${col0}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${row0}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>${col0+1}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${row0+1}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="${picId}" name="Picture ${i+1}"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="${rId}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>\n`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`+
`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n${anchors}</xdr:wsDr>`;
  }

  const hasDrawing = embedded.length>0;

  // contentTypes, rels, wbXml, wbRels, sheetRels — стандартные служебные XML‑файлы
  const contentTypes =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`+
  (hasDrawing?`\n  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`:"")+
`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
\n</Types>`;

  const rels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Товары" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const wbRels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const sheetRels = hasDrawing
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  // Генерируем XML листа с нашими строками (без картинок или с ними — не важно)
  //const sheetXml = makeSheetXML(rows, hasDrawing, imgPx, "rId1");
  const sheetXml = makeSheetXML(rows, hasDrawing, imgPx, "rId2", pageType);

  const stylesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="¥#,##0.00"/>
  </numFmts>
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"
       applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"
       applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"
       applyNumberFormat="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  const files = [
    {name:"[Content_Types].xml", data:encodeUTF8(contentTypes)},
    {name:"_rels/.rels", data:encodeUTF8(rels)},
    {name:"xl/workbook.xml", data:encodeUTF8(wbXml)},
    {name:"xl/_rels/workbook.xml.rels", data:encodeUTF8(wbRels)},
    {name:"xl/worksheets/sheet1.xml", data:encodeUTF8(sheetXml)},
    {name:"xl/styles.xml", data:encodeUTF8(stylesXml)},
  ];

  let imagesEmbedded = 0;
  if(hasDrawing){
    const drawingXml = makeDrawingXMLMapped(embedded.length, imgPx, embeddedRowIdx);
    const imageNames = embedded.map((img, idx) => `image${idx + 1}.${img.ext}`);
    const drawingRels = makeDrawingRels(imageNames);
    
    files.push({name:"xl/worksheets/_rels/sheet1.xml.rels", data:encodeUTF8(sheetRels)});
    files.push({name:"xl/drawings/drawing1.xml", data:encodeUTF8(drawingXml)});
    files.push({name:"xl/drawings/_rels/drawing1.xml.rels", data:encodeUTF8(drawingRels)});
    
    for(let i=0;i<embedded.length;i++){
      files.push({name:`xl/media/${imageNames[i]}`, data:embedded[i].bytes});
      imagesEmbedded++;
    }
  }

  const xlsxBytes = zipStore(files);
  const blob = new Blob([xlsxBytes], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename:"1688_parsed_Товары.xlsx", saveAs:true });
  
  return imagesEmbedded;
}

const contentHeaders = ["Картинка", "Ссылка", "Название на 1688", "Количество", "Цена за ед.", "Доставка по Китаю", "Скидка", "Итого юань"];

// Универсальная обёртка: запускает экспорт по активной вкладке
// type  — WB_1688_AUTO или WB_1688_EXPORT
// label — сообщение в лог на время выполнения
const ORDER_EXPORT_CONFIG = {
  headers: ["Картинка", "Ссылка", "Название на 1688", "Количество", "Цена за ед.", "Доставка по Китаю", "Скидка", "Итого юань"],
  widths: (imgColWidth) => [imgColWidth ? imgColWidth.toFixed(2) : "30", "24", "24", "11.5", "11.5", "17.3", "8.3", "11"],
  buildCells: (row, excelRow) => ([
    { c: 2, t: "inlineStr", v: row.link || "", s: "1" },
    { c: 3, t: "inlineStr", v: row.exportTitle || row.variant || row.title || "", s: "1" },
    { c: 4, t: "n", v: Number(row.qty || 0), s: "0" },
    { c: 5, t: "n", v: Number(row.unitPrice || 0), s: "2" },
    { c: 6, t: "n", v: Number(row.shippingShare || 0), s: "2" },
    { c: 7, t: "n", v: Number(row.discountShare || 0), s: "2" },
    { c: 8, t: "f", f: `D${excelRow}*E${excelRow}+F${excelRow}-G${excelRow}`, s: "2" }
  ])
};

const CART_EXPORT_CONFIG = {
  headers: ["Картинка", "Ссылка", "Название на 1688"],
  widths: (imgColWidth) => [imgColWidth ? imgColWidth.toFixed(2) : "30", "28", "60"],
  buildCells: (row) => ([
    { c: 2, t: "inlineStr", v: row.link || "", s: "1" },
    { c: 3, t: "inlineStr", v: row.exportTitle || row.variant || row.title || "", s: "1" }
  ])
};

function getExportConfig(pageType) {
  return pageType === "cart" ? CART_EXPORT_CONFIG : ORDER_EXPORT_CONFIG;
}

function makeSheetXML(rows, hasDrawing, imgPx, drawingRelId="rId2", pageType="orders"){
  const rowHeightPt = imgPx ? (imgPx * 0.75) : null;
  const imgColWidth = imgPx ? Math.max((imgPx - 5) / 7, 3) : null;
  const exportConfig = getExportConfig(pageType);
  const widths = exportConfig.widths(imgColWidth);
  let rowsXml = "";

  let headerRowXml = `<row r="1">`;
  for (let c = 1; c <= exportConfig.headers.length; c++) {
    const ref = colName(c) + "1";
    const value = exportConfig.headers[c - 1] || "";
    headerRowXml += `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(value)}</t></is></c>`;
  }
  headerRowXml += `</row>`;
  rowsXml += headerRowXml;

  for (let i = 0; i < rows.length; i++) {
    const excelRow = 2 + i;
    const row = rows[i];
    const cells = exportConfig.buildCells(row, excelRow);
    let rowXml = `<row r="${excelRow}"`;
    
    if (rowHeightPt) rowXml += ` ht="${rowHeightPt.toFixed(2)}" customHeight="1"`;
    rowXml += `>`;

    for (const cell of cells) {
      const ref = colName(cell.c) + excelRow;
      if (cell.t === "n") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else if (cell.t === "f") {
        rowXml += `<c r="${ref}" s="${cell.s}"><f>${cell.f}</f></c>`;
      } else {
        rowXml += `<c r="${ref}" t="inlineStr" s="${cell.s}"><is><t>${xmlEscape(cell.v)}</t></is></c>`;
      }
    }

    rowXml += `</row>`;
    rowsXml += rowXml;
  }

  const colsXml = `<cols>\n${widths.map((width, index) => {
    const col = index + 1;
    return `  <col min="${col}" max="${col}" width="${width}" customWidth="1"/>`;
  }).join("\n")}\n</cols>\n`;
  const drawingTag = hasDrawing ? `<drawing r:id="${drawingRelId}"/>\n` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n`+
    colsXml+
    `  <sheetData>\n${rowsXml}\n  </sheetData>\n`+
    drawingTag+
    `</worksheet>`;
}

async function runTabExportLegacy(type, label) {
  logEl.innerHTML = "";
  try{
    autoBtn.disabled = true;
    log(label);

    // Получаем данные с активной вкладки
    const resp = await withActiveTab((tabId) => send(tabId, type));
    if (!resp?.ok) throw new Error(resp?.error || "Ошибка");

    const rows = Array.isArray(resp.rows) ? resp.rows : [];
    if (!rows.length) throw new Error("Не удалось собрать строки из вкладки.");

    const imgPx = Number(imgEl.value || 200); // по умолчанию 200

    log(`order-item-content: ${resp.orders}`, "ok");
    log(`order-item-entry: ${resp.entries}`, "ok");
    log(`rows: ${rows.length}`, "ok");

    // просто строим и скачиваем Excel
    const images = await buildAndDownload(rows, imgPx);
    log(`images embedded: ${images}`, "ok");
    log("Готово.", "ok");
  } catch (e) {
    log(String(e?.message || e), "err");
  } finally {
    autoBtn.disabled = false;
  }
}

// Обработчик кнопки "Авто" — автоскролл + сбор заказов
async function runTabExport(type, label) {
  logEl.innerHTML = "";
  try{
    autoBtn.disabled = true;
    log(label);

    const resp = await withActiveTab((tabId) => send(tabId, type));
    if (!resp?.ok) throw new Error(resp?.error || "Ошибка");

    const rows = Array.isArray(resp.rows) ? resp.rows : [];
    if (!rows.length) {
      if (resp.pageType === "cart") throw new Error("Не удалось собрать отмеченные товары из корзины.");
      if (resp.pageType === "unknown") throw new Error("На вкладке не найдены ни заказы, ни корзина 1688.");
      throw new Error("Не удалось собрать строки из вкладки.");
    }

    const imgPx = Number(imgEl.value || 200);
    const sectionLabel = resp.pageType === "cart" ? "cart groups" : "order-item-content";
    const entryLabel = resp.pageType === "cart" ? "cart items" : "order-item-entry";

    log(`${sectionLabel}: ${resp.blocks ?? resp.orders ?? 0}`, "ok");
    log(`${entryLabel}: ${resp.entries ?? 0}`, "ok");
    if (resp.pageType === "cart") log(`selected cart items: ${resp.selectedEntries ?? rows.length}`, "ok");
    log(`rows: ${rows.length}`, "ok");

    const images = await buildAndDownload(rows, imgPx, resp.pageType || "orders");
    log(`images embedded: ${images}`, "ok");
    log("Готово.", "ok");
  } catch (e) {
    log(String(e?.message || e), "err");
  } finally {
    autoBtn.disabled = false;
  }
}

autoBtn.addEventListener("click", async () => {
  await runTabExport("WB_1688_AUTO", "Авто-режим…");
});
