-- ============================================================================
-- NEPHRODESK AI PRO — SYNTHETIC DEMONSTRATION SEED DATA (NON-IDENTIFIABLE)
-- ============================================================================
BEGIN;

INSERT INTO roles (id, name_en, name_fr, description) VALUES
  ('ADMIN', 'Administrator', 'Administrateur', 'System configuration, user management, and security audit review'),
  ('PHYSICIAN', 'Nephrologist / Resident', 'Néphrologue / Résident', 'Full authorized clinical record, consultation, lab, calculator, and biopsy access'),
  ('STUDENT', 'Medical Student', 'Étudiant en Médecine', 'Educational calculators, clinical references, and synthetic or assigned patient records'),
  ('READ_ONLY', 'Read-Only Clinician / Auditor', 'Lecteur Seul / Auditeur', 'Read-only access to authorized records without modification or export privileges')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guideline_sources (id, organization, title, publication_year, edition_or_section, pmid_or_doi, official_url) VALUES
  ('KDIGO_CKD_2024', 'KDIGO', 'KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease', 2024, 'Kidney Int 2024;105(4S):S117-S314 (Chapters 1-3)', 'PMID: 38490803', 'https://pubmed.ncbi.nlm.nih.gov/38490803/'),
  ('KDIGO_AKI_2012', 'KDIGO', 'KDIGO Clinical Practice Guideline for Acute Kidney Injury', 2012, 'Kidney Int Suppl 2012;2(1):1-138 (Section 2)', 'PMID: 25018915', 'https://kdigo.org/guidelines/acute-kidney-injury/'),
  ('KDIGO_GD_2021', 'KDIGO', 'KDIGO 2021 Clinical Practice Guideline for the Management of Glomerular Diseases', 2021, 'Kidney Int 2021;100(4S):S1-S276 (Chapters 1-11)', 'PMID: 34556256', 'https://pubmed.ncbi.nlm.nih.gov/34556256/'),
  ('KDIGO_BP_2021', 'KDIGO', 'KDIGO 2021 Clinical Practice Guideline for the Management of Blood Pressure in CKD', 2021, 'Kidney Int 2021;99(3S):S1-S87 (Chapters 1-3)', 'PMID: 33637192', 'https://pubmed.ncbi.nlm.nih.gov/33637192/'),
  ('INKER_NEJM_2021', 'CKD-EPI Collaboration', 'New Creatinine- and Cystatin C-Based Equations to Estimate GFR without Race', 2021, 'N Engl J Med 2021;385(19):1737-1749 (Table 2)', 'PMID: 34554658', 'https://pubmed.ncbi.nlm.nih.gov/34554658/')
ON CONFLICT (id) DO NOTHING;

COMMIT;
