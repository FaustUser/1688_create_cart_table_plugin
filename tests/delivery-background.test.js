const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

test("checks three orders in parallel and saves the source file only once", async () => {
  const values = {};
  const writes = [];
  const tabs = new Map();
  const downloads = [];
  let peakTabs = 0;
  let nextTabId = 1;
  let listener;
  let workbookCalls = 0;
  const chrome = {
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(data) { Object.assign(values, data); writes.push(data); },
      async remove(key) { delete values[key]; }
    } },
    tabs: {
      async create({ url }) {
        const id = nextTabId++;
        tabs.set(id, { id, url, status: "loading" });
        peakTabs = Math.max(peakTabs, tabs.size);
        return tabs.get(id);
      },
      async get(id) { return tabs.get(id); },
      async remove(id) { tabs.delete(id); },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript({ target }) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const order = new URL(tabs.get(target.tabId).url).searchParams.get("orderId");
      return [{ result: [{ trackingNumber: `T${order}`, statusText: "已签收", statusCode: "SIGN" }] }];
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      getURL(path) { return `chrome-extension://test/${path}`; },
      async getContexts() { return [{}]; },
      async sendMessage(message) {
        if (message.type === "WB_1688_CREATE_DOWNLOAD_URL") return { ok: true, url: "blob:test" };
        return { ok: true };
      }
    },
    downloads: { async download(options) { downloads.push(options); } }
  };
  const context = {
    chrome, console: { info() {}, warn() {}, error() {} }, crypto: webcrypto, importScripts() {},
    WB1688DeliveryJob: require("../delivery-job.js"),
    WB1688DeliveryParser: require("../delivery-parser.js"),
    WB1688TrackingXlsx: { async enrichDeliveryWorkbook() { workbookCalls += 1; return Uint8Array.of(1); } },
    setTimeout, clearTimeout, atob, btoa
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  const response = await new Promise((resolve) => listener({
    type: "WB_1688_DELIVERY_START",
    fileName: "orders.xlsx",
    sourceBase64: btoa("source"),
    orders: ["1", "2", "3", "4"],
    tracksByOrder: { 1: ["T1"], 2: ["T2"], 3: ["T3"], 4: ["T4"] }
  }, {}, resolve));
  assert.equal(response.ok, true);
  for (let i = 0; i < 100 && values.wb1688DeliveryJob?.status !== "completed"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const state = values.wb1688DeliveryJob;
  assert.equal(state.status, "completed");
  assert.equal(peakTabs, 3);
  assert.equal(tabs.size, 0);
  assert.equal(workbookCalls, 1);
  assert.equal(downloads[0].filename, "orders_со_статусами.xlsx");
  assert.equal(values.wb1688DeliverySource, undefined);
  assert.equal(writes.filter((entry) => Object.hasOwn(entry, "wb1688DeliverySource")).length, 1);
  assert.ok(writes.filter((entry) => Object.hasOwn(entry, "wb1688DeliveryJob"))
    .every((entry) => !Object.hasOwn(entry.wb1688DeliveryJob, "sourceBase64")));
  assert.deepEqual(Object.keys(state.statusesByOrder).sort(), ["1", "2", "3", "4"]);
  assert.ok(Object.values(state.statusesByOrder).every((entry) => Object.values(entry)[0] === "Доставлено"));
  assert.equal(state.events.filter((entry) => entry.phase === "order_done").length, 4);
});

test("cancellation closes all active tabs and prevents a completed workbook", async () => {
  const values = {};
  const tabs = new Map();
  let listener;
  let nextTabId = 1;
  let releaseScripts;
  let scriptCalls = 0;
  let downloads = 0;
  const scriptsGate = new Promise((resolve) => { releaseScripts = resolve; });
  const chrome = {
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(data) { Object.assign(values, data); },
      async remove(key) { delete values[key]; }
    } },
    tabs: {
      async create({ url }) {
        const tab = { id: nextTabId++, url };
        tabs.set(tab.id, tab);
        return tab;
      },
      async get(id) { return tabs.get(id); },
      async remove(id) { tabs.delete(id); },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript() {
      scriptCalls += 1;
      await scriptsGate;
      return [{ result: [{ trackingNumber: "T1", statusText: "已签收" }] }];
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage() { return { ok: true }; }
    },
    downloads: { async download() { downloads += 1; } }
  };
  const context = {
    chrome, console: { info() {}, warn() {}, error() {} }, crypto: webcrypto, importScripts() {},
    WB1688DeliveryJob: require("../delivery-job.js"),
    WB1688DeliveryParser: require("../delivery-parser.js"),
    WB1688TrackingXlsx: { async enrichDeliveryWorkbook() { throw new Error("should not finalize"); } },
    setTimeout, clearTimeout, atob, btoa
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  assert.equal((await send({
    type: "WB_1688_DELIVERY_START", fileName: "orders.xlsx", sourceBase64: btoa("source"),
    orders: ["1", "2", "3"], tracksByOrder: { 1: ["T1"], 2: ["T2"], 3: ["T3"] }
  })).ok, true);
  for (let i = 0; i < 100 && scriptCalls < 3; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(scriptCalls, 3);
  const cancelled = await send({ type: "WB_1688_DELIVERY_CANCEL" });
  assert.equal(cancelled.state.status, "cancelled");
  releaseScripts();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(tabs.size, 0);
  assert.equal(values.wb1688DeliverySource, undefined);
  assert.equal(values.wb1688DeliveryJob.status, "cancelled");
  assert.deepEqual(Object.keys(values.wb1688DeliveryJob.statusesByOrder), []);
  assert.equal(downloads, 0);
});
