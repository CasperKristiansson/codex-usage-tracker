import path from "path";
import { test, expect, type APIResponse, type APIRequestContext } from "@playwright/test";

const RANGE_PARAMS = new URLSearchParams({
  from: "2000-01-01T00:00:00+00:00",
  to: "2100-01-01T00:00:00+00:00",
  bucket: "auto",
  topN: "10"
});

const RANGE_QUERY = `?${RANGE_PARAMS.toString()}`;

const parseJson = async (response: APIResponse) => {
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`Request failed: ${response.status()} ${text}`);
  }
  return text ? JSON.parse(text) : {};
};

const getJson = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path);
  return parseJson(response);
};

test("api overview endpoints return expected shapes", async ({ request }) => {
  const overviewPaths = [
    "/api/overview/volume_timeseries",
    "/api/overview/token_mix_timeseries",
    "/api/overview/cache_effectiveness_timeseries",
    "/api/overview/cost_timeseries",
    "/api/overview/context_pressure",
    "/api/overview/rate_limit_headroom",
    "/api/overview/model_share_timeseries",
    "/api/overview/tools_composition",
    "/api/overview/friction_events",
    "/api/overview/directory_top",
    "/api/overview/repo_top",
    "/api/overview/branch_top"
  ];

  for (const path of overviewPaths) {
    const payload = await getJson(request, `${path}${RANGE_QUERY}`);
    if (path.endsWith("context_pressure")) {
      expect(Array.isArray(payload.histogram)).toBeTruthy();
      expect(payload.histogram.length).toBeGreaterThan(0);
      continue;
    }
    if (path.endsWith("model_share_timeseries")) {
      expect(payload.series && typeof payload.series === "object").toBeTruthy();
      expect(Object.keys(payload.series).length).toBeGreaterThan(0);
      expect(Array.isArray(payload.summary?.rows)).toBeTruthy();
      expect(payload.summary.rows.length).toBeGreaterThan(0);
      continue;
    }
    if (path.endsWith("tools_composition")) {
      expect(Array.isArray(payload.rows)).toBeTruthy();
      expect(payload.rows.length).toBeGreaterThan(0);
      continue;
    }
    if (path.endsWith("directory_top") || path.endsWith("repo_top") || path.endsWith("branch_top")) {
      expect(Array.isArray(payload.rows)).toBeTruthy();
      expect(payload.rows.length).toBeGreaterThan(0);
      continue;
    }
    expect(Array.isArray(payload.rows)).toBeTruthy();
    expect(payload.rows.length).toBeGreaterThan(0);
  }

  const kpis = await getJson(request, `/api/overview/kpis${RANGE_QUERY}`);
  expect(kpis.total_tokens).toBeGreaterThan(0);
  expect(kpis.tool_calls).toBeGreaterThan(0);

  const compare = await getJson(request, `/api/overview/kpis_compare${RANGE_QUERY}`);
  expect(compare.current?.total_tokens).toBeGreaterThan(0);
  expect(compare.previous).not.toBeNull();

  const weeklyQuota = await getJson(request, "/api/overview/weekly_quota");
  expect(weeklyQuota.row).not.toBeNull();
});

test("api tools endpoints return expected shapes", async ({ request }) => {
  const typeCounts = await getJson(request, `/api/tools/type_counts${RANGE_QUERY}`);
  expect(Array.isArray(typeCounts.rows)).toBeTruthy();
  expect(typeCounts.rows.length).toBeGreaterThan(0);

  const toolType = typeCounts.rows[0]?.tool_type;
  expect(typeof toolType).toBe("string");

  const nameCounts = await getJson(
    request,
    `/api/tools/name_counts${RANGE_QUERY}&tool_type=${encodeURIComponent(toolType)}`
  );
  expect(Array.isArray(nameCounts.rows)).toBeTruthy();
  expect(nameCounts.rows.length).toBeGreaterThan(0);

  const trends = await getJson(request, `/api/tools/trend_top_tools${RANGE_QUERY}`);
  expect(Array.isArray(trends.rows)).toBeTruthy();
  expect(trends.rows.length).toBeGreaterThan(0);

  const latency = await getJson(request, `/api/tools/latency_by_tool${RANGE_QUERY}`);
  expect(Array.isArray(latency.rows)).toBeTruthy();
  expect(latency.rows.length).toBeGreaterThan(0);

  const errors = await getJson(request, `/api/tools/error_rates${RANGE_QUERY}`);
  expect(Array.isArray(errors.rows)).toBeTruthy();
  expect(errors.rows.length).toBeGreaterThan(0);
});

