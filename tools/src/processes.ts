// Child-process helpers for the local launchers: prefixed output, health waits and clean shutdown.

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";

export const REPO_ROOT = join(dirname(import.meta.filename), "..", "..");

export function startProcess(
  label: string,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd = REPO_ROOT,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // npm and npx are .cmd shims on Windows.
    shell: process.platform === "win32" && (command === "npm" || command === "npx"),
  });
  const prefix = (chunk: Buffer): string =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => `[${label}] ${line}\n`)
      .join("");
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(prefix(chunk)));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(prefix(chunk)));
  return child;
}

export async function waitForHttp(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${url}: process exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

export function stopOnExit(children: readonly ChildProcess[], onStop?: () => void): void {
  const stop = (): void => {
    onStop?.();
    for (const child of children) if (child.exitCode === null) child.kill();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  for (const child of children) {
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`A child process exited with code ${code}; stopping.`);
        stop();
      }
    });
  }
}

export function readPort(name: string, fallback: number): number {
  const value = process.env[name];
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid ${name}: ${value ?? ""}`);
  return port;
}
