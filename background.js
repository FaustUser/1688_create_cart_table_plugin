// Добавляем слушатель сообщений от других частей расширения (content script, popup и т.д.)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  
  // Проверяем, что пришло сообщение нужного типа для скачивания файла
  if (msg?.type === "WB_1688_DOWNLOAD") {

    // Запускаем загрузку файла через API chrome.downloads
    // url       — откуда скачать
    // filename  — под каким именем сохранить
    // saveAs    — показать пользователю диалог «Сохранить как»
    chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: true }, () => {

      // После старта загрузки отправляем ответ отправителю, что всё ок
      sendResponse({ ok: true });
      
    });

    // Возвращаем true, чтобы указать, что ответ будет отправлен асинхронно
    return true;
  }
});
