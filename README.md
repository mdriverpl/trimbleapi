# Trimble REST API + panel Vue

Aplikacja TypeScript / Node.js 24 / Vue 3 / PostgreSQL 18 do cyklicznego pobierania SOAP. Domyślnie 10 osobnych wątków `worker_threads` realizuje zadania kont klientów. Liczba kont jest niezależna od rozmiaru puli; każde ma `idclient`, użytkownika, hasło, aktywność i przypisaną usługę.

## Uruchomienie Docker Compose (Hostava)

Domy?lny plik `compose.yaml` uruchamia backend i panel z zewn?trzn? baz? Hostava. Nie tworzy kontenera PostgreSQL.

1. Na serwerze skopiuj `.env.example` do `.env` i wpisz has?o Hostava w `DATABASE_URL`. Znaki specjalne w ha?le zakoduj jako URL. Ustaw `ADMIN_TOKEN` (minimum 24 znaki) i `ENCRYPTION_KEY` (64 znaki hex). Przy przenoszeniu istniej?cej aplikacji zachowaj jej klucz szyfrowania.
2. Skopiuj otrzymany certyfikat CA do `certs/hostava-db-ca.pem`. Plik musi by? czytelny dla u?ytkownika kontenera. Certyfikat i `.env` nie s? publikowane w repozytorium.
3. W serwerowym `DATABASE_URL` pozostaw `sslmode=verify-full&sslrootcert=/app/certs/hostava-db-ca.pem`. Jest to ?cie?ka wewn?trz kontenera, nie ?cie?ka Windows. Compose montuje certyfikat tylko do odczytu i wymaga istniej?cego pliku.
4. Zatrzymaj wcze?niejsz? instancj? aplikacji korzystaj?c? z tej samej bazy. Blokada PostgreSQL pozwala dzia?a? tylko jednemu backendowi.

```sh
docker compose up -d --build
docker compose logs --tail=100 trimble
```

Panel: http://localhost:3000 na serwerze. Zaloguj si? warto?ci? `ADMIN_TOKEN`. Port jest dost?pny tylko lokalnie; dla dost?pu przez domen? skonfiguruj reverse proxy z HTTPS na port 3000. Przy pierwszym starcie aplikacja automatycznie tworzy tabele w bazie. Dane z wcze?niejszej bazy lokalnej nie s? automatycznie przenoszone.

Alternatywnie `compose.local.yaml` uruchamia aplikacj? i PostgreSQL 18 z wolumenem `postgres-data`. Ustaw `POSTGRES_PASSWORD`, `ADMIN_TOKEN` oraz `ENCRYPTION_KEY`, nast?pnie uruchom:

```sh
docker compose -f compose.local.yaml up -d --build
```

Wariant lokalny u?ywa `postgres:5432` i nie korzysta z Hostava ani certyfikatu. Wolumen pozostaje po `down`; opcja `down -v` usuwa jego dane.

## Uruchomienie lokalne

Na Windows z zainstalowanym PostgreSQL 18 lub 17 można uruchomić projekt bez Dockera:

```powershell
npm.cmd run build
npm.cmd run start:local
```

Polecenie tworzy osobną bazę projektu w `.local-runtime/postgres`, uruchamia ją na `127.0.0.1:55430` oraz aplikację na porcie z `PORT` (domyślnie 3000). Procesy działają w tle. Logi znajdują się w `.local-runtime/app.log` i `postgres.log`. Ustawia lokalny `DATABASE_URL` w `.env`, zachowując jego poprzednią zawartość w `.local-runtime/env.before-local`; nie zmienia istniejących usług PostgreSQL na komputerze. Nie usuwaj `.local-runtime`, ponieważ zawiera trwałe dane i kopię konfiguracji. Po restarcie komputera ponownie użyj `npm.cmd run start:local`. Opcjonalne `POSTGRES_BIN` wskazuje katalog z programami PostgreSQL, a `LOCAL_POSTGRES_PORT` zmienia port osobnej bazy.

Jeśli używasz PostgreSQL z Compose lub własnej bazy:

```sh
npm install
node scripts/init-env.mjs
# Ustaw DATABASE_URL na lokalny PostgreSQL (host 127.0.0.1, port POSTGRES_PORT).
docker compose -f compose.local.yaml up -d postgres
npm run build
node --env-file=.env backend/dist/server.js
```

Tryb developerski: `npm run dev`, panel http://localhost:5173, proxy API na port 3000. Zmiany TypeScript są automatycznie kompilowane, a backend restartowany. W trybie developerskim pozostaw `PORT=3000` albo zmień adres proxy w `frontend/vite.config.ts`. Po kompilacji aplikację można również uruchomić przez `npm start`. Na Windows z blokadą PowerShell użyj `npm.cmd` zamiast `npm`.

