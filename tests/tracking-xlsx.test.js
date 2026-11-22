const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractOrderNumbersFromSheetXml,
  extractPendingTrackingFromSheetXml,
  enrichSheetXml,
  enrichDeliverySheetXml,
  shiftDrawingXml,
  zipStore,
  inspectTrackingWorkbook,
  enrichTrackingWorkbook
} = require("../tracking-xlsx.js");

const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:C3"/><cols><col min="1" max="1" width="20"/><col min="2" max="2" width="25"/></cols>
<sheetData>
<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Номер заказа</t></is></c><c r="B1" t="inlineStr"><is><t>Картинка</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>512</t></is></c><c r="B2"><v>7</v></c><c r="C2"><f>B2*2</f><v>14</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>512</t></is></c></row>
</sheetData><autoFilter ref="A1:C3"/></worksheet>`;

test("extracts unique order numbers by header", () => {
  assert.deepEqual(extractOrderNumbersFromSheetXml(sheet, []), ["512"]);
});

test("inspection returns product metadata grouped by order", async () => {
  const enc = new TextEncoder();
  const productSheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Номер заказа</t></is></c><c r="B1" t="inlineStr"><is><t>Ссылка</t></is></c><c r="C1" t="inlineStr"><is><t>Название на 1688</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>512</t></is></c><c r="B2" t="inlineStr"><is><t>https://detail.1688.com/offer/100.html</t></is></c><c r="C2" t="inlineStr"><is><t>Товар 100</t></is></c></row>
  </sheetData></worksheet>`;
  const files = new Map([
    ["xl/workbook.xml", enc.encode(`<workbook><sheets><sheet name="Товары" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", enc.encode(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", enc.encode(productSheet)]
  ]);
  const inspection = await inspectTrackingWorkbook(zipStore(files));
  assert.deepEqual(inspection.productsByOrder, {
    "512": [{ offerId: "100", link: "https://detail.1688.com/offer/100.html", title: "Товар 100" }]
  });
});

test("inserts tracking column and shifts cells and formulas", () => {
  const result = enrichSheetXml(sheet, [], { "512": ["SF1", "LP2"] });
  assert.match(result.xml, /<t>Трек номер<\/t>/);
  assert.match(result.xml, /<c r="B2"[^>]*>[\s\S]*SF1[\s\S]*LP2/);
  assert.match(result.xml, /<c r="C2"><v>7<\/v><\/c>/);
  assert.match(result.xml, /<f>C2\*2<\/f>/);
  assert.match(result.xml, /r="A2"[\s\S]*r="B2"[\s\S]*r="C2"[\s\S]*r="D2"/);
  assert.match(result.xml, /dimension ref="A1:D3"/);
  assert.match(result.xml, /autoFilter ref="A1:D3"/);
});

test("formats order and tracking data cells as text", () => {
  const result = enrichSheetXml(sheet, [], { "512": ["TRACK-512"] }, new Map([[0, 3], [1, 4]]));
  assert.match(result.xml, /<c[^>]*r="A2"[^>]*s="3"|<c[^>]*s="3"[^>]*r="A2"/);
  assert.match(result.xml, /<c r="B2"[^>]*\bs="3"/);
});

test("keeps existing tracking numbers when a generated file is uploaded again", () => {
  const once = enrichSheetXml(sheet, [], { "512": ["SF1"] }).xml;
  const twice = enrichSheetXml(once, [], { "512": ["SF2"] }).xml;
  assert.equal((twice.match(/Трек номер/g) || []).length, 1);
  assert.match(twice, /<c r="B2" t="inlineStr"[^>]*>[\s\S]*<t>SF1<\/t>/);
  assert.doesNotMatch(twice, /SF2/);
});

test("keeps delivery status on rows whose tracking number was already filled", () => {
  const withTracks = enrichSheetXml(sheet, [], { "512": ["SF1"] }).xml;
  const withStatus = enrichDeliverySheetXml(withTracks, [], { "512": { SF1: "Доставлено" } }).xml;
  const updated = enrichSheetXml(withStatus, [], { "512": ["SF2"] }).xml;
  const row2 = updated.match(/<row r="2">[\s\S]*?<\/row>/)[0];
  assert.match(row2, /<c r="B2"[^>]*><is><t>SF1<\/t>/);
  assert.match(row2, /Доставлено/);
});

test("queues only blank product rows and preserves filled rows of the same order", () => {
  const source = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Номер заказа</t></is></c><c r="B1" t="inlineStr"><is><t>Трек номер</t></is></c><c r="C1" t="inlineStr"><is><t>Статус доставки</t></is></c><c r="D1" t="inlineStr"><is><t>Ссылка</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>512</t></is></c><c r="B2" t="inlineStr"><is><t>OLD</t></is></c><c r="C2" t="inlineStr"><is><t>Доставлено</t></is></c><c r="D2" t="inlineStr"><is><t>https://detail.1688.com/offer/100.html</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>512</t></is></c><c r="B3" t="inlineStr"><is><t></t></is></c><c r="C3" t="inlineStr"><is><t></t></is></c><c r="D3" t="inlineStr"><is><t>https://detail.1688.com/offer/200.html</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>999</t></is></c><c r="B4" t="inlineStr"><is><t>DONE</t></is></c></row>
  </sheetData></worksheet>`;
  const inspection = extractPendingTrackingFromSheetXml(source);
  assert.deepEqual(inspection.orders, ["512"]);
  assert.equal(inspection.skippedTrackedRows, 2);
  assert.equal(inspection.skippedTrackedOrders, 1);
  assert.deepEqual(inspection.productsByOrder["512"].map((item) => item.offerId), ["200"]);
  const result = enrichSheetXml(source, [], { "512": ["NEW"], "999": ["WRONG"] }).xml;
  assert.match(result.match(/<row r="2">[\s\S]*?<\/row>/)[0], /OLD[\s\S]*Доставлено/);
  assert.match(result.match(/<row r="3">[\s\S]*?<\/row>/)[0], /NEW/);
  assert.match(result.match(/<row r="4">[\s\S]*?<\/row>/)[0], /DONE/);
});

test("treats self-closing tracking cells as blank even when the next cell has a value", () => {
  const source = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Номер заказа</t></is></c><c r="B1" t="inlineStr"><is><t>Трек номер</t></is></c><c r="C1" t="inlineStr"><is><t>Название на 1688</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>512</t></is></c><c r="B2" s="4"/><c r="C2" t="inlineStr"><is><t>Товар</t></is></c></row>
  </sheetData></worksheet>`;
  const inspection = extractPendingTrackingFromSheetXml(source);
  assert.deepEqual(inspection.orders, ["512"]);
  assert.equal(inspection.skippedTrackedRows, 0);
  assert.deepEqual(inspection.productsByOrder["512"].map((item) => item.title), ["Товар"]);
  const result = enrichSheetXml(source, [], { "512": ["TRACK-512"] }).xml;
  assert.match(result.match(/<row r="2">[\s\S]*?<\/row>/)[0], /<c r="B2"[^>]*>[\s\S]*TRACK-512[\s\S]*<c r="C2"/);
});

test("rechecks a row containing an internal LP number and keeps its real track", () => {
  const source = enrichSheetXml(sheet, [], { "512": ["435404121130551"] }).xml
    .replace("<t>435404121130551</t>", "<t>LP00851692921520\n435404121130551</t>");
  assert.deepEqual(extractPendingTrackingFromSheetXml(source).orders, ["512"]);
  const repaired = enrichSheetXml(source, [], {}).xml;
  const row2 = repaired.match(/<row r="2">[\s\S]*?<\/row>/)[0];
  assert.match(row2, /435404121130551/);
  assert.doesNotMatch(row2, /LP00851692921520/);
});

test("column insertion preserves absolute formula references and updates row spans", () => {
  const source = sheet.replace('<row r="2">', '<row r="2" spans="1:3">')
    .replace('<f>B2*2</f>', '<f>$B$2*B2</f>');
  const result = enrichSheetXml(source, [], { "512": ["SF1"] }).xml;
  assert.match(result, /<row r="2" spans="1:4">/);
  assert.match(result, /<f>\$C\$2\*C2<\/f>/);
});

test("shifts image anchors at and after inserted column", () => {
  const drawing = "<xdr:from><xdr:col>1</xdr:col></xdr:from><xdr:to><xdr:col>2</xdr:col></xdr:to>";
  assert.match(shiftDrawingXml(drawing, 1), /<xdr:col>2<\/xdr:col>[\s\S]*<xdr:col>3<\/xdr:col>/);
});

test("round-trips a complete workbook archive", async () => {
  const enc = new TextEncoder();
  const files = new Map([
    ["xl/workbook.xml", enc.encode(`<workbook><sheets><sheet name="Товары" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", enc.encode(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheet)]
  ]);
  const source = zipStore(files);
  assert.deepEqual((await inspectTrackingWorkbook(source)).orders, ["512"]);
  const enriched = await enrichTrackingWorkbook(source, { "512": ["TRACK-512"] });
  assert.deepEqual((await inspectTrackingWorkbook(enriched)).orders, []);
  assert.equal((await inspectTrackingWorkbook(enriched)).skippedTrackedRows, 2);
  assert.match(new TextDecoder().decode(enriched), /Статус доставки/);
});

