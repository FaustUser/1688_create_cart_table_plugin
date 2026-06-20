importScripts("tracking-job.js", "tracking-matcher.js", "tracking-xlsx.js");

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

async function collectOrderTracking(order, state) {
  let tabId = null;
  try {
    const url = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${encodeURIComponent(order)}&to=logisticsTabTitle`;
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    state.currentTabId = tabId;
    await publishJob(state);
    await waitForTabComplete(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "WB_1688_COLLECT_TRACKING",
      timeoutMs: 15000,
      products: state.productsByOrder?.[order] || []
    });
    if (response?.diagnostic && !(response.shipments || []).length) console.info(`[1688 tracking ${order}]`, response.diagnostic);
    return response?.shipments || [];
  } catch (error) {
    console.warn(`[1688 tracking ${order}]`, error);
    return [];
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function downloadResult(state) {
  const trackingSource = state.shipmentDataByOrder && Object.keys(state.shipmentDataByOrder).length
    ? { shipmentDataByOrder: state.shipmentDataByOrder }
    : state.trackingByOrder;
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
