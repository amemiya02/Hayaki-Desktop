// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Help > Guide: the Anki manual, which also describes Hayaki's engine and scheduling. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import * as core from "@/lib/anki/generated/core";
import { HelpPageLinkRequest_HelpPage } from "@/lib/anki/proto/anki/links_pb";

export async function openManual(): Promise<void> {
  try {
    const link = await core.helpPageLink({ page: HelpPageLinkRequest_HelpPage.INDEX });
    await openUrl(link.val);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
