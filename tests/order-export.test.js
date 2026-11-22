const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractOrderNumbersFromSheetXml } = require("../tracking-xlsx.js");

const popupJs = fs.readFileSync(
  path.resolve(__dirname, "..", "popup.js"),
  "utf8"
);
const orderConfig = popupJs.slice(
  popupJs.indexOf("const ORDER_EXPORT_CONFIG"),
  popupJs.indexOf("const CART_EXPORT_CONFIG")
);
const drawingGenerator = popupJs.slice(
  popupJs.indexOf("function makeDrawingXMLMapped"),
  popupJs.indexOf("const sheetXml = makeSheetXML")
);
const sheetGenerator = popupJs.slice(
  popupJs.indexOf("const ORDER_EXPORT_CONFIG"),
  popupJs.indexOf("async function runTabExportLegacy")
);
const { makeSheetXML } = new Function(
  "colName", "xmlEscape", "makeFrozenHeaderSheetViewsXML",
  `${sheetGenerator}\nreturn { makeSheetXML };`
)(
  (n) => { let out = ""; while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); } return out; },
  (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  () => ""
);
const sampleRow = {
  orderNumber: "00123", orderDate: "2026-11-21", link: "https://example.com/item",
  title: "Товар", qty: 2, unitPrice: 10, shippingShare: 3, discountShare: 1
};
const orderXml = makeSheetXML([sampleRow], false, 200, "rId2", "orders");
const cartXml = makeSheetXML([sampleRow], false, 200, "rId2", "cart");

test("owner is the first text-formatted column in both exports", () => {
  for (const xml of [orderXml, cartXml]) {
    assert.match(xml, /<c r="A1" t="inlineStr" s="3"><is><t>Владелец<\/t><\/is><\/c>/);
    assert.match(xml, /<c r="A2" t="inlineStr" s="3"><is><t><\/t><\/is><\/c>/);
    assert.match(xml, /<col min="1" max="1" width="24" customWidth="1" style="3"\/>/);
  }
  const textStyle = popupJs.match(/<cellXfs count="4">([\s\S]*?)<\/cellXfs>/)?.[1];
  assert.ok(textStyle);
  assert.match(textStyle, /<xf numFmtId="49"[\s\S]*?<alignment horizontal="center" vertical="center" wrapText="1"\/>/);
});

test("order export keeps tracking columns and shifts the total formula", () => {
  assert.match(orderXml, /<c r="B1"[^>]*><is><t>Номер заказа<\/t>/);
  assert.match(orderXml, /<c r="C1"[^>]*><is><t>Трек номер<\/t>/);
  assert.match(orderXml, /<c r="D1"[^>]*><is><t>Статус доставки<\/t>/);
  assert.match(orderXml, /<c r="E1"[^>]*><is><t>Картинка<\/t>/);
  assert.match(orderXml, /<c r="B2" t="inlineStr" s="3"><is><t>00123<\/t>/);
  assert.match(orderXml, /<c r="I2" s="0"><v>2<\/v><\/c>/);
  assert.match(orderXml, /<c r="J2" s="2"><v>10<\/v><\/c>/);
  assert.match(orderXml, /<c r="K2" s="2"><v>3<\/v><\/c>/);
  assert.match(orderXml, /<c r="L2" s="2"><v>1<\/v><\/c>/);
  assert.match(orderXml, /<c r="M2" s="2"><f>I2\*J2\+K2-L2<\/f><\/c>/);
  assert.deepEqual(extractOrderNumbersFromSheetXml(orderXml), ["00123"]);
});

test("cart export shifts image, link and title columns", () => {
  assert.match(cartXml, /<c r="B1"[^>]*><is><t>Картинка<\/t>/);
  assert.match(cartXml, /<c r="C2" t="inlineStr" s="1"><is><t>https:\/\/example.com\/item<\/t>/);
  assert.match(cartXml, /<c r="D2" t="inlineStr" s="1"><is><t>Товар<\/t>/);
});

test("order export defines widths for all thirteen columns", () => {
  const widths = orderConfig.match(/widths:[\s\S]*?=>\s*\[([\s\S]*?)\]/);
  assert.ok(widths);
  assert.equal(widths[1].split(",").length, 13);
});

test("images use column E for orders and column B for cart", () => {
  assert.match(
    drawingGenerator,
    /function makeDrawingXMLMapped\(imgCount,\s*imgPx,\s*rowIdx,\s*imageCol0\)/
  );
  assert.match(drawingGenerator, /const col0 = imageCol0;/);
  assert.match(
    popupJs,
    /makeDrawingXMLMapped\(\s*embedded\.length,\s*imgPx,\s*embeddedRowIdx,\s*pageType === "orders" \? 4 : 1\s*\)/
  );
});

test("manual content-script reinjection includes the metadata parser", () => {
  assert.match(
    popupJs,
    /files:\s*\["order-metadata\.js",\s*"content\.js"\]/
  );
});
