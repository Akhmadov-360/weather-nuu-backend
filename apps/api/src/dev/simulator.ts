import "dotenv/config";

/**
 * Pretends to be the two ESP32 devices: posts a reading every few seconds in
 * the exact shape the real firmware sends (snake_case keys, `x-api-key`
 * header) so the dashboard shows LIVE data and the WebSocket push can be
 * seen working locally.
 *
 *   pnpm sim                    # posts to http://localhost:8002 every 5 s
 *   API_URL=http://localhost:8002 SIM_INTERVAL_MS=2000 pnpm sim
 *
 * Only talks to a local API — refuses anything else so it can never feed
 * fake readings into the real server.
 */

const API_URL = process.env.API_URL ?? "http://localhost:8002";
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 5000);
const API_KEY = process.env.INGEST_API_KEY ?? "local-dev-only-key-0123456789abcdef";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "api"]);
const host = new URL(API_URL).hostname;
if (!LOCAL_HOSTS.has(host)) {
  console.error(`Refusing to simulate: API_URL host "${host}" is not local (allowed: ${[...LOCAL_HOSTS].join(", ")}).`);
  process.exit(1);
}

const wobble = (amp: number) => (Math.random() - 0.5) * amp;

function reading(source: "room" | "street") {
  const hour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  const daily = Math.sin((2 * Math.PI * (hour - 4)) / 24);
  const room = source === "room";
  // Only the Room device has a dust sensor. About 1 read in 30 fails and the
  // real firmware then posts 0/0 — reproduced here so the backend's handling
  // of it can be seen working.
  const dust = room
    ? Math.random() < 0.03
      ? { pm25: 0, pm10: 0 }
      : (() => {
          const pm25 = Math.max(1, Math.round(14 + 3 * daily + wobble(5)));
          return { pm25, pm10: Math.round(pm25 * 1.6 + wobble(4)) };
        })()
    : {};
  return {
    ...dust,
    fused_temp: +((room ? 24 + 1.8 * daily : 17 + 7 * daily) + wobble(0.3)).toFixed(2),
    hum: +((room ? 38 - 6 * daily : 45 - 18 * daily) + wobble(1.5)).toFixed(1),
    bmp_press: +(962 + wobble(0.6)).toFixed(2),
    mq5: Math.max(0, Math.round((room ? 30 : 22) + 6 * Math.max(0, daily) + wobble(4))),
    mq3: Math.max(0, Math.round((room ? 3 : 2) + wobble(3))),
  };
}

async function tick() {
  for (const source of ["room", "street"] as const) {
    try {
      const res = await fetch(`${API_URL}/v1/sensors/${source}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify(reading(source)),
      });
      console.log(`${new Date().toISOString()} ${source} -> ${res.status}`);
    } catch (err) {
      console.error(`${source} -> request failed (is the API running?):`, (err as Error).message);
    }
  }
}

console.log(`Simulator posting to ${API_URL} every ${INTERVAL_MS} ms. Ctrl+C to stop.`);
void tick();
setInterval(() => void tick(), INTERVAL_MS);
