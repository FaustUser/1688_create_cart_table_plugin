const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function makeHarness({ blockScripts = false, tabStatus = "complete", emptyComponents = false, componentDataForOrder } = {}) {
  const values = {};
  const writes = [];
  const tabs = new Map();
  const downloads = [];
  let listener;
  let nextTabId = 1;
  let peakTabs = 0;
  let workbookCalls = 0;
  let scriptCalls = 0;
  let contentCalls = 0;
  const componentCallsByOrder = {};
  let releaseScripts;
  const scriptsGate = blockScripts ? new Promise((resolve) => { releaseScripts = resolve; }) : null;
  const chrome = {
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(data) { Object.assign(values, data); writes.push(data); },
      async remove(key) { delete values[key]; }
    } },
    tabs: {
      async create({ url }) {
        const tab = { id: nextTabId++, url, status: tabStatus };
        tabs.set(tab.id, tab);
        peakTabs = Math.max(peakTabs, tabs.size);
        return tab;
      },
      async get(id) { return tabs.get(id); },
      async remove(id) { tabs.delete(id); },
      async sendMessage(id) {
        contentCalls += 1;
        const order = new URL(tabs.get(id).url).searchParams.get("orderId");
        return { ok: true, shipments: [{ trackingNumber: `T${order}`, products: [{ offerId: `P${order}` }] }] };
      },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript({ target }) {
      scriptCalls += 1;
      if (scriptsGate) await scriptsGate;
      const order = new URL(tabs.get(target.tabId).url).searchParams.get("orderId");
      componentCallsByOrder[order] = (componentCallsByOrder[order] || 0) + 1;
      const result = componentDataForOrder
        ? componentDataForOrder(order, componentCallsByOrder[order])
        : emptyComponents ? [] : [{ trackData: { order }, productData: { order } }];
      return [{ result }];
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      getURL(path) { return `chrome-extension://test/${path}`; },
      async getContexts() { return [{}]; },
      async sendMessage(message) {
        return message.type === "WB_1688_CREATE_DOWNLOAD_URL" ? { ok: true, url: "blob:test" } : { ok: true };
      }
    },
    downloads: { async download(options) { downloads.push(options); } }
  };
  const context = {
    chrome, console: { info() {}, warn() {}, error() {} }, crypto: webcrypto, importScripts() {},
    WB1688TrackingJob: require("../tracking-job.js"),
    WB1688DeliveryJob: require("../delivery-job.js"),
    WB1688TrackingParser: { shipmentFromComponentData(trackData, productData) {
      return { trackingNumber: trackData.trackingNumber || `T${trackData.order}`,
        products: Array.isArray(productData) ? productData : [{ offerId: `P${trackData.order}` }] };
    } },
    WB1688TrackingMatcher: require("../tracking-matcher.js"),
    WB1688TrackingXlsx: { async enrichTrackingWorkbook() { workbookCalls += 1; return Uint8Array.of(1); } },
    setTimeout, clearTimeout, atob, btoa
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  return {
    values, writes, tabs, downloads, context,
    get peakTabs() { return peakTabs; },
    get workbookCalls() { return workbookCalls; },
    get scriptCalls() { return scriptCalls; },
    get contentCalls() { return contentCalls; },
    releaseScripts() { releaseScripts?.(); },
    send(message) { return new Promise((resolve) => listener(message, {}, resolve)); }
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 600 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), "background job did not reach the expected state");
}

test("tracking checks three orders in parallel, logs every order and saves once", async () => {
  const h = makeHarness();
  const response = await h.send({
    type: "WB_1688_TRACKING_START", fileName: "orders_с_треками.xlsx",
    sourceBase64: btoa("source"), orders: ["1", "2", "3", "4"], skippedTrackedRows: 7,
    productsByOrder: {}
  });
  assert.equal(response.ok, true);
  await waitFor(() => h.values.wb1688TrackingJob?.status === "completed");
  const state = h.values.wb1688TrackingJob;
  assert.equal(h.peakTabs, 3);
  assert.equal(h.contentCalls, 0);
  assert.equal(h.tabs.size, 0);
  assert.equal(h.workbookCalls, 1);
  assert.equal(h.downloads[0].filename, "orders_с_треками_обновлено.xlsx");
  assert.equal(h.values.wb1688TrackingSource, undefined);
  assert.equal(h.writes.filter((entry) => Object.hasOwn(entry, "wb1688TrackingSource")).length, 1);
  assert.ok(h.writes.filter((entry) => Object.hasOwn(entry, "wb1688TrackingJob"))
    .every((entry) => !Object.hasOwn(entry.wb1688TrackingJob, "sourceBase64")));
  assert.equal(state.found, 4);
  assert.equal(state.events.filter((event) => event.phase === "order_done").length, 4);
  assert.equal(state.events[0].skippedTrackedRows, 7);
  assert.ok(state.events.filter((event) => event.phase === "order_done")
    .every((event) => event.elapsedMs >= 0 && event.navigationMs >= 0));
  assert.equal((await h.send({
    type: "WB_1688_TRACKING_START", fileName: "again.xlsx", sourceBase64: btoa("second"),
    orders: ["5"], productsByOrder: {}
  })).ok, true);
  await waitFor(() => h.values.wb1688TrackingJob?.status === "completed" &&
    h.values.wb1688TrackingJob.fileName === "again.xlsx");
  assert.equal(h.values.wb1688TrackingJob.events.filter((event) => event.phase === "order_done").length, 1);
  assert.equal(h.values.wb1688TrackingJob.events[0].phase, "queued");
});

