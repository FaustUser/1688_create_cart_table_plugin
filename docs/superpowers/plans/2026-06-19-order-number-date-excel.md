# Order Number and Date Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить номер и дату заказа в каждую строку Excel-экспорта заказов 1688.

**Architecture:** Чистый модуль `order-metadata.js` извлекает номер заказа из подписанного текста и нормализует дату без зависимости от DOM. `content.js` собирает подходящие фрагменты заголовка заказа и добавляет метаданные каждой товарной строке. `popup.js` сдвигает колонки, формулу и drawing картинки, не меняя экспорт корзины.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript, Node.js `node:test`, OOXML/XLSX.

---

### Task 1: Парсер метаданных заказа

**Files:**
- Create: `order-metadata.js`
- Create: `tests/order-metadata.test.js`
- Modify: `manifest.json`

- [ ] **Step 1: Write failing tests**

Проверить:

```js
assert.equal(normalizeOrderDate("2026-06-19 14:05:09"), "19.06.2026 14:05:09");
assert.equal(normalizeOrderDate("2026年6月19日 14:05"), "19.06.2026 14:05:00");
assert.equal(extractOrderNumber("订单号：1234567890123456789"), "1234567890123456789");
assert.deepEqual(parseOrderMetadata("下单时间：2026-06-19 14:05:09 订单号：123"), {
  orderNumber: "123",
  orderDate: "19.06.2026 14:05:09"
});
```

- [ ] **Step 2: Verify RED**

Run: `node tests\order-metadata.test.js`

Expected: FAIL because `order-metadata.js` does not exist.

- [ ] **Step 3: Implement parser**

Создать browser/CommonJS-модуль с функциями `normalizeOrderDate`, `extractOrderNumber`, `extractOrderDate`, `parseOrderMetadata`. Поддержать разделители `-`, `/`, `.`, китайские `年/月/日`, секунды по умолчанию `00`, подписи `订单号`, `订单编号`, `order number`, `下单时间`, `创建时间`, `成交时间`.

- [ ] **Step 4: Integrate content script**

Подключить `order-metadata.js` перед `content.js` в `manifest.json`.

- [ ] **Step 5: Verify GREEN**

Run: `node tests\order-metadata.test.js`

Expected: all parser tests pass.

### Task 2: Передача метаданных в строки заказа

**Files:**
- Modify: `content.js`
- Modify: `tests/order-metadata.test.js`

- [ ] **Step 1: Write failing integration assertions**

Проверить статически, что `parseOrderBlock()` вызывает `parseOrderMetadata`, а объект строки содержит `orderNumber` и `orderDate`.

- [ ] **Step 2: Verify RED**

Run: `node tests\order-metadata.test.js`

Expected: FAIL because `content.js` does not yet propagate metadata.

- [ ] **Step 3: Implement integration**

Собрать текст из известных элементов заголовка и всего блока как fallback, вызвать `parseOrderMetadata`, добавить оба поля в каждую строку заказа.

- [ ] **Step 4: Verify GREEN**

Run: `node tests\order-metadata.test.js`

Expected: all metadata tests pass.

### Task 3: Обновление Excel

**Files:**
- Modify: `popup.js`
- Create: `tests/order-export.test.js`

- [ ] **Step 1: Write failing Excel structure tests**

Проверить порядок заголовков, текстовые ячейки `A` и `C`, ссылку в `D`, формулу `F*G+H-I`, десять ширин колонок и drawing в колонке B (`col0 = 1`).

- [ ] **Step 2: Verify RED**

Run: `node tests\order-export.test.js`

Expected: FAIL against the current eight-column export.

- [ ] **Step 3: Update order export**

Изменить только `ORDER_EXPORT_CONFIG`; добавить ячейки A/C, сдвинуть остальные ячейки и формулу. Передать индекс колонки картинки в генератор drawing: `1` для заказов, `0` для корзины.

- [ ] **Step 4: Verify GREEN and regression**

Run:

```powershell
node tests\order-export.test.js
node tests\xlsx-sheet-view.test.js
node --check order-metadata.js
node --check content.js
node --check popup.js
```

Expected: all tests pass and all syntax checks exit with code 0.

### Task 4: Documentation and commit

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document new columns**

Указать, что экспорт заказов содержит номер заказа и нормализованную дату.

- [ ] **Step 2: Run full verification**

Run all `tests\*.test.js` files directly, then syntax checks.

- [ ] **Step 3: Commit**

```powershell
git add order-metadata.js content.js popup.js manifest.json README.md tests docs/superpowers
git commit -m "Add order metadata to Excel export"
```

