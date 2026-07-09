import { existsSync, mkdirSync } from "node:fs";

const repoDir = ".repos/effect";
const repoUrl = "https://github.com/Effect-TS/effect-smol";

if (!existsSync(`${repoDir}/.git`)) {
  mkdirSync(".repos", { recursive: true });
  const clone = Bun.spawnSync(["git", "clone", repoUrl, repoDir], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(clone.exitCode ?? 1);
}
