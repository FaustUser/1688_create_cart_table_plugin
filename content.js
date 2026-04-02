// Пауза на указанное количество миллисекунд (используется при ожидании загрузки/скролле)
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// Удаляет специальные «литературные» комментарии/мусор из строк (подчищает текст перед парсингом)
function stripLitComments(s){
  return String(s || "")
    .replace(/<!--\?lit\$\d+\$-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

// Нормализует текст: убирает переводы строк, табы, неразрывные пробелы, китайские варианты ; и :,
// сжимает последовательности пробелов в один
function normalizeText(s){
  return String(s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[；]/g, ";")
    .replace(/[：]/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

// Приводит ссылку на товар 1688 к канонической форме (detail.1688.com/offer/ID.html)
// и отбрасывает query‑параметры
function cleanOfferLink(href){
  if (!href) return "";
  
  const m = String(href).match(/https?:\/\/detail\.1688\.com\/offer\/\d+\.html/);
  
  if (m) return m[0];
  
  return String(href).split("?")[0];
}

// Получает текстовое содержимое DOM‑элемента, очищает от мусора и нормализует
function text(el){
  if (!el) return "";
  
  return normalizeText(stripLitComments(el.textContent || ""));
}

// Находит последнее числовое значение в строке (учитывает , и . как разделители)
function lastNumber(s){
  const cleaned = String(s || "").replace(/,/g, ".");
  const m = cleaned.match(/(\d+[.]\d+|\d+)(?!.*(\d+[.]\d+|\d+))/);
  return m ? m[1] : null;
}

// Превращает найденное число в Number, если ничего не найдено — возвращает 0
function num(s){
  const n = lastNumber(s);
  return n ? Number(n) : 0;
}

// deep DOM + open shadow roots
// Глубокий обход DOM, включая shadowRoot (рекурсивно обходит все узлы)
function* deepWalk(node){
  if (!node) return;
  yield node;
  
  const sr = node.shadowRoot;
  if (sr) { 
    for (const n of deepWalk(sr)) yield n; 
  }
  
  const kids = node.childNodes || [];
  for (const k of kids) {
    if (k && (k.nodeType === 1 || k.nodeType === 11)) {
      for (const n of deepWalk(k)) yield n;
    }
  }
}

// Глобальный querySelectorAll с поддержкой shadow DOM: ищет selector по всему дереву
function deepQueryAll(selector, root=document){
  const out = [];
  for (const n of deepWalk(root)) {
    if (n.querySelectorAll) {
      try {
        n.querySelectorAll(selector).forEach(x => out.push(x)); 
      } catch {}
    }
  }

  // Убираем дубликат
  return Array.from(new Set(out));
}

// Как deepQueryAll, но возвращает только первый найденный элемент
function deepQuery(selector, root=document){
  const a = deepQueryAll(selector, root);
  
  return a[0] || null;
}

function queryByClassFragment(fragment, root=document){
  return deepQuery(`[class*="${fragment}"]`, root);
}

function queryAllByClassFragment(fragment, root=document){
  return deepQueryAll(`[class*="${fragment}"]`, root);
}

function getImageSrc(img){
  if (!img) return "";
  
  return img.getAttribute("src") || img.getAttribute("data-src") || "";
}

function isChecked(el){
  if (!el) return false;
  
  const input = el.matches?.('input[type="checkbox"]') ? el : el.querySelector?.('input[type="checkbox"]');
  
  if (input) {
    if (input.checked) return true;
    if (input.getAttribute("checked") != null) return true;
    if (input.getAttribute("aria-checked") === "true") return true;
  }
  
  if (el.classList?.contains("checked")) return true;
  if (el.getAttribute?.("aria-checked") === "true") return true;
  
  return false;
}

function detectPageType(root=document){
  if (deepQueryAll(".order-item-content", root).length || deepQueryAll(".order-item-entry", root).length) {
    return "orders";
  }
  
  if (queryAllByClassFragment("item-group-container--container--", root).length || queryAllByClassFragment("item--container--", root).length) {
    return "cart";
  }
  
  return "unknown";
}

function getPrimaryEntryCount(root=document){
  const pageType = detectPageType(root);
  
  if (pageType === "orders") return deepQueryAll(".order-item-entry", root).length;
  if (pageType === "cart") return queryAllByClassFragment("item--container--", root).length;
  
  return 0;
}

async function scrollToTopAndWait(wait = 250){
  const scroller = document.scrollingElement || document.documentElement || document.body;
  const currentTop = window.scrollY || scroller.scrollTop || 0;
  
  if (currentTop <= 2) return;
  
  for (let i = 0; i < 4; i++) {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    scroller.scrollTop = 0;
    await sleep(wait);
    
    const top = window.scrollY || scroller.scrollTop || 0;
    if (top <= 2) break;
  }
}

// Раскрывает/прокручивает список заказов (автоскролл),
// чтобы подгрузились все элементы (цикл ограничен maxLoops)
async function expandAll(maxLoops = 20, wait = 300){
  let total = 0;
  
  for (let i = 0; i < maxLoops; i++) {
    // Ищем кнопки/элементы «ещё» / «развернуть» и кликаем по ним
    const btns = deepQueryAll(".show-more-entries .expend-btn");
    
    if (!btns.length) break;
    
    let clicked = 0;
    
    for (const b of btns) {
      try { 
        b.click();
        clicked++; 
      } catch {}
      
      await sleep(60);
    }
    
    total += clicked;
    await sleep(wait);
    
    if (!clicked) break;
  }
  
  return total;
}

// Автоскролл страницы с дозагрузкой заказов и ожиданием, пока количество записей стабилизируется
// step          — величина прокрутки окна по вертикали за один шаг (в пикселях)
// wait          — задержка между шагами (и вызовами expandAll) в миллисекундах
// stableRounds  — сколько итераций подряд количество .order-item-entry должно не меняться,
//                 чтобы считать страницу «полностью загруженной» и прекратить скролл
// maxRounds     — максимальное число шагов автоскролла (защита от бесконечного цикла)
async function autoScrollAndWait(step = 900, wait = 650, stableRounds = 7, maxRounds = 260){
  // stable    — счётчик «стабильных» итераций, когда число элементов не меняется
  // lastCount — количество .order-item-entry на предыдущем шаге
  let stable = 0, lastCount = -1, lastScrollTop = -1;
  const scroller = document.scrollingElement || document.documentElement || document.body;

  // Основной цикл автоскролла: не более maxRounds шагов
  for (let i = 0; i < maxRounds; i++) {
    // Пробуем ещё немного раскрыть/подгрузить список (кликает по "показать ещё")
    // Ошибки игнорируются, чтобы не останавливать скролл
    await expandAll(4, wait).catch(()=>{});

    // Прокручиваем страницу вниз на указанный шаг
    window.scrollBy(0, step);

    // Ждём, пока DOM/данные успеют догрузиться после скролла
    await sleep(wait);

    // Считаем текущее количество элементов заказов на странице
    const count = getPrimaryEntryCount();
    const scrollTop = window.scrollY || scroller.scrollTop || 0;
    const scrollHeight = Math.max(
      scroller.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    const moved = Math.abs(scrollTop - lastScrollTop) > 2;
    const nearBottom = scrollTop + window.innerHeight >= scrollHeight - 10;

    // Если количество не изменилось — увеличиваем счётчик стабильности,
    // иначе сбрасываем его
    if (count === lastCount && (!moved || nearBottom)) stable++; else stable = 0;
    lastCount = count;
    lastScrollTop = scrollTop;

    // Если несколько раз подряд количество не меняется — считаем,
    // что всё подгружено, выходим из цикла
    if (nearBottom && stable >= 2) break;
    if (stable >= stableRounds) break;
  }

  // Финальная небольшая пауза после завершения скролла/подгрузки
  await sleep(450);
}

// parse entry
// Парсит одну позицию заказа (один товар) из элемента .order-item-entry
function parseEntry(entryEl){
  const prodEl = entryEl.querySelector("order-item-entry-product");
  const unitEl = entryEl.querySelector("order-item-entry-unit-price");
  const qtyEl  = entryEl.querySelector("order-item-entry-quantity-service-status");

  const nameA = prodEl ? deepQuery("a.product-name", prodEl) : null;
  const linkA = prodEl ? deepQuery("a.product-img", prodEl) : null;
  const img   = prodEl ? deepQuery("a.product-img img", prodEl) : null;

  // Название товара
  const title = nameA ? text(nameA) : "";
  // Ссылка на оффер 1688 (очищается до канонического URL)
  const link  = cleanOfferLink(nameA?.getAttribute("href") || linkA?.getAttribute("href") || "");
  // URL картинки товара
  const imgUrl = getImageSrc(img);

  // Собираем список SKU/вариантов из блока product-sku-info
  const skuItems = prodEl ? deepQueryAll("div.product-sku-info span.sku-info-item", prodEl).map(x => {
    let t = text(x);
    // Убираем возможный префикс "Название:" / "规格:" и т.п. перед значением
    t = t.replace(/^\s*[^:：]{1,20}[:：]\s*/, "");
    return t;
  }).filter(Boolean) : [];
  const variant = skuItems.join("; ");

  let unitPrice = 0;
  
  if (unitEl) {
    // Пробуем найти явный блок цены, иначе берём любой элемент с классом price
    const priceEl = deepQuery(".actual-unit-price", unitEl) || deepQuery(".unit-price", unitEl) || deepQuery("[class*=price]", unitEl);
    unitPrice = num(text(priceEl || unitEl));
  }

  let qty = 0;
  if (qtyEl) {
    // Ищем количество в .quantity-amount или по классу с "quantity"
    const q = deepQuery(".quantity-amount", qtyEl) || deepQuery("[class*=quantity]", qtyEl);
    qty = Math.trunc(num(text(q || qtyEl)));
  }

  // Возвращаем структурированный объект по позиции заказа
  return { title, link, imgUrl, variant, qty, unitPrice };
}

// Парсит суммы по заказу (общая, оригинальная, доставка) из блока order-item-total-price
function parseOrderTotals(orderContentEl){
  const totalComp = deepQuery("order-item-total-price", orderContentEl);
  if (!totalComp) return { paidTotal: 0, originalTotal: 0, shippingTotal: 0 };
  
  // important: total-price is paid after discounts
  // paidTotal — сумма, реально оплаченная после всех скидок
  const tp = deepQuery("div.total-price", totalComp) || deepQuery(".total-price", totalComp);
  const paid = num(text(tp || totalComp));

  // originalTotal — исходная сумма без скидок
  const op = deepQuery("div.original-price", totalComp) || deepQuery(".original-price", totalComp);
  const original = num(text(op || ""));

  // shippingTotal — стоимость доставки по заказу (если написано «бесплатно» — 0)
  const carriage = deepQuery("div.carriage", totalComp) || deepQuery(".carriage", totalComp);
  const carriageText = text(carriage || "");
  const shippingTotal = /包邮|免邮/.test(carriageText) ? 0 : num(carriageText);
  
  return { paidTotal: paid || 0, originalTotal: original || 0, shippingTotal: shippingTotal || 0 };
}

// Разбивает один блок заказа (order-item-content) на строки по товарам и
// распределяет по ним доставку и скидку пропорционально
function parseOrderBlock(orderContentEl){
  const { paidTotal, originalTotal, shippingTotal } = parseOrderTotals(orderContentEl);

  // Все позиции (товары) в заказе
  const entries = deepQueryAll(".order-item-entry", orderContentEl);
  const parsedEntries = entries.map((e) => parseEntry(e));

  // Общая сумма по товарам (цена * количество)
  const goodsSubtotal = parsedEntries.reduce((sum, row) => {
    return sum + (Number(row.unitPrice || 0) * Number(row.qty || 0));
  }, 0);

  // Полная сумма заказа по вашей логике: товары + доставка
  const myOrderTotal = goodsSubtotal + Number(shippingTotal || 0);

  // Итоговая сумма с сайта (то, что вы парсите как paidTotal)
  const siteOrderTotal = Number(paidTotal || 0);

  // Общее количество штук в заказе
  const totalQty = parsedEntries.reduce((sum, row) => {
    return sum + Number(row.qty || 0);
  }, 0);

  // Общая скидка: разница между вашей суммой и суммой с сайта (не меньше 0)
  const discountTotal = Math.max(0, myOrderTotal - siteOrderTotal);
  
  const rows = [];
  
  for (const row of parsedEntries) {
    // Пропускаем совсем пустые товары без ссылки/названия/варианта
    if (!row.link && !row.title && !row.variant) continue;

    // Сумма по позиции
    const rowSubtotal = Number(row.unitPrice || 0) * Number(row.qty || 0);

    // Доля доставки на позицию (по количеству)
    const shippingShare = totalQty ? (shippingTotal * (Number(row.qty || 0) / totalQty)) : 0;

    // Доля скидки на позицию (по сумме позиции в общем чеке)
    const discountShare = goodsSubtotal ? (discountTotal * (rowSubtotal / goodsSubtotal)) : 0;

    // Итог по позиции в юанях (товар + его доля доставки)
    const totalYuan = rowSubtotal + shippingShare - discountShare;
    
    rows.push({
      ...row,
      paidTotal,
      originalTotal,
      shippingTotal,
      shippingShare,
      discountShare,
      totalYuan
    });
  }

  // Возвращаем готовые строки по одному заказу
  return rows;
}

// Собирает все строки по всем заказам на странице
function collectAllRowsLegacy(){
  const blocks = deepQueryAll(".order-item-content");
  const all = [];
  for (const b of blocks) all.push(...parseOrderBlock(b));
  
  return { 
    blocks: blocks.length,                                      // количество блоков заказов
    entries: deepQueryAll(".order-item-entry").length,  // количество позиций 
    rows: all                                                   // массив всех строк (товаров)
  };
}

// ---------- messaging ----------
// Слушает сообщения из popup.js и выполняет нужные действия (экспорт/авто‑режим)
function parseCartQty(itemEl){
  const qtyInput = itemEl.querySelector('td[class*="item--colQuantity--"] input') || itemEl.querySelector('input[aria-valuemin]');
  const raw = qtyInput?.value || qtyInput?.getAttribute("value") || "";
  
  return Math.max(0, Math.trunc(num(raw)));
}

function parseCartGroup(groupEl){
  const titleA = groupEl.querySelector('a[class*="item-group--title--"]');
  const groupTitle = text(titleA);
  const link = cleanOfferLink(titleA?.getAttribute("href") || "");
  const groupImg = groupEl.querySelector('a[class*="item-group--imageWrapper--"] img');
  const rebateEl = groupEl.querySelector('td[class*="item--colRebatePrice--"] div[class*="item--rebatePrice--"]') ||
    groupEl.querySelector('td[class*="item--colRebatePrice--"]');
  const sharedRebatePrice = num(text(rebateEl || ""));
  const itemRows = Array.from(groupEl.querySelectorAll('tr[class*="item--container--"]'));
  const rows = [];
  
  for (const itemEl of itemRows) {
    const checkbox = itemEl.querySelector('label[class*="item--checkbox--"]') || itemEl.querySelector('input[type="checkbox"]');
    if (!isChecked(checkbox || itemEl)) continue;
    
    const variant = text(
      itemEl.querySelector('div[class*="item--titleText--"]') ||
      itemEl.querySelector('span[class*="item--titleText--"]') ||
      itemEl.querySelector('div[class*="item--title--"]')
    );
    const itemImg = itemEl.querySelector('div[class*="item--image--"] img') || itemEl.querySelector("img");
    const imgUrl = getImageSrc(itemImg) || getImageSrc(groupImg);
    const qty = parseCartQty(itemEl);
    const subtotalEl = itemEl.querySelector('div[class*="item--subtotal--"]');
    const subtotal = num(text(subtotalEl || ""));
    const discountEl = itemEl.querySelector('div[class*="item--discount--"]');
    const discountShare = num(text(discountEl || ""));
    const exportTitle = variant || groupTitle;
    
    if (!link && !groupTitle && !variant) continue;
    
    rows.push({
      title: groupTitle,
      link,
      imgUrl,
      variant,
      exportTitle: exportTitle || variant || groupTitle,
      qty,
      unitPrice: sharedRebatePrice || 0,
      shippingShare: 0,
      discountShare,
      totalYuan: subtotal || 0
    });
  }
  
  return rows;
}

function collectOrderRows(){
  const blocks = deepQueryAll(".order-item-content");
  const all = [];
  for (const b of blocks) all.push(...parseOrderBlock(b));
  
  return {
    pageType: "orders",
    blocks: blocks.length,
    entries: deepQueryAll(".order-item-entry").length,
    selectedEntries: all.length,
    rows: all
  };
}

function collectCartRows(){
  const groups = queryAllByClassFragment("item-group-container--container--");
  const all = [];
  for (const g of groups) all.push(...parseCartGroup(g));
  
  return {
    pageType: "cart",
    blocks: groups.length,
    entries: queryAllByClassFragment("item--container--").length,
    selectedEntries: all.length,
    rows: all
  };
}

function collectAllRows(){
  const pageType = detectPageType();
  
  if (pageType === "orders") return collectOrderRows();
  if (pageType === "cart") return collectCartRows();
  
  return { pageType: "unknown", blocks: 0, entries: 0, selectedEntries: 0, rows: [] };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const step = Number(msg?.step || 900); // шаг скролла для авто‑режима
      const wait = Number(msg?.wait || 650); // пауза между шагами

      // Одноразовый экспорт: раскрываем все и собираем строки
      if (msg?.type === "WB_1688_EXPORT") {
        await scrollToTopAndWait(Math.min(wait, 300));
        await expandAll(22, wait);
        const { pageType, blocks, entries, selectedEntries, rows } = collectAllRows();
        sendResponse({ ok:true, count: rows.length, pageType, blocks, orders: blocks, entries, selectedEntries, rows });
        
        return;
      }

      // Авто‑режим: автоскролл + раскрытие заказов, затем сбор строк
      if (msg?.type === "WB_1688_AUTO") {
        await scrollToTopAndWait(Math.min(wait, 300));
        await autoScrollAndWait(step, wait, 7, 260);
        await expandAll(22, wait);
        const { pageType, blocks, entries, selectedEntries, rows } = collectAllRows();
        sendResponse({ ok:true, count: rows.length, pageType, blocks, orders: blocks, entries, selectedEntries, rows });
        return;
      }

      // Если тип сообщения не известен — возвращаем ошибку
      sendResponse({ ok:false, error:"unknown message" });
    } catch (e) {
      // Любая ошибка при обработке/парсинге/скролле
      sendResponse({ ok:false, error: String(e?.message || e) });
    }
  })();

  // Сообщаем Chrome, что ответ будет отправлен асинхронно (после async‑кода)
  return true;
});
