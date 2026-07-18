import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const node = "C:/Users/NISAR/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe";
const next = resolve(root, "node_modules/next/dist/bin/next");
const out = openSync(resolve(root, "next-dev.out.log"), "a");
const err = openSync(resolve(root, "next-dev.err.log"), "a");

const child = spawn(node, [next, "dev", "-H", "127.0.0.1", "-p", "3000"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: true
});

child.unref();
console.log(`Started Next dev server with pid ${child.pid}`);
