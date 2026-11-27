// npm run ops:recharged-key -- --environment=<test|live> --out=<file>: a new key of the Recharged API
// (docs/adr/0016). The key goes only into <file>, which must not exist yet; it is never printed. The output is the
// key's RECHARGED_API_KEYS entry (its SHA-256) for backend/.env. The key belongs on the Recharged WFC server only,
// never into the game client. No database is involved.

import fs from "node:fs";
import path from "node:path";
import { generateApiKey } from "../modules/recharged/keys.ts";

const args = process.argv.slice(2);
const option = (name: string): string => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

const environment = option("environment");
const out = option("out");
if ((environment !== "test" && environment !== "live") || !out) {
  console.error("[ops:recharged-key] usage: npm run ops:recharged-key -- --environment=<test|live> --out=<file>");
  process.exit(1);
}

const file = path.resolve(out);
const { key, entry } = generateApiKey(environment);
try {
  // "wx": never overwrites a file, so an earlier key is never lost by mistake.
  fs.writeFileSync(file, `${key}\n`, { flag: "wx", mode: 0o600 });
} catch (error) {
  console.error(
    `[ops:recharged-key] ${file} was not written: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
console.log(JSON.stringify({ environment, key_file: file, recharged_api_keys_entry: entry }, null, 2));
