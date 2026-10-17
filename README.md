# NephroDesk AI Pro — Technical Architecture, Clinical Calculation Validation & Free GitHub Launch Guide

**Product:** NephroDesk AI Pro — Assistant Clinique & Dossiers Néphrologiques  
**Subtitle (FR):** Assistant clinique et gestion des dossiers néphrologiques  
**Subtitle (EN):** Nephrology Clinical Assistant & Patient Record Management  
**Version:** `1.0.0-rc.1`

## 1. Phase 1 Source Inspection & Architectural Blueprint

An initial inspection of the workspace confirmed no legacy HTML source file was pre-loaded; consequently, **NephroDesk AI Pro** was architected and engineered from the ground up in two complementary, synchronized formats:

1. **Interactive Bilingual WebApp (`nephrodesk-ai-pro.html`)**: A complete, zero-dependency, WCAG 2.2 AA accessible single-file clinical workstation featuring all 11 clinical modules, instant French/English (`FR`/`EN`) localization, live RBAC role simulation (`PHYSICIAN`, `ADMIN`, `STUDENT`, `READ_ONLY`), SVG serial laboratory trend plotting, immutable consultation amendment trails, configurable renal biopsy checklists, print-ready clinical reports, and schema-validated JSON import/export.
2. **Full-Stack Production Repository (`nephrodesk-ai-pro-fullstack.zip`)**: A modular Node.js / TypeScript-ready / PostgreSQL architecture separating pure clinical calculation logic (`src/shared/calculators`), server-side RBAC and PHI-scrubbed audit logging (`src/shared/rbac`), payload and import schema validation (`src/shared/validation`), REST API controllers (`src/server`), normalized PostgreSQL migrations (`src/database/migrations/001_initial_schema.sql`), OpenAPI 3.1 specification (`openapi.yaml`), automated verification tests (`tests/run_all_tests.js`), and pre-configured free GitHub deployment files (`.github/workflows/ci-and-pages.yml`, `.devcontainer/devcontainer.json`, and `render.yaml`).

## 2. Normalized Database Schema & Entity-Relationship Architecture

The PostgreSQL schema (`001_initial_schema.sql`) separates patient identity (`patient_identifiers`) from clinical encounters (`encounters`), versioned clinical documentation (`clinical_notes`), laboratory catalog and results (`laboratory_tests`, `laboratory_results`), procedural safety records (`procedures`, `checklist_responses`), and security audit trails (`audit_events`).

| Entity Table | Primary Key | Key Relationships & Clinical Integrity Constraints |
| :--- | :--- | :--- |
| `roles` & `permissions` | `id (VARCHAR)` | Many-to-many via `role_permissions`; defines `ADMIN`, `PHYSICIAN`, `STUDENT`, `READ_ONLY` scopes |
| `users` | `id (UUID)` | `FK -> roles(id)`, `UNIQUE(email)`, `preferred_locale IN ('fr', 'en')`, `mfa_enabled` |
| `patients` | `id (UUID)` | `UNIQUE(internal_code)`, `sex_equation_var IN ('female','male')`, `record_status IN ('ACTIVE','ARCHIVED')` (`ON DELETE RESTRICT`) |
| `patient_identifiers` | `id (UUID)` | `FK -> patients(id) ON DELETE RESTRICT`, `UNIQUE(identifier_type, identifier_value)` (compartmentalizes MRN) |
| `patient_access_assignments` | `(patient_id, user_id)` | Grants time-bounded access for medical students/rotators to specific authorized patient records |
| `encounters` | `id (UUID)` | `FK -> patients(id)`, `status IN ('DRAFT','FINALIZED','AMENDED')`, blood pressure & weight bounds |
| `clinical_notes` | `id (UUID)` | `FK -> encounters(id)`, `UNIQUE(encounter_id, version_number)` — prevents silent overwrites of finalized notes |
| `diagnoses`, `allergies`, `medications` | `id (UUID)` | `FK -> patients(id) ON DELETE RESTRICT`, tracks nephrotoxic flags and renal dosing notes |
| `laboratory_tests` & `laboratory_results` | `code` / `id (UUID)` | Explicit unit storage, lab-supplied `ref_range_low`/`ref_range_high`, `abnormality_flag`, `is_verified` |
| `procedures` & `checklist_responses` | `id (UUID)` | Tracks `NATIVE_RENAL_BIOPSY` / `ALLOGRAFT_BIOPSY` and 12 per-item statuses (`COMPLETE`, `INCOMPLETE`, `NOT_APPLICABLE`) |
| `guideline_sources` & `reference_entries` | `id (VARCHAR)` | Versioned clinical reference content linked to exact KDIGO / PubMed sources and review dates |
| `audit_events` | `id (UUID)` | Immutable security log recording actor, role, action, resource ID, and outcome without PHI leakage |

