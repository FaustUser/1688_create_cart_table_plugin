importScripts("tracking-parser.js", "tracking-job.js", "tracking-matcher.js", "tracking-xlsx.js");

const TRACKING_STATE_KEY = "wb1688TrackingJob";
let processingJob = false;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getStoredJob() {
  return (await chrome.storage.local.get(TRACKING_STATE_KEY))[TRACKING_STATE_KEY] || null;
}

async function publishJob(state) {
  await chrome.storage.local.set({ [TRACKING_STATE_KEY]: state });
  chrome.runtime.sendMessage({ type: "WB_1688_TRACKING_STATE", state: WB1688TrackingJob.snapshot(state) }).catch(() => {});
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Страница заказа не загрузилась вовремя.")), timeoutMs);
    const listener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") finish();
    };
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(finish);
  });
}

function readLogisticsComponentsInPage() {
  const elements = [];
  const collect = (scope) => {
    if (!scope?.querySelectorAll) return;
    for (const element of scope.querySelectorAll("*")) {
      elements.push(element);
      if (element.shadowRoot) collect(element.shadowRoot);
    }
  };
  collect(document);

  const tracks = elements.filter((element) =>
    String(element.tagName || "").toLowerCase() === "logistics-info-track"
  );
  const products = elements.filter((element) =>
    String(element.tagName || "").toLowerCase() === "logistics-info-product"
  );

  return tracks.map((trackElement, index) => {
    const productElement =
      trackElement.parentElement?.querySelector?.("logistics-info-product") ||
      products[index];
    const track = trackElement.data || {};
    const trackData = {
      mailNo: track.mailNo,
      logisticsBillNo: track.logisticsBillNo,
      noLogisticsBillNo: track.noLogisticsBillNo,
      logisticsExternalNo: track.logisticsExternalNo
    };
    for (const [key, value] of Object.entries(track)) {
      if (["string", "number", "boolean"].includes(typeof value)) trackData[key] = value;
    }
    const productItems = Array.isArray(productElement?.data) ? productElement.data : [];
    return {
      trackData,
      productData: productItems.map((product) => ({
        orderEntryId: product?.orderEntryId,
        offerId: product?.offerId,
        offerID: product?.offerID,
        name: product?.name,
        subject: product?.subject,
        productName: product?.productName,
        title: product?.title,
        offerUrl: product?.offerUrl,
        detailUrl: product?.detailUrl
      }))
    };
  });
}

