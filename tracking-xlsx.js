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
    return [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*\/>|<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>[\s\S]*?<\/c>/g)]
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
    const deliveryStatus = cells.find((c) => c.value.trim() === "Статус доставки");
    const link = cells.find((c) => c.value.trim() === "Ссылка");
    const title = cells.find((c) => c.value.trim() === "Название на 1688");
    if (!order) throw new Error("Не найден столбец «Номер заказа».");
    return {
      orderCol: order.col,
      trackingCol: tracking?.col ?? null,
      statusCol: deliveryStatus?.col ?? null,
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
  function extractProductsByOrderFromSheetXml(xml, sharedStrings = []) {
    const { orderCol, linkCol, titleCol } = findColumns(xml, sharedStrings);
    const result = {};
    for (const row of parseRows(xml)) {
      if (row.row === 1) continue;
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((cell) => cell.col === orderCol)?.value.trim() || "";
      if (!order) continue;
      const link = linkCol == null ? "" : cells.find((cell) => cell.col === linkCol)?.value.trim() || "";
      const title = titleCol == null ? "" : cells.find((cell) => cell.col === titleCol)?.value.trim() || "";
      const offerId = (link.match(/detail\.1688\.com\/offer\/(\d+)\.html/i) || [])[1] || "";
      if (!offerId && !title) continue;
      (result[order] ||= []).push({ offerId, link, title });
    }
    return result;
  }
  function hasInternalLogisticsNumber(value) {
    return String(value || "").split(/\r?\n/).some((line) => /^LP\d{10,}$/i.test(line.trim()));
  }
  function withoutInternalLogisticsNumbers(value) {
    return String(value || "").split(/\r?\n/)
      .map((line) => line.trim()).filter((line) => line && !/^LP\d{10,}$/i.test(line)).join("\n");
  }
  function extractPendingTrackingFromSheetXml(xml, sharedStrings = []) {
    const { orderCol, trackingCol, linkCol, titleCol } = findColumns(xml, sharedStrings);
    const allOrders = new Set();
    const pendingOrders = new Set();
    const productsByOrder = {};
    let skippedTrackedRows = 0;
    for (const row of parseRows(xml)) {
      if (row.row === 1) continue;
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((cell) => cell.col === orderCol)?.value.trim() || "";
      if (!order) continue;
      allOrders.add(order);
      const existingTrack = trackingCol == null ? "" : cells.find((cell) => cell.col === trackingCol)?.value || "";
      if (existingTrack.trim() && !hasInternalLogisticsNumber(existingTrack)) {
        skippedTrackedRows += 1;
        continue;
      }
      pendingOrders.add(order);
      const link = linkCol == null ? "" : cells.find((cell) => cell.col === linkCol)?.value.trim() || "";
      const title = titleCol == null ? "" : cells.find((cell) => cell.col === titleCol)?.value.trim() || "";
      const offerId = (link.match(/detail\.1688\.com\/offer\/(\d+)\.html/i) || [])[1] || "";
      if (offerId || title) (productsByOrder[order] ||= []).push({ offerId, link, title });
    }
    return {
      orders: [...pendingOrders], productsByOrder, skippedTrackedRows,
      skippedTrackedOrders: allOrders.size - pendingOrders.size
    };
  }
  function shiftRef(ref, insertCol) {
    return String(ref).replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, absoluteCol, col, absoluteRow, row) => {
      const index = colToIndex(col);
      return `${absoluteCol}${indexToCol(index >= insertCol ? index + 1 : index)}${absoluteRow}${row}`;
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
  function cellStyleId(cellXml) {
    const value = (cellXml.match(/\bs="(\d+)"/) || [])[1];
    return value == null ? 0 : Number(value);
  }
  function setCellStyle(cellXml, styleId) {
    if (/\bs="\d+"/.test(cellXml)) return cellXml.replace(/\bs="\d+"/, `s="${styleId}"`);
    return cellXml.replace(/<c\b/, `<c s="${styleId}"`);
  }
  function ensureTextCellStyles(stylesXml, baseStyleIds) {
    const match = String(stylesXml || "").match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
    if (!match) return { xml: stylesXml, textStyles: new Map() };
    const xfs = [...match[2].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((item) => item[0]);
    const textStyles = new Map();
    for (const baseId of new Set(baseStyleIds || [0])) {
      const base = xfs[baseId] || xfs[0];
      if (!base) continue;
      if (/\bnumFmtId="49"/.test(base)) {
        textStyles.set(baseId, baseId);
        continue;
      }
      let textXf = base;
      if (/\bnumFmtId="\d+"/.test(textXf)) textXf = textXf.replace(/\bnumFmtId="\d+"/, 'numFmtId="49"');
      else textXf = textXf.replace(/<xf\b/, '<xf numFmtId="49"');
      if (/\bapplyNumberFormat="[^"]*"/.test(textXf)) textXf = textXf.replace(/\bapplyNumberFormat="[^"]*"/, 'applyNumberFormat="1"');
      else textXf = textXf.replace(/<xf\b/, '<xf applyNumberFormat="1"');
      textStyles.set(baseId, xfs.length);
      xfs.push(textXf);
    }
    const count = xfs.length;
    const body = xfs.join("\n    ");
    const updated = String(stylesXml).replace(match[0], `<cellXfs${match[1].replace(/\bcount="\d+"/, `count="${count}"`)}>${body}</cellXfs>`);
    return { xml: updated, textStyles };
  }
  function updateRangeAttributes(xml, insertCol) {
    return xml.replace(/\b((?:ref|sqref|activeCell)=")([^"]+)(")/g, (all, prefix, value, suffix) => {
      if (!/^(?:\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)(?:\s+\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)*$/.test(value)) return all;
      return `${prefix}${shiftRef(value, insertCol)}${suffix}`;
    });
  }
  function shiftRowSpans(openingTag, insertCol) {
    const position = insertCol + 1;
    return openingTag.replace(/\bspans="(\d+):(\d+)"/, (_, low, high) =>
      `spans="${Number(low) >= position ? Number(low) + 1 : low}:${Number(high) >= position ? Number(high) + 1 : high}"`);
  }
  function normalizeRowSpans(openingTag, cells) {
    const match = openingTag.match(/\bspans="(\d+):(\d+)"/);
    if (!match || !cells.length) return openingTag;
    const first = Math.min(...cells.map((cell) => cell.outCol + 1));
    const last = Math.max(...cells.map((cell) => cell.outCol + 1));
    return openingTag.replace(match[0], `spans="${Math.min(Number(match[1]), first)}:${Math.max(Number(match[2]), last)}"`);
  }
  function shiftCols(xml, insertCol = null) {
    const replaceRange = (tag, min, max) => tag
      .replace(/\bmin="\d+"/, `min="${min}"`)
      .replace(/\bmax="\d+"/, `max="${max}"`);
    const rewrite = (body) => {
      const columns = [];
      for (const [tag] of body.matchAll(/<col\b[^>]*\/>/g)) {
        const min = Number((tag.match(/\bmin="(\d+)"/) || [])[1]);
        const max = Number((tag.match(/\bmax="(\d+)"/) || [])[1]);
        if (!Number.isInteger(min) || !Number.isInteger(max)) continue;
        const position = insertCol == null ? null : insertCol + 1;
        if (position == null || max < position) columns.push({ min, max, tag });
        else if (min >= position) columns.push({ min: min + 1, max: max + 1, tag: replaceRange(tag, min + 1, max + 1) });
        else {
          columns.push({ min, max: position - 1, tag: replaceRange(tag, min, position - 1) });
          columns.push({ min: position + 1, max: max + 1, tag: replaceRange(tag, position + 1, max + 1) });
        }
      }
      if (insertCol != null) {
        const position = insertCol + 1;
        columns.push({ min: position, max: position, tag: `<col min="${position}" max="${position}" width="24" customWidth="1"/>` });
      }
      columns.sort((a, b) => a.min - b.min || a.max - b.max);
      return `<cols>${columns.map((column) => column.tag).join("")}</cols>`;
    };
    if (/<cols\b[^>]*>[\s\S]*?<\/cols>/.test(xml)) {
      return xml.replace(/<cols\b[^>]*>([\s\S]*?)<\/cols>/, (_, body) => rewrite(body));
    }
    return insertCol == null ? xml : xml.replace(/<sheetData\b/, `${rewrite("")}<sheetData`);
  }
  function uniqueShipmentTracks(shipments) {
    return [...new Set((shipments || [])
      .map((shipment) => String(shipment?.trackingNumber || "").trim())
      .filter(Boolean))];
  }
  function countOrderRows(rows, orderCol, sharedStrings) {
    const counts = {};
    for (const row of rows) {
      if (row.row === 1) continue;
      const order = parseCells(row.xml, sharedStrings).find((c) => c.col === orderCol)?.value.trim() || "";
      if (order) counts[order] = (counts[order] || 0) + 1;
    }
    return counts;
  }
  function orderOfferStats(rows, orderCol, linkCol, sharedStrings) {
    const stats = {};
    if (linkCol == null) return stats;
    for (const row of rows) {
      if (row.row === 1) continue;
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((c) => c.col === orderCol)?.value.trim() || "";
      if (!order) continue;
      const link = cells.find((c) => c.col === linkCol)?.value.trim() || "";
      const offerId = (link.match(/detail\.1688\.com\/offer\/(\d+)\.html/i) || [])[1] || "";
      if (offerId) (stats[order] ||= new Set()).add(offerId);
    }
    return stats;
  }
  function enrichSheetXml(xml, sharedStrings = [], trackingByOrder = {}, textStyleMap = null) {
    const { orderCol, trackingCol, statusCol, linkCol, titleCol } = findColumns(xml, sharedStrings);
    const insert = trackingCol == null;
    const targetCol = insert ? orderCol + 1 : trackingCol;
    let output = String(xml);
    const parsedRows = parseRows(output);
    const orderRowCounts = countOrderRows(parsedRows, orderCol, sharedStrings);
    const offerStats = orderOfferStats(parsedRows, orderCol, linkCol, sharedStrings);
    const rows = parsedRows.reverse();
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
      if (textStyleMap) {
        newCells = newCells.map((c) => {
          const shouldFormat = c.col === orderCol || (!insert && c.col === targetCol);
          if (row.row === 1 || !shouldFormat) return c;
          const styleId = textStyleMap.get(cellStyleId(c.out)) ?? textStyleMap.get(0);
          return styleId == null ? c : { ...c, out: setCellStyle(c.out, styleId) };
        });
      }
      const orderTracks = trackingByOrder[order] || [];
      let rowTracks = orderTracks;
      if (trackingByOrder.shipmentDataByOrder) {
        const matcher = getMatcher();
        const shipments = trackingByOrder.shipmentDataByOrder[order] || [];
        const matchedTracks = matcher
          ? matcher.matchTrackingForRow({ link, title }, shipments)
          : [];
        if (matchedTracks.length) {
          rowTracks = matchedTracks;
        } else {
          const shipmentTracks = uniqueShipmentTracks(shipments);
          const oneOfferOrder = offerStats[order]?.size === 1;
          const fallbackTracks = shipmentTracks.length ? shipmentTracks : orderTracks;
          if (fallbackTracks.length === 1 || orderRowCounts[order] === 1 || oneOfferOrder) rowTracks = fallbackTracks;
          else rowTracks = [];
        }
      }
      const oldTrackingCell = trackingCol == null ? null : cells.find((c) => c.col === trackingCol);
      const oldTracks = oldTrackingCell?.value || "";
      const preserveExisting = row.row !== 1 && Boolean(oldTracks.trim()) && !hasInternalLogisticsNumber(oldTracks);
      const value = row.row === 1 ? "Трек номер" : preserveExisting ? oldTracks
        : rowTracks.join("\n") || withoutInternalLogisticsNumbers(oldTracks);
      if (statusCol != null && row.row !== 1) {
        if (oldTracks !== value) {
          const oldStatus = cells.find((c) => c.col === statusCol);
          const outCol = statusCol + (insert && statusCol >= targetCol ? 1 : 0);
          newCells = newCells.filter((c) => c.col !== statusCol);
          newCells.push({ col: statusCol, outCol, out: makeInlineCell(outCol, row.row, "", (oldStatus?.xml.match(/\bs="([^"]+)"/) || [, ""])[1]) });
        }
      }
      const trackingStyle = row.row === 1
        ? style
        : (textStyleMap?.get(cellStyleId(cells.find((c) => c.col === orderCol)?.xml || "")) ?? textStyleMap?.get(0) ?? style);
      newCells.push({ col: targetCol, outCol: targetCol,
        out: preserveExisting ? oldTrackingCell.xml : makeInlineCell(targetCol, row.row, value, trackingStyle) });
      newCells.sort((a, b) => a.outCol - b.outCol);
      const inner = newCells.map((c) => c.out).join("");
      const replaced = row.xml.replace(/(<row\b[^>]*>)[\s\S]*?(<\/row>)/, (_, opening, closing) =>
        `${normalizeRowSpans(insert ? shiftRowSpans(opening, targetCol) : opening, newCells)}${inner}${closing}`);
      output = output.slice(0, row.index) + replaced + output.slice(row.index + row.xml.length);
    }
    if (insert) {
      output = updateRangeAttributes(output, targetCol);
    }
    output = shiftCols(output, insert ? targetCol : null);
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
  function removeCalcChain(files) {
    files.delete("xl/calcChain.xml");
    const relsPath = "xl/_rels/workbook.xml.rels";
    if (files.has(relsPath)) {
      const rels = decoder.decode(files.get(relsPath)).replace(/<Relationship\b[^>]*\/>/g, (tag) =>
        /\bType="[^"]*\/calcChain"/.test(tag) ? "" : tag);
      files.set(relsPath, encoder.encode(rels));
    }
    const contentTypesPath = "[Content_Types].xml";
    if (files.has(contentTypesPath)) {
      const contentTypes = decoder.decode(files.get(contentTypesPath)).replace(/<Override\b[^>]*\/>/g, (tag) =>
        /\bPartName="\/xl\/calcChain\.xml"/.test(tag) ? "" : tag);
      files.set(contentTypesPath, encoder.encode(contentTypes));
    }
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
    const sheetXml = decoder.decode(files.get(sheetPath));
    return { ...extractPendingTrackingFromSheetXml(sheetXml, shared), sheetPath };
  }
  function extractDeliveryOrdersFromSheetXml(xml, sharedStrings = []) {
    const { orderCol, trackingCol, statusCol } = findColumns(xml, sharedStrings);
    if (trackingCol == null) throw new Error("Не найден столбец «Трек номер».");
    const deliveryByOrder = new Map();
    const tracksByOrder = {};
    for (const row of parseRows(xml)) {
      if (row.row === 1) continue;
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((cell) => cell.col === orderCol)?.value.trim() || "";
      const value = cells.find((cell) => cell.col === trackingCol)?.value || "";
      if (!order || !value.trim()) continue;
      const tracks = value.split(/\r?\n/).map((track) => track.trim()).filter(Boolean);
      if (!tracks.length) continue;
      const statusValue = statusCol == null ? "" : cells.find((cell) => cell.col === statusCol)?.value || "";
      const statuses = statusValue.split(/\r?\n/).map((status) => status.trim());
      const known = deliveryByOrder.get(order) || new Map();
      tracks.forEach((track, index) => {
        const delivered = statuses[index]?.toLocaleLowerCase("ru-RU") === "доставлено";
        known.set(track, (known.get(track) ?? true) && delivered);
      });
      deliveryByOrder.set(order, known);
    }
    let skippedDeliveredOrders = 0;
    for (const [order, tracks] of deliveryByOrder) {
      const pending = [...tracks].filter(([, delivered]) => !delivered).map(([track]) => track);
      if (pending.length) tracksByOrder[order] = pending;
      else skippedDeliveredOrders += 1;
    }
    return { orders: Object.keys(tracksByOrder), tracksByOrder, trackedOrders: deliveryByOrder.size, skippedDeliveredOrders };
  }
  async function inspectDeliveryWorkbook(bytes) {
    const files = await unzipEntries(bytes);
    const sheetPath = findProductsSheet(files);
    const shared = parseSharedStrings(decoder.decode(files.get("xl/sharedStrings.xml") || new Uint8Array()));
    return extractDeliveryOrdersFromSheetXml(decoder.decode(files.get(sheetPath)), shared);
  }
  function enrichDeliverySheetXml(xml, sharedStrings = [], statusesByOrder = {}) {
    const { orderCol, trackingCol, statusCol } = findColumns(xml, sharedStrings);
    if (trackingCol == null) throw new Error("Не найден столбец «Трек номер».");
    const insert = statusCol == null;
    const targetCol = statusCol ?? trackingCol + 1;
    let output = String(xml);
    for (const row of parseRows(output).reverse()) {
      const cells = parseCells(row.xml, sharedStrings);
      const order = cells.find((cell) => cell.col === orderCol)?.value.trim() || "";
      const trackingCell = cells.find((cell) => cell.col === trackingCol);
      const tracks = (trackingCell?.value || "").split(/\r?\n/).map((track) => track.trim()).filter(Boolean);
      const statuses = statusesByOrder[order] || {};
      const oldStatusCell = statusCol == null ? null : cells.find((cell) => cell.col === statusCol);
      const oldStatuses = (oldStatusCell?.value || "").split(/\r?\n/).map((status) => status.trim());
      const attempted = Object.hasOwn(statusesByOrder, order);
      const value = row.row === 1 ? "Статус доставки" : tracks.map((track, index) => {
        const previous = oldStatuses[index] || "";
        if (previous.toLocaleLowerCase("ru-RU") === "доставлено") return previous;
        const updated = statuses[track] || "";
        if (previous && ["Не удалось проверить", "Трек не найден на странице"].includes(updated)) return previous;
        return updated || previous || (attempted ? "Не удалось проверить" : "");
      }).join("\n");
      const style = (oldStatusCell?.xml.match(/\bs="([^"]+)"/) || trackingCell?.xml.match(/\bs="([^"]+)"/) || [, ""])[1];
      let newCells = cells.filter((cell) => cell.col !== targetCol || insert).map((cell) => {
        const outCol = insert && cell.col >= targetCol ? cell.col + 1 : cell.col;
        return { outCol, out: insert ? rewriteCell(cell.xml, outCol, targetCol) : cell.xml };
      });
      newCells.push({ outCol: targetCol, out: makeInlineCell(targetCol, row.row, value, style) });
      newCells.sort((a, b) => a.outCol - b.outCol);
      const replaced = row.xml.replace(/(<row\b[^>]*>)[\s\S]*?(<\/row>)/, (_, opening, closing) =>
        `${normalizeRowSpans(insert ? shiftRowSpans(opening, targetCol) : opening, newCells)}${newCells.map((cell) => cell.out).join("")}${closing}`);
      output = output.slice(0, row.index) + replaced + output.slice(row.index + row.xml.length);
    }
    if (insert) {
      output = updateRangeAttributes(output, targetCol);
    }
    output = shiftCols(output, insert ? targetCol : null);
    return { xml: output, inserted: insert, insertCol: targetCol };
  }
  async function enrichDeliveryWorkbook(bytes, statusesByOrder) {
    const files = await unzipEntries(bytes);
    const sheetPath = findProductsSheet(files);
    const shared = parseSharedStrings(decoder.decode(files.get("xl/sharedStrings.xml") || new Uint8Array()));
    const result = enrichDeliverySheetXml(decoder.decode(files.get(sheetPath)), shared, statusesByOrder);
    files.set(sheetPath, encoder.encode(result.xml));
    if (result.inserted) {
      for (const [name, data] of [...files]) if (/^xl\/drawings\/drawing\d+\.xml$/.test(name)) files.set(name, encoder.encode(shiftDrawingXml(decoder.decode(data), result.insertCol)));
    }
    removeCalcChain(files);
    return zipStore(files);
  }
  async function enrichTrackingWorkbook(bytes, trackingByOrder) {
    const files = await unzipEntries(bytes);
    const sheetPath = findProductsSheet(files);
    const shared = parseSharedStrings(decoder.decode(files.get("xl/sharedStrings.xml") || new Uint8Array()));
    const sheetXml = decoder.decode(files.get(sheetPath));
    let textStyleMap = null;
    const stylesPath = "xl/styles.xml";
    if (files.has(stylesPath)) {
      const { orderCol, trackingCol } = findColumns(sheetXml, shared);
      const targetCol = trackingCol == null ? orderCol + 1 : trackingCol;
      const baseStyleIds = new Set([0]);
      for (const row of parseRows(sheetXml)) {
        if (row.row === 1) continue;
        for (const cell of parseCells(row.xml, shared)) {
          if (cell.col === orderCol || cell.col === targetCol) baseStyleIds.add(cellStyleId(cell.xml));
        }
      }
      const ensured = ensureTextCellStyles(decoder.decode(files.get(stylesPath)), baseStyleIds);
      files.set(stylesPath, encoder.encode(ensured.xml));
      textStyleMap = ensured.textStyles;
    }
    const trackingResult = enrichSheetXml(sheetXml, shared, trackingByOrder, textStyleMap);
    const statusResult = enrichDeliverySheetXml(trackingResult.xml, shared, {});
    files.set(sheetPath, encoder.encode(statusResult.xml));
    for (const result of [trackingResult, statusResult]) {
      if (!result.inserted) continue;
      for (const [name, data] of [...files]) if (/^xl\/drawings\/drawing\d+\.xml$/.test(name)) files.set(name, encoder.encode(shiftDrawingXml(decoder.decode(data), result.insertCol)));
    }
    removeCalcChain(files);
    return zipStore(files);
  }

  const api = { extractOrderNumbersFromSheetXml, extractProductsByOrderFromSheetXml, extractPendingTrackingFromSheetXml, extractDeliveryOrdersFromSheetXml, enrichDeliverySheetXml, enrichDeliveryWorkbook, inspectDeliveryWorkbook, enrichSheetXml, shiftDrawingXml, inspectTrackingWorkbook, enrichTrackingWorkbook, zipStore };
  root.WB1688TrackingXlsx = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
