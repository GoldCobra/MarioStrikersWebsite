// An in-process API for route tests: the fixture data source with per-test overrides, answered through
// app.inject without opening a port.

import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { loadConfig, type Config } from "../config.ts";
import type { DataSource } from "../data-source.ts";
import { createFixtureDataSource } from "../fixtures/data-source.ts";

export const TEST_NOW = "2026-09-13T12:00:00.000Z";

export interface TestAppOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** Replacements for fixture members; a function receives the test config. */
  readonly data?: Partial<DataSource> | ((config: Config) => Partial<DataSource>);
}

export async function createTestApp({ env = {}, data = {} }: TestAppOptions = {}): Promise<{
  app: FastifyInstance;
  config: Config;
  data: DataSource;
}> {
  const config = loadConfig({ NODE_ENV: "test", ...env }, { isolated: true });
  const overrides = typeof data === "function" ? data(config) : data;
  const source: DataSource = { ...createFixtureDataSource({ fixedNow: TEST_NOW }), ...overrides };
  const app = await buildApp({ config, data: source });
  await app.ready();
  return { app, config, data: source };
}

/** The name=value part of a Set-Cookie header, ready to send back as a Cookie header. */
export function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

/** Set-Cookie headers of an inject response as a list. */
export function setCookies(header: string | string[] | number | undefined): string[] {
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [String(header)];
}

/** The token with its last character flipped. */
export function tamper(token: string): string {
  return token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
}
