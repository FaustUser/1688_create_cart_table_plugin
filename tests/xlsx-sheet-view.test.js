const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeFrozenHeaderSheetViewsXML } = require("../xlsx-sheet-view.js");

test("freezes the first worksheet row", () => {
  const xml = makeFrozenHeaderSheetViewsXML();

  assert.match(xml, /<sheetViews>/);
  assert.match(xml, /<sheetView workbookViewId="0">/);
  assert.match(
    xml,
    /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/
  );
});

test("includes the frozen pane in generated worksheets", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const popupHtml = fs.readFileSync(path.join(projectRoot, "popup.html"), "utf8");
  const popupJs = fs.readFileSync(path.join(projectRoot, "popup.js"), "utf8");
  const activeGenerator = popupJs.slice(
    popupJs.indexOf("function makeSheetXML("),
    popupJs.indexOf("async function runTabExportLegacy")
  );

  assert.match(
    popupHtml,
    /<script src="xlsx-sheet-view\.js"><\/script>\s*<script src="popup\.js"><\/script>/
  );
  assert.match(
    activeGenerator,
    /makeFrozenHeaderSheetViewsXML\(\)\+\s*colsXml/
  );
});