Możesz użyć własnego PostgreSQL zamiast kontenera: utwórz bazę i rolę, a następnie ustaw `DATABASE_URL=postgresql://uzytkownik:haslo@host:5432/baza`. Rola aplikacji musi móc tworzyć tabele i indeksy w schemacie `public`. Migracja `backend/migrations/001_initial.sql` uruchamia się automatycznie i zapisuje wersję w `schema_migrations`. Konfiguracja usług i wyniki mają typ JSONB, XML pozostaje tekstem, a czasy API to milisekundy Unix.

**Zmiana z wcześniejszego SQLite:** pliki i wolumen SQLite nie są usuwane ani automatycznie importowane. Aplikacja używa teraz wyłącznie PostgreSQL, a `DATABASE_PATH` jest ignorowane. Jeśli wcześniejsza instalacja ma dane, zachowaj jej kopię i klucz `ENCRYPTION_KEY`; import starej bazy nie jest częścią tej wersji.

## Pierwsze połączenie

Zakładka **Workery** to panel zarządzania kontami: dodawanie, edycja loginu/hasła, `idclient`, usługi i znacznika, wyszukiwanie, filtry usług/statusów, ręczne pobieranie oraz usuwanie. Przycisk **Szczegóły** pokazuje błędy, znacznik, czasy oraz ostatnie 20 prób danego konta. Statusy odświeżają się co 3 sekundy, a licznik czasu do pobrania co sekundę.

Przyciski **Włącz/Wyłącz** zmieniają tylko aktywność konta, zachowując hasło, `mark`, liczniki błędów i termin następnego pobrania. Można wyłączyć zajęty worker: bieżące zapytanie zostanie dokończone, ale następne nie wystartuje. **Pobierz teraz** wymaga aktywnego konta, usługi i harmonogramu; pomija zaplanowaną przerwę. Usunięcie konta usuwa również jego historię i bieżące dane pojazdów.

1. Dodaj usługę w trybie **Demo**, z interwałem 60 sekund.
2. Dodaj aktywny worker, podając nazwę i `idclient`; przypisz usługę demo. Możesz dodać 10 lub więcej kont.
3. W panelu statusów zobaczysz pobieranie, ostatni sukces i historię. Demo zwraca oznaczone, przykładowe dane pojazdu.
4. Dla Trimble wybierz tryb **Trimble Tracking · pollTraces** (domyślny w nowym formularzu). Adres `https://soap.box.trimbletl.com/fleet-service/Tracking` i timeout 300 sekund są gotowe. Dodaj worker z `idclient = customerID`, `user = userName`, `pass = userPass`.

## Trimble Tracking — pollTraces

W **Workery → Edytuj** można ustawić własną **Pauzę szybką** i **Pauzę długą** dla konkretnego konta Trimble (sekundy, 1–86400). Wartości workera mają pierwszeństwo przed usługą. Puste pole (`null` w API) dziedziczy odpowiednią wartość usługi; pola można nadpisywać niezależnie. Przy aktualizacji przez API pominięcie pola zachowuje poprzednią wartość, a `null` przywraca dziedziczenie. Migracja `003_worker_pauses.sql` dodaje kolumny bez zmiany istniejących ustawień. Szczegóły workera pokazują efektywne pauzy.

W **Usługi → Konfiguruj** możesz ustawić **Pauzę szybką** (`dataIntervalSeconds`, domyślnie 3 s) oraz **Pauzę długą** (`emptyIntervalSeconds`, domyślnie 180 s). Obie wartości są podawane w sekundach, w zakresie 1–86400, i obowiązują wszystkie workery przypisane do usługi. Zapis nie wymaga restartu: nową konfigurację otrzyma następne rozpoczynane zadanie. Już zaplanowany termin pobrania nie jest zmieniany; można użyć „Pobierz teraz”. Dla starszych usług bez tych pól stosowane są domyślne 3 i 180 sekund. Opisane niżej stałe odstępy dotyczą wartości domyślnych.

Adapter realizuje operację z przekazanego przykładu C#: SOAP 1.1, HTTP Basic i argumenty `{customer: idclient, mark}`. Login i hasło są w nagłówku Authorization, nie w argumentach XML. Kopia [publicznego WSDL Trimble](https://soap.box.trimbletl.com/fleet-service/Tracking?wsdl), pobrana 2026-10-06, znajduje się w `backend/wsdl/Tracking.wsdl` i jest dołączana do obrazu Docker. Tryb Trimble korzysta z tej kopii, nie pobiera WSDL przy każdym żądaniu. Pole `endpoint` umożliwia zmianę adresu operacji, np. na serwer testowy.

