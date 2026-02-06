"use client";

import { useEffect, useState } from "react";

import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import ThemeToggle from "@/components/layout/theme-toggle";
import { isEmptyResponse } from "@/lib/data";
import { useApi } from "@/lib/hooks/use-api";
import { useSettings } from "@/lib/hooks/use-settings";
import {
  DEFAULT_CURRENCY_LABEL,
  DEFAULT_PRICING,
  type PricingConfig,
  type PricingSettings
} from "@/lib/pricing";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_TIMEZONE, formatTimestamp } from "@/lib/timezone";

const densityOptions = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" }
];

type DbInfo = {
  active_path: string;
  default_path: string;
  exists: boolean;
  row_counts?: {
    events: number;
    tool_calls: number;
    turns: number;
    sessions: number;
  } | null;
  last_ingested_at?: string | null;
  error?: string | null;
};

type TimezoneSettings = {
  timezone: string;
};

type PrivacySettings = {
  capture_payloads: boolean;
};

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const dbInfo = useApi<DbInfo>("/api/settings/db_info", { ttl: 60_000 });
  const pricingSettings = useApi<PricingSettings>("/api/settings/pricing", {
    ttl: 60_000
  });
  const timezoneSettings = useApi<TimezoneSettings>("/api/settings/timezone", {
    ttl: 60_000
  });
  const privacySettings = useApi<PrivacySettings>("/api/settings/privacy", {
    ttl: 60_000
  });

  const [dbInput, setDbInput] = useState(settings.dbPath);
  const [testInfo, setTestInfo] = useState<DbInfo | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [pricingDraft, setPricingDraft] = useState<PricingConfig>(DEFAULT_PRICING);
  const [currencyLabel, setCurrencyLabel] = useState(DEFAULT_CURRENCY_LABEL);
  const [isSavingPricing, setIsSavingPricing] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState(settings.timezone);
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [capturePayloadsDraft, setCapturePayloadsDraft] = useState(false);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  useEffect(() => {
    setDbInput(settings.dbPath);
  }, [settings.dbPath]);

  useEffect(() => {
    if (!timezoneSettings.data?.timezone) return;
    if (timezoneSettings.data.timezone !== settings.timezone) {
      updateSettings({ timezone: timezoneSettings.data.timezone });
    }
  }, [timezoneSettings.data, settings.timezone, updateSettings]);

  useEffect(() => {
    setTimezoneDraft(settings.timezone);
  }, [settings.timezone]);

  useEffect(() => {
    if (!pricingSettings.data) return;
    setPricingDraft(pricingSettings.data.pricing);
    setCurrencyLabel(pricingSettings.data.currency_label);
  }, [pricingSettings.data]);

  useEffect(() => {
    if (!privacySettings.data) return;
    setCapturePayloadsDraft(Boolean(privacySettings.data.capture_payloads));
  }, [privacySettings.data]);

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const params = new URLSearchParams();
      if (dbInput.trim()) params.set("db", dbInput.trim());
      const res = await fetch(`/api/settings/db_info?${params.toString()}`);
      const payload = (await res.json()) as DbInfo;
      setTestInfo(payload);
    } catch {
      setTestInfo({
        active_path: dbInput,
        default_path: "",
        exists: false,
        error: "Failed to test database"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const buildPricingUrl = () => {
    const params = new URLSearchParams();
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    const query = params.toString();
    return query ? `/api/settings/pricing?${query}` : "/api/settings/pricing";
  };

  const buildTimezoneUrl = () => {
    const params = new URLSearchParams();
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    const query = params.toString();
    return query ? `/api/settings/timezone?${query}` : "/api/settings/timezone";
  };

  const buildPrivacyUrl = () => {
    const params = new URLSearchParams();
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    const query = params.toString();
    return query ? `/api/settings/privacy?${query}` : "/api/settings/privacy";
  };

  const updateRate = (
    model: string,
    field: "input_rate" | "cached_input_rate" | "output_rate",
    value: string
  ) => {
    const nextValue = value.trim() === "" ? 0 : Number(value);
    if (!Number.isFinite(nextValue)) return;
    setPricingDraft((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [model]: {
          ...prev.models[model],
          [field]: nextValue
        }
      }
    }));
  };

  const handleSavePricing = async (
    next?: { currency_label: string; pricing: PricingConfig }
  ) => {
    setIsSavingPricing(true);
    setPricingError(null);
    const payload = next ?? {
      currency_label: currencyLabel,
      pricing: pricingDraft
    };
    try {
      const res = await fetch(buildPricingUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save pricing settings");
      }
      const saved = (await res.json()) as PricingSettings;
      setPricingDraft(saved.pricing);
      setCurrencyLabel(saved.currency_label);
      pricingSettings.refetch();
    } catch (error) {
      setPricingError(
        error instanceof Error ? error.message : "Failed to save pricing settings"
      );
    } finally {
      setIsSavingPricing(false);
    }
  };

  const handleResetPricing = async () => {
    await handleSavePricing({
      currency_label: DEFAULT_CURRENCY_LABEL,
      pricing: DEFAULT_PRICING
    });
  };

  const handleSaveTimezone = async () => {
    setIsSavingTimezone(true);
    setTimezoneError(null);
    try {
      const res = await fetch(buildTimezoneUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: timezoneDraft })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save timezone settings");
      }
      const saved = (await res.json()) as TimezoneSettings;
      updateSettings({ timezone: saved.timezone });
      timezoneSettings.refetch();
    } catch (error) {
      setTimezoneError(
        error instanceof Error ? error.message : "Failed to save timezone settings"
      );
    } finally {
      setIsSavingTimezone(false);
    }
  };

  const handleUseBrowserTimezone = () => {
    const browserTz =
      Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    setTimezoneDraft(browserTz);
  };

  const handleSavePrivacy = async () => {
    setIsSavingPrivacy(true);
    setPrivacyError(null);
    try {
      const res = await fetch(buildPrivacyUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture_payloads: capturePayloadsDraft })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save privacy settings");
      }
      await res.json();
      privacySettings.refetch();
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Failed to save privacy settings"
      );
    } finally {
      setIsSavingPrivacy(false);
    }
  };

  const activeInfo = testInfo ?? dbInfo.data ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel title="Data source" subtitle="SQLite connection" testId="settings-data-source">
        {dbInfo.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : dbInfo.error ? (
          <ErrorState onRetry={dbInfo.refetch} />
        ) : isEmptyResponse(dbInfo.data) ? (
          <EmptyState description="No metadata available." />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">DB path</label>
              <Input
                value={dbInput}
                onChange={(event) => setDbInput(event.target.value)}
                placeholder={dbInfo.data?.default_path ?? ""}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleTest} disabled={isTesting}>
                {isTesting ? "Testing" : "Test connection"}
              </Button>
              <Button
                size="sm"
                onClick={() => updateSettings({ dbPath: dbInput.trim() })}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={resetSettings}>
                Reset
              </Button>
            </div>
            {activeInfo ? (
              <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                <div className="flex flex-col gap-1">
                  <span>
                    Active path: <span className="text-foreground">{activeInfo.active_path}</span>
                  </span>
                  <span>
                    Default path: <span className="text-foreground">{activeInfo.default_path}</span>
                  </span>
                  <span>
                    Exists: <span className="text-foreground">{activeInfo.exists ? "Yes" : "No"}</span>
                  </span>
                  {activeInfo.last_ingested_at ? (
                    <span>
                      Last ingested:{" "}
                      <span className="text-foreground">
                        {formatTimestamp(activeInfo.last_ingested_at, settings.timezone)}
                      </span>
                    </span>
                  ) : null}
                </div>
                {activeInfo.row_counts ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      Events: <span className="text-foreground">{activeInfo.row_counts.events}</span>
                    </div>
                    <div>
                      Tool calls: <span className="text-foreground">{activeInfo.row_counts.tool_calls}</span>
                    </div>
                    <div>
                      Turns: <span className="text-foreground">{activeInfo.row_counts.turns}</span>
                    </div>
                    <div>
                      Sessions: <span className="text-foreground">{activeInfo.row_counts.sessions}</span>
                    </div>
                  </div>
                ) : null}
                {activeInfo.error ? (
                  <div className="mt-3 text-rose-400">{activeInfo.error}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardPanel>

      <CardPanel title="Timezone" subtitle="Reporting and charts" testId="settings-timezone">
        {timezoneSettings.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : timezoneSettings.error ? (
          <ErrorState onRetry={timezoneSettings.refetch} />
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">IANA timezone</label>
              <Input
                value={timezoneDraft}
                onChange={(event) => setTimezoneDraft(event.target.value)}
                placeholder={DEFAULT_TIMEZONE}
              />
              <p className="text-xs text-muted-foreground">
                Example: <span className="text-foreground">America/Los_Angeles</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveTimezone}
                disabled={isSavingTimezone}
              >
                {isSavingTimezone ? "Saving" : "Save timezone"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTimezoneDraft(DEFAULT_TIMEZONE)}
                disabled={isSavingTimezone}
              >
                Reset default
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleUseBrowserTimezone}
                disabled={isSavingTimezone}
              >
                Use browser timezone
              </Button>
            </div>
            {timezoneError ? (
              <div className="text-xs text-rose-400">{timezoneError}</div>
            ) : null}
          </div>
        )}
      </CardPanel>

      <CardPanel title="Privacy" subtitle="Payload capture" testId="settings-privacy">
        {privacySettings.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : privacySettings.error ? (
          <ErrorState onRetry={privacySettings.refetch} />
        ) : (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={capturePayloadsDraft}
                onChange={(event) => setCapturePayloadsDraft(event.target.checked)}
                disabled={isSavingPrivacy}
              />
              <span className="leading-5">
                Store full message text and tool call payloads in the DB
                <span className="block text-muted-foreground/80">
                  When disabled (default), the DB will not store messages, and tool call input/output
                  payloads are redacted. Existing payloads remain until you run{" "}
                  <span className="font-mono text-foreground">codex-track purge-payloads</span>{" "}
                  (then optionally{" "}
                  <span className="font-mono text-foreground">codex-track vacuum</span>).
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSavePrivacy} disabled={isSavingPrivacy}>
                {isSavingPrivacy ? "Saving" : "Save privacy"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCapturePayloadsDraft(false)}
                disabled={isSavingPrivacy}
              >
                Reset default
              </Button>
            </div>
            {privacyError ? (
              <div className="text-xs text-rose-400">{privacyError}</div>
            ) : null}
          </div>
        )}
      </CardPanel>

      <CardPanel title="Cost model" subtitle="Pricing per model" testId="settings-cost-model">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.showCost}
              onChange={(event) => updateSettings({ showCost: event.target.checked })}
            />
            Show cost estimates in dashboards
          </label>
          {pricingSettings.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : pricingSettings.error ? (
            <ErrorState onRetry={pricingSettings.refetch} />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Currency label</label>
                  <Input
                    value={currencyLabel}
                    onChange={(event) => setCurrencyLabel(event.target.value)}
                    placeholder={DEFAULT_CURRENCY_LABEL}
                  />
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/20">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Model</th>
                      <th className="px-3 py-2 text-right font-medium">Input / 1M</th>
                      <th className="px-3 py-2 text-right font-medium">Cached / 1M</th>
                      <th className="px-3 py-2 text-right font-medium">Output / 1M</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {Object.entries(pricingDraft.models).map(([model, rates]) => (
                      <tr key={model}>
                        <td className="px-3 py-2 text-foreground">{model}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          <Input
                            type="number"
                            step="0.001"
                            className="h-8 text-right text-xs"
                            value={rates.input_rate}
                            onChange={(event) =>
                              updateRate(model, "input_rate", event.target.value)
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          <Input
                            type="number"
                            step="0.001"
                            className="h-8 text-right text-xs"
                            value={rates.cached_input_rate}
                            onChange={(event) =>
                              updateRate(model, "cached_input_rate", event.target.value)
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          <Input
                            type="number"
                            step="0.001"
                            className="h-8 text-right text-xs"
                            value={rates.output_rate}
                            onChange={(event) =>
                              updateRate(model, "output_rate", event.target.value)
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSavePricing()}
                  disabled={isSavingPricing}
                >
                  {isSavingPricing ? "Saving" : "Save pricing"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetPricing}
                  disabled={isSavingPricing}
                >
                  Reset pricing
                </Button>
                <div className="text-xs text-muted-foreground">
                  Preview: {formatCurrency(1, false, currencyLabel)} / 1M
                </div>
              </div>
              {pricingError ? (
                <div className="text-xs text-rose-400">{pricingError}</div>
              ) : null}
            </div>
          )}
        </div>
      </CardPanel>

      <CardPanel
        title="Appearance"
        subtitle="Theme + density"
        className="lg:col-span-2"
        testId="settings-appearance"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Density</span>
            <SegmentedControl
              options={densityOptions}
              value={settings.density}
              onChange={(value) => updateSettings({ density: value as "comfortable" | "compact" })}
            />
          </div>
        </div>
      </CardPanel>
    </div>
  );
}
