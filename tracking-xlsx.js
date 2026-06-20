(function (root) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function getMatcher() {
    if (root.WB1688TrackingMatcher) return root.WB1688TrackingMatcher;
    if (typeof require !== "undefined") return require("./tracking-matcher.js");
    return null;
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function colToIndex(col) {
    let n = 0;
    for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }
  function indexToCol(index) {
    let n = index + 1, out = "";
    while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
    return out;
  }
  function cellValue(cellXml, sharedStrings) {
    const type = (cellXml.match(/\bt="([^"]+)"/) || [])[1];
    if (type === "inlineStr") return (cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/) || [,""])[1]
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const raw = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [,""])[1];
    return type === "s" ? (sharedStrings[Number(raw)] || "") : raw;
  }
  function parseRows(xml) {
    return [...String(xml).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map((m) => ({
      row: Number(m[1]), xml: m[0], index: m.index
    }));
  }
  function parseCells(rowXml, sharedStrings) {
    return [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*\/>/g)]
      .map((m) => {
        const col = m[1] || m[3];
        return { col: colToIndex(col), row: Number(m[2] || m[4]), xml: m[0], value: cellValue(m[0], sharedStrings) };
      });
  }
  function findColumns(xml, sharedStrings) {
    const header = parseRows(xml).find((r) => r.row === 1);
    if (!header) throw new Error("В листе «Товары» нет строки заголовков.");
    const cells = parseCells(header.xml, sharedStrings);
    const order = cells.find((c) => c.value.trim() === "Номер заказа");
    const tracking = cells.find((c) => c.value.trim() === "Трек номер");
    const link = cells.find((c) => c.value.trim() === "Ссылка");
    const title = cells.find((c) => c.value.trim() === "Название на 1688");
    if (!order) throw new Error("Не найден столбец «Номер заказа».");
    return {
      orderCol: order.col,
      trackingCol: tracking?.col ?? null,
      linkCol: link?.col ?? null,
      titleCol: title?.col ?? null
    };
  }
  function extractOrderNumbersFromSheetXml(xml, sharedStrings = []) {
    const { orderCol } = findColumns(xml, sharedStrings);
    const result = [], seen = new Set();
    for (const row of parseRows(xml)) {
      if (row.row === 1) continue;
      const value = parseCells(row.xml, sharedStrings).find((c) => c.col === orderCol)?.value.trim();
      if (value && !seen.has(value)) { seen.add(value); result.push(value); }
    }
    return result;
  }
  function shiftRef(ref, insertCol) {
    return String(ref).replace(/\$?([A-Z]+)\$?(\d+)/g, (all, col, row) => {
      const index = colToIndex(col);
      return `${indexToCol(index >= insertCol ? index + 1 : index)}${row}`;
    });
  }
  function shiftFormula(formula, insertCol) {
    return shiftRef(formula, insertCol);
  }
  function rewriteCell(cell, newCol, insertCol) {
    const row = (cell.match(/\br="[A-Z]+(\d+)"/) || [,"1"])[1];
    let out = cell.replace(/\br="[A-Z]+\d+"/, `r="${indexToCol(newCol)}${row}"`);
    out = out.replace(/<f([^>]*)>([\s\S]*?)<\/f>/g, (_, attrs, formula) =>
      `<f${attrs}>${shiftFormula(formula, insertCol)}</f>`);
    return out;
  }
  function makeInlineCell(col, row, value, style = "") {
    const preserve = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : "";
    return `<c r="${indexToCol(col)}${row}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t${preserve}>${xmlEscape(value)}</t></is></c>`;
  }
  function updateRangeAttributes(xml, insertCol) {
    return xml.replace(/\b(ref=")([A-Z]+\d+(?::[A-Z]+\d+)?)(")/g, (_, a, range, z) => {
      const parts = range.split(":");
      if (parts.length === 1) return `${a}${shiftRef(parts[0], insertCol)}${z}`;
      return `${a}${parts.map((p) => shiftRef(p, insertCol)).join(":")}${z}`;
    });
  }
  function shiftCols(xml, insertCol) {
    return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (all, body) => {
      const shifted = body.replace(/<col\b([^>]*)\/>/g, (tag, attrs) => {
        const min = Number((attrs.match(/\bmin="(\d+)"/) || [,"0"])[1]);
        const max = Number((attrs.match(/\bmax="(\d+)"/) || [,"0"])[1]);
        const nextMin = min > insertCol ? min + 1 : min;
        const nextMax = max > insertCol ? max + 1 : max;
        return tag.replace(`min="${min}"`, `min="${nextMin}"`).replace(`max="${max}"`, `max="${nextMax}"`);
      });
      return `<cols>${shifted}<col min="${insertCol + 1}" max="${insertCol + 1}" width="24" customWidth="1"/></cols>`;
    });
  }
  function enrichSheetXml(xml, sharedStrings = [], trackingByOrder = {}) {
    const { orderCol, trackingCol, linkCol, titleCol } = findColumns(xml, sharedStrings);
    const insert = trackingCol == null;
    const targetCol = insert ? orderCol + 1 : trackingCol;
    let output = String(xml);
    const rows = parseRows(output).reverse();
    for (const row of rows) {
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((c) => c.col === orderCol)?.value.trim() || "";
      const link = linkCol == null ? "" : cells.find((c) => c.col === linkCol)?.value.trim() || "";
      const title = titleCol == null ? "" : cells.find((c) => c.col === titleCol)?.value.trim() || "";
      const style = (cells.find((c) => c.col === orderCol)?.xml.match(/\bs="([^"]+)"/) || [,""])[1];
      let newCells = cells.filter((c) => c.col !== targetCol || insert);
      if (insert) newCells = newCells.map((c) => {
        const outCol = c.col >= targetCol ? c.col + 1 : c.col;
        return { ...c, outCol, out: rewriteCell(c.xml, outCol, targetCol) };
      });
      else newCells = newCells.map((c) => ({ ...c, outCol: c.col, out: c.xml }));
      let rowTracks = trackingByOrder[order] || [];
      if (trackingByOrder.shipmentDataByOrder) {
        const matcher = getMatcher();
        rowTracks = matcher
          ? matcher.matchTrackingForRow({ link, title }, trackingByOrder.shipmentDataByOrder[order] || [])
          : [];
      }
      const value = row.row === 1 ? "Трек номер" : rowTracks.join("\n");
      newCells.push({ col: targetCol, outCol: targetCol, out: makeInlineCell(targetCol, row.row, value, style) });
      newCells.sort((a, b) => a.outCol - b.outCol);
      const inner = newCells.map((c) => c.out).join("");
      const replaced = row.xml.replace(/(<row\b[^>]*>)[\s\S]*?(<\/row>)/, `$1${inner}$2`);
      output = output.slice(0, row.index) + replaced + output.slice(row.index + row.xml.length);
    }
    if (insert) {
      output = updateRangeAttributes(output, targetCol);
      output = shiftCols(output, targetCol);
    }
    return { xml: output, inserted: insert, insertCol: targetCol };
  }
  function shiftDrawingXml(xml, insertCol) {
    return String(xml).replace(/(<xdr:col>)(\d+)(<\/xdr:col>)/g, (_, a, raw, z) => {
      const col = Number(raw);
      return `${a}${col >= insertCol ? col + 1 : col}${z}`;
    });
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
    return table;
  })();
  function crc32(bytes) { let crc = -1; for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]; return (crc ^ -1) >>> 0; }
  const u16 = (n) => new Uint8Array([n & 255, n >>> 8 & 255]);
  const u32 = (n) => new Uint8Array([n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);
  function concat(parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
  async function unzipEntries(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Некорректный XLSX-файл.");
    let offset = view.getUint32(eocd + 16, true);
    const count = view.getUint16(eocd + 10, true);
    const records = [];
    for (let i = 0; i < count; i++) {
      const compression = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
      records.push({ name: decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLen)), compression, size, local: view.getUint32(offset + 42, true) });
      offset += 46 + nameLen + extra + comment;
    }
    const files = new Map();
    for (const item of records) {
      const nameLen = view.getUint16(item.local + 26, true), extra = view.getUint16(item.local + 28, true);
      const data = bytes.slice(item.local + 30 + nameLen + extra, item.local + 30 + nameLen + extra + item.size);
      if (item.compression === 0) files.set(item.name, data);
      else if (item.compression === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        files.set(item.name, new Uint8Array(await new Response(stream).arrayBuffer()));
      } else throw new Error("Неподдерживаемое сжатие XLSX.");
    }
    return files;
  }
  function zipStore(files) {
    let offset = 0; const local = [], central = [];
    for (const [name, data] of files) {
      const nb = encoder.encode(name), crc = crc32(data), size = data.length;
      const head = concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nb.length),u16(0),nb]);
      local.push(head, data);
      central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nb]));
      offset += head.length + data.length;
    }
    const cd = concat(central);
    return concat([...local, cd, u32(0x06054b50),u16(0),u16(0),u16(files.size),u16(files.size),u32(cd.length),u32(offset),u16(0)]);
  }
  function parseSharedStrings(xml) {
    return [...String(xml || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  }
  function findProductsSheet(files) {
    const workbook = decoder.decode(files.get("xl/workbook.xml") || new Uint8Array());
    const sheet = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => m[1] === "Товары");
    if (!sheet) throw new Error("Не найден лист «Товары».");
    const rels = decoder.decode(files.get("xl/_rels/workbook.xml.rels") || new Uint8Array());
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/>/g)].find((m) => new RegExp(`\\bId="${sheet[2]}"`).test(m[1]));
    const target = (rel?.[1].match(/\bTarget="([^"]+)"/) || [])[1];
    if (!target) throw new Error("Не найден XML листа «Товары».");
    return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.?\//, "")}`;
  }
  async function inspectTrackingWorkbook(bytes) {
    const files = await unzipEntries(bytes);
    const sheetPath = findProductsSheet(files);
    const shared = parseSharedStrings(decoder.decode(files.get("xl/sharedStrings.xml") || new Uint8Array()));
    return { orders: extractOrderNumbersFromSheetXml(decoder.decode(files.get(sheetPath)), shared), sheetPath };
  }
  async function enrichTrackingWorkbook(bytes, trackingByOrder) {
    const files = await unzipEntries(bytes);
    const sheetPath = findProductsSheet(files);
    const shared = parseSharedStrings(decoder.decode(files.get("xl/sharedStrings.xml") || new Uint8Array()));
    const result = enrichSheetXml(decoder.decode(files.get(sheetPath)), shared, trackingByOrder);
    files.set(sheetPath, encoder.encode(result.xml));
    if (result.inserted) {
      for (const [name, data] of [...files]) if (/^xl\/drawings\/drawing\d+\.xml$/.test(name)) files.set(name, encoder.encode(shiftDrawingXml(decoder.decode(data), result.insertCol)));
    }
    return zipStore(files);
  }

  const api = { extractOrderNumbersFromSheetXml, enrichSheetXml, shiftDrawingXml, inspectTrackingWorkbook, enrichTrackingWorkbook, zipStore };
  root.WB1688TrackingXlsx = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
