const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractOrderNumbersFromSheetXml,
  enrichSheetXml,
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

test("updates existing tracking column without inserting another", () => {
  const once = enrichSheetXml(sheet, [], { "512": ["SF1"] }).xml;
  const twice = enrichSheetXml(once, [], { "512": ["SF2"] }).xml;
  assert.equal((twice.match(/Трек номер/g) || []).length, 1);
  assert.match(twice, /SF2/);
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
  assert.deepEqual((await inspectTrackingWorkbook(enriched)).orders, ["512"]);
});
