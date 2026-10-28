/** Prompts shared by the LLM providers. */
import { FLAVORS } from '../recs/flavors.js';

export const LABEL_PROMPT = `You are reading a photo of a wine bottle label.
Return ONLY a JSON object with these keys:
{"producer": "", "name": "", "vintage": "", "region": "", "country": "", "grape": "",
 "colour": "red|white|rose|", "bottle_ml": null, "raw_text": "", "confidence": 0.0}
Rules:
- producer: the winery/house/chateau exactly as printed (e.g. "Château Lynch-Bages").
- name: the specific wine or cuvée name, without the producer (e.g. "Special Selection"); "" if the wine is just the producer's name.
- vintage: the 4-digit year printed on the label, "NV" if it says non-vintage, "" if no year is visible. Never guess a year.
- region / country / grape: only if printed or certain from the appellation on the label.
- bottle_ml: only if a volume is printed (750 ml -> 750, 1.5 L -> 1500).
- raw_text: all other legible label text, space-separated.
- confidence: your probability (0-1) that producer, name and vintage are all correct.
If the image is not a wine label, return all empty strings and confidence 0.`;

/** Most bottles read from one lineup photo. */
export const MAX_LINEUP = 12;

export const LINEUP_PROMPT = `You are looking at a photo of several wine bottles.
Read the front label of every bottle whose label you can see, from left to right (top row first).
Return ONLY a JSON object: {"bottles": [ ... ]}, one entry per bottle, at most ${MAX_LINEUP}, each with these keys:
{"producer": "", "name": "", "vintage": "", "region": "", "country": "", "grape": "",
 "colour": "red|white|rose|", "bottle_ml": null, "raw_text": "", "confidence": 0.0}
Rules for each bottle:
- producer: the winery/house/chateau exactly as printed. name: the cuvée name without the producer, "" if none.
- vintage: the 4-digit year printed on that bottle's label, "NV" if non-vintage, "" if not visible. Never guess a year.
- region / country / grape: only if printed or certain from the appellation.
- raw_text: that bottle's other legible label text.
- confidence: your probability (0-1) that producer, name and vintage are right for that bottle.
- Two bottles of the same wine and vintage are two entries. Skip bottles whose label you can't read at all.
If there are no wine labels, return {"bottles": []}.`;

/** Research brief for a wine; the vintage is left out on purpose (the result is shared by every vintage). */
export function merchantPrompt(q: { name: string; domain: string }): string {
  return `Search the web for this US wine shop: ${q.name} (${q.domain}).
Find (1) its physical retail stores, if any, and (2) which US states it ships wine to (check its shipping or FAQ page; wine
shipping depends on state law, so list only states the shop says it ships to).
Only state what you found on a page; if it ships to "all states where legal" without a list, give the states its shipping
page names, or [] if it names none. For each store, give its approximate latitude/longitude (from the address; city-level
is fine).
Reply with ONLY a JSON object:
{"stores": [{"name": "", "address": "street", "city": "", "state": "CA", "postal": "", "lat": 37.77, "lng": -122.42}],
 "ships_to": ["CA", "NY"],
 "sources": [{"title": "", "url": "https://..."}]}`;
}

export function researchPrompt(q: { displayName: string; producer: string; region: string; country: string; grape: string; colour: string; labelText?: string }, grounded: boolean): string {
  const known = [
    `Wine: ${q.displayName}`,
    q.producer && `Producer: ${q.producer}`,
    (q.region || q.country) && `From: ${[q.region, q.country].filter(Boolean).join(', ')}`,
    q.grape && `Grape: ${q.grape}`,
    q.colour && `Colour: ${q.colour}`,
    q.labelText && `Text on its label: ${q.labelText.slice(0, 400)}`,
  ].filter(Boolean).join('\n');
  return `${grounded ? 'Search the web and research' : 'From what you know, describe'} this wine for a wine lover's cellar app.
${known}

Several wines can share a name: use the producer and the label text to research the right one.
Cover the wine in general, not one vintage. Use the producer's own site, importers' spec sheets, and reputable reviews.
${grounded ? `Look in particular for the wine's technical / spec sheet (the producer's or importer's fact sheet, often a PDF) and use it for the specs.
Then corroborate the tasting notes: find what 2-5 independent sources say it tastes like (the spec sheet, critics, shops), and write
"tasting_notes" as what they agree on. Report each source's own words briefly in "tasting_sources", and in "consensus" say where they
agree and where they differ.
` : ''}
Only state facts you can back up${grounded ? ' with a page you found' : ''}; leave a field "" (or [] for lists) when unsure. Never invent numbers.
Reply with ONLY a JSON object with these keys (plain text values, no markdown):
{"summary": "2-3 sentences: what this wine is and what makes it notable",
 "tasting_notes": {"appearance": "", "nose": "", "palate": "", "finish": ""},
 "descriptors": ["up to 10 short tasting words, lowercase, e.g. black cherry"],
 "food_pairings": ["up to 6"],
 "serving": {"temperature": "e.g. 16-18°C", "decant": "", "drinking_window": "typical ageing, e.g. 5-20 years from vintage"},
 "producer": {"history": "2-4 sentences on the estate/winery and its people", "founded": "year", "location": "", "website": "https://..."},
 "vineyard": "the vineyards, site, soils and climate, 1-3 sentences",
 "specs": {"grapes": "blend with percentages when published", "abv": "", "aging": "oak, vessels, months", "vinification": "", "soil": "", "production": "cases or bottles per year"},
 "wine": {"colour": "red|white|rose|", "wine_type": "still|sparkling|fortified|dessert|", "country": "", "region": "", "sub_region": "", "grape": "main grape or blend name"},
 "sources": [{"title": "", "url": "https://..."}]${grounded ? `,
 "spec_sheets": [{"title": "e.g. 2019 technical sheet", "url": "https://..."}],
 "tasting_sources": [{"source": "who said it, e.g. the producer, Vinous, a shop", "url": "https://...", "kind": "producer|importer|critic|retailer|other", "notes": "their tasting note, 1-2 sentences"}],
 "consensus": "1-2 sentences: where the sources agree and differ"` : ''}}`;
}

