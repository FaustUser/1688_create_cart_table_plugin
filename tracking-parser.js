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

  function extractStrictTrackingNumber(text) {
    const source = String(text || "");
    const match = source.match(new RegExp(`${LABEL_SOURCE}\\s*[:：]?\\s*([^\\r\\n]+)`, "i"));
    const value = cleanValue(match?.[1] || "");
    return /^[A-Za-z0-9-]{6,50}$/.test(value) ? value : "";
  }

  function offerIdFromHref(href) {
    return (String(href || "").match(/detail\.1688\.com\/offer\/(\d+)\.html/i) || [])[1] || "";
  }

  function normalizeProductTitle(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.]+/gu, "");
  }

  function parseShipmentCandidates(candidates) {
    const shipments = [];
    for (const candidate of candidates || []) {
      const trackingNumber = extractStrictTrackingNumber(candidate.text);
      if (!trackingNumber) continue;
      const products = (candidate.products || []).map((product) => {
        const title = String(product.title || "").trim();
        return {
          offerId: String(product.offerId || offerIdFromHref(product.href)).trim(),
          title,
          normalizedTitle: normalizeProductTitle(title)
        };
      }).filter((product) => product.offerId || product.normalizedTitle);
      shipments.push({ trackingNumber, products });
    }
    return shipments;
  }

  function productCandidatesFrom(container) {
    if (!container?.querySelectorAll) return [];
    const products = [];
    const seen = new Set();
    for (const link of container.querySelectorAll('a[href*="detail.1688.com/offer/"]')) {
      const href = link.getAttribute("href") || "";
      const offerId = offerIdFromHref(href);
      if (!offerId || seen.has(offerId)) continue;
      const card = link.closest?.("li, tr, [class*=product], [class*=item], [class*=goods]") || link.parentElement;
      const image = link.querySelector?.("img") || card?.querySelector?.("img");
      const title = String(
        link.getAttribute("title") ||
        image?.getAttribute("alt") ||
        link.innerText ||
        card?.querySelector?.("[title]")?.getAttribute("title") ||
        card?.innerText ||
        ""
      ).trim();
      seen.add(offerId);
      products.push({ href, offerId, title });
    }
    const titleSelectors = [
      "[class*=product-name]", "[class*=productName]", "[class*=product-title]",
      "[class*=goods-name]", "[class*=goodsName]", "[class*=goods-title]",
      "[class*=item-name]", "[class*=itemName]", "[class*=sku-name]"
    ].join(",");
    for (const element of container.querySelectorAll(titleSelectors)) {
      const title = String(element.getAttribute("title") || element.innerText || element.textContent || "").trim();
      const normalized = normalizeProductTitle(title);
      if (title.length < 3 || title.length > 240 || !normalized || LABEL_RE.test(title)) continue;
      const duplicate = products.some((product) => normalizeProductTitle(product.title) === normalized);
      if (!duplicate) products.push({ href: "", offerId: "", title });
    }
    return products;
  }

  function shipmentContainerFor(labelElement) {
    let current = labelElement;
    let fallback = null;
    for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
      const products = productCandidatesFrom(current);
      if (!products.length) continue;
      if (!fallback) fallback = current;
      const labels = String(current.innerText || current.textContent || "").match(new RegExp(LABEL_SOURCE, "gi")) || [];
      if (labels.length === 1) return current;
    }
    return fallback;
  }

  function extractShipments(scope) {
    const elements = [];
    collectElements(scope, elements);
    const candidates = [];
    const seen = new Set();
    for (const element of elements) {
      const ownText = String(element.innerText || element.textContent || "").trim();
      if (!LABEL_RE.test(ownText)) continue;
      const descendantHasLabel = Array.from(element.children || []).some((child) =>
        LABEL_RE.test(String(child.innerText || child.textContent || ""))
      );
      if (descendantHasLabel) continue;
      const siblingText = String(element.nextElementSibling?.innerText || element.nextElementSibling?.textContent || "");
      const labelAndValue = `${ownText}\n${siblingText}`;
      const trackingNumber = extractStrictTrackingNumber(labelAndValue);
      if (!trackingNumber || seen.has(trackingNumber)) continue;
      const container = shipmentContainerFor(element);
      if (!container) continue;
      seen.add(trackingNumber);
      candidates.push({
        text: labelAndValue,
        products: productCandidatesFrom(container)
      });
    }
    return parseShipmentCandidates(candidates);
  }

  const api = {
    extractTrackingNumbers,
    extractTrackingNumbersFromText,
    normalizeTrackingNumbers,
    joinTrackingNumbers,
    parseShipmentCandidates,
    extractStrictTrackingNumber,
    extractShipments
  };
  root.WB1688TrackingParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
