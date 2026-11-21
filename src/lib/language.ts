// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The interface language. "System" (nothing stored) follows the operating
 * system; a stored choice is handed to the core, which translates Anki's own
 * strings, and picks Hayaki's strings (`makeStrings`). The list is upstream's
 * (`anki/lang.py`), each language in its own name.
 */
import { appInfo, setCoreLangs } from "./profiles";

export const LANGUAGES: readonly { name: string; code: string }[] = [
  { name: "Afrikaans", code: "af_ZA" },
  { name: "Bahasa Melayu", code: "ms_MY" },
  { name: "Català", code: "ca_ES" },
  { name: "Dansk", code: "da_DK" },
  { name: "Deutsch", code: "de_DE" },
  { name: "Eesti", code: "et_EE" },
  { name: "English (United States)", code: "en_US" },
  { name: "English (United Kingdom)", code: "en_GB" },
  { name: "Español", code: "es_ES" },
  { name: "Esperanto", code: "eo_UY" },
  { name: "Euskara", code: "eu_ES" },
  { name: "Français", code: "fr_FR" },
  { name: "Galego", code: "gl_ES" },
  { name: "Hrvatski", code: "hr_HR" },
  { name: "Italiano", code: "it_IT" },
  { name: "lo jbobau", code: "jbo_EN" },
  { name: "Lenga d'òc", code: "oc_FR" },
  { name: "Қазақша", code: "kk_KZ" },
  { name: "Magyar", code: "hu_HU" },
  { name: "Nederlands", code: "nl_NL" },
  { name: "Norsk", code: "nb_NO" },
  { name: "Polski", code: "pl_PL" },
  { name: "Português Brasileiro", code: "pt_BR" },
  { name: "Português", code: "pt_PT" },
  { name: "Română", code: "ro_RO" },
  { name: "Slovenčina", code: "sk_SK" },
  { name: "Slovenščina", code: "sl_SI" },
  { name: "Suomi", code: "fi_FI" },
  { name: "Svenska", code: "sv_SE" },
  { name: "Tiếng Việt", code: "vi_VN" },
  { name: "Türkçe", code: "tr_TR" },
  { name: "简体中文", code: "zh_CN" },
  { name: "日本語", code: "ja_JP" },
  { name: "繁體中文", code: "zh_TW" },
  { name: "한국어", code: "ko_KR" },
  { name: "Čeština", code: "cs_CZ" },
  { name: "Ελληνικά", code: "el_GR" },
  { name: "Български", code: "bg_BG" },
  { name: "Монгол хэл", code: "mn_MN" },
  { name: "Pусский язык", code: "ru_RU" },
  { name: "Српски", code: "sr_SP" },
  { name: "Українська мова", code: "uk_UA" },
  { name: "Հայերեն", code: "hy_AM" },
  { name: "עִבְרִית", code: "he_IL" },
  { name: "ייִדיש", code: "yi" },
  { name: "العربية", code: "ar_SA" },
  { name: "فارسی", code: "fa_IR" },
  { name: "ภาษาไทย", code: "th_TH" },
  { name: "Latin", code: "la_LA" },
  { name: "Gaeilge", code: "ga_IE" },
  { name: "Беларуская мова", code: "be_BY" },
  { name: "ଓଡ଼ିଆ", code: "or_OR" },
  { name: "Filipino", code: "tl" },
  { name: "ئۇيغۇر", code: "ug" },
  { name: "Oʻzbekcha", code: "uz_UZ" },
].sort((a, b) => a.name.localeCompare(b.name, "en"));

const KEY = "hayaki.language";

/** The chosen language code, or null to follow the system. */
export function storedLanguage(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    return code && LANGUAGES.some((l) => l.code === code) ? code : null;
  } catch {
    return null;
  }
}

function store(code: string | null): void {
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

/** A BCP 47 tag for the core: upstream's `ja_JP` becomes `ja-JP`. */
export function languageTag(code: string): string {
  return code.replace("_", "-");
}

/** Whether the core already runs in the language (`ja-JP` for `ja_JP`, or its base `ja`). */
export function sameLanguage(running: string | undefined, code: string): boolean {
  if (!running) return false;
  return running.toLowerCase().replace("_", "-") === languageTag(code).toLowerCase();
}

/** At start-up, puts the core in the chosen language before its strings are read. */
export async function applyStoredLanguage(): Promise<void> {
  const code = storedLanguage();
  if (!code) return;
  const info = await appInfo();
  if (!sameLanguage(info.langs[0], code)) await setCoreLangs([languageTag(code)]);
}

/**
 * Switches the language: the core restarts in it (reopening the collection)
 * and the window reloads so every screen reads the new strings. `null` is
 * the system language.
 */
export async function chooseLanguage(code: string | null): Promise<void> {
  const system = typeof navigator === "undefined" ? [] : [...navigator.languages];
  await setCoreLangs(code ? [languageTag(code)] : system.length > 0 ? system : ["en-US"]);
  store(code);
  location.reload();
}
