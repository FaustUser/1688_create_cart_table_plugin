(function (root) {
  // This function is injected into the page's MAIN world and must be self-contained.
  function readDeliveryStatusesInPage() {
    const items = [];
    const visit = (scope) => {
      if (!scope?.querySelectorAll) return;
      items.push(...scope.querySelectorAll(".logistics-info-items"));
      for (const element of scope.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(document);
    return items.map((item) => {
      const message = item.querySelector("logistics-info-message")?.shadowRoot;
      let trackingNumber = "";
      for (const field of message?.querySelectorAll(".info-item") || []) {
        const label = field.querySelector(".info-item-tit")?.textContent || "";
        if (/运单号码|运单号|物流单号/.test(label)) {
          trackingNumber = String(field.querySelector(".info-item-val")?.textContent || "").trim();
          break;
        }
      }
      const statusText = String(item.querySelector("logistics-info-status")?.shadowRoot?.querySelector(".status")?.textContent || "").trim();
      const track = item.querySelector("logistics-info-track");
      if (!trackingNumber) trackingNumber = String(track?.data?.mailNo || track?.data?.logisticsBillNo || "").trim();
      const chart = track?.shadowRoot?.querySelector(".logistics-item");
      const statusCode = String(chart?.className || "").split(/\s+/).find((part) =>
        /^(SIGN|DELIVERING|TRANSPORT|ACCEPT|CONSIGN)$/.test(part)
      ) || "";
      return { trackingNumber, statusText, statusCode };
    }).filter((item) => item.trackingNumber);
  }

  function normalizeDeliveryStatus(statusText, statusCode) {
    const label = String(statusText || "").trim();
    if (/已签收|已收货|妥投/.test(label) || statusCode === "SIGN") return "Доставлено";
    if (/派送|派件/.test(label) || statusCode === "DELIVERING") return "Передано курьеру";
    if (/运输|在途|途中/.test(label) || statusCode === "TRANSPORT") return "В пути";
    if (/揽件|揽收/.test(label) || statusCode === "ACCEPT") return "Принято перевозчиком";
    if (/发货|已寄出/.test(label) || statusCode === "CONSIGN") return "Отправлено";
    return label || "Статус не указан";
  }

  const api = { readDeliveryStatusesInPage, normalizeDeliveryStatus };
  root.WB1688DeliveryParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
