// Preloaded into every test process (node --import): tests supply fake values explicitly, never read a
// local .env, and cannot reach outside services.

import { blockExternalConnections, clearServiceEnvironment } from "../lib/local-isolation.ts";

clearServiceEnvironment();
process.env.NODE_ENV = "test";
delete process.env.MSC_DEV_FIXTURES;
blockExternalConnections({ allowLoopback: true });
