# NephroDesk AI Pro — Technical Architecture, Clinical Calculation Validation & Safety Governance Dossier

**Product:** NephroDesk AI Pro — Assistant Clinique & Dossiers Néphrologiques  
**Subtitle (FR):** Assistant clinique et gestion des dossiers néphrologiques  
**Subtitle (EN):** Nephrology Clinical Assistant & Patient Record Management  
**Version:** `1.0.0-rc.1`

## 1. Phase 1 Source Inspection & Architectural Blueprint

An initial inspection of the workspace confirmed no legacy HTML source file was pre-loaded; consequently, **NephroDesk AI Pro** was architected and engineered from the ground up in two complementary, synchronized formats:

1. **Interactive Bilingual WebApp (`nephrodesk-ai-pro.html`)**: A complete, zero-dependency, WCAG 2.2 AA accessible single-file clinical workstation featuring all 11 clinical modules, instant French/English (`FR`/`EN`) localization, live RBAC role simulation (`PHYSICIAN`, `ADMIN`, `STUDENT`, `READ_ONLY`), SVG serial laboratory trend plotting, immutable consultation amendment trails, configurable renal biopsy checklists, print-ready clinical reports, and schema-validated JSON import/export.
2. **Full-Stack Production Repository (`nephrodesk-ai-pro-fullstack.zip`)**: A modular Node.js / TypeScript-ready / PostgreSQL architecture separating pure clinical calculation logic (`src/shared/calculators`), server-side RBAC and PHI-scrubbed audit logging (`src/shared/rbac`), payload and import schema validation (`src/shared/validation`), REST API controllers (`src/server`), normalized PostgreSQL migrations (`src/database/migrations/001_initial_schema.sql`), OpenAPI 3.1 specification (`openapi.yaml`), and automated verification tests (`tests/run_all_tests.js`).

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
| **CKD-EPI 2021 eGFRcr (Race-Free)** | $	ext{eGFR} = 142 	imes \min(	ext{SCr}/\kappa, 1)^lpha 	imes \max(	ext{SCr}/\kappa, 1)^{-1.200} 	imes 0.9938^{	ext{Age}} 	imes (1.012 	ext{ if female})$ where $\kappa = 0.7$ (F) or $0.9$ (M), $lpha = -0.241$ (F) or $-0.302$ (M); $1	ext{ mg/dL} = 88.4	ext{ }\mu	ext{mol/L}$ | [Inker LA et al., *N Engl J Med* 2021;385:1737-1749 (PMID: 34554658)](https://pubmed.ncbi.nlm.nih.gov/34554658/); [KDIGO 2024 CKD Guideline (PMID: 38490803)](https://pubmed.ncbi.nlm.nih.gov/38490803/) | • 50yo F, SCr $0.7	ext{ mg/dL} ightarrow \mathbf{105.3	ext{ mL/min/1.73m}^2}$ (G1)<br/>• 60yo M, SCr $0.9	ext{ mg/dL} ightarrow \mathbf{97.8	ext{ mL/min/1.73m}^2}$ (G1)<br/>• 65yo M, SCr $176.8	ext{ }\mu	ext{mol/L}$ ($2.0	ext{ mg/dL}$) $ightarrow \mathbf{36.4	ext{ mL/min/1.73m}^2}$ (G3b) |
| **Fractional Excretion of Sodium (FeNa)** | $	ext{FeNa (\%)} = 100 	imes rac{U_{	ext{Na}} 	imes P_{	ext{Cr}}}{P_{	ext{Na}} 	imes U_{	ext{Cr}}}$ after normalizing $P_{	ext{Cr}}$ and $U_{	ext{Cr}}$ to $	ext{mg/dL}$ ($1	ext{ mmol/L Cr} = 11.312	ext{ mg/dL}$) | [Espinel CH, *JAMA* 1976;236(6):579-581 (PMID: 947239)](https://pubmed.ncbi.nlm.nih.gov/947239/) | • $U_{	ext{Na}}=10$, $P_{	ext{Na}}=140$, $U_{	ext{Cr}}=100	ext{ mg/dL}$, $P_{	ext{Cr}}=2.0	ext{ mg/dL} ightarrow \mathbf{0.14\%}$<br/>• $U_{	ext{Na}}=45$, $P_{	ext{Na}}=138$, $U_{	ext{Cr}}=8.84	ext{ mmol/L}$, $P_{	ext{Cr}}=176.8	ext{ }\mu	ext{mol/L} ightarrow \mathbf{0.65\%}$ |
| **Serum Anion Gap & Figge Albumin Correction** | $	ext{AG} = [	ext{Na}^+] - ([	ext{Cl}^-] + [	ext{HCO}_3^-])$; $	ext{Corrected AG} = 	ext{AG} + 2.5 	imes (4.0 - 	ext{Albumin}_{	ext{g/dL}})$ (also reports original Figge $4.4	ext{ g/dL}$ reference variant; $1	ext{ g/dL} = 10	ext{ g/L}$) | [Figge J et al., *Crit Care Med* 1998;26(11):1807-1810 (PMID: 9824071)](https://pubmed.ncbi.nlm.nih.gov/9824071/) | • $	ext{Na}=140, 	ext{Cl}=104, 	ext{HCO}_3=18 ightarrow 	ext{Uncorrected AG} = \mathbf{18.0	ext{ mmol/L}}$<br/>• With $	ext{Albumin}=20	ext{ g/L}$ ($2.0	ext{ g/dL}$) $ightarrow 	ext{Corrected AG (4.0)} = \mathbf{23.0	ext{ mmol/L}}$, $	ext{Figge (4.4)} = \mathbf{24.0	ext{ mmol/L}}$ |
| **Urine ACR (uACR) & Urine PCR (uPCR)** | $	ext{Ratio (mg/g)} = rac{	ext{Urine Analyte (mg/dL)}}{	ext{Urine Creatinine (g/dL)}}$; $	ext{Ratio (mg/mmol)} = rac{	ext{Urine Analyte (mg/dL)}}{	ext{Urine Creatinine (mmol/dL)}}$ | [KDIGO 2024 CKD Guideline Chapter 1 (PMID: 38490803)](https://pubmed.ncbi.nlm.nih.gov/38490803/) | • Albumin $45	ext{ mg/dL}$, UCr $150	ext{ mg/dL} ightarrow 	ext{uACR} = \mathbf{300.0	ext{ mg/g}}$ ($33.94	ext{ mg/mmol}$, KDIGO A2)<br/>• Protein $1.2	ext{ g/L}$, UCr $1.0	ext{ g/L} ightarrow 	ext{uPCR} = \mathbf{1200.0	ext{ mg/g}}$ |
| **Cockcroft–Gault Creatinine Clearance** | $	ext{eCrCl (mL/min)} = rac{(140 - 	ext{Age}) 	imes 	ext{Weight (kg)}}{72 	imes 	ext{SCr (mg/dL)}} 	imes (0.85 	ext{ if female})$ | [Cockcroft DW, Gault MH, *Nephron* 1976;16:31-41 (PMID: 1244564)](https://pubmed.ncbi.nlm.nih.gov/1244564/) | • 70yo F, $65	ext{ kg}$, SCr $1.5	ext{ mg/dL} ightarrow \mathbf{35.8	ext{ mL/min}}$ |
| **Free-Water Deficit (Hypernatremia)** | $	ext{FWD (L)} = (	ext{Weight} 	imes f_{	ext{TBW}}) 	imes \left(rac{	ext{Measured Na}}{	ext{Target Na}} - 1ight)$ | [Adrogué HJ, Madias NE, *N Engl J Med* 2000;342:1493-1499](https://www.nejm.org/doi/full/10.1056/NEJM200005183422006) | • $70	ext{ kg}$, $f_{	ext{TBW}}=0.6$ ($	ext{TBW}=42	ext{ L}$), Na $158 ightarrow 140	ext{ mmol/L} ightarrow \mathbf{5.4	ext{ L}}$ |

## 4. Clinical Safety Plan & Risk Register

| Hazard ID | Clinical Hazard Description | Root Cause / Trigger | Implemented Software Mitigation | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **HAZ-01** | Inappropriate CKD diagnosis from a single eGFR value or during acute kidney injury | Clinician uses CKD-EPI 2021 during rapidly changing SCr (AKI) or without 3-month chronicity | Explicit warning banner on every CKD-EPI calculation; G-categories labeled strictly as *classification support* requiring $\ge 3$ months chronicity | Automated test Subtest 1–4 & UI inspection |
| **HAZ-02** | Unit mismatch between conventional ($	ext{mg/dL}$, $	ext{g/dL}$) and SI ($\mu	ext{mol/L}$, $	ext{g/L}$, $	ext{mmol/L}$) units | Mixed laboratory reporting standards across hospitals | Explicit unit selectors on every input; zero silent unit assumptions; normalized internal conversions verified by unit tests | Automated test Subtest 3, 6, 8, 9 |
| **HAZ-03** | Misinterpreting FeNa $<1\%$ as definitive prerenal AKI in diuretic-exposed or septic patients | Over-reliance on single urinary index | Prominent clinical limitation alert explaining diuretic confounding, FEUrea alternative, contrast/pigment nephropathy, and CKD salt wasting | Automated test Subtest 5–7 |
| **HAZ-04** | Confusing Urine Albumin-to-Creatinine Ratio (uACR) with Total Protein-to-Creatinine Ratio (uPCR) | Interchangeable entry of total protein and albumin | Mandatory analyte selector (`albumin` vs `protein`) with separate output labels (`uACR` vs `uPCR`) and non-interchangeability warning | Automated test Subtest 9 |
| **HAZ-05** | Silent alteration or loss of finalized clinical consultation notes | Overwriting database row on edit | Immutable `clinical_notes` version table; finalized notes require an explicit amendment reason and append `Version N+1` (`AMENDED`) | Automated test Subtest 13 |
| **HAZ-06** | Unvalidated universal cutoffs in renal biopsy pre-procedure checklist | Differing institutional coagulation/platelet thresholds and anticoagulant hold protocols | Checklist items avoid hardcoded universal cutoffs, require institutional protocol attribution, and record verifier identity + timestamp | Biopsy module & schema inspection |
| **HAZ-07** | AI hallucination or unreviewed AI text in patient records | Generative text model inventing findings or treatment orders | AI assistant disabled by default (`AI_ASSISTANT_ENABLED=false`), prohibited from generating orders, badged as generated, and gated by clinician sign-off | Settings & Consultation workflow |

## 5. Security, Privacy & Threat Model (STRIDE)

- **Spoofing & Authentication:** Production mode uses `HttpOnly; Secure; SameSite=Strict` session cookies (`__Host-nephrodesk_session`), Argon2id/bcrypt password hashing, MFA enforcement for clinicians (`MFA_REQUIRED_FOR_CLINICIANS=true`), and brute-force rate limiting (`AUTH_RATE_LIMIT_MAX_ATTEMPTS=5`).
- **Tampering & Injection:** Parameterized SQL queries, strict server-side payload validation (`validatePatientPayload`, `validateImportBundle`), and HTML output encoding (`escapeHtml`) verified against `<script>` injection in Subtest 14.
- **Information Disclosure & Privacy:**
  - Server-side RBAC restricts medical students (`STUDENT`) to synthetic or explicitly assigned records (verified in Subtest 12).
  - Security headers (`Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`) verified in Subtest 15.
  - Application and audit logs record actor ID, role, action, and resource ID while scrubbing identifiable patient names, dates of birth, and clinical notes.
- **Regulatory & Jurisdictional Notice (HIPAA / GDPR / Algerian Law No. 18-07):** Technical security controls do not automatically confer legal compliance. Before processing real patient health data in Algeria (Law No. 18-07 relating to the protection of individuals in the processing of personal data, overseen by the ANPDP), the European Union (GDPR Art. 9 & EU MDR 2017/745), or the United States (HIPAA Security & Privacy Rules), the deploying healthcare institution must complete a formal Data Protection Impact Assessment (DPIA), execute Business Associate / Data Processing Agreements, and obtain formal regulatory/institutional authorization.

## 6. Deployment, Backup, Restoration & Rollback Runbook

### 6.1 Local & Containerized Deployment
1. Configure environment variables in `.env` from `.env.example` (injecting production secrets from a dedicated secret manager such as HashiCorp Vault or AWS KMS).
2. Run `docker compose up --build -d` (which executes `node --test tests/run_all_tests.js` during the Docker build stage and starts PostgreSQL 15 + the non-root Node.js API container behind a TLS 1.3 reverse proxy).
3. Verify service health via `GET /api/v1/health`.

### 6.2 Production Encrypted Backups & Tested Restoration
- **Automated Backups:** Run nightly `pg_dump --format=custom` piped through envelope encryption (`aws kms` / `gpg --cipher-algo AES256`) to immutable object storage, plus continuous WAL archiving for Point-in-Time Recovery (PITR, RPO $< 15$ minutes, RTO $< 60$ minutes).
- **Quarterly Restoration Drill:** Restore encrypted snapshot into an isolated staging database (`pg_restore --clean --if-exists -d nephrodesk_restore_verify`), verify row counts and foreign-key integrity, and log the restoration drill in the governance register.
- **Rollback Strategy:** Application containers are tagged by immutable Git SHA. If post-deployment health checks fail, roll back traffic immediately to the previous container digest (`docker service rollback` or Kubernetes deployment rollback). Database migrations follow an expand-and-contract pattern so `N-1` application binaries remain compatible during rollback.

## 7. Release Report & Acceptance Criteria Status

| Verification Category | Status | Evidence Summary |
| :--- | :--- | :--- |
| **Automated Test Suite (`node --test`)** | **PASSED (16 / 16)** | All 16 unit, reference-case calculation, unit conversion, RBAC, consultation amendment, XSS, import/export, and HTTP header tests passed with 0 failures |
| **WebApp JavaScript Syntax Check (`node --check`)** | **PASSED (0 errors)** | Extracted 187 KB script validated via `node --check` |
| **Bilingual FR / EN Interface** | **COMPLETE** | Full instant switching across all 11 modules, forms, calculators, references, biopsy checklist, and printable reports |
| **Clinical Validation Status** | **PROTOTYPE VERIFIED / PENDING INSTITUTIONAL SIGN-OFF** | Mathematical equations verified against published literature; formal medical director sign-off required before clinical deployment |
| **Production Deployment Status** | **READY FOR STAGING DEPLOYMENT** | Packaged with `Dockerfile`, `docker-compose.yml`, `.env.example`, `openapi.yaml`, and PostgreSQL migrations |
