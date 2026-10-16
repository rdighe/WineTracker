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
