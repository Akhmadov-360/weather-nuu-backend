# Боевой сервер: как устроен и как выкатывать

Здесь лежит то, что раньше жило только на сервере. Секретов в папке нет. Доступ на сервер — по
SSH через Kerio VPN; пароли и ключи в репозиторий не кладём.

## Что где работает (снимок на 10.10.2026)

| Что | Где | Как |
|-----|-----|-----|
| nginx (HTTPS, статика, прокси) | `/etc/nginx/sites-enabled/weather-nuu` | копия в `deploy/nginx/weather-nuu.conf` |
| Фронтенд (собранный `dist/`) | `/var/www/weather-frontend-new` | раздаёт nginx |
| API | контейнер `weather-api-new`, порт 8002 (только на сервере; наружу через nginx) | `apps/api/docker-compose.yml`, исходники в `/home/temur/apps/weather-backend` |
| База | контейнер `weather-db` (PostgreSQL 15), БД `weather` | общая сеть docker `cansat_default` |
| Сертификаты | Let's Encrypt, `/etc/letsencrypt`, проверка через `/var/www/certbot` | обновляет certbot |

Маршруты nginx: `/api/room`, `/api/street` — приём данных от плат (адреса зашиты в прошивку, менять
нельзя); `/api/room/latest`, `/api/room/all`, `/api/street/latest`, `/api/street/all` — старые
адреса для фронтенда, перенаправляются на `/v1/sensors/*`; `/api/v1/ws/sensors` — WebSocket;
остальное `/api/v1/*` — в `/v1/*`; всё прочее — `index.html` (SPA).

Исходники на сервере — это `git archive` нужного коммита (папки `.git` там нет). Проверка, что код
на сервере совпадает с коммитом: контрольные суммы файлов `apps/` и `packages/` на сервере и в
`git archive <коммит>` должны совпасть (файл `.env` не сравниваем).

## Выкатка API

1. Резервная копия базы: `docker exec weather-db pg_dump -U <пользователь> -d weather -Fc > backup.dump`.
2. Пометить текущий образ для отката: `docker tag weather-api-new:latest weather-api-new:pre-<что>`.
3. Загрузить `git archive` нужного коммита в `/home/temur/apps/weather-backend`, не трогая `apps/api/.env`.
4. В `apps/api`: `docker compose build`, затем одноразовый контейнер с `pnpm db:migrate`, затем
   `docker compose up -d`.
5. Проверить: `curl localhost:8002/v1/health` отвечает `{"status":"ok","db":"ok"}`, свежие строки
   появляются в `sensor_data`, в логе контейнера нет ошибок.

Откат: `docker tag weather-api-new:pre-<что> weather-api-new:latest` и `docker compose up -d`
(миграции только добавляют колонки, откат кода их не ломает).

## Выкатка фронтенда

1. Собрать: `pnpm install --frozen-lockfile && pnpm build` (адреса боевого API берутся из `.env.production`).
2. Заархивировать `dist/`, загрузить на сервер, сверить контрольную сумму.
3. Резервная копия: `cp -a /var/www/weather-frontend-new /var/www/weather-frontend-new.bak-<дата>`.
4. `rsync -a --delete <распакованный dist>/ /var/www/weather-frontend-new/`, затем
   `chown -R www-data:www-data /var/www/weather-frontend-new`.
5. Проверить в браузере `/room` и `/street` (карточка пыли, графики, консоль без ошибок).

Откат: `rsync -a --delete /var/www/weather-frontend-new.bak-<дата>/ /var/www/weather-frontend-new/`.
Открытая вкладка со старой версией при следующей подгрузке части страницы может получить 404 до
обновления страницы — это ожидаемо.

## Изменение nginx

Правьте файл в этом репозитории, на сервере сначала сделайте копию текущего, затем замените файл,
выполните `nginx -t` и только после «successful» — `systemctl reload nginx`.

## Известные недочёты конфигурации (на 10.10.2026, не исправлены)

- В `sites-enabled` есть второй файл `weather.nuu.uz` (ссылка на `sites-available/weather.nuu.uz`) —
  старая настройка под прежний Python-бэкенд на порту 8001. nginx пишет предупреждение
  `conflicting server name "weather.nuu.uz" ... ignored` и использует `weather-nuu`. Ссылку можно
  удалить (`rm /etc/nginx/sites-enabled/weather.nuu.uz`), проверив `nginx -t`.
- `gzip_types` не включает `text/css` и `image/svg+xml`: CSS отдаётся без сжатия.
- Для файлов `assets/*` (в именах хеши) нет долгого кэширования (`Cache-Control: public, max-age=31536000, immutable`).
