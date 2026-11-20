# GetCareer Companion 0.4.0 — Chrome Web Store listing

Item id: `flckbclfgaidajgegjablmeppipgppna`
Package: `release/getcareer-companion-<version>-chrome.zip` (`pnpm package`)
Images: `release/store-listing-<version>/` (`node scripts/store-images.cjs . release/store-listing-<version>`)

Paste each block into the field of the same name in the developer console.

**No lists of brand names** in the description, screenshots or promo images: the first
submission (0.4.0, 2026-11-20) was rejected as keyword spam ("Yellow Argon") for listing the
supported ATS vendors and the restricted job sites. Describe them generically. Brand names
are fine in the reviewer test instructions, which aren't public.

---

## Tab "Store listing"

### Description

```
GetCareer Companion connects your browser to your GetCareer account. Save the job you're looking at, see what you already track, and fill application forms from your Career Profile, while you check every value first.

SAVE JOB POSTINGS
• One click reads the posting you're on: title, company, location, employment type, salary when the employer states it, deadline and description.
• Review and edit every field before it's saved. Each value shows where it came from: from the posting, interpreted, or not found.
• Already tracking the job? GetCareer tells you its stage and match, and never creates a duplicate by accident.

FILL APPLICATION FORMS (AutoFill)
• AutoFill finds the fields of an application form and shows what it will write. Only the values you tick are filled.
• Personal details, links, work history and education, each role in the right entry and dates in the form's own format.
• Works with English and German forms, including the application systems most employers use.
• Attach your CV from GetCareer, or a resume GetCareer writes for this job (optional, with your consent to AI processing in GetCareer). The extension reports a file as attached only when the form shows it.
• Multi-step forms: new fields on the next step are offered after each fill.
• Undo restores the form. AutoFill never submits an application. You check the form and send it yourself.

YOU STAY IN CONTROL
• Sensitive and legal questions are always left to you: salary, work authorisation and visa, nationality, date of birth, gender, disability, ethnicity, criminal record, notice period, start date and consent boxes.
• The extension reads a page only when you open it there (or on a site you allowed). It doesn't read your browsing history.
• Job sites whose terms don't allow automated reading are never read automatically. There, select the job description and save the selection instead.
• All processing happens in your GetCareer account. AI is used only on GetCareer's servers and only with your consent.

Requires a GetCareer account (https://getcareer.io).
```

### Category
Workflow & Planning (or Tools). Pick whichever of the two the console offers.

### Language
English

### Graphic assets
| Field | File |
|---|---|
| Store icon (128×128) | `store-icon-128.png` |
| Screenshots (1280×800), in this order | `screenshot-1-save-jobs.png`, `screenshot-2-autofill.png`, `screenshot-3-work-history.png`, `screenshot-4-in-control.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | Optional, leave empty |

### Additional fields
| Field | Value |
|---|---|
| Official URL | `getcareer.io` (only selectable after the domain is verified in Google Search Console) |
| Homepage URL | `https://getcareer.io` |
| Support URL | The support address or contact page you use for GetCareer |
| Mature content | No |

---

## Tab "Privacy"

### Single purpose description
```
Help the user apply for jobs with their GetCareer account: save the job posting they are viewing to GetCareer, show the status of jobs they already track, and fill job application forms from their GetCareer Career Profile after they review every value.
```

### Permission justifications

**activeTab**
```
Read the job posting or application form on the tab where the user opens the extension, only after that click.
```

**scripting**
```
Run the extension's own packaged scripts on that tab: the page reader that extracts the job posting, and AutoFill, which writes the values the user reviewed and ticked into the application form. No remote code is run.
```

**storage**
```
Store the user's settings, and the session for their GetCareer connection and per-tab readings in session storage (cleared when the browser closes).
```

**sidePanel**
```
Show the job review form and the AutoFill review next to the page.
```

**identity**
```
Connect to the user's GetCareer account through the GetCareer website with chrome.identity.launchWebAuthFlow (OAuth with PKCE). The extension does not read the browser's Google account.
```

**contextMenus**
```
Adds "Save this job to GetCareer" and "Save selected text as a job description" to the right-click menu.
```

**Host permission (https://getcareer.io/\*)**
```
The extension talks only to the GetCareer API: it sends the job posting the user chooses to save, reads the status of jobs they track, and loads their Career Profile for AutoFill.
```

**Optional host permission (https://\*/\*)** (if asked)
```
Requested for one site at a time, only when the user chooses "Read this site automatically" in the side panel, so the extension can read job postings there without a click on every page. The user can revoke it in the panel, the options or the browser.
```

**Optional permission downloads** (if asked)
```
Requested only when the user clicks "Download PDF/Word" for a resume from their GetCareer account, so the file is saved under its name and the extension can report when the download finished.
```

### Remote code
**No, I am not using remote code.**
```
All JavaScript is in the package. The extension loads no scripts, fonts or other code from the network; its CSP allows connections only to https://getcareer.io.
```

### Data usage
Tick these and leave the rest unticked:

| Category | Tick | What it is |
|---|---|---|
| Personally identifiable information | ✔ | Name, email, phone and address from the user's Career Profile, loaded to fill forms; the account email shown in the extension |
| Authentication information | ✔ | The GetCareer session tokens |
| Web history | ✔ | The address of a job page the extension is opened on (to show its status) and, if AutoFill history is on, the sites of forms the user filled |
| Website content | ✔ | The job posting the user saves; questions on a form the user asks GetCareer to suggest answers for |
| Health, financial and payment, personal communications, location, user activity | ✘ | Not collected |

Certifications, tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
`https://getcareer.io/privacy`. It must describe the extension before you submit; today it doesn't. See "Before you submit" below.

---

## Tab "Distribution"
| Field | Value |
|---|---|
| Payments | Free |
| Visibility | **Private (trusted testers)** for the first round, then Public |
| Regions | All regions, or the EU only if GetCareer is EU-only |

---

## Tab "Test instructions" (for the reviewer)
```
The extension needs a GetCareer account. Test account: <email> / <password>

1. Click the extension icon and choose "Connect to GetCareer". Sign in with the test account in the window that opens and approve the connection.
2. Open any public job posting (for example a Greenhouse or Lever job page) and click the icon. The posting is read; "Review and save" opens the side panel with every field editable. Save it.
3. Open an application form (for example the "Apply" page of a Greenhouse job). The side panel shows "GetCareer AutoFill" with the detected fields. "Fill application" opens the review; "Fill N fields" fills only ticked values. The extension never submits the form.
4. LinkedIn and Indeed pages are not read automatically by design; there the user selects text and saves the selection.
```

---

## Before you submit

1. **Privacy policy:** add the extension section to https://getcareer.io/privacy. The draft
   paragraph is in `docs/CHROME_WEB_STORE_RELEASE.md` (section 4). It also needs AutoFill
   (Career Profile loaded to fill forms, nothing typed into forms sent, optional history)
   and tailored resumes (the posting sent to GetCareer when the user asks for one).
2. **Allow the store id on the server:** add `flckbclfgaidajgegjablmeppipgppna` to
   `EXTENSION_ALLOWED_IDS` on production and restart the API. Without it the reviewer
   can't connect and the review will fail.
3. **Reviewer account:** create a GetCareer test account with a filled Career Profile, and
   put its login into "Test instructions".
4. Publish to trusted testers first, connect with the store build, then go public.
