const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(require.resolve("../popup.html"), "utf8");
const js = fs.readFileSync(require.resolve("../popup.js"), "utf8");

test("popup has two action cards and tracking progress controls", () => {
  assert.match(html, /Собрать новый файл/);
  assert.match(html, /Добавить трек-номера/);
  assert.match(html, /id="trackingFile"/);
  assert.match(html, /id="trackingProgressFill"/);
  assert.match(html, /id="trackingCurrentOrder"/);
  assert.match(html, /id="trackingStop"/);
  assert.match(html, /id="trackingLog"/);
  assert.match(html, /id="trackingCopyLog"/);
});

test("popup starts, restores and cancels background tracking job", () => {
  assert.match(js, /WB_1688_TRACKING_START/);
  assert.match(js, /WB_1688_TRACKING_GET/);
  assert.match(js, /WB_1688_TRACKING_CANCEL/);
  assert.match(js, /WB_1688_TRACKING_STATE/);
  assert.match(js, /productsByOrder:\s*inspection\.productsByOrder/);
  assert.match(js, /skippedTrackedRows:\s*inspection\.skippedTrackedRows/);
  assert.match(js, /trackingLog"\)\.textContent = ""/);
});
