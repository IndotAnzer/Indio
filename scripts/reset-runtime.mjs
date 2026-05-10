import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const shouldBackup = process.argv.includes("--backup");
const runtimePaths = [
  "indio/indio-v2.db",
  "indio/cache/tts",
  "apps/pwa/dist",
  "packages/contracts/dist",
  "apps/pwa/tsconfig.tsbuildinfo",
  "packages/contracts/tsconfig.tsbuildinfo"
];

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

async function copyIfPresent(source, target) {
  if (!existsSync(source)) {
    return false;
  }

  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
  return true;
}

async function resetPath(path) {
  const absolutePath = resolve(rootDir, path);

  if (!existsSync(absolutePath)) {
    return;
  }

  const info = await stat(absolutePath);
  if (info.isDirectory()) {
    await rm(absolutePath, { recursive: true, force: true });
    await mkdir(absolutePath, { recursive: true });
    return;
  }

  await rm(absolutePath, { force: true });
}

let backupDir = null;

if (shouldBackup) {
  backupDir = resolve(rootDir, ".indio-backups", `reset-${timestamp()}`, "runtime");
  await mkdir(backupDir, { recursive: true });

  for (const path of runtimePaths) {
    const source = resolve(rootDir, path);
    const target = resolve(backupDir, path);
    await copyIfPresent(source, target);
  }
}

for (const path of runtimePaths) {
  await resetPath(path);
}

await mkdir(resolve(rootDir, "indio/cache/tts"), { recursive: true });
await writeFile(resolve(rootDir, "indio/cache/tts/.gitkeep"), "", "utf8");

if (backupDir) {
  console.log(`Runtime artifacts backed up to ${backupDir}`);
}
console.log("Runtime artifacts reset.");
