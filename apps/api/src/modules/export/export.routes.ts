import { PassThrough, Readable } from "node:stream";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import ExcelJS from "exceljs";
// archiver v8 dropped its legacy `archiver("zip")` factory in favour of
// named ESM class exports, so we `new ZipArchive()` directly. Sitting
// behind an `unknown` cast because @types/archiver 8 still describes
// the class as an abstract-ish base — the runtime instance is fully
// operational (`.append`, `.finalize`, EventEmitter surface).
import { ZipArchive } from "archiver";
type ArchiverInstance = import("archiver").Archiver;
import { sql } from "drizzle-orm";
import {
  ExportByMonthsQuerySchema,
  ExportMetaSchema,
  ExportQuerySchema,
  ExportSourceSchema,
  type ExportLang,
  type ExportRow,
  type ExportSource,
} from "@weather/contracts";
import { z } from "zod";
import { ExportService, EXPORT_COLUMNS } from "./export.service.js";
import { SensorsRepo } from "../sensors/sensors.repo.js";
import { CansatRepo } from "../cansat/cansat.repo.js";
import { columnHeader, tr } from "./i18n.js";

/**
 * Parse a "YYYY-MM" month tag into its UTC calendar-month bounds.
 * `to` is the first instant of the NEXT month so range comparisons stay
 * strict-less-than and don't have to worry about "last millisecond of
 * the month" fencepost cases.
 */
function monthRange(tag: string): { from: Date; to: Date } {
  const [y, m] = tag.split("-").map(Number) as [number, number];
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)),
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function csvLine(values: (string | number | null)[]): string {
  return values.map((v) => (v === null || v === undefined ? "" : String(v))).join(",") + "\n";
}

async function* renderCsv(source: keyof typeof EXPORT_COLUMNS, rows: AsyncIterable<ExportRow>) {
  const columns = EXPORT_COLUMNS[source];
  // UTF-8 BOM: Excel opens CSVs in the system codepage (cp1251 on RU
  // locale) unless the file starts with EF BB BF — leading to `Влажность`
  // rendering as `P'P»P°P¶PSPѕCЃC‚CЊ`. Every modern text tool skips the
  // BOM silently, so it's an all-upside marker for Excel compatibility.
  yield "﻿";
  // Leading `kind` column makes every row self-describing — without it, a
  // "reading" row and a "gap" row are only distinguishable by which cells
  // happen to be empty, which reads as broken/malformed data rather than
  // two intentionally different row shapes sharing one table.
  yield csvLine(["kind", "recordedAt", ...columns, "gapFrom", "gapTo", "approxMissingReadings"]);
  for await (const row of rows) {
    if (row.kind === "reading") {
      yield csvLine(["reading", row.recordedAt, ...columns.map((c) => row.values[c] ?? null), null, null, null]);
    } else {
      yield csvLine([
        "gap",
        null,
        ...columns.map(() => null),
        row.from,
        row.to,
        row.approxMissingReadings,
      ]);
    }
  }
}

async function* renderNdjson(rows: AsyncIterable<ExportRow>) {
  for await (const row of rows) {
    yield JSON.stringify(row) + "\n";
  }
}

/**
 * Two-sheet XLSX: Readings on one sheet (only actual data rows, one column
 * per sensor field), Gaps on another (start/end/count). Splitting them
 * avoids what makes the flat CSV unreadable — a table where every gap row
 * has all sensor columns empty and every reading row has all gap columns
 * empty. Column headers and sheet names are localized to `lang`.
 *
 * Uses ExcelJS's streaming WorkbookWriter so we don't buffer the whole
 * workbook in memory — necessary for full-history exports (100k+ rows).
 */
