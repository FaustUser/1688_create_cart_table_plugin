const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const popupJs = fs.readFileSync(
  path.resolve(__dirname, "..", "popup.js"),
  "utf8"
);
const orderConfig = popupJs.slice(
  popupJs.indexOf("const ORDER_EXPORT_CONFIG"),
  popupJs.indexOf("const CART_EXPORT_CONFIG")
);
const drawingGenerator = popupJs.slice(
  popupJs.indexOf("function makeDrawingXMLMapped"),
  popupJs.indexOf("const sheetXml = makeSheetXML")
);

test("order export has number, image and date as the first columns", () => {
  assert.match(
    orderConfig,
    /headers:\s*\["Номер заказа",\s*"Картинка",\s*"Дата заказа",\s*"Ссылка"/
  );
});

test("order export writes shifted cells and total formula", () => {
  assert.match(orderConfig, /\{\s*c:\s*1,\s*t:\s*"inlineStr",\s*v:\s*row\.orderNumber/);
  assert.match(orderConfig, /\{\s*c:\s*3,\s*t:\s*"inlineStr",\s*v:\s*row\.orderDate/);
  assert.match(orderConfig, /\{\s*c:\s*4,\s*t:\s*"inlineStr",\s*v:\s*row\.link/);
  assert.match(
    orderConfig,
    /c:\s*10,\s*t:\s*"f",\s*f:\s*`F\$\{excelRow\}\*G\$\{excelRow\}\+H\$\{excelRow\}-I\$\{excelRow\}`/
  );
});

test("order export defines widths for all ten columns", () => {
  const widths = orderConfig.match(/widths:[\s\S]*?=>\s*\[([\s\S]*?)\]/);
  assert.ok(widths);
  assert.equal(widths[1].split(",").length, 10);
});

test("images use column B for orders and column A for cart", () => {
  assert.match(
    drawingGenerator,
    /function makeDrawingXMLMapped\(imgCount,\s*imgPx,\s*rowIdx,\s*imageCol0\)/
  );
  assert.match(drawingGenerator, /const col0 = imageCol0;/);
  assert.match(
    popupJs,
    /makeDrawingXMLMapped\(\s*embedded\.length,\s*imgPx,\s*embeddedRowIdx,\s*pageType === "orders" \? 1 : 0\s*\)/
  );
});

test("manual content-script reinjection includes the metadata parser", () => {
  assert.match(
    popupJs,
    /files:\s*\["order-metadata\.js",\s*"content\.js"\]/
  );
});
