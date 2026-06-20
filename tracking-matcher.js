(function (root) {
  function extractOfferId(value) {
    return (String(value || "").match(/detail\.1688\.com\/offer\/(\d+)\.html/i) || [])[1] || "";
  }

  function normalizeProductTitle(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.]+/gu, "");
  }

  function normalizedProducts(shipments) {
    return (shipments || []).flatMap((shipment) =>
      (shipment.products || []).map((product) => ({
        trackingNumber: String(shipment.trackingNumber || "").trim(),
        offerId: String(product.offerId || extractOfferId(product.href || "")).trim(),
        normalizedTitle: product.normalizedTitle || normalizeProductTitle(product.title || "")
      }))
    ).filter((item) => item.trackingNumber);
  }

  function uniqueTracks(matches) {
    return [...new Set(matches.map((item) => item.trackingNumber).filter(Boolean))];
  }

  function matchTrackingForRow(row, shipments) {
    const products = normalizedProducts(shipments);
    const offerId = extractOfferId(row?.link || "");
    const title = normalizeProductTitle(row?.title || "");
    if (offerId) {
      const byOffer = products.filter((item) => item.offerId === offerId);
      const offerTracks = uniqueTracks(byOffer);
      if (offerTracks.length === 1) return offerTracks;
      if (offerTracks.length > 1 && title) {
        const exactOfferTitle = byOffer.filter((item) => item.normalizedTitle === title);
        const exactOfferTracks = uniqueTracks(exactOfferTitle);
        if (exactOfferTracks.length) return exactOfferTracks;
      }
      if (offerTracks.length > 1) return [];
    }

    if (!title) return [];
    const exact = products.filter((item) => item.normalizedTitle === title);
    if (exact.length) return uniqueTracks(exact);

    if (title.length >= 6) {
      const included = products.filter((item) =>
        item.normalizedTitle.length >= 6 &&
        (item.normalizedTitle.includes(title) || title.includes(item.normalizedTitle))
      );
      const includedTracks = uniqueTracks(included);
      if (includedTracks.length === 1) return includedTracks;
    }
    return [];
  }

  const api = { extractOfferId, normalizeProductTitle, matchTrackingForRow };
  root.WB1688TrackingMatcher = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
