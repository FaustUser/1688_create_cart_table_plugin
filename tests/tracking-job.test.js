const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createTrackingJob,
  startOrder,
  completeOrder,
  cancelJob
} = require("../tracking-job.js");

test("tracks found, empty and remaining orders", () => {
  let state = createTrackingJob("orders.xlsx", ["1", "2"]);
  state = startOrder(state, 0);
  state = completeOrder(state, "1", ["TRACK-1"]);
  assert.equal(state.index, 1);
  state = startOrder(state, 1);
  state = completeOrder(state, "2", []);
  assert.equal(state.found, 1);
  assert.equal(state.empty, 1);
  assert.equal(state.remaining, 0);
  assert.equal(state.progress, 100);
  assert.equal(state.status, "completed");
});

test("cancels without marking job completed", () => {
  const state = cancelJob(createTrackingJob("orders.xlsx", ["1"]));
  assert.equal(state.status, "cancelled");
  assert.equal(state.remaining, 1);
});

test("stores shipment records per order", () => {
  let state = createTrackingJob("orders.xlsx", ["512"]);
  state = startOrder(state, 0);
  state = completeOrder(state, "512", [{
    trackingNumber: "TRACK-1",
    products: [{ offerId: "100", title: "Товар" }]
  }]);
  assert.deepEqual(state.shipmentDataByOrder["512"], [{
    trackingNumber: "TRACK-1",
    products: [{ offerId: "100", title: "Товар" }]
  }]);
  assert.equal(state.found, 1);
});