Każdy worker ma własny `mark`, widoczny w panelu oraz `/api/workers`. Początkowo puste pole oznacza 24 godziny wstecz w **UTC**, w formacie `yyyy-MM-ddTHH:mm:ss.000` (bez sufiksu `Z`, zgodnie z przykładem). Używamy UTC zamiast zależnego od serwera `DateTime.Now`. Wygenerowany początkowy znacznik jest zapisywany przed pierwszą próbą, więc błędy nie przesuwają początku zakresu.

WSDL definiuje odpowiedź `return: { traces, mark, more }`. Nowy znacznik jest traktowany jako nieprzezroczysty tekst i przesyłany bez zmian. Każda strona zostaje zapisana wraz z nowym `mark` w jednej transakcji PostgreSQL, na tym samym połączeniu. Błąd SOAP, przekroczony timeout, wadliwa odpowiedź lub błąd zapisu nie przesuwają znacznika.

Po każdej poprawnej odpowiedzi worker sprawdza liczbę `traces`: **co najmniej jedno zdarzenie → przerwa 3 sekundy; brak zdarzeń → przerwa 3 minuty**. Reguła obowiązuje niezależnie od `more`, także między stronami. Opóźnienie jest liczone od zakończenia odpowiedzi; harmonogram sprawdzany co sekundę może dodać około sekundę, a zajęta pula wydłużyć oczekiwanie. `more=true` z niezmienionym znacznikiem pozostaje błędem, aby uniknąć nieskończonego pobierania tej samej strony. Błędy mają osobny mechanizm ponowień, nie są traktowane jako puste odpowiedzi.

`GET /api/data/:workerId` zwraca ostatnią zapisaną stronę, nie całą historię trasy. `payload` ma postać:

```json
{
  "mark": "znacznik-z-serwera",
  "more": false,
  "traces": [{
    "source": "pojazd-1",
    "eventTimeUtc": "2026-10-06T08:00:00.000Z",
    "latitude": 52.2,
    "longitude": 21.1,
    "mileage": 123456,
    "type": 1,
    "heading": null,
    "speed": null,
    "tfu": null,
    "properties": []
  }]
}
```

Brak pozycji lub przebiegu jest reprezentowany przez `null`, nie przez zero. Zachowujemy jednostki liczb przesłane przez serwer; WSDL nie opisuje ich znaczenia. Czas ze strefą jest konwertowany na UTC, a dla czasu bez strefy przyjmujemy UTC. Surowy XML całej odpowiedzi jest dostępny w `rawXml` przez `GET /api/runs/:id` i w panelu historii; nie powielamy całej odpowiedzi przy każdym zdarzeniu.

Edycja workera może ustawić inny `mark` lub jawne `""`, aby zacząć ponownie dobę wstecz. Pominięcie `mark` zachowuje postęp, chyba że zmieniasz `idclient` lub `serviceId` — wtedy jest resetowany. Panel nie nadpisuje postępu, jeśli pola `mark` nie edytowano. Zmiana źródła usługi przypisanej do kont wymaga utworzenia nowej usługi i przeniesienia workerów; zapobiega to użyciu znacznika z niewłaściwego źródła.

Testy korzystają z rzeczywistego WSDL i lokalnego serwera SOAP. Połączenie z produkcyjnymi danymi Trimble wymaga własnego uprawnionego konta i nie zostało wykonane.

## Bieżące dane pojazdów

Tabela PostgreSQL `vehicle_current` oraz zakładka **Pojazdy** przechowują najnowszy trace każdego pojazdu. Klucz to `(worker_id, source)` — identyczny `source` u różnych klientów nie powoduje kolizji.

| Kolumna | Znaczenie |
| --- | --- |
| `source` | Identyfikator pojazdu z trace |
| `lat`, `lon` | Szerokość i długość geograficzna |
| `speed` | Prędkość z trace |
| `read_at` | Czas odczytu zdarzenia w UTC (`time` w SOAP) |
| `received_at` | Czas otrzymania/zapisu odczytu przez aplikację |
| `tfu` | Total Fuel Use, liczba z właściwości `tfu` lub `TFU` |
| `mileage`, `heading`, `trace_type` | Przebieg, kierunek i typ zdarzenia |
| `properties` | Wszystkie dodatkowe właściwości w JSONB, także oryginalna wartość TFU |
| `worker_id` | Konto pobierające dane; klient dostępny przez powiązanego workera |

