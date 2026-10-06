// The hidden admin page (docs/adr/0011); built apart from the public site by integrations/private-pages.ts.

import { initAdminPage } from "../features/admin/admin-page.ts";

const root = document.getElementById("admin-root");
if (root) initAdminPage(root);
