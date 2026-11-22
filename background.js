importScripts("tracking-parser.js", "tracking-job.js", "tracking-matcher.js", "tracking-xlsx.js", "delivery-parser.js", "delivery-job.js");

const TRACKING_STATE_KEY = "wb1688TrackingJob";
const TRACKING_SOURCE_KEY = "wb1688TrackingSource";
const TRACKING_CONCURRENCY = 3;
const TRACKING_TIMEOUT_MS = 35000;
const TRACKING_STABLE_MS = 1200;
const DELIVERY_STATE_KEY = "wb1688DeliveryJob";
const DELIVERY_SOURCE_KEY = "wb1688DeliverySource";
const DELIVERY_CONCURRENCY = 3;
const DELIVERY_TIMEOUT_MS = 45000;
let processingJob = false;
let trackingWriteQueue = Promise.resolve();
let processingDeliveryJob = false;
let deliveryWriteQueue = Promise.resolve();

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

function trackingEvent(state, level, phase, message, details = {}) {
  const event = { at: new Date().toISOString(), level, phase, message, ...details };
  console[level === "error" ? "error" : level === "warn" ? "warn" : "info"]("[1688 tracking]", event);
  return { ...state, events: [...(state.events || []), event] };
}

function updateTrackingJob(updater) {
  const operation = trackingWriteQueue.then(async () => {
    const current = await getStoredJob();
    const next = updater(current);
    if (next) await publishJob(next);
    return next;
  });
  trackingWriteQueue = operation.catch(() => {});
  return operation;
}

async function getStoredDeliveryJob() {
  return (await chrome.storage.local.get(DELIVERY_STATE_KEY))[DELIVERY_STATE_KEY] || null;
}

async function publishDeliveryJob(state) {
  await chrome.storage.local.set({ [DELIVERY_STATE_KEY]: state });
  chrome.runtime.sendMessage({ type: "WB_1688_DELIVERY_STATE", state }).catch(() => {});
}

function deliverySnapshot(state) {
  return state || null;
}

function deliveryEvent(state, level, phase, message, details = {}) {
  const event = { at: new Date().toISOString(), level, phase, message, ...details };
  console[level === "error" ? "error" : level === "warn" ? "warn" : "info"]("[1688 delivery]", event);
  return { ...state, events: [...(state.events || []), event] };
}

// All three workers (and cancellation) update the same small metadata record.
function updateDeliveryJob(updater) {
  const operation = deliveryWriteQueue.then(async () => {
    const current = await getStoredDeliveryJob();
    const next = updater(current);
    if (next) await publishDeliveryJob(next);
    return next;
  });
  deliveryWriteQueue = operation.catch(() => {});
  return operation;
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

  const messages = elements.filter((element) =>
    String(element.tagName || "").toLowerCase() === "logistics-info-message"
  );
  const tracks = elements.filter((element) =>
    String(element.tagName || "").toLowerCase() === "logistics-info-track"
  );
  const products = elements.filter((element) =>
    String(element.tagName || "").toLowerCase() === "logistics-info-product"
  );

  return (messages.length ? messages : tracks).map((source, index) => {
    const isMessage = String(source.tagName || "").toLowerCase() === "logistics-info-message";
    const messageElement = isMessage ? source : source.parentElement?.querySelector?.("logistics-info-message");
    const trackElement = isMessage ? source.parentElement?.querySelector?.("logistics-info-track") : source;
    const productElement =
      source.parentElement?.querySelector?.("logistics-info-product") ||
      products[index];
    let waybillNo = "";
    for (const item of messageElement?.shadowRoot?.querySelectorAll?.(".info-item") || []) {
      const label = String(item.querySelector?.(".info-item-tit")?.textContent || "")
        .replace(/[\s:：]/g, "");
      if (!/^(运单号码|运单编号|运单号|快递运单号|快递单号)$/.test(label)) continue;
      waybillNo = String(item.querySelector?.(".info-item-val")?.textContent || "").trim();
      break;
    }
    const track = trackElement?.data || {};
    const trackData = {
      waybillNo,
      mailNo: track.mailNo,
      trackingNumber: track.trackingNumber,
      trackingNo: track.trackingNo,
      expressNo: track.expressNo
    };
    const productItems = Array.isArray(productElement?.data) ? productElement.data
      : Array.isArray(productElement?.data?.products) ? productElement.data.products
      : [...(productElement?.shadowRoot?.querySelectorAll?.(".info-item") || [])].map((item) => {
        const link = item.querySelector?.("a.offer-title");
        const href = link?.getAttribute?.("href") || "";
        return {
          title: String(link?.textContent || "").trim(),
          orderEntryId: (href.match(/[?&]order_entry_id=(\d+)/) || [])[1] || ""
        };
      });
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
  const labelSource = "(?:运单号码|运单编号|运单号|快递运单号|快递单号|Номер\\s+накладной|Трек\\s*номер)";
  const labeledValueRe = new RegExp(`${labelSource}[\\s:：#-]*(?:复制)?[\\s:：#-]*([A-Za-z0-9-]{6,50})`, "gi");
  const genericLabelRe = /(运单号码|运单编号|运单号|快递单号|Номер\s+накладной|Трек\s*номер)/i;
  const nonTrackingLabelRe = /(订单|订单号|订单编号|order\s*(?:id|no|number)|商品|货品|sku|offer)/i;
  const isTrackingValue = (value) => {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9-]{8,50}$/.test(text) && /\d/.test(text) &&
      !/^\d{19,}$/.test(text) && !/^LP\d{10,}$/i.test(text);
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

async function collectLogisticsFromMainWorld(tabId) {
  const execution = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", injectImmediately: true,
    func: readLogisticsComponentsInPage
  });
  return (execution?.[0]?.result || [])
    .map(({ trackData, productData }) =>
      WB1688TrackingParser.shipmentFromComponentData(trackData, productData)
    ).filter(Boolean);
}

async function collectTrackingTextFromMainWorld(tabId) {
  const execution = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", func: readTrackingNumbersFromPageText
  });
  return execution?.[0]?.result || [];
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

