# Архитектура бэкенда (для разработчиков и ИИ-агентов)

Документ описывает устройство API, правила добавления кода и то, как фронтенд использует данные.
Читать вместе с [README.md](../README.md) (запуск и команды) и [deploy/README.md](../deploy/README.md)
(боевой сервер). Фронтенд лежит в репозитории `weather-nuu` и описан в его `docs/ARCHITECTURE.md`:
если задание касается обеих частей, прочитайте оба документа. История решений и замеры: в
`weather-nuu/docs/PROJECT_REPORT.md`.

## 1. Что это

API мониторинга микроклимата weather.nuu.uz. Принимает показания двух плат ESP32 (`room` внутри
аудитории, `street` на улице), хранит их в PostgreSQL, отдаёт текущее значение, историю, агрегаты и
выгрузку, рассылает новые показания по WebSocket. Стек: Node.js 20, TypeScript, Fastify, Drizzle ORM,
PostgreSQL 15, Zod, Turborepo + pnpm.

## 2. Как запустить

Нужно: Docker Desktop (запущенный). Для правки кода ещё Node.js 20+ и pnpm (`corepack enable`).

```bash
# всё сразу: база, миграции, тестовые данные за 30 дней, API на :8002, имитатор датчиков
docker compose -f docker-compose.dev.yml --profile live up --build
# проверка
curl http://localhost:8002/v1/health        # {"status":"ok","db":"ok"}
```

Фронтенд: в папке `weather-nuu` команда `pnpm dev`, он ходит на `localhost:8002` через прокси Vite.

Без Docker для API (база всё равно в Docker):

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d db
cp apps/api/.env.example apps/api/.env
pnpm db:migrate && pnpm db:seed && pnpm dev     # API :8002 с автоперезапуском
pnpm sim                                        # в другом терминале: фейковые датчики
```

Заполнить базу заново при запущенном стеке:
`docker compose -f docker-compose.dev.yml exec -T api pnpm db:seed --force`.
Стереть всё: `docker compose -f docker-compose.dev.yml down -v`.

Проверки перед любым PR: `pnpm typecheck` и `pnpm test` (их запускает CI; CI ещё поднимает стек и
проверяет, что он отвечает). Порты: API `8002` (`API_PORT`), PostgreSQL наружу `55432` (`DB_PORT`).

## 3. Структура

```
apps/api/src/
  app.ts         сборка приложения (порядок плагинов важен, см. §5)
  server.ts      запуск; env.ts: проверка переменных окружения (Zod, падает при ошибке)
  modules/       sensors, export, cansat, health; в каждом routes → service → repo
  plugins/       db, websocket, device-auth, error-handler
  db/            schema.ts, migrations/ (drizzle), manual/ (разовые SQL), seed.ts, client.ts
  jobs/          hourly-snapshot.ts
  lib/           курсоры, keyset-пагинация, выбор корзины агрегации (+ тесты)
  dev/           simulator.ts: только для локальной разработки
