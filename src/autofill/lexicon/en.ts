import type { Lexicon } from "./types";

const ELSEWHERE = ["prefer", "preferred", "would you like", "want to work", "relocate", "office", "willing", "desired"];

export const en: Lexicon = {
  lang: "en",
  keys: {
    first_name: {
      exact: ["first name", "firstname", "given name", "forename", "first", "fname", "legal first name", "first given name"],
      phrases: ["first name", "given name", "forename", "legal first name"],
      not: ["preferred", "last", "middle"],
    },
    last_name: {
      exact: ["last name", "lastname", "surname", "family name", "last", "lname", "legal last name"],
      phrases: ["last name", "surname", "family name", "legal last name"],
      not: ["first"],
    },
    full_name: {
      exact: ["name", "full name", "fullname", "legal name", "full legal name", "applicant name", "candidate name", "first and last name"],
      phrases: ["full name", "full legal name", "first and last name"],
      not: ["company", "employer", "school", "university", "user", "reference", "file", "preferred", "nickname"],
    },
    preferred_name: {
      exact: ["preferred name", "nickname", "preferred first name"],
      phrases: ["preferred name", "preferred first name", "name you go by", "nickname"],
    },
    email: {
      exact: ["email", "e mail", "email address", "e mail address", "mail"],
      phrases: ["email address", "e mail address", "email", "e mail"],
      not: ["newsletter", "subscribe", "updates", "notify", "notification", "marketing", "alert"],
    },
    phone: {
      exact: ["phone", "telephone", "mobile", "cell", "tel", "phone number", "mobile number", "mobile phone", "cell phone", "telephone number"],
      phrases: ["phone number", "telephone number", "mobile number", "mobile phone", "contact number", "cell phone", "phone", "telephone"],
      not: ["country code", "dialing code", "calling code", "extension", "type"],
    },
    phone_country_code: {
      exact: ["country code", "dial code", "dialing code", "calling code", "phone code", "phone country", "country phone code", "phone prefix"],
      phrases: ["phone country code", "country phone code", "country code", "dialing code", "dial code", "calling code", "phone code"],
    },
    street_address: {
      exact: ["address", "street", "street address", "address line 1", "address 1", "address line1", "home address", "postal address"],
      phrases: ["street address", "address line 1", "street and number", "street and house number", "home address", "postal address"],
      not: ["email", "e mail", "web", "ip", "line 2", "address 2"],
    },
    postal_code: {
      exact: ["postal code", "postcode", "zip", "zip code", "zipcode", "post code", "postal"],
      phrases: ["postal code", "postcode", "zip code", "post code"],
    },
    city: {
      exact: ["city", "town", "city town", "town city", "city of residence"],
      phrases: ["city of residence", "city", "town"],
      not: ELSEWHERE,
    },
    country: {
      exact: ["country", "country region", "country of residence", "region country"],
      phrases: ["country of residence", "country"],
      not: ["citizenship", "nationality", "passport", "authorized", "authorised", "birth", "code", "dial", ...ELSEWHERE],
    },
    location: {
      exact: ["location", "current location", "location city", "where are you based", "where are you located"],
      phrases: ["current location", "where are you based", "where are you located"],
      not: ELSEWHERE,
    },
    current_title: {
      exact: ["current title", "job title", "current job title", "current position", "current role", "title current", "most recent title"],
      phrases: ["current job title", "current title", "current position", "current role", "most recent job title", "present position"],
      not: ["apply", "applying", "desired", "interested", "company", "employer"],
    },
    current_company: {
      exact: ["current company", "current employer", "current company name", "present employer", "most recent employer", "org"],
      weak: ["company", "employer", "organization", "organisation", "company name"],
      phrases: ["current company", "current employer", "current organization", "current organisation", "most recent employer", "present employer"],
      not: ["previous", "former", "referred", "referral", "website", "size", "industry"],
    },
    headline: {
      exact: ["headline", "professional headline", "tagline"],
      phrases: ["professional headline", "headline"],
    },
    years_of_experience: {
      exact: ["years of experience", "experience years", "years experience", "total years of experience", "work experience years"],
      phrases: ["years of experience", "years of professional experience", "years of relevant experience", "years of work experience", "how many years", "total experience", "experience in years"],
      not: ["leading", "managing", "management", "leadership"],
    },
    summary: {
      exact: ["summary", "professional summary", "about you", "about me", "bio", "short bio", "profile summary", "profile"],
      phrases: ["professional summary", "about yourself", "about you", "short bio", "profile summary", "summary"],
      not: ["cover letter", "why", "leadership", "management"],
    },
    industry: {
      exact: ["industry", "current industry", "sector"],
      phrases: ["current industry", "industry"],
      not: ["prefer", "interested", "experience"],
    },
    seniority: {
      exact: ["seniority", "seniority level", "career level", "experience level", "level of experience", "level"],
      phrases: ["seniority level", "career level", "experience level", "level of experience", "seniority"],
      not: ["education", "language", "degree", "english", "german"],
    },
    management_experience: {
      phrases: ["management experience", "people management", "managed a team", "manage people", "direct reports", "led a team", "line management", "managing people", "managerial experience", "leadership experience"],
      not: ["years", "how many"],
    },
    leadership_experience: {
      phrases: ["leadership experience", "management experience", "people management experience", "describe your leadership", "describe your management", "leadership scope"],
      not: ["years", "how many"],
    },
    linkedin_url: {
      exact: ["linkedin", "linkedin profile", "linkedin url", "linked in"],
      phrases: ["linkedin", "linked in"],
    },
    github_url: { exact: ["github", "github profile", "github url"], phrases: ["github"] },
    portfolio_url: {
      exact: ["portfolio", "portfolio url", "portfolio link", "portfolio website"],
      phrases: ["portfolio", "work samples"],
      not: ["upload", "attach", "file"],
    },
    website_url: {
      exact: ["website", "personal website", "web site", "homepage", "url", "personal site", "website url", "blog", "other website"],
      phrases: ["personal website", "website", "homepage", "web site", "personal site"],
      not: ["linkedin", "github", "portfolio", "company website", "company s website"],
    },

    date_of_birth: { phrases: ["date of birth", "birth date", "birthdate", "birthday", "dob", "born"] },
    nationality: { phrases: ["nationality"] },
    citizenship: { phrases: ["citizenship", "citizen", "passport"] },
    gender: { exact: ["sex"], phrases: ["gender", "pronouns", "pronoun"] },
    salutation: { exact: ["title", "salutation", "prefix", "honorific", "form of address"], phrases: ["salutation", "honorific"] },
    work_authorization: {
      phrases: ["authorized to work", "authorised to work", "work authorization", "work authorisation", "right to work", "work permit", "legally authorized", "legally authorised", "eligible to work", "permission to work", "legally entitled"],
    },
    visa_sponsorship: { phrases: ["sponsorship", "sponsor", "visa", "immigration"] },
    disability: { phrases: ["disability", "disabled", "handicap", "accommodation"] },
    veteran_status: { phrases: ["veteran", "military service", "armed forces"] },
    ethnicity: { phrases: ["ethnicity", "ethnic", "race", "racial", "hispanic", "latino"] },
    criminal_record: { phrases: ["criminal", "convicted", "conviction", "felony", "background check", "offence", "offense"] },
    salary_expectation: {
      phrases: ["salary expectation", "salary expectations", "expected salary", "desired salary", "salary requirement", "salary requirements", "compensation expectation", "compensation expectations", "expected compensation", "desired compensation", "salary range", "salary"],
      not: ["current", "present", "history", "last"],
    },
    current_salary: { phrases: ["current salary", "current compensation", "current base salary", "current pay", "salary history"] },
    relocation: { phrases: ["relocate", "relocation", "willing to move"] },
    notice_period: { phrases: ["notice period", "notice"] },
    availability_date: {
      phrases: ["start date", "available from", "availability", "earliest start", "when can you start", "date available", "available to start", "joining date"],
    },
    consent: {
      phrases: ["i agree", "i consent", "privacy policy", "privacy notice", "terms and conditions", "terms of use", "data protection", "gdpr", "i accept", "consent", "i acknowledge", "i confirm", "i certify", "retain my data", "talent pool"],
    },
    referral_source: {
      phrases: ["how did you hear", "how did you find", "where did you hear", "where did you find", "referred by", "referral", "source"],
    },
    skills: {
      exact: ["skills", "key skills", "technical skills", "skill set", "skillset", "core skills", "competencies", "core competencies", "areas of expertise", "expertise", "tools and technologies"],
      phrases: ["key skills", "technical skills", "core competencies", "your skills", "skills"],
      not: ["language", "years", "describe", "how"],
    },
    languages: {
      exact: ["languages", "language skills", "languages spoken", "spoken languages", "language proficiency", "language"],
      phrases: ["languages you speak", "language skills", "languages spoken", "which languages", "language proficiency"],
      not: ["programming", "preferred language", "language of", "native"],
    },
    certifications: {
      exact: ["certifications", "certificates", "licenses and certifications", "licences and certifications", "professional certifications", "certification"],
      phrases: ["professional certifications", "licenses and certifications", "licences and certifications", "certifications"],
      not: ["upload", "attach"],
    },
    preferred_location: {
      exact: ["preferred location", "preferred locations", "desired location", "preferred work location", "location preference", "preferred office"],
      phrases: ["preferred location", "desired location", "where would you like to work", "which office", "which location", "preferred office"],
    },
    remote_preference: {
      exact: ["remote", "work model", "working model", "work arrangement", "remote work", "workplace type", "work location type", "remote or on site"],
      phrases: ["work remotely", "remote work", "work model", "working model", "work arrangement", "workplace preference", "on site or remote", "remote or on site", "home office"],
      not: ["policy", "experience"],
    },
    employment_type: {
      exact: ["employment type", "type of employment", "job type", "contract type", "full time or part time", "desired employment type"],
      phrases: ["employment type", "type of employment", "full time or part time", "contract type"],
      not: ["current"],
    },
    // Employment history and education: only inside those sections (see classifier).
    work_company: {
      exact: ["company", "employer", "company name", "employer name", "organization", "organisation", "organization name", "organisation name", "name of employer"],
      phrases: ["company name", "employer name", "name of employer", "name of company"],
      not: ["website", "size", "industry", "address", "phone", "type"],
    },
    work_title: {
      exact: ["title", "job title", "position", "role", "position title", "job role", "designation", "job position", "position held"],
      phrases: ["job title", "position title", "position held", "role title"],
      not: ["company", "employer"],
    },
    work_location: {
      exact: ["location", "city", "place", "work location", "office location", "city country", "location city"],
      phrases: ["work location", "office location"],
      not: ["prefer", "willing"],
    },
    work_start: {
      exact: ["from", "start", "start date", "started", "date from", "from date", "start month", "start year", "month from", "year from", "date started", "begin", "since", "first year attended"],
      phrases: ["start date", "from date", "date from", "start month", "start year", "first year attended", "date started"],
    },
    work_end: {
      exact: ["to", "end", "end date", "until", "date to", "to date", "end month", "end year", "month to", "year to", "date ended", "ended", "last year attended"],
      phrases: ["end date", "to date", "date to", "end month", "end year", "last year attended", "date ended"],
      not: ["current", "present"],
    },
    work_current: {
      exact: ["current", "current position", "current job", "current role", "present", "currently working here", "i currently work here", "to present", "still working here"],
      phrases: ["currently work here", "currently working here", "i currently work", "still work here", "current position", "current role", "current job", "until today", "to present"],
    },
    work_description: {
      exact: ["description", "role description", "responsibilities", "job description", "tasks", "duties", "details", "achievements", "description of role", "summary"],
      phrases: ["role description", "description of your role", "responsibilities", "duties", "job description"],
    },
    edu_school: {
      exact: ["school", "university", "institution", "college", "school name", "university name", "institution name", "school or university", "name of school", "name of institution", "school university", "educational institution"],
      phrases: ["school name", "university name", "institution name", "name of school", "name of institution", "educational institution"],
    },
    edu_degree: {
      exact: ["degree", "degree type", "qualification", "level of education", "degree level", "diploma", "education level", "degree obtained", "type of degree"],
      phrases: ["degree type", "type of degree", "degree obtained", "level of education"],
    },
    edu_field: {
      exact: ["field of study", "major", "discipline", "subject", "study field", "area of study", "specialization", "specialisation", "course", "programme", "program", "course of study", "major field of study"],
      phrases: ["field of study", "area of study", "course of study", "major"],
    },
    edu_end: {
      phrases: ["graduation date", "graduation year", "year of graduation", "date of graduation", "completion date", "year completed", "expected graduation"],
    },
    resume: { exact: ["cv", "resume", "resume cv", "cv resume", "curriculum vitae"], phrases: ["resume", "curriculum vitae", "cv"] },
    cover_letter: { phrases: ["cover letter", "motivation letter", "letter of motivation", "covering letter", "motivational letter"] },
    other_document: { phrases: ["certificate", "certificates", "transcript", "attachment", "attachments", "additional documents", "additional files", "references", "work sample"] },
  },
  // Kept narrow: a section titled "Senior Recruiter" is still the applicant's own form.
  otherPerson: ["reference", "references", "referee", "referees", "emergency contact", "referred by", "referrer", "referring employee", "next of kin"],
  yes: ["yes", "y", "true"],
  no: ["no", "n", "false"],
  salutations: ["mr", "mrs", "ms", "miss", "mx", "dr", "prof"],
  questionStarts: ["why", "what", "how", "describe", "tell us", "please describe", "please explain", "explain", "share", "give an example", "in a few sentences", "which"],
  sections: {
    work: ["work experience", "professional experience", "employment history", "work history", "employment", "experience", "career history", "previous employment", "positions", "job history", "relevant experience"],
    education: ["education", "academic background", "academic history", "educational background", "schools", "studies", "qualifications", "academic qualifications", "university"],
  },
  months: ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
};
