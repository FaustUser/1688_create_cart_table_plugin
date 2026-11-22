const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractDeliveryOrdersFromSheetXml,
  enrichDeliverySheetXml,
  enrichDeliveryWorkbook,
  inspectDeliveryWorkbook,
  zipStore
} = require("../tracking-xlsx.js");

const sheet = `<?xml version="1.0"?><worksheet>
<dimension ref="A1:D3"/><cols><col min="1" max="1" width="20"/><col min="2" max="2" width="25"/></cols>
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Номер заказа</t></is></c><c r="B1" t="inlineStr"><is><t>Трек номер</t></is></c><c r="C1" t="inlineStr"><is><t>Картинка</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>512</t></is></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">JT1\nJT2</t></is></c><c r="C2"><v>7</v></c><c r="D2"><f>C2*2</f><v>14</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>513</t></is></c><c r="B3" t="inlineStr"><is><t></t></is></c></row>
</sheetData><autoFilter ref="A1:D3"/></worksheet>`;

test("queues only orders that have tracks", () => {
  assert.deepEqual(extractDeliveryOrdersFromSheetXml(sheet), {
    orders: ["512"],
    tracksByOrder: { "512": ["JT1", "JT2"] },
    trackedOrders: 1,
    skippedDeliveredOrders: 0
  });
});

test("writes statuses in track order and leaves trackless rows blank", () => {
  const result = enrichDeliverySheetXml(sheet, [], { "512": { JT1: "Доставлено", JT2: "В пути" } });
  assert.match(result.xml, /r="B2"[\s\S]*JT1\nJT2[\s\S]*r="C2"[\s\S]*Доставлено\nВ пути/);
  assert.match(result.xml, /<c r="C3"[^>]*><is><t><\/t><\/is><\/c>/);
  assert.match(result.xml, /<f>D2\*2<\/f>/);
  assert.match(result.xml, /dimension ref="A1:E3"/);
  assert.match(result.xml, /autoFilter ref="A1:E3"/);
  assert.equal((result.xml.match(/Статус доставки/g) || []).length, 1);
  const repeated = enrichDeliverySheetXml(result.xml, [], { "512": { JT1: "В пути", JT2: "Доставлено" } });
  assert.equal(repeated.inserted, false);
  assert.equal((repeated.xml.match(/Статус доставки/g) || []).length, 1);
});

test("matches two rows of one order by their own tracking numbers", () => {
  const twoRows = sheet.replace(
    '<row r="3"><c r="A3" t="inlineStr"><is><t>513</t></is></c><c r="B3" t="inlineStr"><is><t></t></is></c></row>',
    '<row r="3"><c r="A3" t="inlineStr"><is><t>512</t></is></c><c r="B3" t="inlineStr"><is><t>JT3</t></is></c></row>'
  );
  const result = enrichDeliverySheetXml(twoRows, [], {
    "512": { JT1: "Доставлено", JT2: "В пути", JT3: "Передано курьеру" }
  }).xml;
  const first = result.match(/<row r="2">[\s\S]*?<\/row>/)[0];
  const second = result.match(/<row r="3">[\s\S]*?<\/row>/)[0];
  assert.match(first, /Доставлено\nВ пути/);
  assert.doesNotMatch(first, /Передано курьеру/);
  assert.match(second, /Передано курьеру/);
  assert.doesNotMatch(second, /Доставлено/);
});

test("recheck skips delivered tracks and retains their status", () => {
  const first = enrichDeliverySheetXml(sheet, [], { "512": { JT1: "Доставлено", JT2: "В пути" } }).xml;
  assert.deepEqual(extractDeliveryOrdersFromSheetXml(first), {
    orders: ["512"], tracksByOrder: { "512": ["JT2"] }, trackedOrders: 1, skippedDeliveredOrders: 0
  });
  const next = enrichDeliverySheetXml(first, [], { "512": { JT2: "Доставлено" } }).xml;
  assert.match(next, /Доставлено\nДоставлено/);
  assert.deepEqual(extractDeliveryOrdersFromSheetXml(next), {
    orders: [], tracksByOrder: {}, trackedOrders: 1, skippedDeliveredOrders: 1
  });
});

test("keeps an earlier status if a repeated check fails", () => {
  const first = enrichDeliverySheetXml(sheet, [], { "512": { JT1: "Доставлено", JT2: "В пути" } }).xml;
  const next = enrichDeliverySheetXml(first, [], { "512": { JT2: "Не удалось проверить" } }).xml;
  assert.match(next, /Доставлено\nВ пути/);
});

test("inserting inside a grouped column width splits and orders column definitions", () => {
  const grouped = sheet.replace(/<cols>[\s\S]*?<\/cols>/, '<cols><col min="1" max="4" width="20"/></cols>');
  const next = enrichDeliverySheetXml(grouped, [], {}).xml;
  assert.match(next, /<cols><col min="1" max="2" width="20"\/><col min="3" max="3" width="24" customWidth="1"\/><col min="4" max="5" width="20"\/><\/cols>/);
});

test("inspects and enriches a complete workbook", async () => {
  const enc = new TextEncoder();
  const files = new Map([
    ["xl/workbook.xml", enc.encode(`<workbook><sheets><sheet name="Товары" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", enc.encode(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheet)]
  ]);
  const source = zipStore(files);
  assert.deepEqual((await inspectDeliveryWorkbook(source)).orders, ["512"]);
  const output = await enrichDeliveryWorkbook(source, { "512": { JT1: "Доставлено", JT2: "В пути" } });
  assert.deepEqual((await inspectDeliveryWorkbook(output)).tracksByOrder, { "512": ["JT2"] });
});

test("removes stale calculation chain and its package references", async () => {
  const enc = new TextEncoder();
  const files = new Map([
    ["[Content_Types].xml", enc.encode('<Types><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>')],
    ["xl/workbook.xml", enc.encode('<workbook><sheets><sheet name="Товары" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ["xl/_rels/workbook.xml.rels", enc.encode('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>')],
    ["xl/worksheets/sheet1.xml", enc.encode(sheet)],
    ["xl/calcChain.xml", enc.encode('<calcChain><c r="D2"/></calcChain>')]
  ]);
  const output = await enrichDeliveryWorkbook(zipStore(files), { "512": { JT1: "Доставлено", JT2: "В пути" } });
  assert.doesNotMatch(new TextDecoder().decode(output), /calcChain/);
});