packages/contracts/   Zod-схемы запросов и ответов и события WebSocket, общие для API и фронтенда
packages/air-quality/ шкалы AQI (US EPA 2024) и расчёт: чистый модуль; эталонные значения общие с фронтендом
packages/{eslint-config,tsconfig}/
deploy/               конфиг nginx и описание выкатки на боевой сервер
```

## 4. Слои модуля

`routes` описывают HTTP и схемы (Zod из `@weather/contracts`) и вызывают `service`; `service` содержит
бизнес-правила и ничего не знает о Fastify; `repo` единственное место, где пишутся запросы к базе
(Drizzle). Зависимости только вниз. Новая функциональность оформляется отдельным модулем в
`modules/<имя>/` по той же схеме и регистрируется в `app.ts`.

## 5. Приложение и плагины (`app.ts`)

Порядок регистрации важен. CORS, затем **WebSocket раньше compress**: глобальное сжатие вызывало
случайные 502 при апгрейде соединения, поэтому `@fastify/compress` не глобальный (сжатие нужно только
выгрузке); дальше `db`, `error-handler`, `device-auth`, затем маршруты и задача `hourly-snapshot`.

* **Ошибки:** `AppError` из контрактов и общий обработчик; наружу единый формат ошибки (`errors.ts`).
* **Авторизация устройств:** `x-api-key` проверяется, но не обязателен (старая прошивка его не шлёт и
  менять её нельзя). Ключ сравнивается за постоянное время. Секрет `INGEST_API_KEY` только в `.env`
  сервера, в git его нет.
* **WebSocket:** `GET /v1/ws/sensors`, рассылка в одном процессе через `app.broadcast(event)`
  (`sensor.update`, `cansat.update`). За несколькими репликами понадобится Redis pub/sub.

## 6. Данные

* **Таблица `sensor_data`:** `source` (`room` | `street`), `hum`, `bmp_press`, `mq5`, `mq3`, `fused_temp`,
  `pm25`, `pm10`, `timestamp` (`timestamptz`, UTC), `is_snapshot`. Индекс `(source, timestamp)`:
  каждый запрос фильтрует по станции и времени.
* **`null` это «нет показания», не ноль.** У `street` датчика пыли нет. Пара `0/0` от прошивки
  означает сбой чтения и сохраняется как `null`; значения вне 0–1000 отбрасываются поодиночке
  (`modules/sensors/pm.ts`), остальной запрос сохраняется.
* **Прошивка шлёт snake_case** (`bmp_press`, `fused_temp`), API принимает и camelCase: переименование
  в `SensorReadingInputSchema`. В ответах всегда camelCase и ISO-8601 в UTC.
* **Снимки раз в час:** `jobs/hourly-snapshot.ts` клонирует последнее настоящее показание
  (`is_snapshot = true`), если платы писали в последние 3 часа; дольше пауза остаётся пробелом в данных,
  по ней фронтенд отличает «датчик молчит» от «тихой минуты».
* **Миграции:** правите `db/schema.ts`, затем `pnpm db:generate`, проверяете SQL и коммитите вместе;
  `pnpm db:migrate` применяет. Миграции только добавляют (откат кода их не ломает). Разовые SQL лежат
  в `db/manual/`.

## 7. API (кратко)

| Метод и путь | Назначение |
|--------------|-----------|
| `GET /v1/health` | состояние сервиса и БД |
| `POST /v1/sensors/:source` | приём показаний (проверка `x-api-key`) |
| `GET /v1/sensors/:source/latest` | последнее показание |
| `GET /v1/sensors/:source/history` | история постранично (keyset: `from`, `to`, `limit` до 10000, `cursor`) |
| `GET /v1/sensors/:source/aggregate` | avg/min/max по корзинам (`from`, `to`, `bucket=auto`) |
| `GET /v1/export/:source`, `/by-months` | CSV/XLSX и ZIP по месяцам (потоком) |
| `WS /v1/ws/sensors` | push новых показаний |

Точные схемы: `packages/contracts/src/schemas/`. **Фронтенд копирует типы контракта вручную** (чтобы
сборка фронтенда не зависела от этого пакета): меняете схему здесь, обновите типы в
`weather-nuu/src/entities/weather/model/weather.types.ts` и маппер.

* **Агрегаты:** `resolveAutoBucket` выбирает ширину корзины так, чтобы точек было около
  `AGGREGATE_TARGET_POINTS`; сервер возвращает выбранную корзину.
* **Пагинация:** keyset (`lib/keyset.ts`, `lib/cursor.ts`), а не `OFFSET`: быстро на миллионе строк.
* **Выгрузка:** потоковая, с проверкой целостности XLSX/ZIP; пробелы в данных размечаются
  (`export/gap-detector.ts`), заголовки переводятся (`export/i18n.ts`).

## 8. Контракты (`packages/contracts`)

Zod-схемы единый источник формы данных: валидируют вход и выход, из них выводятся TypeScript-типы,
события WebSocket описаны тут же (`ws-events.ts`). Новое поле: сначала схема, затем БД (миграция),
затем модуль, затем тест, затем фронтенд.

## 9. Тесты

Vitest, файлы `*.test.ts` рядом с кодом (`lib/`, `modules/sensors/pm.test.ts`, `gap-detector.test.ts`).
Логику выносите в чистые функции и тестируйте их; работа с базой проверяется запуском стека. Меняете
правило обработки данных, добавьте тест на граничные значения.

## 10. Как добавить

**Эндпоинт в существующем модуле:** схема в `contracts`, маршрут с `schema` в `*.routes.ts`, правило
в `*.service.ts`, запрос в `*.repo.ts`, тест.

**Новый модуль** (например, станции и снимок для карты): `modules/<имя>/{routes,service,repo}.ts`,
схемы в `contracts/src/schemas/<имя>.ts` с экспортом из `index.ts`, регистрация в `app.ts`, таблицы в
`db/schema.ts` и миграция, тесты. Целевая архитектура темы диплома (станции типа `own` и `external`,
`GET /v1/stations`, `GET /v1/map/snapshot`, `GET /v1/stations/:id/history`, серверный расчёт AQI)
описана в `weather-nuu/docs/PROJECT_REPORT.md`, разделы 11.2 и 11.3. Шкалы AQI вынесены в пакет `@weather/air-quality` (`packages/air-quality`): серверный расчёт, карта и
аналитика берут категории и AQI только из него, свою шкалу писать нельзя. Совпадение с фронтендовой копией
(`src/shared/lib/air-quality/`) гарантирует общий файл эталонных значений (см. README пакета).

**Внешний источник данных:** адаптер в отдельной папке, нормализация в общий формат станции, запись
через `service`, нет секретов в коде, ошибки источника не должны ронять API.

## 11. Чего не делать

Не хранить секреты в git и не печатать их в логах; не менять формат, который шлёт прошивка (платы уже
в поле); не запускать `db:seed` и `sim` против чужих адресов (они отказываются работать не с localhost
или Docker, не обходите защиту); не ходить на боевой сервер (выкатка только у владельца
репозитория); не использовать `OFFSET` для больших выборок; не регистрировать глобальный `compress`
раньше WebSocket; не хранить время без пояса (только `timestamptz`).
