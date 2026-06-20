const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTrackingNumbersFromText,
  normalizeTrackingNumbers,
  joinTrackingNumbers,
  parseShipmentCandidates,
  extractStrictTrackingNumber,
  parseShipmentsFromText
} = require("../tracking-parser.js");

test("extracts Chinese and Russian labeled tracking numbers", () => {
  assert.deepEqual(
    extractTrackingNumbersFromText("运单号码：SF123456\nНомер накладной: LP987654"),
    ["SF123456", "LP987654"]
  );
});

test("extracts only the value from a separate tracking-number sibling", () => {
  assert.equal(extractStrictTrackingNumber("运单号码\n435233621072490"), "435233621072490");
  assert.equal(extractStrictTrackingNumber("运单号码\n发货时间：\n2026-06-19 16:38:46"), "");
});

test("builds shipments from raw logistics blocks using expected Excel products", () => {
  const shipments = parseShipmentCandidates([
    {
      text: "物流信息 运单号码 435233621072490 发货时间 2026-06-19 16:38:46 9031【充电式280电机5档调速】入门配",
      products: []
    }
  ], [{
    offerId: "1020395271677",
    link: "https://detail.1688.com/offer/1020395271677.html",
    title: "9031【充电式280电机5档调速】入门配"
  }]);
  assert.equal(shipments[0].trackingNumber, "435233621072490");
  assert.equal(shipments[0].products[0].offerId, "1020395271677");
});

test("associates product text that appears before the tracking label", () => {
  const shipments = parseShipmentsFromText(
    "9031【充电式280电机5档调速】入门配 发货信息 运单号码 435233621072490 发货时间 2026-06-19 16:38:46 " +
    "经济版7.8Vf全能套+30件批头套 发货信息 运单号码 435233604737349 发货时间 2026-06-19 16:20:29",
    [
      { offerId: "1020395271677", title: "9031【充电式280电机5档调速】入门配" },
      { offerId: "719746403487", title: "经济版7.8Vf全能套+30件批头套" }
    ]
  );
  assert.deepEqual(shipments.map((shipment) => ({
    track: shipment.trackingNumber,
    offerIds: shipment.products.map((product) => product.offerId)
  })), [
    { track: "435233621072490", offerIds: ["1020395271677"] },
    { track: "435233604737349", offerIds: ["719746403487"] }
  ]);
});

test("normalizes duplicate values and joins them with line breaks", () => {
  const values = normalizeTrackingNumbers([" SF123 ", "SF123", "LP456"]);
  assert.deepEqual(values, ["SF123", "LP456"]);
  assert.equal(joinTrackingNumbers(values), "SF123\nLP456");
});

test("parses shipment records without shipping time and dates", () => {
  const shipments = parseShipmentCandidates([
    {
      text: "运单号码：435233621072490\n发货时间：\n2026-06-19 16:38:46",
      products: [{ href: "https://detail.1688.com/offer/1020395271677.html", title: "9031【充电式280电机5档调速】入门配" }]
    },
    {
      text: "运单号码：435233604737349\n发货时间：\n2026-06-19 16:20:29",
      products: [{ href: "https://detail.1688.com/offer/719746403487.html", title: "经济版7.8Vf全能套+30件批头套" }]
    }
  ]);

  assert.deepEqual(shipments, [
    {
      trackingNumber: "435233621072490",
      products: [{
        offerId: "1020395271677",
        title: "9031【充电式280电机5档调速】入门配",
        normalizedTitle: "9031充电式280电机5档调速入门配"
      }]
    },
    {
      trackingNumber: "435233604737349",
      products: [{
        offerId: "719746403487",
        title: "经济版7.8Vf全能套+30件批头套",
        normalizedTitle: "经济版7.8vf全能套30件批头套"
      }]
    }
  ]);
});
