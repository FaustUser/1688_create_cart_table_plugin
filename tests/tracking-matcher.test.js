const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractOfferId,
  normalizeProductTitle,
  matchTrackingForRow
} = require("../tracking-matcher.js");

const shipments = [
  {
    trackingNumber: "435233621072490",
    products: [{ offerId: "1020395271677", title: "9031【充电式280电机5档调速】入门配" }]
  },
  {
    trackingNumber: "435233604737349",
    products: [{ offerId: "719746403487", title: "经济版7.8Vf全能套+30件批头套" }]
  }
];

test("extracts offer id and normalizes product title", () => {
  assert.equal(extractOfferId("https://detail.1688.com/offer/1020395271677.html?x=1"), "1020395271677");
  assert.equal(normalizeProductTitle("经济版7.8Vf全能套 + 30件批头套"), "经济版7.8vf全能套30件批头套");
});

test("matches tracking by offer id before title", () => {
  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/1020395271677.html",
    title: "другое название"
  }, shipments), ["435233621072490"]);
});

test("matches tracking by exact normalized title", () => {
  assert.deepEqual(matchTrackingForRow({
    link: "",
    title: "经济版7.8Vf全能套 + 30件批头套"
  }, shipments), ["435233604737349"]);
});

test("returns multiple unique tracks when the same product is in several shipments", () => {
  const repeated = [...shipments, {
    trackingNumber: "SECOND",
    products: [{ offerId: "1020395271677", title: "9031【充电式280电机5档调速】入门配" }]
  }];
  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/1020395271677.html",
    title: "9031【充电式280电机5档调速】入门配"
  }, repeated), ["435233621072490", "SECOND"]);
});

test("leaves ambiguous title match empty", () => {
  const ambiguous = [
    { trackingNumber: "A", products: [{ title: "全能工具套装红色" }] },
    { trackingNumber: "B", products: [{ title: "全能工具套装蓝色" }] }
  ];
  assert.deepEqual(matchTrackingForRow({ link: "", title: "全能工具套装" }, ambiguous), []);
});

test("uses title to disambiguate the same offer split across shipments", () => {
  const splitOffer = [
    { trackingNumber: "RED", products: [{ offerId: "100", title: "工具套装红色" }] },
    { trackingNumber: "BLUE", products: [{ offerId: "100", title: "工具套装蓝色" }] }
  ];
  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/100.html",
    title: "工具套装蓝色"
  }, splitOffer), ["BLUE"]);
  assert.deepEqual(matchTrackingForRow({
    link: "https://detail.1688.com/offer/100.html",
    title: ""
  }, splitOffer), []);
});
