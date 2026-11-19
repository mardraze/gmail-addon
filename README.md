# Asystent AI do Gmaila (Gemini)

Rozszerzenie Chrome (Manifest V3, czysty JavaScript) do pisania, poprawiania i tłumaczenia maili w Gmailu przez Google Gemini z własnym kluczem API.

## Struktura

```
manifest.json
_locales/{pl,en}/messages.json   # i18n (domyślnie pl; nowy język = nowy katalog)
src/selectors.js                 # WSZYSTKIE selektory DOM Gmaila
src/content.js, content.css      # przycisk AI, panel, odczyt szkicu/wątku, wstawianie
src/background.js                # service worker: jedyny kontakt z Gemini API
src/prompts.js                   # instrukcje systemowe dla każdej akcji
options/options.{html,css,js}    # strona ustawień
```

## Instalacja

1. Klucz: wejdź na https://aistudio.google.com/apikey, zaloguj się i kliknij „Create API key”.
2. Chrome → `chrome://extensions` → włącz „Tryb programisty”.
3. „Załaduj rozpakowane” → wskaż ten katalog.
4. Kliknij ikonę rozszerzenia (otwiera ustawienia), wklej klucz, „Testuj połączenie”, „Zapisz”.
5. Odśwież Gmaila. W oknie tworzenia wiadomości obok „Wyślij” pojawi się przycisk „✦ AI”.

## Założenia

- Przycisk jest dodawany do dolnego paska okna kompozycji; panel otwiera się nad/pod przyciskiem.
- „Zamień szkic” podmienia tylko Twój tekst (nie cytowaną korespondencję ani podpis Gmaila). Przy zaznaczonym tekście akcje działają na zaznaczeniu, a przycisk zmienia się na „Zamień zaznaczenie”.
- Podpis z ustawień jest dodawany tylko przy akcji „Napisz”.
- Kontekst wątku: ostatnie do 5 rozwiniętych wiadomości (max ok. 12 tys. znaków) lub cytat ze szkicu.
- Domyślny model: `gemini-2.5-flash`; temperatura dla „Popraw” jest ograniczona do 0.3.
- Klucz jest w `chrome.storage.local` z poziomem dostępu `TRUSTED_CONTEXTS` (content script nie może go odczytać).
- Brak ikon (Chrome pokaże domyślną literę); można dodać `icons` do manifestu.

## Znane ograniczenia

- Klasy CSS Gmaila (`.btC`, `.a3s.aiL`, `.gmail_quote`…) mogą się zmienić – popraw je w `src/selectors.js`.
- Zwinięte wiadomości wątku nie są w DOM, więc nie trafią do kontekstu.
- Wstawianie używa `document.execCommand` (obsługuje Ctrl+Z, ale API jest oficjalnie przestarzałe).
- Wynik jest zwykłym tekstem (bez formatowania rich text).
- Brak strumieniowania odpowiedzi.

## Pomysły na rozwój

Strumieniowanie wyników, własne presety promptów, skróty klawiszowe, ikony, historia ostatnich wyników, tryb „odpowiedz jednym kliknięciem”, kolejne języki UI.
