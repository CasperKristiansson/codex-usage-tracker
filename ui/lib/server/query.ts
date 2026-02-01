import { MAX_BUCKETS } from "@/lib/server/constants";
import type { NormalizedFilters } from "@/lib/server/filters";

export type WhereClause = {
  sql: string;
  params: Array<string | number>;
};

type WhereOptions = {
  timeColumn?: string;
  modelColumn?: string;
  dirColumn?: string;
  sourceColumn?: string;
};

export const bucketExpression = (
  bucket: "hour" | "day",
  column = "captured_at_utc"
) => {
  if (bucket === "hour") {
    return `substr(${column}, 1, 13) || ':00:00Z'`;
  }
  return `substr(${column}, 1, 10) || 'T00:00:00Z'`;
};

export const buildWhere = (
  filters: NormalizedFilters,
  options: WhereOptions = {}
): WhereClause => {
  const timeColumn = options.timeColumn ?? "captured_at_utc";
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  clauses.push(`${timeColumn} >= ?`);
  params.push(filters.from);
  clauses.push(`${timeColumn} <= ?`);
  params.push(filters.to);

  if (options.modelColumn && filters.models.length) {
    clauses.push(
      `${options.modelColumn} IN (${filters.models
        .map(() => "?")
        .join(",")})`
    );
    params.push(...filters.models);
  }

  if (options.dirColumn && filters.dirs.length) {
    const dirClauses = filters.dirs.map(() => `${options.dirColumn} LIKE ?`);
    clauses.push(`(${dirClauses.join(" OR ")})`);
    params.push(...filters.dirs.map((dir) => `${dir}%`));
  }

  if (options.sourceColumn && filters.source.length) {
    clauses.push(
      `${options.sourceColumn} IN (${filters.source
        .map(() => "?")
        .join(",")})`
    );
    params.push(...filters.source);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
};

export const applyEventType = (where: WhereClause, eventType: string) => {
  const sql = where.sql
    ? `${where.sql} AND event_type = ?`
    : "WHERE event_type = ?";
  return {
    sql,
    params: [...where.params, eventType]
  };
};

export const clampBuckets = (rows: Array<Record<string, unknown>>) => {
  if (rows.length <= MAX_BUCKETS) return rows;
  return rows.slice(rows.length - MAX_BUCKETS);
};

export const limitBuckets = (
  rows: Array<Record<string, unknown>>,
  bucketKey = "bucket"
) => {
  const buckets = Array.from(
    new Set(rows.map((row) => row[bucketKey] as string))
  ).sort();
  if (buckets.length <= MAX_BUCKETS) return rows;
  const keep = new Set(buckets.slice(buckets.length - MAX_BUCKETS));
  return rows.filter((row) => keep.has(row[bucketKey] as string));
};

export const buildToolJoin = (filters: NormalizedFilters) => {
  const join =
    filters.models.length || filters.dirs.length
      ? "LEFT JOIN turns t ON t.session_id = tc.session_id AND t.turn_index = tc.turn_index"
      : "";
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  clauses.push(`tc.captured_at_utc >= ?`);
  params.push(filters.from);
  clauses.push(`tc.captured_at_utc <= ?`);
  params.push(filters.to);

  if (filters.models.length) {
    clauses.push(`t.model IN (${filters.models.map(() => "?").join(",")})`);
    params.push(...filters.models);
  }

  if (filters.dirs.length) {
    const dirClauses = filters.dirs.map(() => "t.cwd LIKE ?");
    clauses.push(`(${dirClauses.join(" OR ")})`);
    params.push(...filters.dirs.map((dir) => `${dir}%`));
  }

  if (filters.source.length) {
    clauses.push(`tc.source IN (${filters.source.map(() => "?").join(",")})`);
    params.push(...filters.source);
  }

  return {
    join,
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
};
