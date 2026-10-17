# @weather/timeseries

Общие кирпичики для временных рядов: поиск пропусков и приведение ряда к регулярной сетке.
Чистый TypeScript без базы и Fastify; используют экспорт (пропуски в файле), аналитика
(полнота данных, прогноз) и карта. Свои копии этих функций писать нельзя.

Время везде в миллисекундах UTC (`Date.getTime()`); значение `null` означает «нет показания»
и никогда не превращается в ноль.

## Пропуски

```ts
import { findGaps, gapBetween } from "@weather/timeseries";

// Между соседними показаниями: null, если расстояние не больше порога (ровно порог не пропуск)
gapBetween(prevMs, nextMs, { thresholdMs: 15 * 60_000 });

// По списку времён (любой порядок). С диапазоном считаются и тишина в начале и конце,
// а пустой ряд даёт один пропуск на весь диапазон.
findGaps(timesMs, { thresholdMs: 10 * 60_000, expectedStepMs: 5_000, fromMs, toMs });
// → [{ fromMs, toMs, durationMs, approxMissing }]
```

`expectedStepMs` задаёт, как часто ожидается показание, для оценки числа потерянных (платы шлют
раз в 5 секунд). Без него оценка идёт от порога, как в экспорте.

## Регулярная сетка

```ts
import { fillShortGaps, gridTimes, toRegularGrid } from "@weather/timeseries";

const range = { fromMs, toMs, stepMs: 3_600_000 };      // шаг: целое число миллисекунд
gridTimes(range);                                        // начала шагов
toRegularGrid(points, range);                            // [{ t, v }] → (number | null)[]; mean или last
const { values, filled } = fillShortGaps(grid, 3);       // короткие внутренние дыры линейно
```

* Шаг сетки покрывает `[from + i·step, from + (i+1)·step)`; шаг без показаний это `null`.
* `fillShortGaps` заполняет только **внутренние** пропуски не длиннее лимита; края и длинные
  тишины остаются `null` (их нельзя «выдумывать»). `filled[i]` показывает, какие значения
  сочинены, чтобы график или отчёт могли это подписать.
* Неверный шаг или пустой диапазон: `RangeError`.

```bash
pnpm --filter @weather/timeseries test
```
