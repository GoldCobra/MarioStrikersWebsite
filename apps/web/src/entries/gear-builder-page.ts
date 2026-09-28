// The MSBL Gear Builder.

import { initGearBuilder } from "../features/gear-builder/gear-builder-host.ts";

const host = document.getElementById("msbl-gear-builder-host");
if (host) void initGearBuilder(host);
