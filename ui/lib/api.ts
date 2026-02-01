import type { Filters } from "@/lib/filters";

export const buildFilterQuery = (filters: Filters) => {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  params.set("bucket", filters.bucket);
  params.set("topN", String(filters.topN));

  if (filters.models.length) {
    params.set("models", filters.models.join(","));
  }
  if (filters.dirs.length) {
    params.set("dirs", filters.dirs.join(","));
  }
  if (filters.source.length) {
    params.set("source", filters.source.join(","));
  }

  return params.toString();
};
