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
  
  return normalizeText(stripLitComments(deepText(el)));
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

function numericTokens(value){
  return [...String(value || "").replace(/\u00a0/g, " ").replace(/,/g, ".").matchAll(/(?:^|[^\w.])((?:\d+(?:\.\d+)?|\.\d+))(?![\w.])/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function moneyTokens(value){
  const source = String(value || "").replace(/\u00a0/g, " ").replace(/,/g, ".");
  const result = [];
  for (const match of source.matchAll(/(?:¥|￥|\bRMB\b|\bCNY\b)\s*([\d]+(?:\.\d+)?)/gi)) {
    result.push(Number(match[1]));
  }
  for (const match of source.matchAll(/([\d]+(?:\.\d+)?)\s*(?:元|块)/g)) {
    result.push(Number(match[1]));
  }
  return result.filter((value) => Number.isFinite(value));
}

function fieldElements(root, selectors){
  const result = [];
  for (const selector of selectors) {
    for (const element of deepQueryAll(selector, root)) result.push(element);
  }
  return Array.from(new Set(result));
}

function readFieldNumber(root, selectors, options = {}){
  const candidates = [];
  for (const element of fieldElements(root, selectors)) {
    const value = text(element);
    const values = options.money ? moneyTokens(value) : numericTokens(value);
    if (!values.length) continue;
    const className = `${element.tagName || ""} ${element.getAttribute?.("class") || ""}`.toLowerCase();
    const score = (options.money && moneyTokens(value).length ? 100 : 0) +
      (/(?:unit|actual|sale).*price|price.*(?:unit|actual|sale)/i.test(className) ? 30 : 0) +
      (values.length === 1 ? 10 : 0) - Math.min(value.length, 80) / 1000;
    candidates.push({ value: options.preferDecimal ? (values.find((number) => !Number.isInteger(number)) ?? values[0]) : values[0], score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value || 0;
}

function readAttributeNumber(root, names){
  for (const element of [root, ...deepQueryAll("*", root)]) {
    for (const name of names) {
      const raw = element.getAttribute?.(name);
      if (raw != null && numericTokens(raw).length) return numericTokens(raw)[0];
    }
  }
  return 0;
}

function readLabeledNumber(value, labels){
  const labelPattern = labels.join("|");
  const match = String(value || "").match(new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*(?:¥|￥)?\\s*([\\d]+(?:[.,]\\d+)?)`, "i"));
  return match ? Number(String(match[1]).replace(",", ".")) : 0;
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

function deepText(node){
  if (!node) return "";
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";

  const parts = [];
  if (node.shadowRoot) parts.push(deepText(node.shadowRoot));
  for (const child of node.childNodes || []) parts.push(deepText(child));
  return parts.join(" ");
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
    const checkedAttribute = input.getAttribute("checked");
    if (checkedAttribute != null && !/^(false|0)$/i.test(checkedAttribute.trim())) return true;
    if (input.getAttribute("aria-checked") === "true") return true;
  }

  const ownCheckedAttribute = el.getAttribute?.("checked");
  if (ownCheckedAttribute != null) {
    return !/^(false|0)$/i.test(ownCheckedAttribute.trim());
  }

  const candidates = [el, ...Array.from(el.querySelectorAll?.("[class], [aria-checked]") || [])];
  for (const candidate of candidates) {
    if (candidate.getAttribute?.("aria-checked") === "true") return true;
    const className = String(candidate.getAttribute?.("class") || "");
    if (/(^|[-_\s])(checked|selected)([-_\s]|$)/i.test(className)) return true;
  }

  return false;
}

function isCheckedSelectionControl(root){
  if (!root) return false;
  const selectors = [
    "q-checkbox",
    'input[type="checkbox"], [role="checkbox"], [aria-checked], [class*="checkbox"], [class*="Checkbox"]'
  ];
  const controls = selectors.flatMap((selector) => [
    ...(root.matches?.(selector) ? [root] : []),
    ...deepQueryAll(selector, root)
  ]);
  
  return controls.some(isChecked);
}

function isOrderBlockSelected(orderContentEl){
  const orderContainer = orderContentEl.closest?.(
    "order-item, .order-item, [class*=order-item-container], [class*=order-container]"
  );
  const roots = Array.from(new Set([
    orderContentEl.previousElementSibling,
    orderContentEl,
    orderContainer,
    orderContainer?.querySelector?.("order-item-header, .order-item-header, [class*=order-header]")
  ].filter(Boolean)));
  
  return roots.some(isCheckedSelectionControl);
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
  const prodEl = deepQuery("order-item-entry-product", entryEl);
  const unitEl = deepQuery("order-item-entry-unit-price", entryEl);
  const qtyEl  = deepQuery("order-item-entry-quantity-service-status", entryEl);

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

  const priceSelectors = [
    "[data-unit-price]",
    "[data-price]",
    ".unit-price",
    '[class*="unit-price"]',
    ".actual-unit-price",
    '[class*="actual-unit-price"]',
    '[class*="actualUnitPrice"]',
    '[class*="unitPrice"]',
    '[class*="price"]'
  ];
  const quantitySelectors = [
    "[data-quantity]",
    "[data-count]",
    ".quantity-amount",
    '[class*="quantity-amount"]',
    '[class*="quantityAmount"]',
    '[class*="quantity"]',
    '[class*="count"]'
  ];
  const entryText = text(entryEl);

  // В новой разметке 1688 блок цены может содержать одновременно цену и
  // количество. Сначала читаем явное денежное значение, а не последнее число
  // во всём блоке (раньше это превращало qty=30 в unitPrice=30).
  let unitPrice = readFieldNumber(unitEl || entryEl, [
    ".actual-unit-price",
    '[class*="actual-unit-price"]',
    '[class*="actualUnitPrice"]'
  ], { money: true });
  unitPrice ||= readAttributeNumber(entryEl, ["data-unit-price", "data-price", "unit-price", "unitPrice"]);
  unitPrice ||= readFieldNumber(entryEl, priceSelectors, { money: true, preferDecimal: true });
  unitPrice ||= readFieldNumber(entryEl, priceSelectors, { preferDecimal: true });
  if (!unitPrice && unitEl) unitPrice = readFieldNumber(unitEl, priceSelectors, { money: true, preferDecimal: true });
  if (!unitPrice && unitEl) unitPrice = readFieldNumber(unitEl, priceSelectors, { preferDecimal: true });

  let qty = readAttributeNumber(entryEl, ["data-quantity", "data-count", "quantity", "count"]);
  qty ||= readFieldNumber(entryEl, quantitySelectors);
  if (!qty && qtyEl) qty = readFieldNumber(qtyEl, quantitySelectors);

  if (!qty) qty = readLabeledNumber(entryText, ["数量", "购买数量", "件数", "quantity", "qty"]);
  if (!qty && qtyEl) qty = numericTokens(text(qtyEl)).find((value) => Number.isInteger(value)) || 0;
  if (!qty && unitEl) qty = numericTokens(text(unitEl)).find((value) => Number.isInteger(value)) || 0;
  if (!unitPrice) unitPrice = readLabeledNumber(entryText, ["单价", "价格", "unit price", "price"]);

  if (!unitPrice) {
    const lineTotal = readFieldNumber(entryEl, [
      '[data-total-price]',
      '[class*="total-price"]',
      '[class*="totalPrice"]',
      '[class*="subtotal"]',
      '[class*="subTotal"]'
    ], { money: true });
    if (lineTotal && qty) unitPrice = lineTotal / qty;
  }
  // Возвращаем структурированный объект по позиции заказа
  return {
    title,
    link,
    imgUrl,
    variant,
    qty: Math.trunc(qty),
    unitPrice
  };
}

// Парсит оплаченную сумму и доставку из блока order-item-total-price.
function parseOrderTotals(orderContentEl){
  const totalComp = orderContentEl.querySelector("order-item-total-price") ||
    deepQuery("order-item-total-price", orderContentEl);
  const totalRoot = totalComp?.shadowRoot || totalComp;
  const orderText = text(orderContentEl);

  // paidTotal — сумма, реально оплаченная за заказ.
  const paid = moneyTokens(text(totalRoot?.querySelector?.(".total-price")))[0] ||
    readFieldNumber(totalComp || orderContentEl, [
    ".total-price",
    '[class*="total-price"]',
    '[class*="totalPrice"]',
    '[data-paid-total]',
    '[data-actual-paid]'
  ], { money: true }) ||
    readLabeledNumber(orderText, ["实付款", "实付", "已付款", "付款金额", "paid", "order total"]);

  // shippingTotal — стоимость доставки по заказу (если написано «бесплатно» — 0)
  const carriage = totalRoot?.querySelector?.(".carriage") ||
    deepQuery("div.carriage", totalComp || orderContentEl) ||
    deepQuery(".carriage", totalComp || orderContentEl) ||
    deepQuery('[class*="carriage"]', orderContentEl) ||
    deepQuery('[class*="shipping"]', orderContentEl) ||
    deepQuery('[class*="freight"]', orderContentEl);
  const carriageText = text(carriage || "");
  const shippingKnown = /包邮|免邮|free shipping|含运费|运费|快递费|shipping|freight/i.test(carriageText) ||
    moneyTokens(carriageText).length > 0;
  const shippingTotal = /包邮|免邮|free shipping/i.test(carriageText) ? 0 :
    (readLabeledNumber(carriageText, ["含运费", "运费", "快递费", "shipping", "freight"]) ||
      moneyTokens(carriageText)[0] || numericTokens(carriageText)[0] ||
      readFieldNumber(carriage || orderContentEl, [
      '[class*="carriage"]',
      '[class*="shipping"]',
      '[class*="freight"]',
      '[data-shipping]'
    ], { money: true }) || readLabeledNumber(orderText, ["运费", "快递费", "shipping", "freight"]));
  
  return {
    paidTotal: paid || 0,
    shippingTotal: shippingTotal || 0,
    shippingKnown
  };
}

// Разбивает заказ на строки и распределяет доставку и разницу с оплаченным
// итогом так, чтобы сумма строк в Excel совпадала с итогом на 1688.
function parseOrderBlock(orderContentEl){
  const { paidTotal, shippingTotal: parsedShippingTotal, shippingKnown } = parseOrderTotals(orderContentEl);
  const metadataSelectors = [
    "order-item-header",
    ".order-item-header",
    "[class*=order-header]",
    "[class*=order-info]",
    "[class*=order-number]",
    "[class*=order-time]"
  ];
  const orderContainer = orderContentEl.closest?.(
    "order-item, .order-item, [class*=order-item-container], [class*=order-container]"
  );
  const metadataRoots = Array.from(new Set([
    orderContentEl,
    orderContentEl.previousElementSibling,
    orderContainer
  ].filter(Boolean)));
  const metadataParts = [];
  for (const root of metadataRoots) {
    for (const selector of metadataSelectors) {
      for (const element of deepQueryAll(selector, root)) {
        const value = text(element);
        if (value) metadataParts.push(value);
      }
    }
  }
  metadataParts.push(...metadataRoots.map(text));
  const { orderNumber, orderDate } = parseOrderMetadata(metadataParts.join(" "));

  // Все позиции (товары) в заказе
  const entries = deepQueryAll(".order-item-entry", orderContentEl);
  const parsedEntries = entries.map((e) => parseEntry(e))
    .filter((row) => row.link || row.title || row.variant);

  // Общая сумма по товарам (цена * количество)
  const goodsSubtotal = parsedEntries.reduce((sum, row) => {
    return sum + (Number(row.unitPrice || 0) * Number(row.qty || 0));
  }, 0);

  // Когда отдельная стоимость доставки не показана, берём разницу между
  // оплаченным итогом и суммой строк товаров. Зачёркнутая цена не участвует.
  const shippingTotal = shippingKnown ? parsedShippingTotal :
    (parsedShippingTotal || Math.max(0, paidTotal - goodsSubtotal));

  // Общее количество штук в заказе
  const totalQty = parsedEntries.reduce((sum, row) => {
    return sum + Number(row.qty || 0);
  }, 0);

  const shippingCents = Math.round(shippingTotal * 100);
  const discountCents = paidTotal > 0
    ? Math.round(goodsSubtotal * 100) + shippingCents - Math.round(paidTotal * 100)
    : 0;
  let allocatedShippingCents = 0;
  let allocatedDiscountCents = 0;
  let cumulativeQty = 0;
  let cumulativeGoods = 0;
  const rows = [];

  for (const row of parsedEntries) {
    const rowSubtotal = Number(row.unitPrice || 0) * Number(row.qty || 0);
    cumulativeQty += Number(row.qty || 0);
    cumulativeGoods += rowSubtotal;

    // Считаем в центах юаня; отрицательная корректировка увеличивает итог.
    const shippingShareCents = totalQty
      ? Math.round(shippingCents * cumulativeQty / totalQty) - allocatedShippingCents : 0;
    const discountProgress = goodsSubtotal
      ? cumulativeGoods / goodsSubtotal : (totalQty ? cumulativeQty / totalQty : 0);
    const discountShareCents = Math.round(discountCents * discountProgress) - allocatedDiscountCents;
    allocatedShippingCents += shippingShareCents;
    allocatedDiscountCents += discountShareCents;

    const shippingShare = shippingShareCents / 100;
    const discountShare = discountShareCents / 100;
    const totalYuan = rowSubtotal + shippingShare - discountShare;
    
    rows.push({
      ...row,
      orderNumber,
      orderDate,
      paidTotal,
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

function normalizeCartSelectionMode(mode){
  return mode === "selected" ? "selected" : "all";
}

function parseCartGroup(groupEl, cartSelectionMode = "all"){
  const normalizedMode = normalizeCartSelectionMode(cartSelectionMode);
  const titleA = groupEl.querySelector('a[class*="item-group--title--"]');
  const groupTitle = text(titleA);
  const link = cleanOfferLink(titleA?.getAttribute("href") || "");
  const groupImg = groupEl.querySelector('a[class*="item-group--imageWrapper--"] img');
  const rebateEl = groupEl.querySelector('td[class*="item--colRebatePrice--"] div[class*="item--rebatePrice--"]') ||
    groupEl.querySelector('td[class*="item--colRebatePrice--"]');
  const sharedRebatePrice = num(text(rebateEl || ""));
  const itemRows = Array.from(groupEl.querySelectorAll('tr[class*="item--container--"]'));
  const rows = [];
  let selectedEntries = 0;
  
  for (const itemEl of itemRows) {
    const checkbox = itemEl.querySelector('label[class*="item--checkbox--"]') || itemEl.querySelector('input[type="checkbox"]');
    const checked = isChecked(checkbox || itemEl);

    if (checked) selectedEntries++;
    if (normalizedMode === "selected" && !checked) continue;
    
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
  
  return {
    entries: itemRows.length,
    selectedEntries,
    rows
  };
}

function collectOrderRows(cartSelectionMode = "all"){
  const normalizedMode = normalizeCartSelectionMode(cartSelectionMode);
  const blocks = deepQueryAll(".order-item-content");
  const all = [];
  let selectedEntries = 0;

  for (const b of blocks) {
    const rows = parseOrderBlock(b);
    const checked = isOrderBlockSelected(b);
    if (checked) selectedEntries += rows.length;
    if (normalizedMode === "selected" && !checked) continue;
    all.push(...rows);
  }
  
  return {
    pageType: "orders",
    blocks: blocks.length,
    entries: deepQueryAll(".order-item-entry").length,
    selectedEntries,
    collectedEntries: all.length,
    cartSelectionMode: normalizedMode,
    rows: all
  };
}

function collectCartRows(cartSelectionMode = "all"){
  const normalizedMode = normalizeCartSelectionMode(cartSelectionMode);
  const groups = queryAllByClassFragment("item-group-container--container--");
  const all = [];
  let entries = 0;
  let selectedEntries = 0;

  for (const g of groups) {
    const parsedGroup = parseCartGroup(g, normalizedMode);
    entries += parsedGroup.entries;
    selectedEntries += parsedGroup.selectedEntries;
    all.push(...parsedGroup.rows);
  }
  
  return {
    pageType: "cart",
    blocks: groups.length,
    entries,
    selectedEntries,
    collectedEntries: all.length,
    cartSelectionMode: normalizedMode,
    rows: all
  };
}

function collectAllRows(cartSelectionMode = "all"){
  const pageType = detectPageType();
  
  if (pageType === "orders") return collectOrderRows(cartSelectionMode);
  if (pageType === "cart") return collectCartRows(cartSelectionMode);
  
  return {
    pageType: "unknown",
    blocks: 0,
    entries: 0,
    selectedEntries: 0,
    collectedEntries: 0,
    cartSelectionMode: normalizeCartSelectionMode(cartSelectionMode),
    rows: []
  };
}

globalThis.__WB1688_RUN_EXPORT__ = async (msg) => {
  const step = Number(msg?.step || 900);
  const wait = Number(msg?.wait || 650);
  const cartSelectionMode = normalizeCartSelectionMode(msg?.cartSelectionMode);

  await scrollToTopAndWait(Math.min(wait, 300));
  if (msg?.type === "WB_1688_AUTO") {
    await autoScrollAndWait(step, wait, 7, 260);
  }
  await expandAll(22, wait);

  const { pageType, blocks, entries, selectedEntries, collectedEntries, rows } =
    collectAllRows(cartSelectionMode);
  return {
    ok: true,
    parserVersion: chrome.runtime.getManifest().version,
    count: rows.length,
    pageType,
    blocks,
    orders: blocks,
    entries,
    selectedEntries,
    collectedEntries,
    cartSelectionMode,
    rows
  };
};

if (!globalThis.__WB1688_CONTENT_LISTENER_INSTALLED__) {
  globalThis.__WB1688_CONTENT_LISTENER_INSTALLED__ = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "WB_1688_COLLECT_TRACKING") {
        const timeoutMs = Math.max(1000, Number(msg.timeoutMs || 15000));
        const started = Date.now();
        let shipments = [];
        while (Date.now() - started < timeoutMs) {
          shipments = WB1688TrackingParser.extractShipments(document, msg.products || []);
          if (shipments.length && shipments.every((shipment) => shipment.products.length)) break;
          await sleep(500);
        }
        const seenTracks = new Set(shipments.map((shipment) => String(shipment.trackingNumber || "").trim()).filter(Boolean));
        const blockedTracks = new Set((msg.products || []).map((product) => String(product?.offerId || "").trim()).filter(Boolean));
        for (const trackingNumber of WB1688TrackingParser.extractTrackingNumbers(document)) {
          if (seenTracks.has(trackingNumber) || blockedTracks.has(trackingNumber)) continue;
          seenTracks.add(trackingNumber);
          shipments.push({ trackingNumber, products: [] });
        }
        const pageText = normalizeText(document.body?.innerText || "");
        const diagnostic = shipments.length ? "" : pageText.slice(0, 1200);
        sendResponse({ ok: true, shipments, diagnostic });
        return;
      }

      if (msg?.type === "WB_1688_EXPORT" || msg?.type === "WB_1688_AUTO") {
        sendResponse(await globalThis.__WB1688_RUN_EXPORT__(msg));
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
}
