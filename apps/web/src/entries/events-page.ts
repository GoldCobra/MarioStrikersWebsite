// The community tournaments page: the current events.

import { initEventsList } from "../features/events/events-list.ts";

const mount = document.getElementById("events-root");
if (mount) void initEventsList(mount);