test("assigns shipment tracking to each product row of the same order", () => {
  const productSheet = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1">
    <c r="A1" t="inlineStr"><is><t>Номер заказа</t></is></c>
    <c r="B1" t="inlineStr"><is><t>Ссылка</t></is></c>
    <c r="C1" t="inlineStr"><is><t>Название на 1688</t></is></c>
  </row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>5120380515991059600</t></is></c><c r="B2" t="inlineStr"><is><t>https://detail.1688.com/offer/1020395271677.html</t></is></c><c r="C2" t="inlineStr"><is><t>9031【充电式280电机5档调速】入门配</t></is></c></row>
  <row r="3"><c r="A3" t="inlineStr"><is><t>5120380515991059600</t></is></c><c r="B3" t="inlineStr"><is><t>https://detail.1688.com/offer/719746403487.html</t></is></c><c r="C3" t="inlineStr"><is><t>经济版7.8Vf全能套+30件批头套</t></is></c></row>
  </sheetData></worksheet>`;
  const result = enrichSheetXml(productSheet, [], {
    shipmentDataByOrder: {
      "5120380515991059600": [
        { trackingNumber: "435233621072490", products: [{ offerId: "1020395271677", title: "9031【充电式280电机5档调速】入门配" }] },
        { trackingNumber: "435233604737349", products: [{ offerId: "719746403487", title: "经济版7.8Vf全能套+30件批头套" }] }
      ]
    }
  });
  const row2 = result.xml.match(/<row r="2">[\s\S]*?<\/row>/)[0];
  const row3 = result.xml.match(/<row r="3">[\s\S]*?<\/row>/)[0];
  assert.match(row2, /435233621072490/);
  assert.doesNotMatch(row2, /435233604737349/);
  assert.match(row3, /435233604737349/);
  assert.doesNotMatch(row3, /435233621072490/);
});