test("api sessions endpoints return expected shapes", async ({ request }) => {
  const list = await getJson(
    request,
    `/api/sessions/list${RANGE_QUERY}&page=1&pageSize=25`
  );
  expect(Array.isArray(list.rows)).toBeTruthy();
  expect(list.rows.length).toBeGreaterThan(0);
  expect(list.total).toBeGreaterThan(0);

  const sessionId = list.rows[0]?.session_id;
  expect(typeof sessionId).toBe("string");

  const detail = await getJson(
    request,
    `/api/sessions/detail?session_id=${encodeURIComponent(sessionId)}`
  );
  expect(detail.session?.session_id).toBe(sessionId);
  expect(Array.isArray(detail.top_models)).toBeTruthy();
  expect(detail.top_models.length).toBeGreaterThan(0);

  const annotations = await getJson(
    request,
    `/api/sessions/annotations?session_id=${encodeURIComponent(sessionId)}`
  );
  expect(annotations.session_id).toBe(sessionId);
  expect(Array.isArray(annotations.tags)).toBeTruthy();

  const tags = await getJson(request, "/api/sessions/tags");
  expect(Array.isArray(tags.tags)).toBeTruthy();
});

test("api hotspots endpoints return expected shapes", async ({ request }) => {
  const matrix = await getJson(request, `/api/hotspots/model_dir_matrix${RANGE_QUERY}`);
  expect(Array.isArray(matrix.models)).toBeTruthy();
  expect(Array.isArray(matrix.directories)).toBeTruthy();
  expect(Array.isArray(matrix.matrix)).toBeTruthy();
  expect(matrix.models.length).toBeGreaterThan(0);
  expect(matrix.directories.length).toBeGreaterThan(0);

  const distribution = await getJson(
    request,
    `/api/hotspots/tokens_per_turn_distribution${RANGE_QUERY}`
  );
  expect(Array.isArray(distribution.rows)).toBeTruthy();
  expect(distribution.rows.length).toBeGreaterThan(0);
  expect(typeof distribution.bin_size).toBe("number");

  const topSessions = await getJson(request, `/api/hotspots/top_sessions${RANGE_QUERY}`);
  expect(Array.isArray(topSessions.rows)).toBeTruthy();
  expect(topSessions.rows.length).toBeGreaterThan(0);
});

test("api sync start/progress returns a valid state", async ({ request }) => {
  const syncDb = path.resolve(__dirname, "fixtures", "sync.sqlite");
  const syncParams = new URLSearchParams(RANGE_PARAMS);
  syncParams.set("db", syncDb);

  const startResponse = await request.post(`/api/sync/start?${syncParams.toString()}`, {
    data: {}
  });
  const startPayload = await parseJson(startResponse);
  expect(typeof startPayload.sync_id).toBe("string");

  const progress = await getJson(
    request,
    `/api/sync/progress?sync_id=${encodeURIComponent(startPayload.sync_id)}`
  );
  expect(typeof progress.status).toBe("string");
  expect(["running", "completed", "failed", "unknown"]).toContain(progress.status);
});

test("api rollout backup returns archive for matching range", async ({ request }) => {
  const params = new URLSearchParams({
    from: "2025-01-01T00:00:00+00:00",
    to: "2025-01-02T00:00:00+00:00"
  });
  const response = await request.get(`/api/db/backup/rollouts?${params.toString()}`);
  expect(response.status()).toBe(200);
  const disposition = response.headers()["content-disposition"] ?? "";
  expect(disposition).toContain("attachment");
  expect(disposition).toContain(".tar.xz");
  const body = await response.body();
  expect(body.length).toBeGreaterThan(0);
});

test("api rollout backup validates timestamps", async ({ request }) => {
  const params = new URLSearchParams({
    from: "not-a-date",
    to: "2025-01-02T00:00:00+00:00"
  });
  const response = await request.get(`/api/db/backup/rollouts?${params.toString()}`);
  expect(response.status()).toBe(400);
  const payload = (await response.json()) as { error?: string };
  expect(typeof payload.error).toBe("string");
});

test("api rollout backup returns 404 for empty range", async ({ request }) => {
  const params = new URLSearchParams({
    from: "2035-01-01T00:00:00+00:00",
    to: "2035-01-02T00:00:00+00:00"
  });
  const response = await request.get(`/api/db/backup/rollouts?${params.toString()}`);
  expect(response.status()).toBe(404);
  const payload = (await response.json()) as { error?: string };
  expect(typeof payload.error).toBe("string");
});
