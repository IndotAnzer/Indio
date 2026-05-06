import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const homebrewBin = "/opt/homebrew/bin";
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/with-dev-node.mjs <command> [...args]");
  process.exit(2);
}

const env = { ...process.env };

if (existsSync(`${homebrewBin}/node`)) {
  env.PATH = `${homebrewBin}:${env.PATH ?? ""}`;
}

const child = spawn(command, args, {
  env,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
