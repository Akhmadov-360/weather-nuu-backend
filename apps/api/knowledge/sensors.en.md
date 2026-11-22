---
source: NUUz station: sensors and their limits
url: https://weather.nuu.uz
lang: en
kind: sensor
title: Sensors of the NUUz station and their limits
---
# Sensors of the NUUz station and their limits

Each kit is built around an ESP32 microcontroller. The readings are estimates from low-cost sensors, not laboratory measurements.

## Dust sensor (Plantower PMS, room only)

A laser particle sensor: it counts particles in a stream of air and converts the counts to the mass concentration of PM1.0, PM2.5 and PM10 in µg/m³. PM2.5 means particles smaller than 2.5 µm, PM10 smaller than 10 µm. Limits: the conversion assumes a typical particle; high air humidity can make the sensor overstate the dust because particles swell; the values can differ from a reference instrument, so use them to follow changes and to compare hours and days. The dust sensor is installed only in the room. The street kit has no dust sensor.

## Gas sensors MQ-5 and MQ-3

Both are metal-oxide semiconductor sensors. Their resistance changes in the presence of certain gases, and the firmware converts it to ppm. MQ-5 is sensitive to combustible gases such as LPG and natural gas. MQ-3 is sensitive to alcohol vapour. Limits: neither sensor is selective (other gases and humidity change the signal), the ppm values are rough estimates, and neither is a safety alarm. Neither sensor measures carbon dioxide (CO2). The platform does not show CO2 and does not call the MQ readings CO2 or aerosol.

## Temperature, humidity and pressure

The readings are temperature in °C (a fused value from the firmware), relative humidity in percent and pressure in hPa. Pressure is the pressure at the station, not reduced to sea level, so in Tashkent it is around 960 hPa rather than 1013 hPa. Temperature and humidity in the room follow the air conditioner and the people in the room.

## Is the sensor alive

The platform marks a reading as stale when no new data has arrived for some time. A flat line on a chart can mean a stable value; a sensor that stopped sending data is shown as not alive.
