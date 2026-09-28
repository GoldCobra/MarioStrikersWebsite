// The MSC save editor: SAVE mode (Strikers2) and FRIENDLIST mode (Online), in this order.

import { initMscOnlineEditor } from "../features/save-editors/msc/online-editor.ts";
import { initMscSaveEditor } from "../features/save-editors/msc/save-editor.ts";

initMscSaveEditor();
initMscOnlineEditor();
