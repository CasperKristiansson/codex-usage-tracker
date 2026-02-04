import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 50000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const toCsv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns.map((key) => escapeCsv(row[key])).join(",")
  );
  return [header, ...lines].join("\n");
};

const parseDataset = (value: string | null) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "events" || normalized === "turns" || normalized === "tool_calls") {
    return normalized;
  }
  return null;
};

const parseFormat = (value: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "csv" || normalized === "json") return normalized;
  return null;
};

const parseLimit = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPORT_LIMIT;
  return clamp(Math.floor(parsed), 1, MAX_EXPORT_LIMIT);
};

const buildFilename = (dataset: string, format: "csv" | "json") => {
  const stamp = new Date().toISOString().slice(0, 10);
  return `db-${dataset}-${stamp}.${format}`;
};

export const GET = (request: NextRequest) => {
  try {
    const params = request.nextUrl.searchParams;
    const dataset = parseDataset(params.get("dataset"));
    if (!dataset) {
      return errorResponse("Unknown dataset. Use events, turns, or tool_calls.", 400);
    }

    const format = parseFormat(params.get("format")) ?? "json";
    const limit = parseLimit(params.get("limit"));

    const filters = parseFilters(params);
    const db = getDb(params);

    let rows: Array<Record<string, unknown>> = [];

    if (dataset === "events") {
      const base = buildWhere(filters, {
        timeColumn: "captured_at",
        modelColumn: "model",
        dirColumn: "directory",
        sourceColumn: "source"
      });
      rows = db
        .prepare(
          `SELECT *
          FROM events
          ${base.sql}
          ORDER BY captured_at_utc DESC
          LIMIT ${limit}`
        )
        .all(base.params) as Array<Record<string, unknown>>;
    }

    if (dataset === "turns") {
      const base = buildWhere(filters, {
        timeColumn: "captured_at",
        modelColumn: "model",
        dirColumn: "cwd",
        sourceColumn: "source"
      });
      rows = db
        .prepare(
          `SELECT *
          FROM turns
          ${base.sql}
          ORDER BY captured_at_utc DESC
          LIMIT ${limit}`
        )
        .all(base.params) as Array<Record<string, unknown>>;
    }

    if (dataset === "tool_calls") {
      const tool = buildToolJoin(filters);
      const join = tool.join
        ? tool.join
        : "LEFT JOIN turns t ON t.session_id = tc.session_id AND t.turn_index = tc.turn_index";
      rows = db
        .prepare(
          `SELECT tc.*, t.model as turn_model, t.cwd as turn_cwd
          FROM tool_calls tc
          ${join}
          ${tool.where}
          ORDER BY tc.captured_at_utc DESC
          LIMIT ${limit}`
        )
        .all(tool.params) as Array<Record<string, unknown>>;
    }

    if (format === "json") {
      return jsonResponse({
        dataset,
        generated_at: new Date().toISOString(),
        filters,
        limit,
        row_count: rows.length,
        rows
      });
    }

    const csv = toCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildFilename(dataset, "csv")}"`
      }
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to export dataset",
      500
    );
  }
};