test("tracking reads complete component data before the tab load event", async () => {
  const h = makeHarness({ tabStatus: "loading" });
  assert.equal((await h.send({
    type: "WB_1688_TRACKING_START", fileName: "orders.xlsx", sourceBase64: btoa("source"),
    orders: ["1"], productsByOrder: {}
  })).ok, true);
  await waitFor(() => h.values.wb1688TrackingJob?.status === "completed");
  assert.equal(h.contentCalls, 0);
  assert.equal(h.values.wb1688TrackingJob.events.find((event) => event.phase === "order_done").source, "components");
});

test("tracking waits for all product shipments before closing the tab", async () => {
  const h = makeHarness({ componentDataForOrder(_order, call) {
    const first = { trackData: { trackingNumber: "TRACK-10001" },
      productData: [{ offerId: "100", title: "First" }] };
    const second = { trackData: { trackingNumber: "TRACK-20002" },
      productData: [{ offerId: "200", title: "Second" }] };
    return call < 3 ? [first] : [first, second];
  } });
  assert.equal((await h.send({
    type: "WB_1688_TRACKING_START", fileName: "orders.xlsx", sourceBase64: btoa("source"),
    orders: ["1"], productsByOrder: { "1": [
      { link: "https://detail.1688.com/offer/100.html", title: "First" },
      { link: "https://detail.1688.com/offer/200.html", title: "Second" }
    ] }
  })).ok, true);
  await waitFor(() => h.values.wb1688TrackingJob?.status === "completed");
  assert.equal(h.values.wb1688TrackingJob.shipmentDataByOrder["1"].length, 2);
  assert.equal(h.contentCalls, 0);
});

test("tracking uses the content fallback when components are missing", async () => {
  const h = makeHarness({ emptyComponents: true });
  assert.equal((await h.send({
    type: "WB_1688_TRACKING_START", fileName: "orders.xlsx", sourceBase64: btoa("source"),
    orders: ["1"], productsByOrder: {}
  })).ok, true);
  await waitFor(() => h.values.wb1688TrackingJob?.status === "completed");
  assert.equal(h.contentCalls, 1);
  assert.equal(h.values.wb1688TrackingJob.found, 1);
});

test("main-world reader uses the waybill label even without a track component", () => {
  const h = makeHarness();
  const item = (label, value) => ({ querySelector(selector) {
    return { textContent: selector === ".info-item-tit" ? label : value };
  } });
  const product = { tagName: "LOGISTICS-INFO-PRODUCT", data: [{ name: "Товар" }] };
  const message = { tagName: "LOGISTICS-INFO-MESSAGE",
    shadowRoot: { querySelectorAll(selector) {
      return selector === ".info-item" ? [
        item("物流编号：", "LP00851692921520"),
        item("运单号码：", "435403379191067")
      ] : [];
    } },
    parentElement: { querySelector(selector) {
      return selector === "logistics-info-product" ? product : null;
    } }
  };
  h.context.document = { querySelectorAll() { return [message, product]; } };
  const result = h.context.readLogisticsComponentsInPage();
  assert.equal(result.length, 1);
  assert.equal(result[0].trackData.waybillNo, "435403379191067");
  assert.equal(result[0].productData[0].name, "Товар");
  h.context.document = { body: { innerText: "物流编号：LP00851692921520\n运单号码：435403379191067" } };
  assert.deepEqual(Array.from(h.context.readTrackingNumbersFromPageText(),
    (shipment) => shipment.trackingNumber), ["435403379191067"]);
});

test("both journals retain more than 200 events", () => {
  const h = makeHarness();
  let tracking = { events: [] };
  let delivery = { events: [] };
  for (let i = 0; i < 250; i++) {
    tracking = h.context.trackingEvent(tracking, "info", "test", `tracking ${i}`);
    delivery = h.context.deliveryEvent(delivery, "info", "test", `delivery ${i}`);
  }
  assert.equal(tracking.events.length, 250);
  assert.equal(delivery.events.length, 250);
});

test("tracking cancellation closes all three tabs and does not create a workbook", async () => {
  const h = makeHarness({ blockScripts: true });
  assert.equal((await h.send({
    type: "WB_1688_TRACKING_START", fileName: "orders.xlsx",
    sourceBase64: btoa("source"), orders: ["1", "2", "3", "4"], productsByOrder: {}
  })).ok, true);
  await waitFor(() => h.scriptCalls === 3);
  const cancelled = await h.send({ type: "WB_1688_TRACKING_CANCEL" });
  assert.equal(cancelled.state.status, "cancelled");
  h.releaseScripts();
  await waitFor(() => h.tabs.size === 0);
  assert.equal(h.values.wb1688TrackingSource, undefined);
  assert.equal(h.values.wb1688TrackingJob.status, "cancelled");
  assert.equal(h.workbookCalls, 0);
  assert.equal(h.downloads.length, 0);
});