function readTrackingNumbersFromPageText() {
  const labelSource = "(?:运单号码|运单编号|运单号|物流单号|物流运单号|物流编号|快递单号|快递编号|货运单号|包裹单号|包裹号|Номер\\s+накладной|Трек\\s*номер)";
  const labeledValueRe = new RegExp(`${labelSource}[\\s:：#-]*(?:复制)?[\\s:：#-]*([A-Za-z0-9-]{6,50})`, "gi");
  const genericLabelRe = /(运单|物流|快递|货运|包裹|承运|面单|mail|waybill|tracking|track|bill|накладной|трек)/i;
  const nonTrackingLabelRe = /(订单|订单号|订单编号|order\s*(?:id|no|number)|商品|货品|sku|offer)/i;
  const isTrackingValue = (value) => {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9-]{8,50}$/.test(text) && /\d/.test(text) && !/^\d{19,}$/.test(text);
  };
  const texts = [];
  const collect = (scope) => {
    if (!scope) return;
    const text = String(scope.innerText || scope.textContent || "").trim();
    if (text) texts.push(text);
    if (!scope.querySelectorAll) return;
    for (const element of scope.querySelectorAll("*")) {
      const ownText = String(element.innerText || element.textContent || "").trim();
      if (ownText) texts.push(ownText);
      if (element.shadowRoot) collect(element.shadowRoot);
    }
  };
  collect(document.body || document);

  const seen = new Set();
  const values = [];
  for (const text of texts) {
    for (const match of text.matchAll(labeledValueRe)) {
      const value = String(match[1] || "").trim();
      if (!isTrackingValue(value) || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!genericLabelRe.test(line) || nonTrackingLabelRe.test(line)) continue;
      const windowText = [line, lines[index + 1] || "", lines[index + 2] || ""].join(" ");
      for (const match of windowText.matchAll(/[A-Za-z0-9-]{6,50}/g)) {
        const value = String(match[0] || "").trim();
        if (!isTrackingValue(value) || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values.map((trackingNumber) => ({ trackingNumber, products: [] }));
}

async function collectLogisticsFromMainWorld(tabId, timeoutMs = 15000) {
  const started = Date.now();
  let shipments = [];
  while (Date.now() - started < timeoutMs) {
    const execution = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readLogisticsComponentsInPage
    });
    const componentData = execution?.[0]?.result || [];
    shipments = componentData
      .map(({ trackData, productData }) =>
        WB1688TrackingParser.shipmentFromComponentData(trackData, productData)
      )
      .filter(Boolean);
    if (shipments.length && shipments.every((shipment) => shipment.products.length)) return shipments;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return shipments;
}

async function collectTrackingTextFromMainWorld(tabId, timeoutMs = 30000) {
  const started = Date.now();
  let shipments = [];
  while (Date.now() - started < timeoutMs) {
    const execution = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readTrackingNumbersFromPageText
    });
    shipments = execution?.[0]?.result || [];
    if (shipments.length) return shipments;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return shipments;
}

function shipmentProductKey(product) {
  return [
    String(product?.orderEntryId || "").trim(),
    String(product?.offerId || "").trim(),
    String(product?.normalizedTitle || product?.title || "").trim()
  ].join("|");
}

function mergeShipments(...groups) {
  const byTrack = new Map();
  for (const shipment of groups.flat()) {
    const trackingNumber = String(shipment?.trackingNumber || "").trim();
    if (!trackingNumber) continue;
    const existing = byTrack.get(trackingNumber) || { trackingNumber, products: [] };
    const seenProducts = new Set(existing.products.map(shipmentProductKey));
    for (const product of shipment.products || []) {
      const key = shipmentProductKey(product);
      if (!key.replace(/\|/g, "") || seenProducts.has(key)) continue;
      seenProducts.add(key);
      existing.products.push(product);
    }
    byTrack.set(trackingNumber, existing);
  }
  return [...byTrack.values()];
}

function filterShipmentCandidates(shipments, order, expectedProducts) {
  const blocked = new Set([
    String(order || "").trim(),
    ...(expectedProducts || []).map((product) => String(product?.offerId || "").trim())
  ].filter(Boolean));
  return (shipments || []).filter((shipment) => {
    const trackingNumber = String(shipment?.trackingNumber || "").trim();
    return trackingNumber && !blocked.has(trackingNumber);
  });
}

async function collectLogisticsFromContentScript(tabId, products, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "WB_1688_COLLECT_TRACKING",
      products,
      timeoutMs: Math.max(1000, timeoutMs - (Date.now() - started))
    }).catch(() => null);
    if (response?.ok && Array.isArray(response.shipments)) return response.shipments;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

