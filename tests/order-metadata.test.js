const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeOrderDate,
  extractOrderNumber,
  parseOrderMetadata
} = require("../order-metadata.js");

test("normalizes numeric order date with seconds", () => {
  assert.equal(
    normalizeOrderDate("2026-06-19 14:05:09"),
    "19.06.2026 14:05:09"
  );
});

test("normalizes Chinese order date and supplies missing seconds", () => {
  assert.equal(
    normalizeOrderDate("2026年6月19日 14:05"),
    "19.06.2026 14:05:00"
  );
});

test("extracts a long order number as text", () => {
  assert.equal(
    extractOrderNumber("订单号：1234567890123456789"),
    "1234567890123456789"
  );
});

test("extracts labeled order number and date together", () => {
  assert.deepEqual(
    parseOrderMetadata("下单时间：2026-06-19 14:05:09 订单号：123"),
    {
      orderNumber: "123",
      orderDate: "19.06.2026 14:05:09"
    }
  );
});

test("content parser propagates metadata to every order row", () => {
  const contentJs = fs.readFileSync(
    path.resolve(__dirname, "..", "content.js"),
    "utf8"
  );
  const parser = contentJs.slice(
    contentJs.indexOf("function parseOrderBlock("),
    contentJs.indexOf("function collectAllRowsLegacy")
  );

  assert.match(parser, /parseOrderMetadata\(/);
  assert.match(parser, /\borderNumber\b/);
  assert.match(parser, /\borderDate\b/);
});

test("manifest loads metadata parser before the content script", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "manifest.json"), "utf8")
  );

  assert.deepEqual(
    manifest.content_scripts[0].js.slice(0, 2),
    ["order-metadata.js", "content.js"]
  );
});