async function collectLogisticsFromContentScript(tabId, products, timeoutMs = 5000) {
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

async function collectOrderTracking(order, expectedProducts, jobId) {
  const started = Date.now();
  let tabId = null;
  let navigationMs = null;
  let componentMs = null;
  let contentMs = null;
  let attempts = 0;
  let source = "";
  let outcome = "empty";
  let errorMessage = "";
  let shipments = [];
  try {
    const url = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${encodeURIComponent(order)}&to=logisticsTabTitle`;
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    const accepted = await updateTrackingJob((state) => {
      if (state?.id !== jobId || state.status !== "running") return null;
      const activeTabsByOrder = { ...state.activeTabsByOrder, [order]: tabId };
      return trackingEvent({ ...state, activeTabsByOrder, currentOrder: Object.keys(activeTabsByOrder).join(", ") },
        "info", "tab_opened", "Открыта вкладка заказа", { order });
    });
    if (!accepted) return null;
    let completeSince = null;
    let firstComponentsAt = null;
    let stableSince = null;
    let stableSignature = "";
    let componentShipments = [];
    let readyComponents = false;
    while (Date.now() - started < TRACKING_TIMEOUT_MS) {
      const state = await getStoredJob();
      if (state?.id !== jobId || state.status !== "running") return null;
      const currentTab = await chrome.tabs.get(tabId);
      const currentUrl = currentTab.url || "";
      if (/login|signin/i.test(currentUrl)) throw new Error("1688 перенаправил на страницу входа.");
      if (/\/trade-order-detail\/index\.html/.test(currentUrl) &&
          currentUrl.includes(`orderId=${encodeURIComponent(order)}`)) {
        if (currentTab.status === "complete" && completeSince == null) completeSince = Date.now();
        attempts += 1;
        try {
          const observed = filterShipmentCandidates(
            await collectLogisticsFromMainWorld(tabId), order, expectedProducts);
          if (navigationMs == null) navigationMs = Date.now() - started;
          if (observed.length) {
            componentShipments = observed;
            if (firstComponentsAt == null) firstComponentsAt = Date.now();
            if (componentMs == null) componentMs = Date.now() - started;
            const complete = observed.every((shipment) => shipment.products.length);
            const coversProducts = !expectedProducts.length ||
              typeof WB1688TrackingMatcher === "undefined" ||
              expectedProducts.every((product) =>
                WB1688TrackingMatcher.matchTrackingForRow(product, observed).length);
            const signature = JSON.stringify(observed.map((shipment) => [
              shipment.trackingNumber,
              shipment.products.map((product) => `${product.offerId}|${product.normalizedTitle}`).sort()
            ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
            if (complete && coversProducts) {
              if (signature !== stableSignature) { stableSignature = signature; stableSince = Date.now(); }
              if (Date.now() - stableSince >= TRACKING_STABLE_MS) {
                readyComponents = true;
                break;
              }
            } else {
              stableSignature = "";
              stableSince = null;
            }
          }
        } catch (error) {
          // The document can still be committing. Retry while the tab remains active.
          errorMessage = String(error?.message || error);
        }
      }
      if (firstComponentsAt != null && Date.now() - firstComponentsAt >= 3000) break;
      if (completeSince != null && Date.now() - completeSince >= 2500) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (readyComponents) {
      shipments = componentShipments;
      source = "components";
    } else {
      const state = await getStoredJob();
      if (state?.id !== jobId || state.status !== "running") return null;
      const contentShipments = await collectLogisticsFromContentScript(tabId, expectedProducts);
      contentMs = Date.now() - started;
      shipments = filterShipmentCandidates(mergeShipments(componentShipments, contentShipments), order, expectedProducts);
      if (shipments.length) source = contentShipments.length ? "components+content" : "components";
      else {
        const textShipments = await collectTrackingTextFromMainWorld(tabId).catch(() => []);
        shipments = filterShipmentCandidates(mergeShipments(textShipments), order, expectedProducts);
        if (shipments.length) source = "text";
      }
    }
    outcome = shipments.length ? "success" : "empty";
    if (outcome === "success") errorMessage = "";
  } catch (error) {
    outcome = "error";
    errorMessage = String(error?.message || error);
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
  }
  return { shipments, outcome, error: errorMessage, metrics: {
    elapsedMs: Date.now() - started, navigationMs, componentMs, contentMs,
    attempts, source,
    shipments: shipments.length, tracks: [...new Set(shipments.map((item) => item.trackingNumber))].length
  } };
}

async function downloadWorkbook(output, filename) {
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
    filename,
    saveAs: true
  });
}

async function downloadResult(state, sourceBase64) {
  const trackingSource = {
    ...state.trackingByOrder,
    shipmentDataByOrder: state.shipmentDataByOrder || {}
  };
  const output = await WB1688TrackingXlsx.enrichTrackingWorkbook(base64ToBytes(sourceBase64), trackingSource);
  const stem = state.fileName.replace(/\.(xlsx|xlsm)$/i, "");
  await downloadWorkbook(output, stem.endsWith("_с_треками") ? `${stem}_обновлено.xlsx` : `${stem}_с_треками.xlsx`);
}

async function collectOrderDelivery(order, expectedTracks, jobId) {
  const started = Date.now();
  let tabId = null;
  let navigationMs = null;
  let firstShipmentMs = null;
  let attempts = 0;
  let results = [];
  let lastError = "";
  let outcome = "timeout";
  const expected = new Set(expectedTracks.map((track) => track.toUpperCase()));
  try {
    const url = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${encodeURIComponent(order)}&to=logisticsTabTitle`;
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    const accepted = await updateDeliveryJob((state) => {
      if (state?.status !== "running" || state.jobId !== jobId) return null;
      const activeTabsByOrder = { ...state.activeTabsByOrder, [order]: tabId };
      return deliveryEvent({ ...state, activeTabsByOrder, currentOrder: Object.keys(activeTabsByOrder).join(", ") },
        "info", "tab_opened", "Открыта вкладка заказа", { order });
    });
    if (!accepted) return null;

    // A 1688 page often keeps loading after the logistics component is ready.
    // Probe the committed document immediately; do not wait for tab 'complete'.
    while (Date.now() - started < DELIVERY_TIMEOUT_MS) {
      const state = await getStoredDeliveryJob();
      if (state?.status !== "running" || state.jobId !== jobId) return null;
      const currentTab = await chrome.tabs.get(tabId);
      const currentUrl = currentTab.url || "";
      if (/\/trade-order-detail\/index\.html/.test(currentUrl) && currentUrl.includes(`orderId=${encodeURIComponent(order)}`)) {
        if (navigationMs == null) navigationMs = Date.now() - started;
        attempts += 1;
        try {
          const execution = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            injectImmediately: true,
            func: WB1688DeliveryParser.readDeliveryStatusesInPage
          });
          const currentResults = execution?.[0]?.result || [];
          if (currentResults.length) {
            results = currentResults;
            if (firstShipmentMs == null) firstShipmentMs = Date.now() - started;
          }
          const found = new Set(results.filter((item) => item.statusText || item.statusCode)
            .map((item) => String(item.trackingNumber || "").toUpperCase()));
          if ([...expected].every((track) => found.has(track))) {
            outcome = "success";
            break;
          }
        } catch (error) {
          // Script injection can race a navigation; retry until the deadline.
          lastError = String(error?.message || error);
        }
      } else if (/login|signin/i.test(currentUrl)) {
        throw new Error("1688 перенаправил на страницу входа.");
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) {
    outcome = "error";
    lastError = String(error?.message || error);
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
  }
  if (outcome === "timeout" && results.length) outcome = "partial";
  const byTrack = new Map(results.map((item) => [String(item.trackingNumber || "").toUpperCase(), item]));
  const statuses = Object.fromEntries(expectedTracks.map((track) => {
    const found = byTrack.get(track.toUpperCase());
    const status = found && (found.statusText || found.statusCode)
      ? WB1688DeliveryParser.normalizeDeliveryStatus(found.statusText, found.statusCode)
      : results.length ? "Трек не найден на странице" : "Не удалось проверить";
    return [track, status];
  }));
  return {
    statuses,
    outcome,
    metrics: {
      elapsedMs: Date.now() - started,
      navigationMs,
      firstShipmentMs,
      attempts,
      matched: expectedTracks.filter((track) => {
        const found = byTrack.get(track.toUpperCase());
        return Boolean(found && (found.statusText || found.statusCode));
      }).length,
      expected: expectedTracks.length
    },
    error: lastError
  };
}

async function processDeliveryJob() {
  if (processingDeliveryJob) return;
  processingDeliveryJob = true;
  let jobId = null;
  try {
    let state = await getStoredDeliveryJob();
    if (!state || !["idle", "running", "finalizing"].includes(state.status)) return;
    jobId = state.jobId;
    // Resume a job that was created by the earlier version of this extension.
    if (state.sourceBase64) {
      await chrome.storage.local.set({ [DELIVERY_SOURCE_KEY]: state.sourceBase64 });
      state = await updateDeliveryJob((current) => {
        if (current?.jobId !== jobId) return null;
        const { sourceBase64, ...metadata } = current;
        return deliveryEvent(metadata, "info", "migrated", "Исходный файл перенесён в отдельное хранилище");
      });
      if (!state) return;
    }
    if (state.status !== "finalizing") {
      const staleTabs = [
        ...Object.values(state.activeTabsByOrder || {}),
        ...(state.currentTabId != null ? [state.currentTabId] : [])
      ];
      await Promise.all(staleTabs.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
      state = await updateDeliveryJob((current) => {
        if (!current || current.jobId !== jobId || !["idle", "running"].includes(current.status)) return null;
        return deliveryEvent({ ...current, status: "running", activeTabsByOrder: {}, currentTabId: null, currentOrder: "" },
          "info", staleTabs.length ? "resumed" : "started",
          staleTabs.length ? "Продолжение после перезапуска" : "Проверка запущена",
          { total: current.orders.length, parallel: DELIVERY_CONCURRENCY });
      });
      if (!state) return;
      const pending = state.orders.filter((order) => !Object.hasOwn(state.statusesByOrder || {}, order));
      await WB1688DeliveryJob.runDeliveryPool(pending, DELIVERY_CONCURRENCY, async (order) => {
        const current = await getStoredDeliveryJob();
        if (current?.status !== "running" || current.jobId !== jobId) return;
        const result = await collectOrderDelivery(order, current.tracksByOrder[order], jobId);
        if (!result) return;
        await updateDeliveryJob((latest) => {
          if (latest?.status !== "running" || latest.jobId !== jobId) return null;
          const activeTabsByOrder = { ...latest.activeTabsByOrder };
          delete activeTabsByOrder[order];
          const statusesByOrder = { ...latest.statusesByOrder, [order]: result.statuses };
          const processed = Object.keys(statusesByOrder).length;
          const next = {
            ...latest, activeTabsByOrder, statusesByOrder, index: processed,
            remaining: latest.orders.length - processed,
            progress: Math.round(processed * 100 / latest.orders.length),
            currentOrder: Object.keys(activeTabsByOrder).join(", ")
          };
          return deliveryEvent(next, result.outcome === "success" ? "info" : "warn", "order_done",
            result.outcome === "success" ? "Статусы получены" : "Проверка завершена с проблемой",
            { order, outcome: result.outcome, ...result.metrics, ...(result.error ? { error: result.error } : {}) });
        });
      });
      state = await updateDeliveryJob((current) => {
        if (current?.status !== "running" || current.jobId !== jobId || Object.keys(current.statusesByOrder).length !== current.orders.length) return null;
        return deliveryEvent({ ...current, status: "finalizing", currentOrder: "" },
          "info", "finalizing", "Формируется итоговый файл");
      });
    }
    if (state?.status === "finalizing") {
      const finalizingStarted = Date.now();
      const sourceBase64 = (await chrome.storage.local.get(DELIVERY_SOURCE_KEY))[DELIVERY_SOURCE_KEY];
      if (!sourceBase64) throw new Error("Исходный Excel не найден в хранилище расширения.");
      const output = await WB1688TrackingXlsx.enrichDeliveryWorkbook(base64ToBytes(sourceBase64), state.statusesByOrder);
      const stem = state.fileName.replace(/\.(xlsx|xlsm)$/i, "");
      await downloadWorkbook(output, `${stem}_со_статусами.xlsx`);
      await updateDeliveryJob((current) => current?.status === "finalizing" && current.jobId === jobId
        ? deliveryEvent({ ...current, status: "completed", progress: 100, remaining: 0 },
          "info", "completed", "Итоговый файл сохранён", { elapsedMs: Date.now() - finalizingStarted }) : null);
      await chrome.storage.local.remove(DELIVERY_SOURCE_KEY);
    }
  } catch (error) {
    const message = String(error?.message || error);
    const state = await getStoredDeliveryJob();
    if (state?.jobId === jobId) {
      await Promise.all(Object.values(state.activeTabsByOrder || {}).map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
    }
    await updateDeliveryJob((current) => current && current.jobId === jobId && !["cancelled", "cancelling"].includes(current.status)
      ? deliveryEvent({ ...current, status: "failed", error: message, activeTabsByOrder: {}, currentOrder: "" },
        "error", "failed", "Задание прервано", { error: message }) : null);
    if ((await getStoredDeliveryJob())?.jobId === jobId) await chrome.storage.local.remove(DELIVERY_SOURCE_KEY);
  } finally {
    processingDeliveryJob = false;
    const next = await getStoredDeliveryJob();
    if (next?.jobId !== jobId && ["idle", "running", "finalizing"].includes(next?.status)) processDeliveryJob();
  }
}

async function processTrackingJob() {
  if (processingJob) return;
  processingJob = true;
  let jobId = null;
  try {
    let state = await getStoredJob();
    if (!state || !["idle", "running", "finalizing"].includes(state.status)) return;
    jobId = state.id;
    if (state.sourceBase64) {
      await chrome.storage.local.set({ [TRACKING_SOURCE_KEY]: state.sourceBase64 });
      state = await updateTrackingJob((current) => {
        if (current?.id !== jobId) return null;
        const { sourceBase64, ...metadata } = current;
        return trackingEvent(metadata, "info", "migrated", "Исходный файл перенесён в отдельное хранилище");
      });
      if (!state) return;
    }
    if (state.status !== "finalizing") {
      const staleTabs = [
        ...Object.values(state.activeTabsByOrder || {}),
        ...(state.currentTabId != null ? [state.currentTabId] : [])
      ];
      await Promise.all(staleTabs.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
      state = await updateTrackingJob((current) => {
        if (current?.id !== jobId || !["idle", "running"].includes(current.status)) return null;
        return trackingEvent({ ...current, status: "running", activeTabsByOrder: {}, currentTabId: null, currentOrder: "" },
          "info", staleTabs.length ? "resumed" : "started",
          staleTabs.length ? "Продолжение после перезапуска" : "Поиск треков запущен",
          { total: current.orders.length, parallel: TRACKING_CONCURRENCY });
      });
      if (!state) return;
      const pending = state.orders.filter((order) => !Object.hasOwn(state.trackingByOrder, order));
      await WB1688DeliveryJob.runDeliveryPool(pending, TRACKING_CONCURRENCY, async (order) => {
        const current = await getStoredJob();
        if (current?.id !== jobId || current.status !== "running") return;
        const result = await collectOrderTracking(order, current.productsByOrder?.[order] || [], jobId);
        if (!result) return;
        await updateTrackingJob((latest) => {
          if (latest?.id !== jobId || latest.status !== "running") return null;
          const activeTabsByOrder = { ...latest.activeTabsByOrder };
          delete activeTabsByOrder[order];
          const completed = WB1688TrackingJob.completeOrder(latest, order, result.shipments);
          const next = { ...completed, status: "running", activeTabsByOrder,
            currentOrder: Object.keys(activeTabsByOrder).join(", ") };
          return trackingEvent(next, result.outcome === "success" ? "info" : "warn", "order_done",
            result.outcome === "success" ? "Треки получены" : "Треки не получены",
            { order, outcome: result.outcome, ...result.metrics, ...(result.error ? { error: result.error } : {}) });
        });
      });
      state = await updateTrackingJob((current) => {
        if (current?.id !== jobId || current.status !== "running" ||
            Object.keys(current.trackingByOrder).length !== current.orders.length) return null;
        return trackingEvent({ ...current, status: "finalizing", currentOrder: "" },
          "info", "finalizing", "Формируется итоговый файл");
      });
    }
    if (state?.status === "finalizing") {
      const finalizingStarted = Date.now();
      const sourceBase64 = (await chrome.storage.local.get(TRACKING_SOURCE_KEY))[TRACKING_SOURCE_KEY];
      if (!sourceBase64) throw new Error("Исходный Excel не найден в хранилище расширения.");
      await downloadResult(state, sourceBase64);
      await updateTrackingJob((current) => current?.id === jobId && current.status === "finalizing"
        ? trackingEvent({ ...current, status: "completed", progress: 100, remaining: 0 },
          "info", "completed", "Итоговый файл сохранён", { elapsedMs: Date.now() - finalizingStarted }) : null);
      await chrome.storage.local.remove(TRACKING_SOURCE_KEY);
    }
  } catch (error) {
    const message = String(error?.message || error);
    const state = await getStoredJob();
    if (state?.id === jobId) {
      await Promise.all(Object.values(state.activeTabsByOrder || {}).map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
      await updateTrackingJob((current) => current?.id === jobId && !["cancelled", "cancelling"].includes(current.status)
        ? trackingEvent({ ...current, status: "failed", error: message, activeTabsByOrder: {}, currentOrder: "" },
          "error", "failed", "Задание прервано", { error: message }) : null);
      await chrome.storage.local.remove(TRACKING_SOURCE_KEY);
    }
  } finally {
    processingJob = false;
    const next = await getStoredJob();
    if (next?.id !== jobId && ["idle", "running", "finalizing"].includes(next?.status)) processTrackingJob();
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
      if (current && ["idle", "running", "finalizing", "cancelling"].includes(current.status)) throw new Error("Уже выполняется другое задание.");
      const delivery = await getStoredDeliveryJob();
      if (delivery && ["idle", "running", "finalizing", "cancelling"].includes(delivery.status)) throw new Error("Уже выполняется другое задание.");
      const created = WB1688TrackingJob.createTrackingJob(msg.fileName, msg.orders, msg.sourceBase64, msg.productsByOrder || {});
      const { sourceBase64, ...state } = created;
      await chrome.storage.local.set({ [TRACKING_SOURCE_KEY]: sourceBase64 });
      const queued = await updateTrackingJob(() => trackingEvent(state, "info", "queued", "Файл принят", {
        total: state.orders.length, parallel: TRACKING_CONCURRENCY,
        skippedTrackedRows: Number(msg.skippedTrackedRows || 0)
      }));
      processTrackingJob();
      return { ok: true, state: WB1688TrackingJob.snapshot(queued) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (msg?.type === "WB_1688_TRACKING_GET") {
    getStoredJob().then((state) => {
      if (["idle", "running", "finalizing"].includes(state?.status)) processTrackingJob();
      sendResponse({ ok: true, state: state ? WB1688TrackingJob.snapshot(state) : null });
    });
    return true;
  }
  if (msg?.type === "WB_1688_TRACKING_CANCEL") {
    (async () => {
      const existing = await getStoredJob();
      if (!existing || ["completed", "cancelled", "failed"].includes(existing.status)) {
        return { ok: true, state: existing ? WB1688TrackingJob.snapshot(existing) : null };
      }
      const state = await updateTrackingJob((current) => {
        if (!current) return null;
        if (current.status === "finalizing") throw new Error("Итоговый файл уже создаётся.");
        if (!["idle", "running", "cancelling"].includes(current.status)) return null;
        return trackingEvent({ ...current, status: "cancelling" }, "warn", "cancelling", "Остановка поиска треков");
      });
      if (!state) return { ok: true, state: WB1688TrackingJob.snapshot(await getStoredJob()) };
      const tabs = [...Object.values(state.activeTabsByOrder || {}), ...(state.currentTabId != null ? [state.currentTabId] : [])];
      await Promise.all(tabs.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
      await chrome.storage.local.remove(TRACKING_SOURCE_KEY);
      const cancelled = await updateTrackingJob((current) => trackingEvent(WB1688TrackingJob.cancelJob(current),
        "warn", "cancelled", "Поиск треков остановлен"));
      return { ok: true, state: WB1688TrackingJob.snapshot(cancelled) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (msg?.type === "WB_1688_DELIVERY_START") {
    (async () => {
      const current = await getStoredDeliveryJob();
      const tracking = await getStoredJob();
      if ([current, tracking].some((job) => job && ["idle", "running", "finalizing", "cancelling"].includes(job.status))) throw new Error("Уже выполняется другое задание.");
      const state = {
        jobId: crypto.randomUUID(),
        fileName: msg.fileName,
        orders: msg.orders,
        tracksByOrder: msg.tracksByOrder,
        statusesByOrder: {},
        index: 0,
        remaining: msg.orders.length,
        progress: 0,
        currentOrder: "",
        activeTabsByOrder: {},
        events: [],
        status: "idle",
        error: ""
      };
      await chrome.storage.local.set({ [DELIVERY_SOURCE_KEY]: msg.sourceBase64 });
      const queued = await updateDeliveryJob(() => deliveryEvent(state, "info", "queued", "Файл принят", {
        total: msg.orders.length, parallel: DELIVERY_CONCURRENCY
      }));
      processDeliveryJob();
      return { ok: true, state: deliverySnapshot(queued) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (msg?.type === "WB_1688_DELIVERY_GET") {
    getStoredDeliveryJob().then((state) => {
      if (state?.status === "running" || state?.status === "finalizing") processDeliveryJob();
      sendResponse({ ok: true, state: deliverySnapshot(state) });
    });
    return true;
  }
  if (msg?.type === "WB_1688_DELIVERY_CANCEL") {
    (async () => {
      const existing = await getStoredDeliveryJob();
      if (!existing || ["completed", "cancelled", "failed"].includes(existing.status)) {
        return { ok: true, state: deliverySnapshot(existing) };
      }
      const state = await updateDeliveryJob((current) => {
        if (!current) return null;
        if (current.status === "finalizing") throw new Error("Итоговый файл уже создаётся.");
        if (!["idle", "running", "cancelling"].includes(current.status)) return null;
        return deliveryEvent({ ...current, status: "cancelling" }, "warn", "cancelling", "Остановка проверки");
      });
      if (!state) return { ok: true, state: deliverySnapshot(await getStoredDeliveryJob()) };
      await Promise.all(Object.values(state.activeTabsByOrder || {}).map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
      await chrome.storage.local.remove(DELIVERY_SOURCE_KEY);
      const cancelled = await updateDeliveryJob((current) => deliveryEvent({
        ...current, status: "cancelled", activeTabsByOrder: {}, currentOrder: ""
      }, "warn", "cancelled", "Проверка остановлена"));
      return { ok: true, state: deliverySnapshot(cancelled) };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

getStoredJob().then((state) => {
  if (["idle", "running", "finalizing"].includes(state?.status)) processTrackingJob();
});
getStoredDeliveryJob().then((state) => {
  if (["running", "finalizing"].includes(state?.status)) processDeliveryJob();
});
