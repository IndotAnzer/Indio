import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.env.NETEASE_API_ENHANCED_DIR ?? "/Users/indot/api-enhanced");
const targetRoot = path.join(repoRoot, "deploy", "api-enhanced-cloudrun", "source");

const excludedNames = new Set([
  ".DS_Store",
  ".env",
  ".git",
  ".github",
  ".husky",
  "examples",
  "module_example",
  "node_modules",
  "test",
]);

function shouldCopy(source) {
  const name = path.basename(source);
  if (excludedNames.has(name)) {
    return false;
  }
  return !name.endsWith(".test.js");
}

if (!fs.existsSync(path.join(sourceRoot, "package.json"))) {
  console.error(`api-enhanced source not found: ${sourceRoot}`);
  console.error("Set NETEASE_API_ENHANCED_DIR=/path/to/api-enhanced if it is not in the default location.");
  process.exit(1);
}

fs.rmSync(targetRoot, { recursive: true, force: true });
fs.mkdirSync(targetRoot, { recursive: true });
fs.cpSync(sourceRoot, targetRoot, {
  recursive: true,
  filter: shouldCopy,
});

console.log(`Prepared api-enhanced source for Cloud Run: ${targetRoot}`);
