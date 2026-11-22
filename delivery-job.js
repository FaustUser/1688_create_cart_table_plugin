// A fixed number of workers share one queue. An item is claimed before the
// handler awaits, so no two workers can process the same order.
async function runDeliveryPool(items, limit, handler) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await handler(item);
    }
  }));
}

const WB1688DeliveryJob = { runDeliveryPool };
if (typeof globalThis !== "undefined") globalThis.WB1688DeliveryJob = WB1688DeliveryJob;
if (typeof module !== "undefined") module.exports = WB1688DeliveryJob;
