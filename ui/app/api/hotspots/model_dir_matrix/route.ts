import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const selectTop = (
  db: ReturnType<typeof getDb>,
  sql: string,
  params: Array<string | number>,
  column: string,
  topN: number
) => {
  return db
    .prepare(
      `SELECT ${column} as label, SUM(total_tokens) as total
      FROM events
      ${sql}
      GROUP BY ${column}
      ORDER BY total DESC
      LIMIT ${topN}`
    )
    .all(params) as Array<{ label: string; total: number }>;
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const base = buildWhere(filters, {
      timeColumn: "captured_at",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const models = filters.models.length
      ? filters.models.slice(0, filters.topN).map((label) => ({ label, total: 0 }))
      : selectTop(db, eventsWhere.sql, eventsWhere.params, "model", filters.topN);
    const directories = filters.dirs.length
      ? filters.dirs.slice(0, filters.topN).map((label) => ({ label, total: 0 }))
      : selectTop(
          db,
          eventsWhere.sql,
          eventsWhere.params,
          "directory",
          filters.topN
        );

    const modelList = models.map((row) => row.label).filter(Boolean);
    const dirList = directories.map((row) => row.label).filter(Boolean);

    const modelCount = db
      .prepare(
        `SELECT COUNT(DISTINCT model) as total
        FROM events
        ${eventsWhere.sql}`
      )
      .get(eventsWhere.params) as { total: number } | undefined;
    const dirCount = db
      .prepare(
        `SELECT COUNT(DISTINCT directory) as total
        FROM events
        ${eventsWhere.sql}`
      )
      .get(eventsWhere.params) as { total: number } | undefined;
    const hasOtherModels = (modelCount?.total ?? 0) > modelList.length;
    const hasOtherDirs = (dirCount?.total ?? 0) > dirList.length;

    const modelsOut = hasOtherModels ? [...modelList, "Other"] : modelList;
    const dirsOut = hasOtherDirs ? [...dirList, "Other"] : dirList;

    if (!modelsOut.length || !dirsOut.length) {
      return jsonResponse({ models: modelsOut, directories: dirsOut, matrix: [] });
    }

    const rows = db
      .prepare(
        `SELECT model, directory, SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        AND model IN (${modelList.map(() => "?").join(",")})
        AND directory IN (${dirList.map(() => "?").join(",")})
        GROUP BY model, directory`
      )
      .all([...eventsWhere.params, ...modelList, ...dirList]) as Array<{
      model: string;
      directory: string;
      total_tokens: number;
    }>;

    const matrix = modelsOut.map((model) => {
      const row = dirsOut.map(() => 0);
      rows
        .filter((entry) => entry.model === model)
        .forEach((entry) => {
          const idx = dirsOut.indexOf(entry.directory);
          if (idx >= 0) row[idx] = entry.total_tokens;
        });
      return row;
    });

    if (hasOtherModels) {
      const otherModelRows = db
        .prepare(
          `SELECT directory, SUM(total_tokens) as total_tokens
          FROM events
          ${eventsWhere.sql}
          AND model NOT IN (${modelList.map(() => "?").join(",")})
          AND directory IN (${dirList.map(() => "?").join(",")})
          GROUP BY directory`
        )
        .all([...eventsWhere.params, ...modelList, ...dirList]) as Array<{
        directory: string;
        total_tokens: number;
      }>;
      const rowIndex = modelsOut.indexOf("Other");
      otherModelRows.forEach((entry) => {
        const idx = dirsOut.indexOf(entry.directory);
        if (rowIndex >= 0 && idx >= 0) {
          matrix[rowIndex][idx] = entry.total_tokens;
        }
      });
    }

    if (hasOtherDirs) {
      const otherDirRows = db
        .prepare(
          `SELECT model, SUM(total_tokens) as total_tokens
          FROM events
          ${eventsWhere.sql}
          AND directory NOT IN (${dirList.map(() => "?").join(",")})
          AND model IN (${modelList.map(() => "?").join(",")})
          GROUP BY model`
        )
        .all([...eventsWhere.params, ...dirList, ...modelList]) as Array<{
        model: string;
        total_tokens: number;
      }>;
      const colIndex = dirsOut.indexOf("Other");
      otherDirRows.forEach((entry) => {
        const idx = modelsOut.indexOf(entry.model);
        if (colIndex >= 0 && idx >= 0) {
          matrix[idx][colIndex] = entry.total_tokens;
        }
      });
    }

    if (hasOtherModels && hasOtherDirs) {
      const otherCell = db
        .prepare(
          `SELECT SUM(total_tokens) as total_tokens
          FROM events
          ${eventsWhere.sql}
          AND model NOT IN (${modelList.map(() => "?").join(",")})
          AND directory NOT IN (${dirList.map(() => "?").join(",")})`
        )
        .get([...eventsWhere.params, ...modelList, ...dirList]) as
        | { total_tokens: number | null }
        | undefined;
      const rowIndex = modelsOut.indexOf("Other");
      const colIndex = dirsOut.indexOf("Other");
      if (rowIndex >= 0 && colIndex >= 0) {
        matrix[rowIndex][colIndex] = otherCell?.total_tokens ?? 0;
      }
    }

    return jsonResponse({
      models: modelsOut,
      directories: dirsOut,
      matrix
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load model-dir matrix",
      500
    );
  }
};
