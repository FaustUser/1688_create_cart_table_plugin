const test = require("node:test");
const assert = require("node:assert/strict");
const shipments = require("./fixtures/order-5120380515991059600-shipments.json");
const { matchTrackingForRow } = require("../tracking-matcher.js");

test("matches the confirmed rows from 1688_parsed_Товары (3).xlsx", () => {
  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/1020395271677.html",
    title: "9031【充电式280电机5档调速】入门配"
  }, shipments), ["435233621072490"]);

  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/719746403487.html",
    title: "经济版7.8Vf全能套+30件批头套"
  }, shipments), ["435233604737349"]);
});