## 3. Clinical Calculation Verification Dossier

All calculation functions in `src/shared/calculators/index.js` are pure, deterministic, and independent of the UI. Intermediate values retain full IEEE-754 double precision and are rounded only for display according to documented rules.

| Calculator | Exact Mathematical Formula & Unit Conversions | Authoritative Source | Verified Reference Case (Automated Test) |
| :--- | :--- | :--- | :--- |
| **CKD-EPI 2021 eGFRcr (Race-Free)** | `eGFR = 142 * min(SCr/k, 1)^a * max(SCr/k, 1)^(-1.200) * 0.9938^Age * (1.012 if female)` where `k = 0.7` (F) or `0.9` (M), `a = -0.241` (F) or `-0.302` (M); `1 mg/dL = 88.4 µmol/L` | [Inker LA et al., *N Engl J Med* 2021;385:1737-1749 (PMID: 34554658)](https://pubmed.ncbi.nlm.nih.gov/34554658/); [KDIGO 2024 CKD Guideline (PMID: 38490803)](https://pubmed.ncbi.nlm.nih.gov/38490803/) | • 50yo F, SCr `0.7 mg/dL` -> **105.3 mL/min/1.73m²** (G1)<br/>• 60yo M, SCr `0.9 mg/dL` -> **97.8 mL/min/1.73m²** (G1)<br/>• 65yo M, SCr `176.8 µmol/L` (`2.0 mg/dL`) -> **36.4 mL/min/1.73m²** (G3b) |
| **Fractional Excretion of Sodium (FeNa)** | `FeNa (%) = 100 * (U_Na * P_Cr) / (P_Na * U_Cr)` after normalizing `P_Cr` and `U_Cr` to `mg/dL` (`1 mmol/L Cr = 11.312 mg/dL`) | [Espinel CH, *JAMA* 1976;236(6):579-581 (PMID: 947239)](https://pubmed.ncbi.nlm.nih.gov/947239/) | • `U_Na=10`, `P_Na=140`, `U_Cr=100 mg/dL`, `P_Cr=2.0 mg/dL` -> **0.14%**<br/>• `U_Na=45`, `P_Na=138`, `U_Cr=8.84 mmol/L`, `P_Cr=176.8 µmol/L` -> **0.65%** |
| **Serum Anion Gap & Figge Albumin Correction** | `AG = [Na+] - ([Cl-] + [HCO3-])`; `Corrected AG = AG + 2.5 * (4.0 - Albumin_g/dL)` (also reports original Figge `4.4 g/dL` reference variant; `1 g/dL = 10 g/L`) | [Figge J et al., *Crit Care Med* 1998;26(11):1807-1810 (PMID: 9824071)](https://pubmed.ncbi.nlm.nih.gov/9824071/) | • `Na=140, Cl=104, HCO3=18` -> Uncorrected AG = **18.0 mmol/L**<br/>• With `Albumin=20 g/L` (`2.0 g/dL`) -> Corrected AG (4.0) = **23.0 mmol/L**, Figge (4.4) = **24.0 mmol/L** |
| **Urine ACR (uACR) & Urine PCR (uPCR)** | `Ratio (mg/g) = Urine Analyte (mg/dL) / Urine Creatinine (g/dL)`; `Ratio (mg/mmol) = Urine Analyte (mg/dL) / Urine Creatinine (mmol/dL)` | [KDIGO 2024 CKD Guideline Chapter 1 (PMID: 38490803)](https://pubmed.ncbi.nlm.nih.gov/38490803/) | • Albumin `45 mg/dL`, UCr `150 mg/dL` -> `uACR` = **300.0 mg/g** (`33.94 mg/mmol`, KDIGO A2)<br/>• Protein `1.2 g/L`, UCr `1.0 g/L` -> `uPCR` = **1200.0 mg/g** |
| **Cockcroft–Gault Creatinine Clearance** | `eCrCl (mL/min) = ((140 - Age) * Weight_kg) / (72 * SCr_mg/dL) * (0.85 if female)` | [Cockcroft DW, Gault MH, *Nephron* 1976;16:31-41 (PMID: 1244564)](https://pubmed.ncbi.nlm.nih.gov/1244564/) | • 70yo F, `65 kg`, SCr `1.5 mg/dL` -> **35.8 mL/min** |
| **Free-Water Deficit (Hypernatremia)** | `FWD (L) = (Weight * f_TBW) * ((Measured Na / Target Na) - 1)` | [Adrogué HJ, Madias NE, *N Engl J Med* 2000;342:1493-1499](https://www.nejm.org/doi/full/10.1056/NEJM200005183422006) | • `70 kg`, `f_TBW=0.6` (`TBW=42 L`), Na `158 -> 140 mmol/L` -> **5.4 L** |

## 4. Clinical Safety Plan & Risk Register

| Hazard ID | Clinical Hazard Description | Root Cause / Trigger | Implemented Software Mitigation | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **HAZ-01** | Inappropriate CKD diagnosis from a single eGFR value or during acute kidney injury | Clinician uses CKD-EPI 2021 during rapidly changing SCr (AKI) or without 3-month chronicity | Explicit warning banner on every CKD-EPI calculation; G-categories labeled strictly as *classification support* requiring >= 3 months chronicity | Automated test Subtest 1–4 & UI inspection |
| **HAZ-02** | Unit mismatch between conventional (`mg/dL`, `g/dL`) and SI (`µmol/L`, `g/L`, `mmol/L`) units | Mixed laboratory reporting standards across hospitals | Explicit unit selectors on every input; zero silent unit assumptions; normalized internal conversions verified by unit tests | Automated test Subtest 3, 6, 8, 9 |
| **HAZ-03** | Misinterpreting FeNa < 1% as definitive prerenal AKI in diuretic-exposed or septic patients | Over-reliance on single urinary index | Prominent clinical limitation alert explaining diuretic confounding, FEUrea alternative, contrast/pigment nephropathy, and CKD salt wasting | Automated test Subtest 5–7 |
| **HAZ-04** | Confusing Urine Albumin-to-Creatinine Ratio (uACR) with Total Protein-to-Creatinine Ratio (uPCR) | Interchangeable entry of total protein and albumin | Mandatory analyte selector (`albumin` vs `protein`) with separate output labels (`uACR` vs `uPCR`) and non-interchangeability warning | Automated test Subtest 9 |
| **HAZ-05** | Silent alteration or loss of finalized clinical consultation notes | Overwriting database row on edit | Immutable `clinical_notes` version table; finalized notes require an explicit amendment reason and append `Version N+1` (`AMENDED`) | Automated test Subtest 13 |
| **HAZ-06** | Unvalidated universal cutoffs in renal biopsy pre-procedure checklist | Differing institutional coagulation/platelet thresholds and anticoagulant hold protocols | Checklist items avoid hardcoded universal cutoffs, require institutional protocol attribution, and record verifier identity + timestamp | Biopsy module & schema inspection |
| **HAZ-07** | AI hallucination or unreviewed AI text in patient records | Generative text model inventing findings or treatment orders | AI assistant disabled by default (`AI_ASSISTANT_ENABLED=false`), prohibited from generating orders, badged as generated, and gated by clinician sign-off | Settings & Consultation workflow |

## 5. Security, Privacy & Threat Model (STRIDE)

- **Spoofing & Authentication:** Production mode uses `HttpOnly; Secure; SameSite=Strict` session cookies (`__Host-nephrodesk_session`), Argon2id/bcrypt password hashing, MFA enforcement for clinicians (`MFA_REQUIRED_FOR_CLINICIANS=true`), and brute-force rate limiting (`AUTH_RATE_LIMIT_MAX_ATTEMPTS=5`).
- **Tampering & Injection:** Parameterized SQL queries, strict server-side payload validation (`validatePatientPayload`, `validateImportBundle`), and HTML output encoding (`escapeHtml`) verified against `<script>` injection in Subtest 14.
- **Information Disclosure & Privacy:**
  - Server-side RBAC restricts medical students (`STUDENT`) to synthetic or explicitly assigned records (verified in Subtest 12).
  - Security headers (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`) verified in Subtest 15.
  - Application and audit logs record actor ID, role, action, and resource ID while scrubbing identifiable patient names, dates of birth, and clinical notes.
- **Regulatory & Jurisdictional Notice (HIPAA / GDPR / Algerian Law No. 18-07):** Technical security controls do not automatically confer legal compliance. Before processing real patient health data in Algeria (Law No. 18-07 relating to the protection of individuals in the processing of personal data, overseen by the ANPDP), the European Union (GDPR Art. 9 & EU MDR 2017/745), or the United States (HIPAA Security & Privacy Rules), the deploying healthcare institution must complete a formal Data Protection Impact Assessment (DPIA), execute Business Associate / Data Processing Agreements, and obtain formal regulatory/institutional authorization.

## 6. How to Launch & Set Up Everything on GitHub for Free ($0/Month)

The `nephrodesk-ai-pro-fullstack.zip` archive is pre-configured with three zero-cost GitHub workflows:

### Step 1: Push the Repository to GitHub
1. Extract `nephrodesk-ai-pro-fullstack.zip` on your computer.
2. Create a new repository on [GitHub](https://github.com/new) named `nephrodesk-ai-pro` (keep it **Public** if you want unlimited free GitHub Actions minutes and free GitHub Pages hosting on the standard free plan, and never commit real patient data).
3. Run these commands inside the extracted `nephrodesk-ai-pro-fullstack` folder:
```bash
git init
git branch -M main
git add .
git commit -m "Initial release of NephroDesk AI Pro v1.0.0-rc.1"
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/nephrodesk-ai-pro.git
git push -u origin main
```

### Step 2: Enable Free Hosting & CI on GitHub Pages (Automatic via `.github/workflows/ci-and-pages.yml`)
1. In your GitHub repository, click **Settings** -> **Pages** (in the left sidebar).
2. Under **Build and deployment** -> **Source**, select **GitHub Actions**.
3. On every push to `main`, the included workflow (`.github/workflows/ci-and-pages.yml`) automatically:
   - Boots an Ubuntu runner on [GitHub Actions](https://docs.github.com/en/actions),
   - Runs all **16 automated clinical unit, RBAC, and security tests** (`node --test tests/run_all_tests.js`),
   - Deploys the bilingual WebApp (`public/index.html`) to `https://<YOUR_GITHUB_USERNAME>.github.io/nephrodesk-ai-pro/` with free HTTPS.

### Step 3: Run the Full-Stack Server Inside GitHub Codespaces for Free (Zero Local Setup)
1. Your repository includes `.devcontainer/devcontainer.json` for [GitHub Codespaces](https://docs.github.com/en/codespaces/overview) (every personal GitHub account includes **120 core-hours / 60 hours per month of 2-core Codespaces for free**).
2. On your GitHub repository page, click the green **<> Code** button -> **Codespaces** tab -> **Create codespace on main**.
3. Codespaces automatically runs `npm test` and starts `npm start` (`node src/server/index.js`) on port `8080`, opening a live browser preview serving both the full bilingual WebApp (`/`) and the REST API (`/api/v1/health`, `/api/v1/calculators/*`).

### Step 4: Deploy the Full-Stack Backend + Free PostgreSQL Database (Render + Neon Free Tier)
To keep the Node.js API and PostgreSQL database online 24/7 outside of Codespaces for $0/month:
1. **Free Serverless PostgreSQL ([Neon](https://neon.tech/docs/introduction))**:
   - Sign in to Neon using your GitHub account and create a free project (`nephrodesk-db`).
   - Copy the PostgreSQL connection string (`postgresql://...`) from the Neon dashboard.
   - Open the Neon **SQL Editor** and paste the contents of `src/database/migrations/001_initial_schema.sql` followed by `src/database/seed/seed_synthetic.sql` to initialize all 20 normalized tables and synthetic demo records.
2. **Free Node.js Web Service ([Render](https://render.com/docs/free))**:
   - Sign in to Render using your GitHub account, click **New +** -> **Blueprint**, and select your `nephrodesk-ai-pro` repository.
   - Render automatically detects the included `render.yaml` file, runs `npm test` during build, and launches `node src/server/index.js` on the Free plan.
   - Paste your Neon connection string into the `DATABASE_URL` environment variable in Render. Your full-stack app and REST API will be live at `https://nephrodesk-ai-pro.onrender.com`.

## 7. Release Report & Acceptance Criteria Status

| Verification Category | Status | Evidence Summary |
| :--- | :--- | :--- |
| **Automated Test Suite (`node --test`)** | **PASSED (16 / 16)** | All 16 unit, reference-case calculation, unit conversion, RBAC, consultation amendment, XSS, import/export, and HTTP header tests passed with 0 failures |
| **WebApp JavaScript Syntax Check (`node --check`)** | **PASSED (0 errors)** | Extracted 187 KB script validated via `node --check` |
| **Bilingual FR / EN Interface** | **COMPLETE** | Full instant switching across all 11 modules, forms, calculators, references, biopsy checklist, and printable reports |
| **Free GitHub Deployment Readiness** | **COMPLETE** | Includes `.github/workflows/ci-and-pages.yml`, `.devcontainer/devcontainer.json`, `render.yaml`, and `.gitignore` |
