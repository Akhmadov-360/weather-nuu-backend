---
source: NUUz stansiyasi: datchiklar va ularning cheklovlari
url: https://weather.nuu.uz
lang: uz
kind: sensor
title: NUUz stansiyasi datchiklari va ularning cheklovlari
---
# NUUz stansiyasi datchiklari va ularning cheklovlari

Har bir komplekt ESP32 mikrokontrolleri asosida qurilgan. Ko‘rsatkichlar arzon datchiklarning baholari, laboratoriya o‘lchovlari emas.

## Chang datchigi (Plantower PMS, faqat auditoriyada)

Lazerli zarracha hisoblagich: havo oqimidagi zarrachalarni sanaydi va sonini PM1.0, PM2.5 va PM10 ning massaviy konsentratsiyasiga (mkg/m³) aylantiradi. PM2.5 — 2,5 mkm dan mayda zarrachalar, PM10 — 10 mkm dan mayda zarrachalar. Cheklovlar: havo namligi yuqori bo‘lsa, ko‘rsatkich oshib ketishi mumkin; qiymatlar etalon asbobdan farq qilishi mumkin, shuning uchun ulardan o‘zgarishlarni kuzatish uchun foydalaniladi. Chang datchigi faqat auditoriyada o‘rnatilgan. Ko‘cha komplektida chang datchigi yo‘q.

## MQ-5 va MQ-3 gaz datchiklari

Ikkalasi ham metall-oksidli yarimo‘tkazgich datchiklar. MQ-5 suyultirilgan va tabiiy gaz kabi yonuvchi gazlarga, MQ-3 spirt bug‘lariga sezgir. Cheklovlar: ikkalasi ham tanlab ta’sirlanmaydi, ppm qiymatlari taxminiy baho, ikkalasi ham xavfsizlik signalizatsiyasi emas. Hech biri karbonat angidridni (CO2) o‘lchamaydi. Platforma CO2 ni ko‘rsatmaydi va MQ ko‘rsatkichlarini CO2 yoki aerozol deb atamaydi.

## Harorat, namlik va bosim

Harorat °C da, nisbiy namlik foizda, bosim gPa da ko‘rsatiladi. Bosim stansiyadagi bosim, dengiz sathiga keltirilmagan, shuning uchun Toshkentda u 1013 gPa emas, taxminan 960 gPa.
