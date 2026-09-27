const { clearServiceEnvironment, blockExternalConnections } = require("../lib/local-isolation");
clearServiceEnvironment();
process.env.NODE_ENV = "test";
delete process.env.MSC_DEV_FIXTURES;
// Tests supply fake values explicitly. Ignore any local .env and real cache snapshots.
process.env.PUBLIC_DATA_CACHE_SNAPSHOT_PATH = "";
blockExternalConnections({ allowLoopback: true });
