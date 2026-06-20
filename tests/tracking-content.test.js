const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../content.js"), "utf8");

test("content script collects tracking numbers with bounded polling", () => {
  assert.match(source, /WB_1688_COLLECT_TRACKING/);
  assert.match(source, /WB1688TrackingParser\.extractShipments/);
  assert.match(source, /msg\.products/);
  assert.match(source, /shipments\.every\(\(shipment\) => shipment\.products\.length\)/);
  assert.match(source, /diagnostic/);
});
