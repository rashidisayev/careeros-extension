/**
 * Confidence engine: from what a field is (classification) and what CareerOS could put in it
 * (proposal), decide what happens. The rules, in order:
 *
 *  1. Unrecognised fields, documents, sensitive, legal and preference questions: the user
 *     answers them. Nothing about them is ever inferred.
 *  2. Fields about someone else (references, emergency contacts): left alone.
 *  3. Fields switched off in settings: left alone.
 *  4. A field the user edited after AutoFill: left alone. A field that already has a value:
 *     kept, unless the user chooses to replace it.
 *  5. No value in the Career Profile, or no option that fits: the user answers it.
 *  6. Otherwise: high confidence (clear label and a stated value) is filled; medium (a
 *     derived value, a weaker label, a repeated field) is suggested for confirmation; low is
 *     left to the user. Job preferences (relocation, remote work, employment type, preferred
 *     locations) are only ever suggested, and only with that category switched on.
 */
import { isFillableCategory, KEYS } from "./keys";
import type { Proposal } from "./mapper";
import type { AutofillSettings, Classification, Confidence, FieldDescriptor, PlanAction, PlanReason } from "./types";

export type Decision = { action: PlanAction; confidence: Confidence; reasons: PlanReason[] };

const ORDER: Confidence[] = ["low", "medium", "high"];
const min = (a: Confidence, b: Confidence): Confidence => ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))]!;

export function decide(
  field: FieldDescriptor,
  c: Classification,
  proposal: Proposal | null,
  settings: AutofillSettings,
  opts: { repeated: boolean },
): Decision {
  const classConf: Confidence = c.level === "high" ? "high" : c.level === "medium" ? "medium" : "low";
  if (!c.key || c.level === "none") {
    // A dropdown widget AutoFill can't operate yet: say so, rather than "not recognised".
    return { action: "ask", confidence: "low", reasons: [field.kind === "custom" ? "unsupported_control" : "not_recognised"] };
  }

  const spec = KEYS[c.key];
  if (!spec.fill) return { action: "ask", confidence: classConf, reasons: [spec.ask ?? "sensitive"] };
  if (c.otherPerson) return { action: "skip", confidence: classConf, reasons: ["other_person"] };
  // Preferences switched off: the question is the user's, as before AutoFill knew them.
  if (spec.category === "preferences" && !settings.categories.preferences) return { action: "ask", confidence: classConf, reasons: ["preference"] };
  if (settings.excluded.includes(c.key)) return { action: "excluded", confidence: classConf, reasons: ["excluded_field"] };
  if (isFillableCategory(spec.category) && !settings.categories[spec.category]) {
    return { action: "excluded", confidence: classConf, reasons: ["excluded_category"] };
  }
  if (field.filledByCareerOS === "edited") return { action: "keep", confidence: classConf, reasons: ["user_edited"] };
  if (field.filledByCareerOS === "yes") return { action: "keep", confidence: classConf, reasons: ["already_filled"] };

  // The end date of the role the user still has: nothing to enter.
  if (proposal && !proposal.ok && proposal.reason === "current_role") return { action: "skip", confidence: classConf, reasons: ["current_role"] };
  if (!proposal || !proposal.ok) return { action: "ask", confidence: classConf, reasons: [proposal?.reason ?? "missing_in_profile"] };

  const reasons: PlanReason[] = [...proposal.reasons];
  let confidence = min(classConf, proposal.confidence);
  if (c.ambiguous) reasons.push("ambiguous_label");
  if (c.level === "low") reasons.push("low_confidence");
  if (opts.repeated && !spec.repeatable) {
    confidence = min(confidence, "medium");
    reasons.push("repeated_field");
  }
  if (field.hasValue) return { action: "keep", confidence, reasons: [...reasons, "has_value"] };
  if (confidence === "low") return { action: "ask", confidence, reasons: reasons.length ? reasons : ["low_confidence"] };
  if (spec.suggestOnly) return { action: "confirm", confidence: min(confidence, "medium"), reasons: [...new Set(reasons)] };
  return { action: confidence === "high" ? "fill" : "confirm", confidence, reasons: [...new Set(reasons)] };
}
