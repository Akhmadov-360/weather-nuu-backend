import type { RetrievalCase } from "./retrieval-eval.js";

const c = (lang: RetrievalCase["lang"], topic: string, question: string): RetrievalCase => ({ lang, topic, question });

/** Questions for the evaluation of the search. Written before looking at the results, not tuned to them. */
export const RETRIEVAL_CASES: RetrievalCase[] = [
  c("ru", "who-2021", "Какая рекомендуемая суточная норма PM2.5 по ВОЗ?"),
  c("ru", "who-2021", "Чем рекомендации ВОЗ 2021 года отличаются от прежних?"),
  c("ru", "who-2021", "Сколько озона допустимо по рекомендациям ВОЗ?"),
  c("en", "who-2021", "What is the WHO annual guideline for PM10?"),
  c("en", "who-2021", "Does the WHO give a guideline level for carbon monoxide?"),
  c("uz", "who-2021", "JSST PM2.5 uchun sutkalik tavsiya qancha?"),
  c("ru", "us-epa-aqi", "Что означает категория «вредно для чувствительных групп»?"),
  c("ru", "us-epa-aqi", "Как считается индекс AQI по концентрации?"),
  c("ru", "us-epa-aqi", "Какие значения PM2.5 считаются хорошими по шкале EPA?"),
  c("en", "us-epa-aqi", "Which AQI range counts as Unhealthy and what colour is it?"),
  c("en", "us-epa-aqi", "What changed in the 2024 revision of the AQI breakpoints?"),
  c("uz", "us-epa-aqi", "AQI ning xavfli toifasi qaysi rangda?"),
  c("ru", "sensors", "Что измеряет датчик MQ-5?"),
  c("ru", "sensors", "Почему давление около 960 гПа, а не 1013?"),
  c("ru", "sensors", "Как работает датчик пыли PMS и какие у него ограничения?"),
  c("en", "sensors", "Does the MQ-3 sensor measure CO2?"),
  c("en", "sensors", "Can high humidity make the dust sensor read too high?"),
  c("uz", "sensors", "MQ-3 datchigi nimani o‘lchaydi?"),
  c("ru", "station", "Где стоит комплект Room и чем он отличается от Street?"),
  c("ru", "station", "Почему для улицы нет показаний пыли?"),
  c("en", "station", "What is Weather NUUz and what can the website show?"),
  c("uz", "station", "Ko‘cha komplektida chang datchigi bormi?"),
  c("ru", "dust-and-ventilation", "Поможет ли открытое окно снизить пыль в аудитории?"),
  c("ru", "dust-and-ventilation", "Что означает резкий всплеск PM2.5 в аудитории?"),
  c("en", "dust-and-ventilation", "Does the air conditioner remove dust from the room?"),
  c("en", "dust-and-ventilation", "Where does dust indoors come from?"),
];
