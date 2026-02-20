import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";

import { NextRequest, NextResponse } from "next/server";

import { resolveRolloutsPath } from "@/lib/server/paths";
import { errorResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_MATCH_EXIT_CODE = 3;

const parseIso = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const resolveBackendRoot = () => {
  const override = process.env.CODEX_USAGE_BACKEND_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(process.cwd(), "..");
};

const resolvePythonPath = () => {
  const override = process.env.CODEX_USAGE_PYTHONPATH?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveBackendRoot(), "src");
};

const sanitizeFilenameStamp = (value: string) =>
  value.replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");

const parseError = (stderr: string, stdout: string, fallback: string) => {
  const stderrText = stderr.trim();
  if (stderrText) return stderrText;
  const stdoutText = stdout.trim();
  if (stdoutText) return stdoutText;
  return fallback;
};

export const GET = (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const fromIso = parseIso(params.get("from"));
  const toIso = parseIso(params.get("to"));

  if (!fromIso || !toIso) {
    return errorResponse("Missing or invalid 'from'/'to' ISO timestamps.", 400);
  }
  if (new Date(fromIso).getTime() > new Date(toIso).getTime()) {
    return errorResponse("'from' must be earlier than or equal to 'to'.", 400);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cut-rollout-backup-"));
  const archivePath = path.join(tempDir, "rollouts-backup.tar.xz");
  const rolloutsPath = resolveRolloutsPath();
  const backendRoot = resolveBackendRoot();
  const pythonPath = resolvePythonPath();

  const result = spawnSync(
    process.env.PYTHON ?? "python",
    [
      "-m",
      "codex_usage_tracker.rollout_backup",
      "--rollouts",
      rolloutsPath,
      "--from",
      fromIso,
      "--to",
      toIso,
      "--out",
      archivePath,
    ],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
      },
      encoding: "utf-8",
    }
  );

  if (result.error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return errorResponse(
      `Failed to run rollout backup exporter: ${result.error.message}`,
      500
    );
  }

  if (result.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const message = parseError(
      result.stderr ?? "",
      result.stdout ?? "",
      "Failed to create rollout backup."
    );
    if (result.status === NO_MATCH_EXIT_CODE) {
      return errorResponse(message, 404);
    }
    return errorResponse(message, 500);
  }

  if (!fs.existsSync(archivePath)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return errorResponse("Backup archive was not created.", 500);
  }

  const fromStamp = sanitizeFilenameStamp(fromIso);
  const toStamp = sanitizeFilenameStamp(toIso);
  const filename = `codex-rollouts-backup-${fromStamp}-to-${toStamp}.tar.xz`;
  const stat = fs.statSync(archivePath);
  const stream = fs.createReadStream(archivePath);

  const cleanup = () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  stream.once("close", cleanup);
  stream.once("error", cleanup);

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-xz",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
