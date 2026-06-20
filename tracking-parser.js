(function (root) {
  const LABEL_SOURCE = "(?:运单号码|Номер\\s+накладной)";
  const LABEL_RE = new RegExp(LABEL_SOURCE, "i");
  const LABELED_VALUE_RE = new RegExp(`${LABEL_SOURCE}\\s*[:：]?\\s*([^\\r\\n]+)`, "gi");

  function cleanValue(value) {
    return String(value || "")
      .replace(new RegExp(LABEL_SOURCE, "gi"), "")
      .replace(/^[\s:：-]+|[\s,，;；]+$/g, "")
      .trim();
  }

  function normalizeTrackingNumbers(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const value = cleanValue(raw);
      if (!value || value.length > 160 || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function extractTrackingNumbersFromText(text) {
    const values = [];
    const source = String(text || "");
    for (const match of source.matchAll(LABELED_VALUE_RE)) values.push(match[1]);
    return normalizeTrackingNumbers(values);
  }

  function collectElements(scope, output) {
    if (!scope?.querySelectorAll) return;
    for (const element of scope.querySelectorAll("*")) {
      output.push(element);
      if (element.shadowRoot) collectElements(element.shadowRoot, output);
    }
  }

  function extractTrackingNumbers(scope) {
    const elements = [];
    collectElements(scope, elements);
    const values = extractTrackingNumbersFromText(scope?.body?.innerText || scope?.innerText || "");

    for (const element of elements) {
      const ownText = String(element.innerText || element.textContent || "").trim();
      if (!ownText || !LABEL_RE.test(ownText)) continue;
      values.push(...extractTrackingNumbersFromText(ownText));
      const sibling = element.nextElementSibling;
      if (sibling) values.push(sibling.innerText || sibling.textContent || "");
      const container = element.closest?.("li, tr, dl, [class*=logistic], [class*=express], [class*=waybill]");
      if (container && container !== element) {
        values.push(...extractTrackingNumbersFromText(container.innerText || container.textContent || ""));
      }
    }
    return normalizeTrackingNumbers(values);
  }

  function joinTrackingNumbers(values) {
    return normalizeTrackingNumbers(values).join("\n");
  }

  const api = {
    extractTrackingNumbers,
    extractTrackingNumbersFromText,
    normalizeTrackingNumbers,
    joinTrackingNumbers
  };
  root.WB1688TrackingParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
