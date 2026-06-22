const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../content.js"), "utf8");

function extractFunction(name) {
  let start = source.indexOf(`function ${name}`);
  if (start === -1) start = source.indexOf(`function* ${name}`);
  assert.notEqual(start, -1);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("content script collects tracking numbers with bounded polling", () => {
  assert.match(source, /WB_1688_COLLECT_TRACKING/);
  assert.match(source, /WB1688TrackingParser\.extractShipments/);
  assert.match(source, /msg\.products/);
  assert.match(source, /shipments\.every\(\(shipment\) => shipment\.products\.length\)/);
  assert.match(source, /diagnostic/);
});

test("cart selected mode recognizes checked marker inside custom checkbox", () => {
  const isChecked = Function(`${extractFunction("isChecked")}; return isChecked;`)();
  const checkedMarker = {
    matches: () => false,
    querySelector: () => null,
    classList: {
      contains: () => false
    },
    getAttribute: (name) => name === "class" ? "next-checkbox-inner next-checkbox-checked" : null
  };
  const checkbox = {
    matches: () => false,
    querySelector: (selector) => selector === "[class]" ? checkedMarker : null,
    querySelectorAll: (selector) => selector === "[class], [aria-checked]" ? [checkedMarker] : [],
    classList: {
      contains: () => false
    },
    getAttribute: () => null
  };

  assert.equal(isChecked(checkbox), true);
});

test("order selected mode can read checked marker from order header", () => {
  const isOrderBlockSelected = Function([
    extractFunction("deepWalk"),
    extractFunction("deepQueryAll"),
    extractFunction("isChecked"),
    extractFunction("isCheckedSelectionControl"),
    extractFunction("isOrderBlockSelected"),
    "return isOrderBlockSelected;"
  ].join("\n"))();
  const checkedMarker = {
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => name === "class" ? "next-checkbox-inner next-checkbox-checked" : null
  };
  const header = {
    querySelectorAll: (selector) => selector === 'input[type="checkbox"], [role="checkbox"], [aria-checked], [class*="checkbox"], [class*="Checkbox"]' ? [checkedMarker] : [],
    closest: () => null,
    previousElementSibling: null
  };
  const orderContent = {
    querySelectorAll: () => [],
    closest: () => null,
    previousElementSibling: header
  };

  assert.equal(isOrderBlockSelected(orderContent), true);
});

test("order selected mode ignores unrelated selected classes inside order content", () => {
  const isOrderBlockSelected = Function([
    extractFunction("deepWalk"),
    extractFunction("deepQueryAll"),
    extractFunction("isChecked"),
    extractFunction("isCheckedSelectionControl"),
    extractFunction("isOrderBlockSelected"),
    "return isOrderBlockSelected;"
  ].join("\n"))();
  const unrelatedSelected = {
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => name === "class" ? "product-card selected" : null
  };
  const orderContent = {
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[class], [aria-checked]" ? [unrelatedSelected] : [],
    closest: () => null,
    previousElementSibling: null
  };

  assert.equal(isOrderBlockSelected(orderContent), false);
});

test("order selected mode ignores unchecked custom checkbox", () => {
  const isOrderBlockSelected = Function([
    extractFunction("deepWalk"),
    extractFunction("deepQueryAll"),
    extractFunction("isChecked"),
    extractFunction("isCheckedSelectionControl"),
    extractFunction("isOrderBlockSelected"),
    "return isOrderBlockSelected;"
  ].join("\n"))();
  const uncheckedMarker = {
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => name === "class" ? "next-checkbox-inner next-checkbox-unchecked" : null
  };
  const header = {
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'input[type="checkbox"], [role="checkbox"], [aria-checked], [class*="checkbox"], [class*="Checkbox"]' ? [uncheckedMarker] : [],
    closest: () => null,
    previousElementSibling: null
  };
  const orderContent = {
    querySelectorAll: () => [],
    closest: () => null,
    previousElementSibling: header
  };

  assert.equal(isOrderBlockSelected(orderContent), false);
});

test("order selected mode reads the real 1688 q-checkbox checked attribute", () => {
  const isOrderBlockSelected = Function([
    extractFunction("deepWalk"),
    extractFunction("deepQueryAll"),
    extractFunction("isChecked"),
    extractFunction("isCheckedSelectionControl"),
    extractFunction("isOrderBlockSelected"),
    "return isOrderBlockSelected;"
  ].join("\n"))();
  const createCheckbox = (checked) => ({
    matches: (selector) => selector.includes("q-checkbox"),
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => {
      if (name === "checked") return checked;
      if (name === "class") return "pc";
      return null;
    }
  });
  const createOrderContent = (checked) => {
    const checkbox = createCheckbox(checked);
    const header = {
      matches: () => false,
      querySelectorAll: (selector) => selector.includes("q-checkbox") ? [checkbox] : [],
      previousElementSibling: null
    };
    return {
      matches: () => false,
      querySelectorAll: () => [],
      closest: () => null,
      previousElementSibling: header
    };
  };

  assert.equal(isOrderBlockSelected(createOrderContent("true")), true);
  assert.equal(isOrderBlockSelected(createOrderContent("false")), false);
});

test("checked=false is not treated as a selected native checkbox", () => {
  const isChecked = Function(`${extractFunction("isChecked")}; return isChecked;`)();
  const checkbox = {
    checked: false,
    matches: (selector) => selector === 'input[type="checkbox"]',
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => name === "checked" ? "false" : null
  };

  assert.equal(isChecked(checkbox), false);
});

test("order selected mode is wired from collectAllRows into order collection", () => {
  assert.match(source, /function collectOrderRows\(cartSelectionMode = "all"\)/);
  assert.match(source, /if \(pageType === "orders"\) return collectOrderRows\(cartSelectionMode\)/);
  assert.match(source, /const checked = isOrderBlockSelected\(b\)/);
  assert.match(source, /if \(normalizedMode === "selected" && !checked\) continue/);
});
