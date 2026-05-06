import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEnhancedDir = process.env.NETEASE_API_ENHANCED_DIR ?? "/Users/indot/api-enhanced";
const homebrewNode = "/opt/homebrew/bin/node";
const nodeCommand = existsSync(homebrewNode) ? homebrewNode : process.execPath;
const children = new Set();

function color(name, code) {
  return `\x1b[${code}m${name}\x1b[0m`;
}

const services = [
  {
    name: "ncm",
    port: 3000,
    cwd: apiEnhancedDir,
    command: "npm",
    args: ["start"],
    env: {
      NODE_TLS_REJECT_UNAUTHORIZED: "0"
    },
    color: 36,
    missingMessage: `找不到 api-enhanced 目录：${apiEnhancedDir}`
  },
  {
    name: "server",
    port: Number(process.env.INDIO_PORT ?? 8787),
    cwd: rootDir,
    command: "npm",
    args: ["run", "dev", "--workspace", "@indio/server"],
    color: 32
  },
  {
    name: "pwa",
    port: 5173,
    cwd: resolve(rootDir, "apps/pwa"),
    command: nodeCommand,
    args: [resolve(rootDir, "node_modules/vite/bin/vite.js"), "--host", "0.0.0.0", "--port", "5173"],
    color: 34
  }
];

function log(service, message) {
  process.stdout.write(`${color(`[${service.name}]`, service.color)} ${message}\n`);
}

function pipe(service, stream, target) {
  stream.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) {
        target.write(`${color(`[${service.name}]`, service.color)} ${line}\n`);
      }
    }
  });
}

function isPortOpen(port) {
  return new Promise((resolvePort) => {
    const server = createServer();

    server.once("error", () => {
      resolvePort(true);
    });

    server.once("listening", () => {
      server.close(() => {
        resolvePort(false);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

async function startService(service) {
  if (await isPortOpen(service.port)) {
    log(service, `端口 ${service.port} 已有服务在运行，直接复用。`);
    return;
  }

  if (service.missingMessage && !existsSync(service.cwd)) {
    throw new Error(service.missingMessage);
  }

  log(service, `启动中：${service.command} ${service.args.join(" ")}`);
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: {
      ...process.env,
      ...service.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.add(child);
  pipe(service, child.stdout, process.stdout);
  pipe(service, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (signal) {
      log(service, `已停止：${signal}`);
      return;
    }

    log(service, `已退出，code=${String(code)}`);
  });
}

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

for (const service of services) {
  await startService(service);
}

process.stdout.write("\nIndio 已启动：\n");
process.stdout.write("- PWA: http://localhost:5173\n");
process.stdout.write("- Server: http://localhost:8787\n");
process.stdout.write("- Netease API: http://localhost:3000\n\n");
process.stdout.write("按 Ctrl+C 可以停止由本脚本启动的服务。\n");

setInterval(() => {}, 60_000);
