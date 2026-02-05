import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");
const fixtureDir = path.resolve(__dirname, "fixtures");
const fixtureDb = path.join(fixtureDir, "usage.sqlite");
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

export default async function globalSetup() {
  ensureFixtureDb();
}
