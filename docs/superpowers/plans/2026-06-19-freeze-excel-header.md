# Freeze Excel Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрепить первую строку с заголовками во всех XLSX-файлах, создаваемых расширением.

**Architecture:** Чистая функция формирует OOXML-блок `sheetViews` для закрепления первой строки. `popup.js` вставляет этот блок в активный генератор `worksheet` до описания колонок.

**Tech Stack:** JavaScript, OOXML SpreadsheetML, Node.js built-in test runner.

---

### Task 1: Генератор XML закрепления

**Files:**
- Create: `xlsx-sheet-view.js`
- Create: `tests/xlsx-sheet-view.test.js`
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Write the failing test**

Создать тест, импортирующий `makeFrozenHeaderSheetViewsXML` и ожидающий `pane` с `ySplit="1"`, `topLeftCell="A2"`, `activePane="bottomLeft"` и `state="frozen"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/xlsx-sheet-view.test.js`

Expected: FAIL, потому что `xlsx-sheet-view.js` ещё не существует.

- [ ] **Step 3: Write minimal implementation**

Создать чистую функцию, возвращающую:

```xml
<sheetViews>
  <sheetView workbookViewId="0">
    <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
  </sheetView>
</sheetViews>
```

Экспортировать функцию для Node.js и сделать доступной в popup через обычный `<script>`.

- [ ] **Step 4: Integrate into worksheet generation**

Подключить `xlsx-sheet-view.js` перед `popup.js`. В `makeSheetXML()` вставить результат функции сразу после открывающего элемента `worksheet`.

- [ ] **Step 5: Run verification**

Run:

```powershell
node tests/xlsx-sheet-view.test.js
node --check xlsx-sheet-view.js
node --check popup.js
```

Expected: все команды завершаются с кодом 0.

- [ ] **Step 6: Commit**

```powershell
git add popup.html popup.js xlsx-sheet-view.js tests/xlsx-sheet-view.test.js docs/superpowers
git commit -m "Freeze Excel header row"
```