function xlsxStream(
  source: keyof typeof EXPORT_COLUMNS,
  rows: AsyncIterable<ExportRow>,
  lang: ExportLang,
): PassThrough {
  const columns = EXPORT_COLUMNS[source];
  const dict = tr(lang);
  const passthrough = new PassThrough();

  // useStyles:false + useSharedStrings:false — dropping per-cell style
  // objects and the sharedStrings dict shrinks the file dramatically for
  // full-history exports (100k+ rows). Header bold/date formatting is
  // done once via column-level numFmt below, which stays cheap.
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: passthrough,
    useStyles: true,
    useSharedStrings: false,
  });

  const readings = workbook.addWorksheet(dict.readings);
  readings.columns = [
    { header: dict.recordedAt, key: "recordedAt", width: 22, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
    ...columns.map((c) => ({ header: columnHeader(lang, c), key: c, width: 20 })),
  ];

  const gaps = workbook.addWorksheet(dict.gaps);
  gaps.columns = [
    { header: dict.gapFrom, key: "from", width: 22, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
    { header: dict.gapTo, key: "to", width: 22, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
    { header: dict.approxMissingReadings, key: "n", width: 24 },
  ];

  // Kick off async writing; errors are surfaced through the passthrough.
  (async () => {
    try {
      for await (const row of rows) {
        if (row.kind === "reading") {
          const rec: Record<string, unknown> = { recordedAt: new Date(row.recordedAt) };
          for (const c of columns) rec[c] = row.values[c] ?? null;
          readings.addRow(rec).commit();
        } else {
          gaps
            .addRow({
              from: new Date(row.from),
              to: new Date(row.to),
              n: row.approxMissingReadings,
            })
            .commit();
        }
      }
      readings.commit();
      gaps.commit();
      await workbook.commit();
    } catch (err) {
      passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return passthrough;
}

/** camelCase JS field → snake_case DB column, e.g. `bmpPress` → `bmp_press`. */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

type ExecutableDb = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Monthly-aggregated overview as an XLSX workbook — one sheet where each
 * column group is `<metric> (avg | min | max)`. XLSX rather than CSV so
 * Excel opens it with correct encoding (a plain UTF-8 CSV renders as
 * mojibake in a system-cp1251 Excel) and non-tech users get the header
 * hierarchy without needing to format the sheet themselves.
 *
 * Aggregation happens in Postgres in a single pass — a raw month table
 * would balloon this file by ~10 000x for no analytical gain, since the
 * details are already in the per-month CSVs next to it.
 */
async function generateSummaryXlsx(
  db: ExecutableDb,
  source: ExportSource,
  months: string[],
  lang: ExportLang,
): Promise<Buffer> {
  const columns = EXPORT_COLUMNS[source];
  const dict = tr(lang);
  const from = monthRange(months[0]!).from;
  const to = monthRange(months[months.length - 1]!).to;
  const table = source === "cansat" ? "cansat_data" : "sensor_data";

  // Aliases have to be double-quoted so Postgres preserves the camelCase —
  // an unquoted alias like `bmpPress_avg` gets folded to `bmppress_avg`
  // and the row-key lookup below silently returns undefined.
  const aggregates = columns
    .flatMap((c) => {
      const snake = camelToSnake(c);
      return [
        `AVG(${snake}) AS "${c}_avg"`,
        `MIN(${snake}) AS "${c}_min"`,
        `MAX(${snake}) AS "${c}_max"`,
      ];
    })
    .join(", ");
  const sourceFilter = source === "cansat" ? sql`` : sql`AND source = ${source}`;

  const result = await db.execute(sql`
    SELECT to_char(date_trunc('month', "timestamp"), 'YYYY-MM') AS month,
           COUNT(*)::int AS count,
           ${sql.raw(aggregates)}
    FROM ${sql.raw(table)}
    WHERE "timestamp" >= ${from.toISOString()}::timestamptz
      AND "timestamp" <  ${to.toISOString()}::timestamptz
      ${sourceFilter}
    GROUP BY month
    ORDER BY month
  `);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(dict.summarySheet);

  // Two-row header: first row groups metrics ("Temperature (°C)"), second
  // row labels the stat (avg / min / max). Excel merges the group cell
  // across its three stat columns so it reads as one visual header.
  const groupRow = ["", ""] as (string | number)[];
  const statRow = [dict.summaryMonth, dict.summaryCount] as (string | number)[];
  for (const c of columns) {
    const h = columnHeader(lang, c);
    groupRow.push(h, "", "");
    statRow.push(dict.summaryAvg, dict.summaryMin, dict.summaryMax);
  }
  sheet.addRow(groupRow);
  sheet.addRow(statRow);

  // Merge each metric's header cell across its three stat columns.
  let col = 3;
  for (let i = 0; i < columns.length; i++) {
    sheet.mergeCells(1, col, 1, col + 2);
    col += 3;
  }

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: "center" };

  // Column widths — wide enough for "Carbon dioxide (CO₂) (ppm)"-class
  // headers, plus a tighter first column for the month tag.
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 12;
  for (let i = 3; i <= 2 + columns.length * 3; i++) sheet.getColumn(i).width = 18;

  // Data rows.
  const keys = ["month", "count", ...columns.flatMap((c) => [`${c}_avg`, `${c}_min`, `${c}_max`])];
  for (const row of result.rows) {
    const values = keys.map((k) => {
      const v = row[k];
      if (v === null || v === undefined) return null;
      // Aggregates come back as strings from `pg` for numeric precision;
      // parse them so Excel gets real numbers (right-aligned, formattable)
      // instead of text-that-looks-like-a-number.
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? Number(n.toFixed(3)) : v;
      }
      return v;
    });
    sheet.addRow(values);
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export const exportRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ExportService(app.db, new SensorsRepo(app.db), new CansatRepo(app.db));
  const sourceParam = z.object({ source: ExportSourceSchema });

  app.get(
    "/v1/export/:source/meta",
    { schema: { params: sourceParam, response: { 200: ExportMetaSchema } } },
    async (request) => service.meta(request.params.source),
  );

  app.get(
    "/v1/export/:source",
    { schema: { params: sourceParam, querystring: ExportQuerySchema } },
    async (request, reply) => {
      const { source } = request.params;
      const query = request.query;
      const rows = service.stream(source, query);

      const contentType = {
        csv: "text/csv; charset=utf-8",
        ndjson: "application/x-ndjson; charset=utf-8",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }[query.format];
      const filename = `${source}-export.${query.format}`;

      reply
        .header("content-type", contentType)
        .header("content-disposition", `attachment; filename="${filename}"`)
        // readings can span years — never let a slow client stall a huge query connection
        .header("cache-control", "no-store");

      if (query.format === "xlsx") {
        return reply.send(xlsxStream(source, rows, query.lang));
      }
      const generator = query.format === "csv" ? renderCsv(source, rows) : renderNdjson(rows);
      return reply.send(Readable.from(generator));
    },
  );

  /**
   * Calendar-months export. One month → a flat CSV/XLSX (nothing to zip
   * around). Multiple months → a ZIP with one file per month plus a
   * `summary.csv` of per-month aggregates. Automatic packaging: the user
   * doesn't have to answer a "one file or many?" question — a multi-
   * month pick is inherently "give me a folder of monthly files".
   */
  app.get(
    "/v1/export/:source/by-months",
    { schema: { params: sourceParam, querystring: ExportByMonthsQuerySchema } },
    async (request, reply) => {
      const { source } = request.params;
      const { months, format, lang } = request.query;

      const buildRows = (month: string) => {
        const { from, to } = monthRange(month);
        return service.stream(source, {
          from: from.toISOString(),
          to: to.toISOString(),
          format: "csv",
          gapThresholdMinutes: 15,
          lang,
        } as Parameters<typeof service.stream>[1]);
      };

      // Single month → serve directly, no zip envelope.
      if (months.length === 1) {
        const month = months[0]!;
        const filename = `${source}-${month}.${format}`;
        const contentType =
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        reply
          .header("content-type", contentType)
          .header("content-disposition", `attachment; filename="${filename}"`)
          .header("cache-control", "no-store");
        const rows = buildRows(month);
        return reply.send(
          format === "xlsx"
            ? xlsxStream(source, rows, lang)
            : Readable.from(renderCsv(source, rows)),
        );
      }

      // Multiple months → ZIP with per-month files + summary.csv. Each
      // per-month payload is buffered in memory before being added to the
      // archive so entry ordering stays deterministic — archiver.append
      // with a live Readable can interleave with the next append(). The
      // typical peak is one month's CSV (~5MB), not the whole archive.
      const firstMonth = months[0]!;
      const lastMonth = months[months.length - 1]!;
      const zipName = `${source}-${firstMonth}_${lastMonth}.zip`;
      reply
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="${zipName}"`)
        .header("cache-control", "no-store");

      const archive = new ZipArchive({ zlib: { level: 6 } }) as unknown as ArchiverInstance;
      // Fastify's compress plugin is scoped to specific routes, and this
      // one isn't among them — so no double-encoding to worry about.
      reply.raw.on("close", () => archive.destroy());

      (async () => {
        try {
          for (const month of months) {
            const rows = buildRows(month);
            const perMonth =
              format === "xlsx"
                ? await streamToBuffer(xlsxStream(source, rows, lang))
                : await streamToBuffer(Readable.from(renderCsv(source, rows)));
            archive.append(perMonth, { name: `${source}-${month}.${format}` });
          }

          const summary = await generateSummaryXlsx(app.db as unknown as ExecutableDb, source, months, lang);
          archive.append(summary, { name: "summary.xlsx" });

          await archive.finalize();
        } catch (err) {
          request.log.error({ err }, "by-months export failed");
          archive.destroy();
        }
      })();

      return reply.send(archive);
    },
  );
};
