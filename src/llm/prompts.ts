/** Prompts shared by the LLM providers. */

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
export function researchPrompt(q: { displayName: string; producer: string; region: string; country: string; grape: string; colour: string }, grounded: boolean): string {
  const known = [
    `Wine: ${q.displayName}`,
    q.producer && `Producer: ${q.producer}`,
    (q.region || q.country) && `From: ${[q.region, q.country].filter(Boolean).join(', ')}`,
    q.grape && `Grape: ${q.grape}`,
    q.colour && `Colour: ${q.colour}`,
  ].filter(Boolean).join('\n');
  return `${grounded ? 'Search the web and research' : 'From what you know, describe'} this wine for a wine lover's cellar app.
${known}

Cover the wine in general, not one vintage. Use the producer's own site, importers' spec sheets, and reputable reviews.
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
 "sources": [{"title": "", "url": "https://..."}]}`;
}
