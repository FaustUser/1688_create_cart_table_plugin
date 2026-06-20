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
    const match = source.match(new RegExp(`${LABEL_SOURCE}\\s*[:：]?\\s*([A-Za-z0-9-]{6,50})`, "i"));
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

  function shipmentFromComponentData(trackData, productData) {
    const trackingNumber = normalizeTrackingNumbers([
      trackData?.mailNo,
      trackData?.logisticsBillNo,
      trackData?.noLogisticsBillNo,
      trackData?.logisticsExternalNo
    ])[0] || "";
    if (!trackingNumber) return null;

    const products = (Array.isArray(productData) ? productData : []).map((product) => {
      const title = String(
        product?.name ||
        product?.subject ||
        product?.productName ||
        product?.title ||
        ""
      ).trim();
      const href = String(product?.offerUrl || product?.detailUrl || "").trim();
      return {
        orderEntryId: String(product?.orderEntryId || "").trim(),
        offerId: String(product?.offerId || product?.offerID || offerIdFromHref(href)).trim(),
        title,
        normalizedTitle: normalizeProductTitle(title)
      };
    }).filter((product) => product.offerId || product.normalizedTitle);

    return { trackingNumber, products };
  }

  function extractComponentShipments(elements) {
    const tracks = (elements || []).filter((element) =>
      String(element?.tagName || "").toLowerCase() === "logistics-info-track"
    );
    const products = (elements || []).filter((element) =>
      String(element?.tagName || "").toLowerCase() === "logistics-info-product"
    );
    const shipments = [];
    const seen = new Set();

    tracks.forEach((trackElement, index) => {
      const productElement =
        trackElement.parentElement?.querySelector?.("logistics-info-product") ||
        products[index];
      const shipment = shipmentFromComponentData(trackElement.data, productElement?.data);
      if (!shipment || seen.has(shipment.trackingNumber)) return;
      seen.add(shipment.trackingNumber);
      shipments.push(shipment);
    });
    return shipments;
  }

  function parseShipmentCandidates(candidates, expectedProducts = []) {
    const shipments = [];
    for (const candidate of candidates || []) {
      const trackingNumber = extractStrictTrackingNumber(candidate.text);
      if (!trackingNumber) continue;
      const explicitProducts = (candidate.products || []).map((product) => {
        const title = String(product.title || "").trim();
        return {
          offerId: String(product.offerId || offerIdFromHref(product.href)).trim(),
          title,
          normalizedTitle: normalizeProductTitle(title)
        };
      }).filter((product) => product.offerId || product.normalizedTitle);
      const candidateText = normalizeProductTitle(candidate.text);
      const inferredProducts = (expectedProducts || []).filter((product) => {
        const normalizedTitle = normalizeProductTitle(product.title);
        return (normalizedTitle.length >= 4 && candidateText.includes(normalizedTitle)) ||
          (product.offerId && String(candidate.text).includes(String(product.offerId)));
      }).map((product) => ({
        offerId: String(product.offerId || offerIdFromHref(product.link)).trim(),
        title: String(product.title || "").trim(),
        normalizedTitle: normalizeProductTitle(product.title)
      }));
      const products = [...explicitProducts];
      for (const product of inferredProducts) {
        if (!products.some((existing) =>
          (product.offerId && existing.offerId === product.offerId) ||
          (product.normalizedTitle && existing.normalizedTitle === product.normalizedTitle)
        )) products.push(product);
      }
      shipments.push({ trackingNumber, products });
    }
    return shipments;
  }

  function textShipmentCandidates(text) {
    const source = String(text || "");
    const pattern = new RegExp(`${LABEL_SOURCE}\\s*[:：]?\\s*[A-Za-z0-9-]{6,50}`, "gi");
    const matches = [...source.matchAll(pattern)];
    return matches.map((match, index) => {
      const previousEnd = index === 0 ? 0 : matches[index - 1].index + matches[index - 1][0].length;
      const nextStart = matches[index + 1]?.index ?? source.length;
      const start = index === 0 ? 0 : Math.floor((previousEnd + match.index) / 2);
      const end = index === matches.length - 1
        ? source.length
        : Math.floor((match.index + match[0].length + nextStart) / 2);
      return { text: source.slice(start, end), products: [] };
    });
  }

  function parseShipmentsFromText(text, expectedProducts = []) {
    const source = String(text || "");
    const candidates = textShipmentCandidates(source);
    const pattern = new RegExp(`${LABEL_SOURCE}\\s*[:：]?\\s*[A-Za-z0-9-]{6,50}`, "gi");
    const trackMatches = [...source.matchAll(pattern)];
    for (const product of expectedProducts || []) {
      const title = String(product.title || "").trim();
      const offerId = String(product.offerId || offerIdFromHref(product.link)).trim();
      const positions = [title ? source.indexOf(title) : -1, offerId ? source.indexOf(offerId) : -1].filter((index) => index >= 0);
      if (!positions.length || !trackMatches.length) continue;
      const productIndex = Math.min(...positions);
      let shipmentIndex = trackMatches.findIndex((match) => match.index >= productIndex);
      if (shipmentIndex < 0) shipmentIndex = trackMatches.length - 1;
      (candidates[shipmentIndex].products ||= []).push(product);
    }
    return parseShipmentCandidates(candidates, expectedProducts);
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

  function expectedProductsInText(text, expectedProducts) {
    const normalizedText = normalizeProductTitle(text);
    return (expectedProducts || []).some((product) => {
      const normalizedTitle = normalizeProductTitle(product.title);
      return (normalizedTitle.length >= 4 && normalizedText.includes(normalizedTitle)) ||
        (product.offerId && String(text).includes(String(product.offerId)));
    });
  }

  function shipmentContainerFor(labelElement, expectedProducts = []) {
    let current = labelElement;
    let fallback = null;
    for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
      const products = productCandidatesFrom(current);
      const currentText = String(current.innerText || current.textContent || "");
      const labels = currentText.match(new RegExp(LABEL_SOURCE, "gi")) || [];
      if (labels.length !== 1) continue;
      fallback = current;
      if (products.length || expectedProductsInText(currentText, expectedProducts)) return current;
    }
    return fallback;
  }

  function extractShipments(scope, expectedProducts = []) {
    const elements = [];
    collectElements(scope, elements);
    const componentShipments = extractComponentShipments(elements);
    if (componentShipments.some((shipment) => shipment.products.length)) {
      return componentShipments;
    }
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
      const container = shipmentContainerFor(element, expectedProducts);
      if (!container) continue;
      seen.add(trackingNumber);
      candidates.push({
        text: labelAndValue,
        products: productCandidatesFrom(container)
      });
    }
    const domShipments = parseShipmentCandidates(candidates, expectedProducts);
    const foundTracks = new Set(domShipments.map((shipment) => shipment.trackingNumber));
    const bodyText = String(scope?.body?.innerText || scope?.innerText || scope?.textContent || "");
    const fallback = parseShipmentsFromText(bodyText, expectedProducts)
      .filter((shipment) => !foundTracks.has(shipment.trackingNumber));
    return [...domShipments, ...fallback];
  }

  const api = {
    extractTrackingNumbers,
    extractTrackingNumbersFromText,
    normalizeTrackingNumbers,
    joinTrackingNumbers,
    parseShipmentCandidates,
    shipmentFromComponentData,
    extractComponentShipments,
    extractStrictTrackingNumber,
    extractShipments,
    parseShipmentsFromText
  };
  root.WB1688TrackingParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
