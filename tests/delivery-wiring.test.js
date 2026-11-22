const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const popupHtml = fs.readFileSync(require.resolve("../popup.html"), "utf8");
const popupJs = fs.readFileSync(require.resolve("../popup.js"), "utf8");
const background = fs.readFileSync(require.resolve("../background.js"), "utf8");

test("delivery control starts only for workbook orders with tracks", () => {
  assert.match(popupHtml, /Проверить доставку/);
  assert.match(popupHtml, /id="deliveryFile"/);
  assert.match(popupJs, /inspectDeliveryWorkbook\(bytes\)/);
  assert.match(popupJs, /orders:\s*inspection\.orders/);
  assert.match(popupJs, /tracksByOrder:\s*inspection\.tracksByOrder/);
});

test("delivery job reads each page and downloads a separate workbook", () => {
  assert.match(background, /WB_1688_DELIVERY_START/);
  assert.match(background, /WB_1688_DELIVERY_GET/);
  assert.match(background, /WB_1688_DELIVERY_CANCEL/);
  assert.match(background, /readDeliveryStatusesInPage/);
  assert.match(background, /enrichDeliveryWorkbook/);
  assert.match(background, /_со_статусами\.xlsx/);
});

test("delivery job probes before full load, uses three tabs and stores workbook separately", () => {
  const collection = background.slice(background.indexOf("async function collectOrderDelivery"), background.indexOf("async function processDeliveryJob"));
  assert.doesNotMatch(collection, /waitForTabComplete/);
  assert.match(collection, /injectImmediately: true/);
  assert.match(background, /DELIVERY_CONCURRENCY = 3/);
  assert.match(background, /runDeliveryPool\(pending, DELIVERY_CONCURRENCY/);
  assert.match(background, /DELIVERY_SOURCE_KEY/);
  assert.match(background, /events: \[\]/);
  assert.match(popupHtml, /id="deliveryLog"/);
  assert.match(popupJs, /formatJobEvent/);
  assert.match(popupJs, /deliveryLog"\)\.textContent = ""/);
  assert.doesNotMatch(background, /\.slice\(-200\)/);
});