Aktualizacja następuje w tej samej transakcji co wynik i `mark`. Starszy odczyt ani odczyt z identycznym czasem nie nadpisuje istniejącego rekordu. Pusta odpowiedź nie usuwa pojazdów. Każdy rekord jest spójnym odczytem: jeśli najnowszy trace nie zawiera pozycji, prędkości lub TFU, odpowiednie kolumny mają `NULL`; nie przenosimy wartości ze starszego zdarzenia. TFU nie jest przeliczane na inne jednostki. Niepoprawna lub brakująca wartość TFU daje `NULL`, a tekst pozostaje w `properties`.

`GET /api/vehicles?workerId=1&source=pojazd-1&limit=100&offset=0` zwraca bieżące odczyty. Filtry są opcjonalne; `source` oznacza dokładny identyfikator, limit wynosi 1–500 (domyślnie 100). Panel odświeża listę co 3 sekundy, obsługuje filtrowanie i kolejne strony. W przeciwieństwie do historii prób tabela nie jest objęta limitem 100 wpisów. Usunięcie workera usuwa jego bieżące pojazdy; zmiana klienta lub przypisanej usługi czyści je, aby uniknąć mieszania kont.

Migracja `002_vehicle_current.sql` uruchamia się automatycznie przy starcie. Tabela jest zasilana nowymi pobraniami; nie importuje historycznych prób, które mogą dotyczyć dawnej konfiguracji klienta.

## Inne usługi SOAP

Tryb **SOAP (własna konfiguracja)** pozostaje dostępny: ustaw WSDL, dokładną nazwę operacji, sposób uwierzytelnienia i JSON argumentów zgodny ze schematem danej usługi. Ten tryb nie obsługuje automatycznie znaczników ani paginacji.

Przykład szablonu argumentów (nazwy pól należy dopasować do konkretnej usługi):

```json
{"idclient":"{{idclient}}","user":"{{user}}","pass":"{{pass}}"}
```

Szablony działają również wewnątrz obiektów i tablic. Dostępne jest HTTP Basic, WS-Security UsernameToken lub przekazanie danych w argumentach SOAP. Hasła wpisuj w konfiguracji workera, nie w JSON usługi. Edycja workera z pustym polem hasła zachowuje poprzednie hasło; API pozwala jawnie wyczyścić hasło przez `pass: ""`, a pominięcie `pass` je zachowuje.

W trybie ogólnym WSDL musi być dostępny dla serwera; auth Basic/WS-Security dotyczy wywołania operacji, nie pobierania chronionego WSDL.

## Harmonogram i dane

- Maksymalnie `WORKER_COUNT` równoległych zadań (domyślnie 10, zakres 1–32). Jedno konto nie ma równoległych wywołań.
- Trimble: 3 sekundy po odpowiedzi z danymi, 180 sekund po pustej. Demo i ogólny SOAP: interwał z konfiguracji usługi. Po błędzie odstęp rośnie wykładniczo od skonfigurowanego interwału, maksymalnie do 16 interwałów; sukces resetuje licznik. W trybie Trimble pole interwału służy wyłącznie ponowieniom po błędach.
- Limit czasu (5–300 sekund) obejmuje przygotowanie klienta i operację. Zawieszony wątek jest kończony i zastępowany nowym. Nie odwzorowujemy osobnych timeoutów Open/Close i limitów `XmlDictionaryReaderQuotas` z WCF; używamy limitu czasu całego zadania oraz rozmiaru odpowiedzi.
- Wyłączenie usługi, workera lub całego harmonogramu blokuje nowe zadania. Bieżące zadania kończą się normalnie. Edycja/usuwanie zajętego workera zwraca 409.
- Trimble: limit 20 000 000 bajtów odpowiedzi HTTP przed parsowaniem XML oraz 20 000 000 bajtów wynikowego JSON. Ogólny SOAP: limit 5 MB po serializacji, bez ograniczenia pamięci podczas samego parsowania. Zachowywane jest ostatnie 100 prób/stron na konto, również nieudanych, wraz z XML dla udanych stron Trimble. To ograniczona historia, nie archiwum telemetryczne; starsze strony są usuwane nawet gdy `mark` jest już dalej. Wyniki nie są deduplikowane, ponowne ustawienie wcześniejszego `mark` może powtórzyć dane.
- Po restarcie konfiguracja, historia, znacznik i stan wstrzymania pozostają zapisane w PostgreSQL. Przerwane pobranie zostaje zakwalifikowane ponownie z ostatniego zapisanego znacznika. Zajmowanie zadań i edycja kont używają blokad wierszy. Błąd zapisu wyników zatrzymuje backend, aby nie przesunąć znacznika bez danych; Compose uruchamia aplikację ponownie.
- Hasła kont są szyfrowane AES-256-GCM. Klucz `ENCRYPTION_KEY` przechowuj razem z bezpieczną kopią konfiguracji; zmiana klucza wymaga ponownego zapisania haseł. Odpowiedzi SOAP są przechowywane jako zwykły JSON i mogą zawierać dane wrażliwe. Błędy SOAP są celowo ogólne, aby nie ujawnić haseł lub XML żądania.
- Administrator ma pełny dostęp, w tym możliwość konfiguracji adresów SOAP osiągalnych z serwera. Token nie jest zapisywany w przeglądarce i znika po odświeżeniu. Projekt nie zawiera kont użytkowników ani ról.