/** The longest note sent to a model; tasting notes are rarely a tenth of this. */
export const MAX_NOTE_CHARS = 2000;

/**
 * Reading flavors from a drinker's own note and tags. The same families and
 * wording as the on-device version (mobile/modules/note-flavors).
 */
export function noteFlavorsPrompt(text: string): string {
  const families = Object.entries(FLAVORS)
    .map(([key, f]) => `- ${key}: ${f.label} (${f.words.slice(0, 5).join(', ')})`)
    .join('\n');
  return `You read a wine drinker's own tasting note and tags about one wine.
Say which of these flavor and structure families the drinker says the wine HAS, each with an intensity:
1 = a hint, 2 = clearly there, 3 = dominant.

${families}

Rules:
- Only what the note says. Do not guess from the grape, region or anything you know about the wine.
- Leave out a family the note says is absent or wished for ("no oak", "not sweet at all", "could use more acidity").
- Words outside the examples count too ("campfire" is smoke, so oak; "zippy" is high acidity).
- Nothing about flavor in the note: an empty object.

Reply with JSON only: {"flavors": {"<family>": <1-3>, ...}}

Note:
"""
${text.slice(0, MAX_NOTE_CHARS)}
"""`;
}

/** The longest wine list text sent to a model (a long list is about 15,000 characters). */
export const MAX_LIST_CHARS = 30000;
/** Most wines kept from one list. */
export const MAX_LIST_ENTRIES = 400;

/**
 * Reading a restaurant wine list from its text (the phone reads the photo; a
 * line is roughly one row of the page, columns joined by " | "). The same
 * fields as the on-device reader (mobile/modules/wine-list).
 */
export function wineListPrompt(text: string): string {
  return `This is the text of a restaurant wine list, read from a photo (each line is about one row of the page; " | " separates text far apart on the same row, which can be two columns of the list).
List every wine on it. Return ONLY a JSON object: {"wines": [ ... ]}, one entry per wine, each with these keys:
{"producer": "", "name": "", "vintage": "", "region": "", "country": "", "grape": "", "colour": "red|white|rose|orange|",
 "style": "still|sparkling|sweet|fortified|", "section": "", "glass_price": null, "bottle_price": null, "bottle_ml": null, "text": ""}
Rules:
- producer: the winery/house/chateau as printed. name: the rest of the wine's name (cuvée, vineyard, appellation), without the producer.
- vintage: the 4-digit year printed for that wine, "NV" if printed as non-vintage, "" if none. Never guess.
- region / country / grape / colour / style: as printed, or certain from the appellation or the heading the wine is under. "" when unsure.
- section: the heading the wine is listed under ("Sparkling", "Pinot Noir", "Rhône"), "" if none.
- glass_price / bottle_price: the prices as numbers in the list's currency (18 for "18" or "$18.00"), null when not given. When a wine has one price, decide from the heading or column ("by the glass") whether it is a glass or a bottle price; a lone price under about 25 is usually a glass.
- bottle_ml: only for half bottles (375), magnums (1500) and other non-750 sizes, else null.
- Bin numbers, page numbers, descriptions and food are not wines. Skip cocktails, beer, spirits and sake.
- text: the wine's line as printed.
At most ${MAX_LIST_ENTRIES} wines, in the order listed.

Wine list text:
"""
${text.slice(0, MAX_LIST_CHARS)}
"""`;
}
