import type { ExportLang } from "@weather/contracts";

/**
 * Translations for XLSX headers and sheet names. Kept in the export module
 * on purpose — this is not a general-purpose i18n layer, it exists to make
 * the downloaded file readable by a human in Excel without them needing to
 * know that `bmpPress` means "atmospheric pressure". Any new column added
 * to EXPORT_COLUMNS needs an entry under `columns` here in all 3 languages.
 */
type ColumnKey =
  | "hum"
  | "bmpPress"
  | "mq5"
  | "mq3"
  | "fusedTemp"
  | "pm25"
  | "pm10"
  | "temp"
  | "pressure"
  | "humidity"
  | "accelX";

interface Dict {
  readings: string;
  gaps: string;
  recordedAt: string;
  gapFrom: string;
  gapTo: string;
  approxMissingReadings: string;
  columns: Record<ColumnKey, string>;
  units: Partial<Record<ColumnKey, string>>;
  summarySheet: string;
  summaryMonth: string;
  summaryCount: string;
  summaryAvg: string;
  summaryMin: string;
  summaryMax: string;
}

const DICTS: Record<ExportLang, Dict> = {
  ru: {
    readings: "Данные",
    gaps: "Пропуски",
    recordedAt: "Время (UTC)",
    gapFrom: "Начало пропуска",
    gapTo: "Конец пропуска",
    approxMissingReadings: "Пропущено записей (≈)",
    columns: {
      hum: "Влажность",
      bmpPress: "Давление",
      mq5: "Горючий газ, MQ-5 (LPG)",
      mq3: "Пары спирта, MQ-3",
      pm25: "Пыль PM2.5",
      pm10: "Пыль PM10",
      fusedTemp: "Температура",
      temp: "Температура",
      pressure: "Давление",
      humidity: "Влажность",
      accelX: "Ускорение (X)",
    },
    units: {
      hum: "%",
      humidity: "%",
      bmpPress: "гПа",
      pressure: "гПа",
      mq5: "ppm",
      mq3: "ppm",
      pm25: "мкг/м³",
      pm10: "мкг/м³",
      fusedTemp: "°C",
      temp: "°C",
      accelX: "м/с²",
    },
    summarySheet: "Сводка",
    summaryMonth: "Месяц",
    summaryCount: "Измерений",
    summaryAvg: "Среднее",
    summaryMin: "Минимум",
    summaryMax: "Максимум",
  },
  uz: {
    readings: "Ma'lumotlar",
    gaps: "Uzilishlar",
    recordedAt: "Vaqt (UTC)",
    gapFrom: "Uzilish boshi",
    gapTo: "Uzilish tugashi",
    approxMissingReadings: "Yo'qolgan yozuvlar (≈)",
    columns: {
      hum: "Namlik",
      bmpPress: "Bosim",
      mq5: "Yonuvchi gaz, MQ-5 (LPG)",
      mq3: "Spirt bug'lari, MQ-3",
      pm25: "Chang PM2.5",
      pm10: "Chang PM10",
      fusedTemp: "Harorat",
      temp: "Harorat",
      pressure: "Bosim",
      humidity: "Namlik",
      accelX: "Tezlanish (X)",
    },
    units: {
      hum: "%",
      humidity: "%",
      bmpPress: "gPa",
      pressure: "gPa",
      mq5: "ppm",
      mq3: "ppm",
      pm25: "mkg/m³",
      pm10: "mkg/m³",
      fusedTemp: "°C",
      temp: "°C",
      accelX: "m/s²",
    },
    summarySheet: "Xulosa",
    summaryMonth: "Oy",
    summaryCount: "O'lchovlar",
    summaryAvg: "O'rtacha",
    summaryMin: "Minimum",
    summaryMax: "Maksimum",
  },
  en: {
    readings: "Readings",
    gaps: "Gaps",
    recordedAt: "Timestamp (UTC)",
    gapFrom: "Gap start",
    gapTo: "Gap end",
    approxMissingReadings: "Missing readings (≈)",
    columns: {
      hum: "Humidity",
      bmpPress: "Pressure",
      mq5: "Combustible gas, MQ-5 (LPG)",
      mq3: "Alcohol vapour, MQ-3",
      pm25: "Dust PM2.5",
      pm10: "Dust PM10",
      fusedTemp: "Temperature",
      temp: "Temperature",
      pressure: "Pressure",
      humidity: "Humidity",
      accelX: "Acceleration (X)",
    },
    units: {
      hum: "%",
      humidity: "%",
      bmpPress: "hPa",
      pressure: "hPa",
      mq5: "ppm",
      mq3: "ppm",
      pm25: "μg/m³",
      pm10: "μg/m³",
      fusedTemp: "°C",
      temp: "°C",
      accelX: "m/s²",
    },
    summarySheet: "Summary",
    summaryMonth: "Month",
    summaryCount: "Measurements",
    summaryAvg: "Average",
    summaryMin: "Minimum",
    summaryMax: "Maximum",
  },
};

export function tr(lang: ExportLang): Dict {
  return DICTS[lang];
}

/** Header text combining name + unit — "Temperature (°C)" style. */
export function columnHeader(lang: ExportLang, key: string): string {
  const d = DICTS[lang];
  const name = d.columns[key as ColumnKey] ?? key;
  const unit = d.units[key as ColumnKey];
  return unit ? `${name} (${unit})` : name;
}