## REST API

Wszystkie ścieżki `/api/*` wymagają `Authorization: Bearer <ADMIN_TOKEN>`. Publiczne `GET /health` sprawdza również połączenie PostgreSQL. Żądania zapisu używają `Content-Type: application/json`. Pole `success` w historii ma teraz typ boolean (`true`/`false`).

| Metoda | Ścieżka | Działanie |
| --- | --- | --- |
| GET | `/api/status` | Pula, harmonogram, usługi i statusy kont |
| PUT | `/api/control` | `{"enabled":true}` lub `false` |
| GET / POST | `/api/services` | Lista / utworzenie usługi |
| PUT / DELETE | `/api/services/:id` | Pełna aktualizacja / usunięcie nieużywanej usługi |
| GET / POST | `/api/workers` | Lista bez haseł / utworzenie konta |
| PUT / DELETE | `/api/workers/:id` | Pełna aktualizacja / usunięcie konta i jego historii |
| PATCH | `/api/workers/:id/active` | `{"active":true}` lub `false`; zmiana aktywności także podczas pobierania |
| POST | `/api/workers/:id/run` | Zlecenie pobrania aktywnego konta; odpowiedź 202 |
| GET | `/api/runs?workerId=1&limit=50` | Historia, limit do 100, oba parametry opcjonalne |
| GET | `/api/runs/:id` | Szczegóły próby, JSON wyniku |
| GET | `/api/data/:id` | Ostatni zachowany udany wynik workera |
| GET | `/api/vehicles` | Bieżące pojazdy; filtry `workerId`, `source`, paginacja `limit`, `offset` |

Usługa: `name, active, mode (demo/soap/trimble), endpoint (opcjonalny, domyślnie Trimble Tracking), wsdl, operation, auth (basic/wssecurity/parameters), parameters (obiekt), intervalSeconds (10–86400), timeoutSeconds (5–300)`. W trybie `trimble` operacja, uwierzytelnianie i argumenty są ustalone przez adapter; pola `wsdl`, `operation`, `auth`, `parameters` są ignorowane.

Worker: `name, idclient, user, pass (opcjonalne), active, serviceId, mark (opcjonalne)`.

## Sprawdzanie

```sh
npm run build
npm test
```

Dla testów bazy i integracji ustaw jawnie `TEST_DATABASE_URL` na serwer testowy z rolą mającą `CREATEDB`. Testy tworzą i usuwają własne bazy o losowych nazwach `trimble_test_*`; nie używają `DATABASE_URL` aplikacji. Przykład PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:haslo@127.0.0.1:5432/postgres'
npm.cmd test
node scripts/smoke.mjs
node scripts/trimble-smoke.mjs
```

Bez `TEST_DATABASE_URL` test bazy w `npm test` jest jawnie pomijany; skrypty integracyjne wymagają tej zmiennej. Test PostgreSQL sprawdza migrację, rollback, równoległe transakcje, odrzucenie drugiej instancji oraz zachowanie postępu po restarcie. Testy API sprawdzają pulę 10 wątków i 12 kont oraz SOAP. Test Trimble używa kopii WSDL Tracking i sprawdza HTTP Basic, faktyczny odstęp co najmniej 3 sekundy między zapytaniami z danymi, zapis terminu 180 sekund po pustej odpowiedzi, zachowanie mark po błędzie/restarcie oraz limit 20 MB. Nie zastępuje to testu na koncie produkcyjnym. Docker wymaga oddzielnego sprawdzenia przez `docker compose up --build`.

Dokumentacja użytych mechanizmów: [Node.js worker threads](https://nodejs.org/api/worker_threads.html), [node-soap](https://github.com/vpulim/node-soap), [transakcje node-postgres](https://node-postgres.com/features/transactions), [obraz PostgreSQL](https://hub.docker.com/_/postgres).
