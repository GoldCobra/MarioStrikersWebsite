// Preloaded into the fixture API by dev-smoke.test.ts (node --import). Loading database code fails the
// process; with MSC_PROBE_ISOLATION=1 it also checks the isolation once dev.ts has set it up, then exits.

import { registerHooks } from "node:module";
import net from "node:net";

const DATABASE_CODE =
  /[\\/]node_modules[\\/]mssql[\\/]|[\\/]db[\\/]database\.ts$|[\\/]cache[\\/]public-data-cache\.ts$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (DATABASE_CODE.test(resolved.url)) throw new Error(`Fixture mode loaded database code: ${resolved.url}`);
    return resolved;
  },
});

function expectBlocked(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    if (String(error).includes("External connections")) return;
    throw error;
  }
  throw new Error("An outgoing connection was not blocked.");
}

if (process.env.MSC_PROBE_ISOLATION === "1") {
  // dev.ts sets MSC_DEV_FIXTURES in the same synchronous step that clears credentials and blocks connections.
  const timer = setInterval(() => {
    if (process.env.MSC_DEV_FIXTURES !== "1") return;
    clearInterval(timer);
    const leaked = ["MSSQL_HOST", "MSSQL_PASSWORD", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN", "BOT_TOKEN"].filter(
      (key) => process.env[key] !== undefined,
    );
    if (leaked.length > 0) throw new Error(`Credentials survived: ${leaked.join(", ")}`);
    expectBlocked(() => fetch("https://discord.com/api/v10/users/@me"));
    expectBlocked(() => net.connect(1433, "example.test"));
    console.log("[probe] isolation ok");
    process.exit(0);
  }, 1);
}
