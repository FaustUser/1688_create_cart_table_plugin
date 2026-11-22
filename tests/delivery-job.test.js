const test = require("node:test");
const assert = require("node:assert/strict");
const { runDeliveryPool } = require("../delivery-job.js");

test("processes every order once with at most three simultaneous workers", async () => {
  let active = 0;
  let peak = 0;
  const seen = [];
  await runDeliveryPool([1, 2, 3, 4, 5, 6, 7], 3, async (order) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, order % 3 + 1));
    seen.push(order);
    active -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("empty queue starts no workers", async () => {
  let called = false;
  await runDeliveryPool([], 3, async () => { called = true; });
  assert.equal(called, false);
});
