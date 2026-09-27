// Orchestrates the comparison checks. Usage (from tests/e2e):
//   node run.ts visual [--self-check] [-- <playwright args>]   screenshots: reference commit vs working tree
//   node run.ts dom [--update]                                  committed DOM/head goldens vs working tree
//   node run.ts contract [--self-check]                         API responses: reference commit vs working tree
//   node run.ts routes [--update]                               status/Location probes vs golden (ROUTES_URL)
// The reference commit is read from visual-reference.sha; "self" compares the working tree with itself.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FIXTURE_NOW } from "./lib/site.ts";

interface StackConfig {
  install: string[][];
  installedMarker: string;
  start: string[];
  env?: Record<string, string>;
}

interface RunningStack {
  url: string;
  process: ChildProcess;
}

const E2E_DIR = dirname(import.meta.filename);
const REPO_ROOT = resolve(E2E_DIR, "../..");
const CACHE_DIR = join(E2E_DIR, ".cache");
// Resolved like a normal import, so it works with a local or a hoisted workspace install.
const PLAYWRIGHT_CLI = resolvePlaywrightCli();
const IS_WINDOWS = process.platform === "win32";
const REFERENCE_PORT = 8791;
const CANDIDATE_PORT = 8792;

function resolvePlaywrightCli(): string {
  try {
    return join(dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json")), "cli.js");
  } catch {
    return "";
  }
}

function fail(message: string): never {
  console.error("[e2e] " + message);
  process.exit(1);
}

function runSync(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): string {
  const result = spawnSync(command, args, { ...options, encoding: "utf8", shell: IS_WINDOWS && command === "npm" });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function readStackConfig(root: string): StackConfig {
  const file = join(root, "tests", "e2e", "stack.json");
  if (!existsSync(file)) fail(`No stack description at ${file}.`);
  return JSON.parse(readFileSync(file, "utf8")) as StackConfig;
}

function installStack(root: string, config: StackConfig): void {
  if (existsSync(join(root, config.installedMarker))) return;
  for (const [command, ...args] of config.install) {
    if (!command) continue;
    console.log(`[e2e] ${command} ${args.join(" ")} (${root})`);
    runSync(command, args, { cwd: root });
  }
}

function readReferenceSha(): string {
  const value = readFileSync(join(E2E_DIR, "visual-reference.sha"), "utf8").trim();
  if (value !== "self" && !/^[0-9a-f]{40}$/.test(value)) fail("visual-reference.sha must hold a full commit SHA or 'self'.");
  return value;
}

// Exports the reference commit into the cache without touching the working tree or its index.
function prepareReferenceTree(sha: string): string {
  const dir = join(CACHE_DIR, "reference", sha);
  const readyMarker = join(dir, ".e2e-ready");
  if (existsSync(readyMarker)) return dir;
  const hasCommit = spawnSync("git", ["cat-file", "-e", sha + "^{commit}"], { cwd: REPO_ROOT }).status === 0;
  if (!hasCommit) runSync("git", ["fetch", "--depth=1", "origin", sha], { cwd: REPO_ROOT });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const indexFile = join(CACHE_DIR, "reference-" + sha + ".index");
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  runSync("git", ["read-tree", sha], { cwd: REPO_ROOT, env });
  runSync("git", ["--work-tree=" + dir, "checkout-index", "--all", "--force"], { cwd: REPO_ROOT, env });
  rmSync(indexFile, { force: true });
  installStack(dir, readStackConfig(dir));
  writeFileSync(readyMarker, sha + "\n");
  return dir;
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`Stack at ${url} exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url + "/api/health");
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  fail(`Stack at ${url} did not become healthy within 60 s.`);
}

async function startStack(root: string, port: number, label: string): Promise<RunningStack> {
  const config = readStackConfig(root);
  installStack(root, config);
  const [command, ...args] = config.start;
  if (!command) fail(`Empty start command in ${root}.`);
  const env = { ...process.env, ...config.env, PORT: String(port), MSC_FIXTURE_NOW: FIXTURE_NOW };
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: IS_WINDOWS && command === "npm" });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk}`));
  const url = "http://127.0.0.1:" + port;
  await waitForHealth(url, child);
  console.log(`[e2e] ${label} stack ready at ${url} (${root})`);
  return { url, process: child };
}

function stopStack(stack: RunningStack | undefined): void {
  if (stack && stack.process.exitCode === null) stack.process.kill();
}

function runPlaywright(args: string[], env: Record<string, string>): number {
  if (!PLAYWRIGHT_CLI || !existsSync(PLAYWRIGHT_CLI)) fail("Install dependencies first (npm ci).");
  const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", ...args], {
    cwd: E2E_DIR, stdio: "inherit", env: { ...process.env, ...env }
  });
  return result.status ?? 1;
}

async function withStacks(
  needReference: boolean,
  selfCheck: boolean,
  body: (urls: { reference?: string; candidate: string }) => number
): Promise<number> {
  let reference: RunningStack | undefined;
  let candidate: RunningStack | undefined;
  const stopAll = (): void => { stopStack(reference); stopStack(candidate); };
  process.once("SIGINT", () => { stopAll(); process.exit(130); });
  try {
    candidate = await startStack(REPO_ROOT, CANDIDATE_PORT, "candidate");
    if (needReference) {
      const sha = selfCheck ? "self" : readReferenceSha();
      const root = sha === "self" ? REPO_ROOT : prepareReferenceTree(sha);
      reference = await startStack(root, REFERENCE_PORT, "reference");
    }
    return body({ reference: reference?.url, candidate: candidate.url });
  } finally {
    stopAll();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const separator = rest.indexOf("--");
  const flags = separator === -1 ? rest : rest.slice(0, separator);
  const passThrough = separator === -1 ? [] : rest.slice(separator + 1);
  const update = flags.includes("--update");
  const selfCheck = flags.includes("--self-check");
  let status: number;

  switch (command) {
    case "visual": {
      status = await withStacks(true, selfCheck, ({ reference, candidate }) => {
        const snapshots = join(CACHE_DIR, "visual");
        rmSync(snapshots, { recursive: true, force: true });
        const env = { REF_URL: reference ?? "", CAND_URL: candidate };
        const captured = runPlaywright(["--project=reference", "--update-snapshots=all", ...passThrough], env);
        if (captured !== 0) return captured;
        return runPlaywright(["--project=candidate", ...passThrough], env);
      });
      break;
    }
    case "dom": {
      status = await withStacks(false, false, ({ candidate }) =>
        runPlaywright(["--project=golden", ...(update ? ["--update-snapshots=all"] : []), ...passThrough], { CAND_URL: candidate }));
      break;
    }
    case "contract": {
      status = await withStacks(true, selfCheck, ({ reference, candidate }) =>
        runPlaywright(["--project=contract", ...passThrough], { REF_URL: reference ?? "", CAND_URL: candidate }));
      break;
    }
    case "routes": {
      const routesUrl = process.env.ROUTES_URL || "http://127.0.0.1:8080";
      status = runPlaywright(["--project=routes", ...(update ? ["--update-snapshots=all"] : []), ...passThrough], { ROUTES_URL: routesUrl });
      break;
    }
    default:
      fail("Usage: node run.ts <visual|dom|contract|routes> [--update] [--self-check] [-- <playwright args>]");
  }
  process.exit(status);
}

await main();
