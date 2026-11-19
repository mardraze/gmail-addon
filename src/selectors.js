// Wszystkie selektory zależne od DOM Gmaila w jednym miejscu.
// Po zmianie struktury Gmaila poprawiaj tylko ten plik.
globalThis.GAI_SELECTORS = {
  // Edytowalne pole treści wiadomości (nie zależy od języka interfejsu).
  composeBody: 'div[contenteditable="true"][role="textbox"][g_editable="true"]',
  // Dolny pasek narzędzi okna kompozycji (tu trafia przycisk AI).
  toolbar: '.btC',
  // Zapasowo: przycisk "Wyślij" - przycisk AI trafia obok niego.
  sendButton: 'div.T-I.aoO[role="button"]',
  // Okno kompozycji w trybie dialogu / wyskakującego okienka.
  dialog: 'div[role="dialog"]',
  // Cytowana poprzednia wiadomość w treści szkicu.
  quote: '.gmail_quote',
  // Elementy pomijane przy odczycie szkicu (cytaty, podpis Gmaila, nagłówek cytatu).
  excluded: '.gmail_quote, .gmail_signature, [data-smartmail="gmail_signature"], .gmail_attr',
  // Treści wiadomości w otwartym wątku.
  threadMessage: 'div.a3s.aiL',
  threadMessageContainer: 'div.adn, div.gs',
  threadSender: 'h3.iw span[email], span.gD[email]'
};
