# Order Tracking Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить фоновое получение трек-номеров заказов 1688 и безопасное обогащение ранее созданного XLSX-файла с визуальным прогрессом в popup.

**Architecture:** Чистые модули `tracking-parser.js`, `tracking-xlsx.js` и `tracking-job.js` реализуют парсинг DOM, преобразование XLSX XML и модель состояния. `background.js` оркестрирует одну неактивную вкладку, хранит состояние и скачивает результат; `popup.js` загружает исходный файл и отображает состояние задания.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript, DOMParser/XMLSerializer, ZIP/XLSX XML, Node.js `node:test`.

---

### Task 1: Парсер трек-номеров

**Files:**
- Create: `tracking-parser.js`
- Create: `tests/tracking-parser.test.js`
- Modify: `manifest.json`

- [ ] **Step 1: Write the failing tests**

Проверить извлечение из текста `运单号码：SF123`, пары соседних элементов, удаление дублей и объединение через `\n`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-parser.test.js`
Expected: FAIL because `tracking-parser.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Экспортировать `extractTrackingNumbers(root)`, `normalizeTrackingNumbers(values)` и `joinTrackingNumbers(values)`. Обходить обычный DOM и открытые shadow root, распознавать китайскую и русскую подписи.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-parser.test.js`
Expected: PASS.

### Task 2: Преобразование XLSX

**Files:**
- Create: `tracking-xlsx.js`
- Create: `tests/tracking-xlsx.test.js`

- [ ] **Step 1: Write the failing tests**

Проверить поиск листа `Товары`, извлечение уникальных заказов, вставку/обновление `Трек номер`, сдвиг ячеек и drawing anchors, перенос строк и сохранение остальных ZIP entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-xlsx.test.js`
Expected: FAIL because module is missing.

- [ ] **Step 3: Write minimal implementation**

Реализовать ZIP reader/writer, поиск worksheet через workbook relationships и `enrichTrackingWorkbook(bytes, trackingByOrder)`, возвращающий новые байты и список заказов.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-xlsx.test.js`
Expected: PASS.

### Task 3: Модель фонового задания

**Files:**
- Create: `tracking-job.js`
- Create: `tests/tracking-job.test.js`

- [ ] **Step 1: Write the failing tests**

Проверить начальное состояние, прогресс, найденные/пустые результаты, продолжение после ошибки и отмену без итогового файла.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-job.test.js`
Expected: FAIL because module is missing.

- [ ] **Step 3: Write minimal implementation**

Экспортировать чистые функции создания и переходов состояния, чтобы background и popup использовали одинаковый контракт.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-job.test.js`
Expected: PASS.

### Task 4: Background orchestration

**Files:**
- Modify: `background.js`
- Modify: `manifest.json`
- Create: `tests/tracking-background.test.js`

- [ ] **Step 1: Write the failing contract tests**

Проверить наличие сообщений START/GET/CANCEL, `chrome.storage.local`, последовательного `chrome.tabs.create`, закрытия вкладки в `finally` и скачивания результата.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-background.test.js`
Expected: FAIL against current download-only worker.

- [ ] **Step 3: Implement orchestration**

Добавить обработчики сообщений, ожидание загрузки вкладки, запрос `WB_1688_COLLECT_TRACKING`, таймаут, сохранение снимков состояния и автоматическую загрузку итогового XLSX.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-background.test.js`
Expected: PASS.

### Task 5: Content script integration

**Files:**
- Modify: `content.js`
- Create: `tests/tracking-content.test.js`

- [ ] **Step 1: Write the failing contract test**

Проверить обработку `WB_1688_COLLECT_TRACKING`, ожидание появления данных и возврат массива треков.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-content.test.js`
Expected: FAIL because the message is not handled.

- [ ] **Step 3: Implement content handler**

Использовать `extractTrackingNumbers(document)`, polling с ограниченным таймаутом и диагностический фрагмент при пустом результате.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-content.test.js`
Expected: PASS.

### Task 6: Popup UI and file upload

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Create: `tests/tracking-popup.test.js`

- [ ] **Step 1: Write the failing UI contract tests**

Проверить две карточки, скрытый file input, progress bar, текущий заказ, три счётчика, кнопку остановки и runtime messages.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracking-popup.test.js`
Expected: FAIL against the current single-card popup.

- [ ] **Step 3: Implement the UI**

Сохранить существующие controls первой карточки. Во второй карточке читать файл как base64, локально валидировать список заказов, запускать background job и рендерить восстановленное состояние.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracking-popup.test.js`
Expected: PASS.

### Task 7: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`

- [ ] **Step 1: Update user documentation and version**

Описать оба сценария, фоновые вкладки, пустые значения и формат нескольких треков. Добавить permissions `tabs` и `storage`, подключить новые scripts и повысить версию.

- [ ] **Step 2: Run complete test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS.

- [ ] **Step 3: Run syntax and diff checks**

Run: `node --check popup.js; node --check background.js; node --check content.js; node --check tracking-parser.js; node --check tracking-xlsx.js; node --check tracking-job.js; git diff --check`
Expected: exit code 0.

- [ ] **Step 4: Inspect final diff against specification**

Проверить все требования спецификации: последовательность вкладок, восстановление progress, отмену, пустые ошибки заказов, обновление существующего столбца и сохранение картинок.
