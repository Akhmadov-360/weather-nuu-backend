---
source: US EPA Air Quality Index (AQI), 2024 revision
url: https://www.airnow.gov/aqi/aqi-basics/
lang: en
kind: standard
title: US EPA Air Quality Index and its categories
---
# US EPA Air Quality Index

The AQI turns the concentration of a pollutant into a number from 0 to 500 and a category. The platform uses the US EPA scale with the breakpoints revised in 2024: the upper limit of the Good category for PM2.5 was lowered from 12.0 to 9.0 µg/m³.

## Categories and what they mean

| Category | AQI | Colour | Meaning |
|----------|-----|--------|---------|
| Good | 0-50 | green | air quality is satisfactory, little or no risk |
| Moderate | 51-100 | yellow | acceptable; unusually sensitive people may have mild effects |
| Unhealthy for sensitive groups | 101-150 | orange | people with lung or heart disease, older adults and children may be affected; most people are not |
| Unhealthy | 151-200 | red | everyone may begin to feel effects; sensitive groups may feel more serious effects |
| Very unhealthy | 201-300 | purple | health alert: the risk is higher for everyone |
| Hazardous | 301-500 | maroon | emergency conditions: the whole population is likely to be affected |

## PM2.5 breakpoints (24-hour mean, µg/m³)

| Category | PM2.5 | PM10 |
|----------|-------|------|
| Good | 0.0-9.0 | 0-54 |
| Moderate | 9.1-35.4 | 55-154 |
| Unhealthy for sensitive groups | 35.5-55.4 | 155-254 |
| Unhealthy | 55.5-125.4 | 255-354 |
| Very unhealthy | 125.5-225.4 | 355-424 |
| Hazardous | 225.5-325.4 | 425-604 |

## How the number is calculated

The AQI is found by linear interpolation inside the category that contains the concentration C: AQI = (AQI_high - AQI_low) / (C_high - C_low) x (C - C_low) + AQI_low. PM2.5 is truncated to one decimal place and PM10 to a whole number first. For example, PM2.5 of 48.2 µg/m³ lies in the range 35.5-55.4, so the category is Unhealthy for sensitive groups and the AQI is about 132.

## What the station shows

The official AQI is defined for 24-hour averages. On the platform the category and the AQI are computed from the reading or from the average of the period that was asked about, so a single reading is a guide, not the official index. Only the room has a dust sensor. The street has none, so there is no AQI for the street.
