const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTrackingNumbersFromText,
  normalizeTrackingNumbers,
  joinTrackingNumbers
} = require("../tracking-parser.js");

test("extracts Chinese and Russian labeled tracking numbers", () => {
  assert.deepEqual(
    extractTrackingNumbersFromText("运单号码：SF123456\nНомер накладной: LP987654"),
    ["SF123456", "LP987654"]
  );
});

test("normalizes duplicate values and joins them with line breaks", () => {
  const values = normalizeTrackingNumbers([" SF123 ", "SF123", "LP456"]);
  assert.deepEqual(values, ["SF123", "LP456"]);
  assert.equal(joinTrackingNumbers(values), "SF123\nLP456");
});
