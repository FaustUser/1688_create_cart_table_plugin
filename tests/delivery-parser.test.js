const test = require("node:test");
const assert = require("node:assert/strict");
const { readDeliveryStatusesInPage, normalizeDeliveryStatus } = require("../delivery-parser.js");

function shipment(trackingNumber, statusText, statusCode) {
  const field = {
    querySelector(selector) {
      return selector === ".info-item-tit" ? { textContent: "运单号码：" } : { textContent: trackingNumber };
    }
  };
  const components = {
    "logistics-info-message": { shadowRoot: { querySelectorAll: () => [field] } },
    "logistics-info-status": { shadowRoot: { querySelector: () => ({ textContent: statusText }) } },
    "logistics-info-track": { shadowRoot: { querySelector: () => ({ className: `logistics-item ${statusCode}` }) } }
  };
  return { querySelector: (selector) => components[selector] };
}

test("reads two shipment statuses from their own logistics blocks", () => {
  const original = global.document;
  global.document = {
    querySelectorAll(selector) {
      return selector === ".logistics-info-items" ? [
        shipment("JT3181301575358", "已签收", "SIGN"),
        shipment("JT3181301575347", "已运输", "TRANSPORT")
      ] : [];
    }
  };
  try {
    assert.deepEqual(readDeliveryStatusesInPage(), [
      { trackingNumber: "JT3181301575358", statusText: "已签收", statusCode: "SIGN" },
      { trackingNumber: "JT3181301575347", statusText: "已运输", statusCode: "TRANSPORT" }
    ]);
  } finally {
    global.document = original;
  }
});

test("normalizes known logistics stages and preserves unknown page text", () => {
  assert.equal(normalizeDeliveryStatus("已签收", "SIGN"), "Доставлено");
  assert.equal(normalizeDeliveryStatus("已运输", "TRANSPORT"), "В пути");
  assert.equal(normalizeDeliveryStatus("已派送", "DELIVERING"), "Передано курьеру");
  assert.equal(normalizeDeliveryStatus("物流异常", ""), "物流异常");
});
