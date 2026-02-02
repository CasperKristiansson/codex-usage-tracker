export type ExportRow = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeSeries = (series: Record<string, Array<{ bucket: string; value: number }>>) => {
  const buckets = new Set<string>();
  Object.values(series).forEach((points) => {
    points.forEach((point) => buckets.add(point.bucket));
  });

  const rows = Array.from(buckets).sort().map((bucket) => ({ bucket } as ExportRow));
  const rowMap = new Map(rows.map((row) => [row.bucket as string, row]));

  Object.entries(series).forEach(([name, points]) => {
    points.forEach((point) => {
      const row = rowMap.get(point.bucket);
      if (!row) return;
      row[name] = point.value;
    });
  });

  return rows;
};

export const normalizeExportRows = (data: unknown): ExportRow[] => {
  if (!data) return [];

  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    if (typeof data[0] === "object") return data as ExportRow[];
    return data.map((value) => ({ value }));
  }

  if (!isRecord(data)) return [{ value: data }];

  if (Array.isArray(data.rows)) {
    const rows = [...(data.rows as ExportRow[])];
    if (isRecord(data.other)) {
      rows.push(data.other as ExportRow);
    }
    return rows;
  }

  if (Array.isArray(data.histogram)) {
    return data.histogram as ExportRow[];
  }

  if (data.series && isRecord(data.series)) {
    return normalizeSeries(data.series as Record<string, Array<{ bucket: string; value: number }>>);
  }

  if (Array.isArray(data.matrix) && Array.isArray(data.models) && Array.isArray(data.directories)) {
    const rows: ExportRow[] = [];
    const models = data.models as string[];
    const directories = data.directories as string[];
    const matrix = data.matrix as number[][];
    models.forEach((model, rowIndex) => {
      directories.forEach((directory, colIndex) => {
        rows.push({
          model,
          directory,
          value: matrix[rowIndex]?.[colIndex] ?? 0
        });
      });
    });
    return rows;
  }

  return [data as ExportRow];
};

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
};

export const toCsv = (rows: ExportRow[]) => {
  if (!rows.length) return "";
  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row)))
  );
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns.map((key) => escapeCsv(row[key])).join(",")
  );
  return [header, ...lines].join("\n");
};

const downloadBlob = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const downloadJson = (rows: ExportRow[], filename: string) => {
  downloadBlob(JSON.stringify(rows, null, 2), filename, "application/json");
};

export const downloadCsv = (rows: ExportRow[], filename: string) => {
  downloadBlob(toCsv(rows), filename, "text/csv");
};

export const toFileBase = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || "panel";
