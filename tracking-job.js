(function (root) {
  function snapshot(state) {
    const { sourceBase64, ...publicState } = state || {};
    return publicState;
  }

  function createTrackingJob(fileName, orders, sourceBase64 = "", productsByOrder = {}) {
    const uniqueOrders = [...new Set((orders || []).map(String).map((x) => x.trim()).filter(Boolean))];
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName,
      sourceBase64,
      productsByOrder,
      orders: uniqueOrders,
      index: 0,
      currentOrder: "",
      trackingByOrder: {},
      shipmentDataByOrder: {},
      found: 0,
      empty: 0,
      remaining: uniqueOrders.length,
      progress: uniqueOrders.length ? 0 : 100,
      status: "idle",
      currentTabId: null,
      error: ""
    };
  }

  function startOrder(state, index) {
    return { ...state, status: "running", index, currentOrder: state.orders[index] || "" };
  }

  function completeOrder(state, order, trackingNumbers) {
    const items = trackingNumbers || [];
    const isShipmentData = items.some((item) => item && typeof item === "object");
    const values = isShipmentData
      ? [...new Set(items.map((item) => String(item.trackingNumber || "").trim()).filter(Boolean))]
      : [...new Set(items.map(String).map((x) => x.trim()).filter(Boolean))];
    const trackingByOrder = { ...state.trackingByOrder, [order]: values };
    const shipmentDataByOrder = isShipmentData
      ? { ...state.shipmentDataByOrder, [order]: items }
      : state.shipmentDataByOrder;
    const processed = Math.min(state.orders.length, state.index + 1);
    const remaining = Math.max(0, state.orders.length - processed);
    return {
      ...state,
      index: processed,
      trackingByOrder,
      shipmentDataByOrder,
      found: state.found + (values.length ? 1 : 0),
      empty: state.empty + (values.length ? 0 : 1),
      remaining,
      progress: state.orders.length ? Math.round(processed * 100 / state.orders.length) : 100,
      status: remaining ? "running" : "completed",
      currentOrder: remaining ? state.currentOrder : "",
      currentTabId: null
    };
  }

  function cancelJob(state) {
    return { ...state, status: "cancelled", currentOrder: "", currentTabId: null };
  }

  const api = { snapshot, createTrackingJob, startOrder, completeOrder, cancelJob };
  root.WB1688TrackingJob = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
