/** Shared by the AutoFill tests: fixture forms and a Career Profile. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AutofillProfile, ProfileValue } from "../../src/autofill/types";

/** Loads a fixture into the test document (a real window, so events and styles work). */
export function load(name: string): void {
  document.open();
  document.write(readFileSync(resolve(process.cwd(), "test/fixtures/forms", name), "utf8"));
  document.close();
}

export const e = (value: string | number | boolean): ProfileValue => ({ value, basis: "explicit" });

export const ANNA: AutofillProfile = {
  profile_version: 7,
  updated_at: "2026-11-01T10:00:00Z",
  language: "en",
  values: {
    email: e("anna@example.com"),
    full_name: e("Anna Schmidt"),
    first_name: e("Anna"),
    last_name: e("Schmidt"),
    phone: e("+49 151 2345678"),
    street_address: e("Torstraße 1"),
    postal_code: e("10119"),
    city: e("Berlin"),
    country: e("DE"),
    current_title: e("Head of Platform"),
    current_company: e("Nordlicht Payments"),
    years_of_experience: e(12),
    management_experience: e(true),
    linkedin_url: e("https://linkedin.com/in/anna"),
    github_url: e("https://github.com/anna"),
  },
};

