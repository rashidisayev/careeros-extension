/** Text normalisation shared by the lexicons and the classifier. Pure. */

/** Lower case, no accents (ä → a, ß → ss), punctuation as spaces, single spaces. */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** firstName, first_name, applicant[first-name] → "first name" (then normalised). */
export function splitIdentifier(text: string): string {
  return norm(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[_\-.[\]:]+/g, " "),
  );
}

// Words around a label that don't change its meaning.
const FILLER_START = /^(please (enter|provide|select|type)|enter|provide|select|type|your|ihr|ihre|ihren|dein|deine|bitte (geben sie|wahlen sie)|bitte)\s+/;
// A date format hint ("From (MM/YYYY)") says how to write the date, not what it is.
const FILLER_END = /\s+(required|optional|pflichtfeld|pflichtangabe|freiwillig|erforderlich|here|hier|eingeben|angeben|(dd|tt) mm (yyyy|jjjj)|mm dd yyyy|yyyy mm dd|mm (yyyy|jjjj|yy)|yyyy mm|yyyy|jjjj)$/;

/** A label reduced to its words: "Your e-mail address *" → "e mail address". */
export function labelCore(text: string): string {
  let t = norm(text);
  for (let i = 0; i < 3; i++) {
    const next = t.replace(FILLER_START, "").replace(FILLER_END, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

export function wordCount(t: string): number {
  return t ? t.split(" ").length : 0;
}

/** Whole-word containment on normalised text. */
export function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}
