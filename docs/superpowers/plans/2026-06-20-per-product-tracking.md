# Per-Product Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Назначать трек-номер конкретным товарным строкам Excel на основании состава каждого отправления заказа.

**Architecture:** `tracking-parser.js` извлекает строгие shipment records из DOM. `tracking-matcher.js` независимо сопоставляет shipment products со строками Excel. `tracking-job.js` хранит shipments по заказам, а `tracking-xlsx.js` применяет matcher при записи каждой строки.

**Tech Stack:** Chrome Extension MV3, JavaScript, DOM/shadow DOM, XLSX XML, Node.js `node:test`.

---

### Task 1: Строгий парсер shipment records

**Files:**
- Modify: `tracking-parser.js`
- Modify: `tests/tracking-parser.test.js`

- [ ] Добавить падающие тесты для двух отправлений: номера, товары, offerId и исключение `发货时间`.
- [ ] Запустить `node --test tests/tracking-parser.test.js` и подтвердить RED.
- [ ] Реализовать `extractShipments(root)` и строгую валидацию tracking number.
- [ ] Повторить тест и подтвердить GREEN.

### Task 2: Чистый matcher строк Excel

**Files:**
- Create: `tracking-matcher.js`
- Create: `tests/tracking-matcher.test.js`

- [ ] Добавить падающие тесты приоритетов `offerId`, title, включения, неоднозначности и нескольких отправлений.
- [ ] Запустить тест и подтвердить RED.
- [ ] Реализовать `normalizeProductTitle`, `extractOfferId`, `matchTrackingForRow`.
- [ ] Повторить тест и подтвердить GREEN.

### Task 3: Построчная модель XLSX

**Files:**
- Modify: `tracking-xlsx.js`
- Modify: `tests/tracking-xlsx.test.js`

- [ ] Добавить падающий тест, где четыре строки одного заказа получают разные треки.
- [ ] Запустить тест и подтвердить RED.
- [ ] Читать из строки order, link, title и передавать их matcher.
- [ ] Повторить тест и подтвердить GREEN.

### Task 4: Фоновый контракт shipments

**Files:**
- Modify: `tracking-job.js`
- Modify: `background.js`
- Modify: `content.js`
- Modify: `manifest.json`
- Modify: `tests/tracking-job.test.js`
- Modify: `tests/tracking-content.test.js`
- Modify: `tests/tracking-background.test.js`

- [ ] Добавить падающие contract-тесты для `shipments` и `shipmentDataByOrder`.
- [ ] Запустить тесты и подтвердить RED.
- [ ] Передавать shipment records из content в background и хранить их по заказу.
- [ ] Повторить тесты и подтвердить GREEN.

### Task 5: Регрессия на фактическом Excel

**Files:**
- Create: `tests/fixtures/order-5120380515991059600-shipments.json`
- Create: `tests/tracking-real-workbook.test.js`
- Modify: `README.md`

- [ ] Зафиксировать fixture с двумя отправлениями и товарами из первых четырёх строк.
- [ ] Проверить, что `9031...` получает `435233621072490`, а `经济版...` — `435233604737349`.
- [ ] Запустить все тесты: каждый файл `tests/*.test.js`.
- [ ] Выполнить `node --check` для изменённых JS и `git diff --check`.