async function collectOrderTracking(order, state) {
  let tabId = null;
  try {
    const url = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${encodeURIComponent(order)}&to=logisticsTabTitle`;
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    state.currentTabId = tabId;
    await publishJob(state);
    await waitForTabComplete(tabId);
    const expectedProducts = state.productsByOrder?.[order] || [];
    const componentShipments = await collectLogisticsFromMainWorld(tabId);
    const contentShipments = await collectLogisticsFromContentScript(tabId, expectedProducts);
    const mergedShipments = filterShipmentCandidates(
      mergeShipments(componentShipments, contentShipments),
      order,
      expectedProducts
    );
    if (mergedShipments.length) return mergedShipments;
    const textShipments = await collectTrackingTextFromMainWorld(tabId);
    return filterShipmentCandidates(mergeShipments(textShipments), order, expectedProducts);
  } catch (error) {
    console.warn(`[1688 tracking ${order}]`, error);
    return [];
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function downloadResult(state) {
  const trackingSource = {
    ...state.trackingByOrder,
    shipmentDataByOrder: state.shipmentDataByOrder || {}
  };
  const output = await WB1688TrackingXlsx.enrichTrackingWorkbook(base64ToBytes(state.sourceBase64), trackingSource);
  const stem = state.fileName.replace(/\.(xlsx|xlsm)$/i, "");
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl] })
    : [];
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Создание Blob URL для скачивания большого Excel-файла с картинками"
    }).catch((error) => {
      if (!/single offscreen document/i.test(String(error?.message || error))) throw error;
    });
  }
  const response = await chrome.runtime.sendMessage({
    type: "WB_1688_CREATE_DOWNLOAD_URL",
    base64: bytesToBase64(output)
  });
  if (!response?.ok || !response.url) throw new Error(response?.error || "Не удалось подготовить итоговый Excel.");
  await chrome.downloads.download({
    url: response.url,
    filename: `${stem}_с_треками.xlsx`,
    saveAs: true
  });
}

async function processTrackingJob() {
  if (processingJob) return;
  processingJob = true;
  try {
    let state = await getStoredJob();
    if (!state || !["idle", "running"].includes(state.status)) return;
    for (let index = state.index || 0; index < state.orders.length; index++) {
      state = await getStoredJob();
      if (!state || ["cancelled", "cancelling"].includes(state.status)) return;
      state = WB1688TrackingJob.startOrder(state, index);
      await publishJob(state);
      const order = state.orders[index];
      const shipments = await collectOrderTracking(order, state);
      state = await getStoredJob();
      if (!state || ["cancelled", "cancelling"].includes(state.status)) return;
      state = WB1688TrackingJob.completeOrder(state, order, shipments);
      await publishJob(state);
    }
    state = await getStoredJob();
    if (state?.status === "completed") {
      await downloadResult(state);
      state.sourceBase64 = "";
      await publishJob(state);
    }
  } catch (error) {
    const state = await getStoredJob();
    if (state) await publishJob({ ...state, status: "failed", error: String(error?.message || error), currentTabId: null });
  } finally {
    processingJob = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WB_1688_DOWNLOAD") {
    chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: true }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "WB_1688_TRACKING_START") {
    (async () => {
      const current = await getStoredJob();
      if (current && ["idle", "running", "cancelling"].includes(current.status)) throw new Error("Уже выполняется другое задание.");
      const state = WB1688TrackingJob.createTrackingJob(msg.fileName, msg.orders, msg.sourceBase64, msg.productsByOrder || {});
      await publishJob(state);
      processTrackingJob();
      return { ok: true, state: WB1688TrackingJob.snapshot(state) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (msg?.type === "WB_1688_TRACKING_GET") {
    getStoredJob().then((state) => {
      if (state?.status === "running") processTrackingJob();
      sendResponse({ ok: true, state: state ? WB1688TrackingJob.snapshot(state) : null });
    });
    return true;
  }
  if (msg?.type === "WB_1688_TRACKING_CANCEL") {
    (async () => {
      const state = await getStoredJob();
      if (!state) return { ok: true, state: null };
      await publishJob({ ...state, status: "cancelling" });
      if (state.currentTabId != null) await chrome.tabs.remove(state.currentTabId).catch(() => {});
      const cancelled = WB1688TrackingJob.cancelJob(state);
      cancelled.sourceBase64 = "";
      await publishJob(cancelled);
      return { ok: true, state: WB1688TrackingJob.snapshot(cancelled) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

getStoredJob().then((state) => {
  if (state?.status === "running") processTrackingJob();
});
