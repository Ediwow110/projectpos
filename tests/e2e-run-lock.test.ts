import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..");

describe("e2e run lock hygiene", () => {
  it("ignores the transient e2e run lock so a local run leaves a clean tree", () => {
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    const rules = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(rules).toContain(".e2e-run.lock");
  });

  it("makes git actually ignore the lock file", () => {
    let ignored = false;
    try {
      execFileSync("git", ["check-ignore", "-q", ".e2e-run.lock"], { cwd: repoRoot, stdio: "ignore" });
      ignored = true;
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(true);
  });

  it("proves the lock is a transient runner artifact, not a source file", () => {
    const runner = readFileSync(join(repoRoot, "scripts", "run-e2e.mjs"), "utf8");

    expect(runner).toContain('.e2e-run.lock');
    // The runner takes a real lock and releases it on every exit path.
    expect(runner).toMatch(/openSync\(lockPath, "wx"\)/);
    expect(runner).toMatch(/rmSync\(lockPath, \{ force: true \}\)/);
  });
});
