# Инструкции для ИИ-агентов (бэкенд)

Прочитайте до первого изменения:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): устройство API, слои, данные, контракты, как добавлять
   эндпоинты и модули. Фронтенд описан в репозитории `weather-nuu` (`docs/ARCHITECTURE.md`): если
   задание касается данных, прочитайте и его.
2. [README.md](README.md): запуск и команды.
3. Зоны и каталоги, правила стыка, календарь и ваше задание: `docs/tasks/README.md` и документ вашей зоны
   (`SPATIAL_VISUALIZATION.md` или `ANALYTICS.md`) в репозитории `weather-nuu`.

## Запуск

```bash
docker compose -f docker-compose.dev.yml --profile live up --build   # база + API :8002 + имитатор
curl http://localhost:8002/v1/health                                   # {"status":"ok","db":"ok"}
```

Фронтенд (папка `weather-nuu`): `pnpm install && pnpm dev`, http://localhost:5173.

## Минимум, который нельзя пропускать

* Перед «готово»: `pnpm typecheck` и `pnpm test` (то же запускает CI).
* Слои модуля: `routes → service → repo`, запросы к базе только в `repo`; схемы только в
  `packages/contracts` (Zod). Изменили схему, обновите типы и маппер во фронтенде.
* `null` это «нет показания», не ноль; время только `timestamptz` (UTC), в API ISO-8601.
* Миграции только через `pnpm db:generate`; они лишь добавляют; схему БД и миграции правит только владелец зоны
  станций (аналитика в базу не пишет).
* Правьте только модули своей зоны (таблица в `docs/tasks/README.md`); категории AQI только из
  `@weather/air-quality`, пропуски и сетку рядов только из `@weather/timeseries`, свои копии не пишите.
* Секреты в git не кладём; формат, который шлёт прошивка, не меняем; `db:seed` и `sim` работают только
  с локальной базой, защиту не обходим; на боевой сервер не ходим; `main` не трогаем напрямую, работаем
  в ветке и PR.
