(function (root) {
  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/：/g, ":")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeOrderDate(value) {
    const match = normalizeText(value).match(
      /(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );
    if (!match) return "";

    const [, year, month, day, hour, minute, second = "00"] = match;
    if (
      Number(month) < 1 || Number(month) > 12 ||
      Number(day) < 1 || Number(day) > 31 ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    ) {
      return "";
    }

    return `${pad2(day)}.${pad2(month)}.${year} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  }

  function extractOrderNumber(value) {
    const match = normalizeText(value).match(
      /(?:订单号|订单编号|order\s*(?:number|no\.?)|номер\s+заказа)\s*[:#]?\s*([A-Za-z0-9-]{3,})/i
    );
    return match ? match[1] : "";
  }

  function extractOrderDate(value) {
    const text = normalizeText(value);
    const labeled = text.match(
      /(?:下单时间|创建时间|成交时间|order\s*(?:date|time)|дата\s+заказа)\s*:?\s*([^|;,]+?)(?=\s+(?:订单号|订单编号|order\s*(?:number|no\.?)|номер\s+заказа)\b|$)/i
    );
    return normalizeOrderDate(labeled ? labeled[1] : text);
  }

  function parseOrderMetadata(value) {
    return {
      orderNumber: extractOrderNumber(value),
      orderDate: extractOrderDate(value)
    };
  }

  const api = {
    normalizeOrderDate,
    extractOrderNumber,
    extractOrderDate,
    parseOrderMetadata
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);

