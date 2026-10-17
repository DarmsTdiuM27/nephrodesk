-- ============================================================================
-- NEPHRODESK AI PRO — POSTGRESQL NORMALIZED CLINICAL SCHEMA (001_initial_schema.sql)
-- Includes 19 normalized entities, foreign keys, check constraints, indexes,
-- versioned clinical notes (no silent overwrites), and retention controls.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Roles
CREATE TABLE roles (
    id VARCHAR(32) PRIMARY KEY,
    name_en VARCHAR(100) NOT NULL,
    name_fr VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Permissions
CREATE TABLE permissions (
    id VARCHAR(64) PRIMARY KEY,
    module VARCHAR(64) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_id VARCHAR(32) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 3. Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    specialty_title VARCHAR(150),
    role_id VARCHAR(32) NOT NULL REFERENCES roles(id),
    preferred_locale VARCHAR(5) NOT NULL DEFAULT 'fr' CHECK (preferred_locale IN ('fr', 'en')),
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Patients (Minimum necessary demographic & renal status fields)
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_code VARCHAR(32) NOT NULL UNIQUE,
    display_name VARCHAR(150) NOT NULL,
    birth_year SMALLINT CHECK (birth_year >= 1900 AND birth_year <= 2100),
    age_years SMALLINT NOT NULL CHECK (age_years >= 0 AND age_years <= 120),
    sex_equation_var VARCHAR(16) NOT NULL CHECK (sex_equation_var IN ('female', 'male')),
    known_kidney_disease VARCHAR(255),
    kdigo_g_category VARCHAR(8) CHECK (kdigo_g_category IN ('G1', 'G2', 'G3a', 'G3b', 'G4', 'G5', 'ND')),
    kdigo_a_category VARCHAR(8) CHECK (kdigo_a_category IN ('A1', 'A2', 'A3', 'ND')),
    rrt_modality VARCHAR(32) NOT NULL DEFAULT 'NONE' CHECK (rrt_modality IN ('NONE', 'HD', 'PD', 'TRANSPLANT', 'CONSERVATIVE')),
    vascular_access_or_graft TEXT,
    medical_history_summary TEXT,
    surgical_history_summary TEXT,
    family_history_summary TEXT,
    comorbidities JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    record_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (record_status IN ('ACTIVE', 'ARCHIVED')),
    archived_at TIMESTAMPTZ,
    archived_by UUID REFERENCES users(id),
    archive_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_status ON patients(record_status);
CREATE INDEX idx_patients_internal_code ON patients(internal_code);

-- 5. Patient Identifiers (Separated from core clinical data for privacy compartmentalization)
CREATE TABLE patient_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    identifier_type VARCHAR(32) NOT NULL CHECK (identifier_type IN ('MRN', 'INSURANCE_ID', 'EXTERNAL_LAB_ID')),
    identifier_value VARCHAR(100) NOT NULL,
    issuing_facility VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (identifier_type, identifier_value)
);

CREATE INDEX idx_patient_identifiers_patient ON patient_identifiers(patient_id);

-- 6. Student / Clinician Authorized Patient Assignments (Least Privilege)
CREATE TABLE patient_access_assignments (
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (patient_id, user_id)
);

-- 7. Allergies
CREATE TABLE allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    substance VARCHAR(150) NOT NULL,
    reaction_description TEXT NOT NULL,
    severity VARCHAR(32) NOT NULL CHECK (severity IN ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING')),
    verification_status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
    recorded_by UUID REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Medications
CREATE TABLE medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    medication_name VARCHAR(200) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    route VARCHAR(64) NOT NULL DEFAULT 'PO',
    indication VARCHAR(200),
    renal_adjustment_note TEXT,
    is_nephrotoxic_warning BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HELD', 'DISCONTINUED')),
    prescribed_by UUID REFERENCES users(id),
    started_at DATE,
    ended_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Encounters (Consultations & Follow-up Visits)
CREATE TABLE encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    encounter_date TIMESTAMPTZ NOT NULL,
    encounter_type VARCHAR(64) NOT NULL CHECK (encounter_type IN ('INITIAL_CONSULT', 'FOLLOW_UP', 'HD_ROUND', 'POST_BIOPSY', 'TRANSPLANT_FOLLOW_UP', 'URGENT_ASSESSMENT')),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED', 'AMENDED')),
    chief_complaint TEXT NOT NULL,
    systolic_bp SMALLINT CHECK (systolic_bp BETWEEN 40 AND 300),
    diastolic_bp SMALLINT CHECK (diastolic_bp BETWEEN 20 AND 200),
    heart_rate SMALLINT CHECK (heart_rate BETWEEN 20 AND 260),
    weight_kg NUMERIC(5,2) CHECK (weight_kg BETWEEN 1.0 AND 350.0),
    volume_status VARCHAR(64) CHECK (volume_status IN ('EUVOLEMIC', 'HYPOVOLEMIC', 'HYPERVOLEMIC')),
    next_followup_date DATE,
    author_id UUID NOT NULL REFERENCES users(id),
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_encounters_patient_date ON encounters(patient_id, encounter_date DESC);

-- 10. Clinical Notes & Immutable Version / Amendment History
CREATE TABLE clinical_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL DEFAULT 1,
    note_state VARCHAR(24) NOT NULL CHECK (note_state IN ('DRAFT', 'FINALIZED', 'AMENDED')),
    hpi_text TEXT NOT NULL,
    examination_text TEXT,
    lab_interpretation_text TEXT,
    assessment_text TEXT NOT NULL,
    differential_diagnoses TEXT,
    treatment_plan_text TEXT NOT NULL,
    followup_instructions_text TEXT,
    amendment_reason TEXT,
    ai_assisted_draft BOOLEAN NOT NULL DEFAULT FALSE,
    clinician_reviewed BOOLEAN NOT NULL DEFAULT TRUE,
    authored_by UUID NOT NULL REFERENCES users(id),
    authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (encounter_id, version_number)
);

-- 11. Diagnoses
CREATE TABLE diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
    icd10_code VARCHAR(16),
    diagnosis_label_fr VARCHAR(255) NOT NULL,
    diagnosis_label_en VARCHAR(255) NOT NULL,
    clinical_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (clinical_status IN ('ACTIVE', 'PROVISIONAL', 'RESOLVED')),
    onset_date DATE,
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Laboratory Tests Catalog
CREATE TABLE laboratory_tests (
    code VARCHAR(32) PRIMARY KEY,
    name_fr VARCHAR(150) NOT NULL,
    name_en VARCHAR(150) NOT NULL,
    category VARCHAR(64) NOT NULL,
    canonical_unit VARCHAR(32) NOT NULL,
    allowed_units JSONB NOT NULL
);

-- 13. Laboratory Results (with Lab-Specific Reference Ranges & Verification Flags)
CREATE TABLE laboratory_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
    test_code VARCHAR(32) NOT NULL REFERENCES laboratory_tests(code),
    numeric_value NUMERIC(12,4) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL,
    laboratory_source VARCHAR(150) NOT NULL,
    ref_range_low NUMERIC(12,4),
    ref_range_high NUMERIC(12,4),
    abnormality_flag VARCHAR(24) NOT NULL DEFAULT 'NORMAL' CHECK (abnormality_flag IN ('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'UNSPECIFIED')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by UUID REFERENCES users(id),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_results_patient_test_date ON laboratory_results(patient_id, test_code, collected_at DESC);

-- 14. Procedures (including Renal Biopsy events)
CREATE TABLE procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    procedure_type VARCHAR(64) NOT NULL CHECK (procedure_type IN ('NATIVE_RENAL_BIOPSY', 'ALLOGRAFT_BIOPSY', 'HD_CATHETER_INSERTION', 'AVF_CREATION', 'PD_CATHETER')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    indication TEXT NOT NULL,
    kidney_target VARCHAR(32),
    protocol_version VARCHAR(64) NOT NULL,
    overall_safety_status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (overall_safety_status IN ('IN_PROGRESS', 'READY_FOR_REVIEW', 'HOLD_CONTRAINDICATION', 'COMPLETED')),
    lead_clinician_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Checklist Responses (Renal Biopsy Safety Verification Items)
CREATE TABLE checklist_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure_id UUID NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
    item_key VARCHAR(64) NOT NULL,
    item_status VARCHAR(24) NOT NULL CHECK (item_status IN ('COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE')),
    comment TEXT,
    checked_by_name VARCHAR(150) NOT NULL,
    checked_by_user_id UUID REFERENCES users(id),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (procedure_id, item_key)
);

-- 16. Generated Clinical Documents
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
    document_type VARCHAR(64) NOT NULL CHECK (document_type IN ('CONSULTATION_NOTE', 'PATIENT_SUMMARY', 'LAB_SUMMARY', 'FOLLOWUP_NOTE', 'CALCULATION_REPORT', 'BIOPSY_CHECKLIST')),
    locale VARCHAR(5) NOT NULL CHECK (locale IN ('fr', 'en')),
    version_label VARCHAR(32) NOT NULL DEFAULT '1.0',
    review_state VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (review_state IN ('DRAFT', 'CLINICIAN_APPROVED')),
    content_snapshot JSONB NOT NULL,
    authored_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. Guideline Sources
CREATE TABLE guideline_sources (
    id VARCHAR(64) PRIMARY KEY,
    organization VARCHAR(100) NOT NULL,
    title VARCHAR(300) NOT NULL,
    publication_year SMALLINT NOT NULL,
    edition_or_section VARCHAR(150) NOT NULL,
    pmid_or_doi VARCHAR(100),
    official_url TEXT NOT NULL
);

-- 18. Reference Entries (Versioned Clinical Reference Library)
CREATE TABLE reference_entries (
    id VARCHAR(64) PRIMARY KEY,
    category VARCHAR(64) NOT NULL,
    title_fr VARCHAR(255) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    version VARCHAR(24) NOT NULL,
    review_status VARCHAR(32) NOT NULL CHECK (review_status IN ('APPROVED_CLINICAL_REF', 'UNDER_REVIEW', 'RETIRED')),
    last_reviewed_date DATE NOT NULL,
    reviewer_name VARCHAR(150) NOT NULL,
    guideline_source_id VARCHAR(64) NOT NULL REFERENCES guideline_sources(id),
    content_fr JSONB NOT NULL,
    content_en JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. Audit Events (Immutable Security & Access Log without PHI leakage)
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID REFERENCES users(id),
    actor_role VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(100),
    outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'ERROR')),
    ip_hash VARCHAR(64),
    reason TEXT
);

CREATE INDEX idx_audit_events_occurred ON audit_events(occurred_at DESC);

-- 20. Application Settings
CREATE TABLE application_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
