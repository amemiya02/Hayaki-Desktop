// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The request and response message of every core method, read from the
 * services in the generated protobuf modules, so plugin calls can be parsed
 * from and written back to protobuf JSON.
 */
import type { DescMessage, DescService } from "@bufbuild/protobuf";

import * as ankidroid from "../anki/proto/anki/ankidroid_pb";
import * as ankihub from "../anki/proto/anki/ankihub_pb";
import * as ankiweb from "../anki/proto/anki/ankiweb_pb";
import * as card_rendering from "../anki/proto/anki/card_rendering_pb";
import * as cards from "../anki/proto/anki/cards_pb";
import * as collection from "../anki/proto/anki/collection_pb";
import * as config from "../anki/proto/anki/config_pb";
import * as deck_config from "../anki/proto/anki/deck_config_pb";
import * as decks from "../anki/proto/anki/decks_pb";
import * as frontend from "../anki/proto/anki/frontend_pb";
import * as generic from "../anki/proto/anki/generic_pb";
import * as github from "../anki/proto/anki/github_pb";
import * as i18n from "../anki/proto/anki/i18n_pb";
import * as image_occlusion from "../anki/proto/anki/image_occlusion_pb";
import * as import_export from "../anki/proto/anki/import_export_pb";
import * as links from "../anki/proto/anki/links_pb";
import * as media from "../anki/proto/anki/media_pb";
import * as notes from "../anki/proto/anki/notes_pb";
import * as notetypes from "../anki/proto/anki/notetypes_pb";
import * as scheduler from "../anki/proto/anki/scheduler_pb";
import * as search from "../anki/proto/anki/search_pb";
import * as stats from "../anki/proto/anki/stats_pb";
import * as sync from "../anki/proto/anki/sync_pb";
import * as tags from "../anki/proto/anki/tags_pb";
import * as zz_hayaki from "../anki/proto/anki/zz_hayaki_pb";

export interface MethodSchemas {
  input: DescMessage;
  output: DescMessage;
}

const modules: Record<string, unknown>[] = [
  ankidroid, ankihub, ankiweb, card_rendering, cards, collection, config, deck_config, decks, frontend, generic, github,
  i18n, image_occlusion, import_export, links, media, notes, notetypes, scheduler, search, stats, sync, tags,
  zz_hayaki,
];

let table: Map<string, MethodSchemas> | null = null;

function isService(value: unknown): value is DescService {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "service";
}

/** The schemas of a core method by its generated name (`getCard`), if any. */
export function methodSchemas(method: string): MethodSchemas | undefined {
  if (!table) {
    table = new Map();
    for (const module of modules) {
      for (const value of Object.values(module)) {
        if (!isService(value)) continue;
        for (const m of value.methods) table.set(m.localName, { input: m.input, output: m.output });
      }
    }
  }
  return table.get(method);
}
