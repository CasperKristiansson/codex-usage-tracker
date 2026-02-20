import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");
const fixtureDir = path.resolve(__dirname, "fixtures");
const fixtureDb = path.join(fixtureDir, "usage.sqlite");
const emptyDb = path.join(fixtureDir, "empty.sqlite");
const syncDb = path.join(fixtureDir, "sync.sqlite");
const fixtureRollouts = path.join(fixtureDir, "rollouts");
const generator = path.join(fixtureDir, "generate_fixture_db.py");

const ensureFixtureDb = () => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  if (!fs.existsSync(generator)) {
    throw new Error(`Fixture generator not found: ${generator}`);
  }

  const python = process.env.PYTHON ?? "python";
  const pythonPath = path.join(repoRoot, "src");
  const env = {
    ...process.env,
    PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`
  };

  execFileSync(python, [generator, fixtureDb], { env, stdio: "inherit" });
};

const ensureEmptyDb = () => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  if (fs.existsSync(emptyDb)) {
    fs.unlinkSync(emptyDb);
  }

  const python = process.env.PYTHON ?? "python";
  const pythonPath = path.join(repoRoot, "src");
  const env = {
    ...process.env,
    PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`
  };

  execFileSync(
    python,
    [
      "-c",
      [
        "from pathlib import Path",
        "import sys",
        "from codex_usage_tracker.store import UsageStore",
        "UsageStore(Path(sys.argv[1])).close()"
      ].join("; "),
      emptyDb
    ],
    { env, stdio: "inherit" }
  );
};

const ensureSyncDb = () => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  if (fs.existsSync(syncDb)) {
    fs.unlinkSync(syncDb);
  }

  const python = process.env.PYTHON ?? "python";
  const pythonPath = path.join(repoRoot, "src");
  const env = {
    ...process.env,
    PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`
  };

  execFileSync(
    python,
    [
      "-c",
      [
        "from pathlib import Path",
        "import sys",
        "from codex_usage_tracker.store import UsageStore",
        "UsageStore(Path(sys.argv[1])).close()"
      ].join("; "),
      syncDb
    ],
    { env, stdio: "inherit" }
  );
};

export default async function globalSetup() {
  ensureFixtureDb();
  ensureEmptyDb();
  ensureSyncDb();
  if (!fs.existsSync(fixtureRollouts)) {
    throw new Error(`Rollout fixtures not found: ${fixtureRollouts}`);
  }
}
