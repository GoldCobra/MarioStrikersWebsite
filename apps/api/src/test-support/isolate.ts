// Preloaded into every test process (node --import): tests supply fake values explicitly, never read a
// local .env or real cache snapshots, and cannot reach outside services.

import { blockExternalConnections, clearServiceEnvironment } from "../lib/local-isolation.ts";

clearServiceEnvironment();
process.env.NODE_ENV = "test";
delete process.env.MSC_DEV_FIXTURES;
process.env.PUBLIC_DATA_CACHE_SNAPSHOT_PATH = "";
blockExternalConnections({ allowLoopback: true });
