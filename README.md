# Weather NUU — Backend

API системы мониторинга микроклимата (weather.nuu.uz): принимает показания датчиков
ESP32, хранит их в PostgreSQL, отдаёт историю, агрегаты и экспорт, рассылает обновления по
WebSocket. Фронтенд живёт в отдельном репозитории (`weather-nuu`).

> **Запуск всей системы, правила работы, задания и карта документов — в README репозитория
> `weather-nuu`.** Этот файл — справочник по бэкенду (API, команды, структура).

**Стек:** Node.js 20, TypeScript, Fastify, Drizzle ORM, PostgreSQL 15, Zod, Turborepo + pnpm.

## Быстрый старт (локально, без доступа к серверу)

Нужно: **Docker Desktop** (запущенный). Больше ничего ставить не требуется.

```bash
docker compose -f docker-compose.dev.yml up --build
```

Что произойдёт само: поднимется PostgreSQL, применятся миграции, база заполнится
синтетической историей за 90 дней (2 датчика, с намеренными «дырами», точка раз в 5 минут), запустится API.

Проверка: http://localhost:8002/v1/health → `{"status":"ok","db":"ok"}`

**Хотите «живые» данные** (как будто датчики включены и шлют показания каждые 5 секунд —
дашборд покажет LIVE, заработает WebSocket):

```bash
docker compose -f docker-compose.dev.yml --profile live up --build
```

Остановить: `Ctrl+C`, затем `docker compose -f docker-compose.dev.yml down`.
Стереть базу и начать заново: `docker compose -f docker-compose.dev.yml down -v`.

### Если порт занят

| Порт | Для чего | Как поменять |
|------|----------|--------------|
| 8002 | API | `API_PORT=8010` перед командой (тогда и прокси фронта надо направить туда) |
| 55432 | PostgreSQL наружу (нужен только для запуска API без Docker) | `DB_PORT=55440` |

Пример (PowerShell): `$env:DB_PORT=55440; docker compose -f docker-compose.dev.yml up --build`

## Запуск API без Docker (для тех, кто правит код бэкенда)

Нужно: Node.js 20+, pnpm (`corepack enable`), Docker (только для базы).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d db     # только база
cp apps/api/.env.example apps/api/.env                # локальные значения уже подходят
pnpm db:migrate
pnpm db:seed
pnpm dev                                              # API с автоперезапуском на :8002
pnpm sim                                              # (в другом терминале) фейковые датчики
```

## Команды

| Команда | Что делает |
|---------|-----------|
| `pnpm dev` | запуск API с автоперезапуском |
| `pnpm typecheck` | проверка типов (обязательна перед PR) |
| `pnpm test` | модульные тесты (Vitest), без базы |
| `pnpm test:integration` | интеграционные тесты на настоящей Postgres (нужна база: `docker compose -f docker-compose.dev.yml up -d db`) |
| `pnpm db:migrate` | применить миграции |
| `pnpm db:generate` | создать миграцию после правки `schema.ts` |
| `pnpm db:seed [--force] [--days=N] [--anomalies]` | заполнить локальную БД тестовыми данными (по умолчанию 90 дней); `--anomalies` добавляет пропуски, выбросы и «залипание» в известных местах (список: `apps/api/seed-anomalies.manifest.json`) |
| `pnpm sim` | имитатор датчиков, шлёт показания в локальный API |

`db:seed` и `sim` **отказываются работать с чужими адресами** (только localhost/Docker) — случайно
затереть или засорить боевые данные не получится.

## API

| Метод и путь | Назначение |
|--------------|-----------|
| `GET /v1/health` | состояние сервиса и БД |
| `POST /v1/sensors/:source` | приём показаний от устройства (`source`: `room` или `street`) |
| `GET /v1/sensors/:source/latest` | последнее показание |
| `GET /v1/sensors/:source/history` | история, постранично (`from`, `to`, `limit`, `cursor`) |
| `GET /v1/sensors/:source/aggregate` | агрегаты avg/min/max по интервалам (`from`, `to`, `bucket`) |
| `GET /v1/export/:source` | выгрузка CSV/XLSX (`format`, `lang`, `from`, `to`) |
| `GET /v1/export/:source/by-months` | выгрузка по месяцам (ZIP) |
| `WS /v1/ws/sensors` | push новых показаний |

Точные схемы запросов и ответов — в `packages/contracts/src/schemas/`.

**Поля показаний:** `fused_temp`, `hum`, `bmp_press`, `mq5`, `mq3` и пыль `pm25`, `pm10` (µg/m³).
Прошивка шлёт snake_case, API принимает и camelCase.

- `mq5` и `mq3` — датчики MQ-5 и MQ-3: оценка концентрации горючего газа (LPG) и паров спирта
  в ppm. Это **не** CO₂ и **не** PM2.5.
- `pm25` и `pm10` — настоящий датчик пыли (Plantower PMS), он есть только у Room. У Street
  значения `null`. Пара `0/0` от прошивки означает сбой чтения и сохраняется как `null`;
  значения вне диапазона 0–1000 отбрасываются поодиночке, остальной запрос сохраняется.
  История пыли до появления этих полей не сохранялась и восстановлению не подлежит.

## Структура

```
apps/api/src/
  modules/   sensors, export, cansat, health   (routes → service → repo)
  plugins/   db, websocket, device-auth, error-handler
  db/        schema.ts, migrations/, seed.ts
  jobs/      hourly-snapshot.ts
  lib/       курсоры, keyset-пагинация, выбор корзины агрегации (+ тесты)
  dev/       simulator.ts  (только для локальной разработки)
packages/contracts/   Zod-схемы, общие для бэкенда и фронтенда
packages/air-quality/ шкалы AQI и расчёт (чистый модуль, общие эталонные значения с фронтендом)
packages/timeseries/   пропуски и регулярная сетка для временных рядов (чистый модуль)
```

Устройство API и правила добавления кода — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); для ИИ-агентов —
[AGENTS.md](AGENTS.md). Подробный технический отчёт (проблемы старого бэкенда, решения, замеры) — в
репозитории фронтенда: `weather-nuu/docs/PROJECT_REPORT.md`.

## Полезно знать

- **Секреты не в git.** `apps/api/.env` в `.gitignore`. В `.env.example` — только локальные значения.
- **Боевой деплой** делает только владелец репозитория; контрибьюторам доступ к серверу не нужен.
- Время в БД хранится как `timestamptz` (UTC); в API всегда ISO-8601.
- Ошибка «port is already allocated» — порт занят другой программой, см. таблицу выше.
- Ошибка «cannot connect to the Docker daemon» — не запущен Docker Desktop.
