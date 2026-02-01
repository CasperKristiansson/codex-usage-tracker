export const isEmptyResponse = (data: unknown) => {
  if (!data) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows.length === 0;
    if (Array.isArray(record.series)) return record.series.length === 0;
    if (Array.isArray(record.matrix)) return record.matrix.length === 0;
    if (Array.isArray(record.histogram)) return record.histogram.length === 0;
    if (
      record.series &&
      typeof record.series === "object" &&
      !Array.isArray(record.series)
    ) {
      return Object.keys(record.series as Record<string, unknown>).length === 0;
    }
  }
  return false;
};
