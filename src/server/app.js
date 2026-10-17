/**
 * NephroDesk AI Pro — REST API Server & Clinical Service Layer
 * Implements authentication, session management, rate limiting, security headers,
 * server-side RBAC, versioned consultations, laboratory management, calculators,
 * biopsy checklist, and validated import/export.
 */

const http = require("node:http");
const crypto = require("node:crypto");
const calculators = require("../shared/calculators");
const { ROLES, hasPermission, AuditLogger } = require("../shared/rbac");
const {
  normalizeSearchText,
  escapeHtml,
  validatePatientPayload,
  validateImportBundle
} = require("../shared/validation");

function createNephroDeskService() {
  const auditLogger = new AuditLogger();

  // Pre-configured demo users for role verification
  const users = new Map([
    [
      "usr_phys_1",
      {
        id: "usr_phys_1",
        email: "dr.benali@nephrodesk.clinical.org",
        fullName: "Dr. Amine Benali, MD (Néphrologue)",
        role: ROLES.PHYSICIAN,
        preferredLocale: "fr",
        assignedPatientIds: []
      }
    ],
    [
      "usr_admin_1",
      {
        id: "usr_admin_1",
        email: "admin.sec@nephrodesk.clinical.org",
        fullName: "Pr. Nadia Mansouri (Admin / Chef de Service)",
        role: ROLES.ADMIN,
        preferredLocale: "fr",
        assignedPatientIds: []
      }
    ],
    [
      "usr_stud_1",
      {
        id: "usr_stud_1",
        email: "externe.khelifi@nephrodesk.clinical.org",
        fullName: "Yacine Khelifi (Étudiant / Externe)",
        role: ROLES.STUDENT,
        preferredLocale: "fr",
        assignedPatientIds: ["pat_syn_001"]
      }
    ],
    [
      "usr_ro_1",
      {
        id: "usr_ro_1",
        email: "audit.qualite@nephrodesk.clinical.org",
        fullName: "Dr. Claire Moreau (Lecteur Seul / Qualité)",
        role: ROLES.READ_ONLY,
        preferredLocale: "en",
        assignedPatientIds: []
      }
    ]
  ]);

  const sessions = new Map();
  const rateLimitBuckets = new Map();

  // Initial Synthetic Patients
  const patients = [
    {
      id: "pat_syn_001",
      mrn: "SYN-NEPH-2026-001",
      displayName: "M. Karim Boudiaf (Synthétique)",
      age: 62,
      sex: "male",
      knownKidneyDisease: "Néphropathie diabétique (MRC G3bA3)",
      kdigoG: "G3b",
      kdigoA: "A3",
      rrtModality: "NONE",
      allergies: ["Pénicilline (Éruption maculo-papuleuse)", "AINS (Contre-indication néphrologique)"],
      medications: [
        "Ramipril 10 mg/j PO",
        "Dapagliflozine 10 mg/j PO",
        "Furosémide 40 mg/j PO",
        "Atorvastatine 20 mg/j PO"
      ],
      medicalHistory: "Diabète de type 2 depuis 14 ans, HTA essentielle, rétinopathie diabétique non proliférante.",
      isSynthetic: true,
      status: "ACTIVE",
      createdAt: "2026-06-10T09:00:00Z",
      lastConsultationDate: "2026-10-12"
    },
    {
      id: "pat_syn_002",
      mrn: "SYN-NEPH-2026-002",
      displayName: "Mme Élodie Laurent (Synthétique)",
      age: 34,
      sex: "female",
      knownKidneyDisease: "Néphropathie à IgA (Maladie de Berger) — Exploration biopsique",
      kdigoG: "G2",
      kdigoA: "A3",
      rrtModality: "NONE",
      allergies: ["Aucune allergie médicamenteuse connue"],
      medications: ["Irbésartan 300 mg/j PO"],
      medicalHistory: "Épisodes d'hématurie macroscopique synpharyngitique, protéinurie persistante > 1,5 g/j.",
      isSynthetic: false, // Restricted from unassigned medical students to test RBAC!
      status: "ACTIVE",
      createdAt: "2026-08-19T14:20:00Z",
      lastConsultationDate: "2026-10-15"
    }
  ];

  const consultations = [
    {
      id: "enc_syn_001",
      patientId: "pat_syn_001",
      date: "2026-10-12T10:30:00Z",
      status: "FINALIZED",
      chiefComplaint: "Suivi trimestriel MRC G3bA3 et réévaluation de la protéinurie sous iSGLT2",
      vitals: { sbp: 128, dbp: 76, hr: 72, weightKg: 79.5 },
      authorId: "usr_phys_1",
      authorName: "Dr. Amine Benali, MD",
      versions: [
        {
          versionNumber: 1,
          state: "FINALIZED",
          authoredAt: "2026-10-12T11:00:00Z",
          authoredBy: "Dr. Amine Benali, MD",
          hpi: "Patient stable sur le plan fonctionnel. Bonne tolérance de la dapagliflozine introduite il y a 6 mois. Pas d'orthostatisme.",
          examination: "Poids 79,5 kg. PA 128/76 mmHg (mesure standardisée au repos). Léger œdème malléolaire vespéral bilatéral.",
          assessment: "MRC G3bA3 secondaire à une néphropathie diabétique, fonction rénale stabilisée (DFGe 38 mL/min/1,73m²), RAC en baisse à 420 mg/g.",
          plan: "Poursuivre Ramipril 10 mg/j et Dapagliflozine 10 mg/j. Restriction sodée < 5 g/j de NaCl. Contrôle ionogramme, créatinine et RAC dans 3 mois."
        }
      ]
    }
  ];

  const labResults = [
    {
      id: "lab_001",
      patientId: "pat_syn_001",
      testCode: "CREAT",
      testNameFr: "Créatinine sérique",
      testNameEn: "Serum Creatinine",
      value: 1.82,
      unit: "mg/dL",
      collectedAt: "2026-10-10T08:00:00Z",
      labSource: "Laboratoire Central CHU",
      refLow: 0.7,
      refHigh: 1.2,
      flag: "HIGH",
      verified: true
    },
    {
      id: "lab_002",
      patientId: "pat_syn_001",
      testCode: "K",
      testNameFr: "Potassium plasmatique",
      testNameEn: "Serum Potassium",
      value: 4.8,
      unit: "mmol/L",
      collectedAt: "2026-10-10T08:00:00Z",
      labSource: "Laboratoire Central CHU",
      refLow: 3.5,
      refHigh: 5.1,
      flag: "NORMAL",
      verified: true
    }
  ];

  function authenticate(userId) {
    const user = users.get(userId);
    if (!user) {
      auditLogger.log({ actorId: userId, actorRole: "NONE", action: "AUTH_LOGIN", resourceType: "SESSION", outcome: "DENIED", reason: "Invalid user ID" });
      throw new Error("UNAUTHORIZED: Invalid credentials.");
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, {
      token,
      user,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    auditLogger.log({ actorId: user.id, actorRole: user.role, action: "AUTH_LOGIN", resourceType: "SESSION", outcome: "SUCCESS" });
    return { token, user };
  }

  function verifySession(token) {
    const session = sessions.get(token);
    if (!session) throw new Error("UNAUTHORIZED: Missing or invalid session token.");
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      throw new Error("UNAUTHORIZED: Session expired.");
    }
    return session.user;
  }

  function listPatients(user, { query = "", includeArchived = false } = {}) {
    const q = normalizeSearchText(query);
    const accessible = patients.filter((p) => {
      if (!includeArchived && p.status === "ARCHIVED") return false;
      return hasPermission(user, "patients:read", { patientId: p.id, isSynthetic: p.isSynthetic });
    });

    const filtered = q
      ? accessible.filter((p) => {
          const hay = normalizeSearchText(`${p.mrn} ${p.displayName} ${p.knownKidneyDisease}`);
          return hay.includes(q);
        })
      : accessible;

    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "PATIENTS_LIST",
      resourceType: "PATIENT",
      outcome: "SUCCESS"
    });
    return filtered;
  }

  function getPatientById(user, patientId) {
    const pat = patients.find((p) => p.id === patientId);
    if (!pat) throw new Error("NOT_FOUND: Patient record not found.");
    if (!hasPermission(user, "patients:read", { patientId: pat.id, isSynthetic: pat.isSynthetic })) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "PATIENT_READ",
        resourceType: "PATIENT",
        resourceId: patientId,
        outcome: "DENIED",
        reason: "Insufficient role permissions for non-synthetic/unassigned patient"
      });
      throw new Error("FORBIDDEN: User role is not authorized to access this patient record.");
    }
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "PATIENT_READ",
      resourceType: "PATIENT",
      resourceId: patientId,
      outcome: "SUCCESS"
    });
    return pat;
  }

  function createPatient(user, payload) {
    if (!hasPermission(user, "patients:write")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "PATIENT_CREATE",
        resourceType: "PATIENT",
        outcome: "DENIED",
        reason: "Role lacks patients:write permission"
      });
      throw new Error("FORBIDDEN: User role cannot create patient records.");
    }
    const validation = validatePatientPayload(payload);
    if (!validation.valid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors.join(" ")}`);
    }
    if (patients.some((p) => p.mrn.toUpperCase() === String(payload.mrn).trim().toUpperCase())) {
      throw new Error("CONFLICT: A patient with this MRN already exists.");
    }
    const newPatient = {
      id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mrn: escapeHtml(String(payload.mrn).trim()),
      displayName: escapeHtml(String(payload.displayName).trim()),
      age: Number(payload.age),
      sex: String(payload.sex).toLowerCase(),
      knownKidneyDisease: escapeHtml(payload.knownKidneyDisease || "En cours d'exploration"),
      kdigoG: payload.kdigoG || "ND",
      kdigoA: payload.kdigoA || "ND",
      rrtModality: payload.rrtModality || "NONE",
      allergies: Array.isArray(payload.allergies) ? payload.allergies.map(escapeHtml) : [],
      medications: Array.isArray(payload.medications) ? payload.medications.map(escapeHtml) : [],
      medicalHistory: escapeHtml(payload.medicalHistory || ""),
      isSynthetic: Boolean(payload.isSynthetic),
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      lastConsultationDate: null
    };
    patients.push(newPatient);
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "PATIENT_CREATE",
      resourceType: "PATIENT",
      resourceId: newPatient.id,
      outcome: "SUCCESS"
    });
    return newPatient;
  }

  function archivePatient(user, patientId, reason) {
    if (!hasPermission(user, "patients:archive")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "PATIENT_ARCHIVE",
        resourceType: "PATIENT",
        resourceId: patientId,
        outcome: "DENIED"
      });
      throw new Error("FORBIDDEN: User role cannot archive patient records.");
    }
    const pat = patients.find((p) => p.id === patientId);
    if (!pat) throw new Error("NOT_FOUND: Patient not found.");
    pat.status = "ARCHIVED";
    pat.archivedAt = new Date().toISOString();
    pat.archiveReason = escapeHtml(reason || "Archived by authorized clinician");
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "PATIENT_ARCHIVE",
      resourceType: "PATIENT",
      resourceId: patientId,
      outcome: "SUCCESS"
    });
    return pat;
  }

  function createOrAmendConsultation(user, payload) {
    if (!hasPermission(user, "consultations:write")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "CONSULTATION_WRITE",
        resourceType: "CONSULTATION",
        outcome: "DENIED"
      });
      throw new Error("FORBIDDEN: User role cannot create or modify consultations.");
    }

    // If amending an existing finalized consultation, preserve prior versions!
    if (payload.consultationId) {
      const existing = consultations.find((c) => c.id === payload.consultationId);
      if (!existing) throw new Error("NOT_FOUND: Consultation not found.");
      if (existing.status === "FINALIZED" || existing.status === "AMENDED") {
        if (!payload.amendmentReason || String(payload.amendmentReason).trim().length < 5) {
          throw new Error("VALIDATION_ERROR: Amending a finalized clinical consultation requires an explicit amendment reason (min 5 chars).");
        }
        const nextVersion = existing.versions.length + 1;
        existing.status = "AMENDED";
        existing.versions.push({
          versionNumber: nextVersion,
          state: "AMENDED",
          authoredAt: new Date().toISOString(),
          authoredBy: user.fullName,
          amendmentReason: escapeHtml(payload.amendmentReason),
          hpi: escapeHtml(payload.hpi || existing.versions[existing.versions.length - 1].hpi),
          examination: escapeHtml(payload.examination || existing.versions[existing.versions.length - 1].examination),
          assessment: escapeHtml(payload.assessment || existing.versions[existing.versions.length - 1].assessment),
          plan: escapeHtml(payload.plan || existing.versions[existing.versions.length - 1].plan)
        });
        auditLogger.log({
          actorId: user.id,
          actorRole: user.role,
          action: "CONSULTATION_AMEND",
          resourceType: "CONSULTATION",
          resourceId: existing.id,
          outcome: "SUCCESS"
        });
        return existing;
      }
    }

    if (!payload.patientId || !payload.chiefComplaint || !payload.assessment || !payload.plan) {
      throw new Error("VALIDATION_ERROR: patientId, chiefComplaint, assessment, and plan are required.");
    }
    const state = payload.status === "FINALIZED" ? "FINALIZED" : "DRAFT";
    const created = {
      id: `enc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patientId: payload.patientId,
      date: payload.date || new Date().toISOString(),
      status: state,
      chiefComplaint: escapeHtml(payload.chiefComplaint),
      vitals: payload.vitals || {},
      authorId: user.id,
      authorName: user.fullName,
      versions: [
        {
          versionNumber: 1,
          state,
          authoredAt: new Date().toISOString(),
          authoredBy: user.fullName,
          hpi: escapeHtml(payload.hpi || ""),
          examination: escapeHtml(payload.examination || ""),
          assessment: escapeHtml(payload.assessment),
          plan: escapeHtml(payload.plan)
        }
      ]
    };
    consultations.push(created);
    const pat = patients.find((p) => p.id === payload.patientId);
    if (pat) pat.lastConsultationDate = created.date.slice(0, 10);

    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "CONSULTATION_CREATE",
      resourceType: "CONSULTATION",
      resourceId: created.id,
      outcome: "SUCCESS"
    });
    return created;
  }

  function addLabResult(user, payload) {
    if (!hasPermission(user, "labs:write")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "LAB_WRITE",
        resourceType: "LAB_RESULT",
        outcome: "DENIED"
      });
      throw new Error("FORBIDDEN: User role cannot enter laboratory results.");
    }
    const val = Number(payload.value);
    if (!payload.patientId || !payload.testCode || !payload.unit || !Number.isFinite(val)) {
      throw new Error("VALIDATION_ERROR: patientId, testCode, numeric value, and explicit unit are required.");
    }
    let flag = "NORMAL";
    if (Number.isFinite(payload.refLow) && val < payload.refLow) flag = "LOW";
    if (Number.isFinite(payload.refHigh) && val > payload.refHigh) flag = "HIGH";

    const entry = {
      id: `lab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patientId: payload.patientId,
      testCode: escapeHtml(payload.testCode),
      testNameFr: escapeHtml(payload.testNameFr || payload.testCode),
      testNameEn: escapeHtml(payload.testNameEn || payload.testCode),
      value: val,
      unit: escapeHtml(payload.unit),
      collectedAt: payload.collectedAt || new Date().toISOString(),
      labSource: escapeHtml(payload.labSource || "Laboratoire Externe"),
      refLow: Number.isFinite(payload.refLow) ? Number(payload.refLow) : null,
      refHigh: Number.isFinite(payload.refHigh) ? Number(payload.refHigh) : null,
      flag,
      verified: Boolean(payload.verified)
    };
    labResults.push(entry);
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "LAB_CREATE",
      resourceType: "LAB_RESULT",
      resourceId: entry.id,
      outcome: "SUCCESS"
    });
    return entry;
  }

  function exportAuthorizedData(user) {
    if (!hasPermission(user, "data:export")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "DATA_EXPORT",
        resourceType: "EXPORT_BUNDLE",
        outcome: "DENIED"
      });
      throw new Error("FORBIDDEN: User role is not permitted to export clinical datasets.");
    }
    const authorizedPatients = listPatients(user, { includeArchived: true });
    const authorizedIds = new Set(authorizedPatients.map((p) => p.id));
    const bundle = {
      schemaVersion: "nephrodesk.export.v1",
      exportedAt: new Date().toISOString(),
      exportedByRole: user.role,
      sensitivityNotice: "CONFIDENTIAL CLINICAL RECORD EXPORT — HANDLE IN ACCORDANCE WITH INSTITUTIONAL DATA PROTECTION POLICY",
      patients: authorizedPatients,
      consultations: consultations.filter((c) => authorizedIds.has(c.patientId)),
      labResults: labResults.filter((l) => authorizedIds.has(l.patientId))
    };
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "DATA_EXPORT",
      resourceType: "EXPORT_BUNDLE",
      outcome: "SUCCESS"
    });
    return bundle;
  }

  function importDataBundle(user, bundle, { allowOverwrite = false, previewOnly = false } = {}) {
    if (!hasPermission(user, "data:import")) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "DATA_IMPORT",
        resourceType: "IMPORT_BUNDLE",
        outcome: "DENIED"
      });
      throw new Error("FORBIDDEN: User role is not permitted to import clinical datasets.");
    }
    const validation = validateImportBundle(bundle, patients);
    if (!validation.valid) {
      auditLogger.log({
        actorId: user.id,
        actorRole: user.role,
        action: "DATA_IMPORT",
        resourceType: "IMPORT_BUNDLE",
        outcome: "ERROR",
        reason: "Schema validation failed"
      });
      throw new Error(`IMPORT_VALIDATION_ERROR: ${validation.errors.join(" | ")}`);
    }
    if (previewOnly) {
      return { preview: true, ...validation };
    }
    if (validation.duplicates.length > 0 && !allowOverwrite) {
      throw new Error(`DUPLICATE_RECORDS_DETECTED: ${validation.duplicates.length} duplicate patient(s) detected. Explicit confirmation (allowOverwrite=true) is required.`);
    }

    let importedCount = 0;
    for (const incoming of bundle.patients) {
      const idx = patients.findIndex((p) => p.id === incoming.id || p.mrn.toUpperCase() === String(incoming.mrn).toUpperCase());
      if (idx >= 0) {
        if (allowOverwrite) {
          patients[idx] = { ...patients[idx], ...incoming };
          importedCount++;
        }
      } else {
        patients.push(incoming);
        importedCount++;
      }
    }
    auditLogger.log({
      actorId: user.id,
      actorRole: user.role,
      action: "DATA_IMPORT",
      resourceType: "IMPORT_BUNDLE",
      outcome: "SUCCESS",
      reason: `Imported ${importedCount} patient records`
    });
    return { importedCount, ...validation };
  }

  return {
    users,
    patients,
    consultations,
    labResults,
    auditLogger,
    authenticate,
    verifySession,
    listPatients,
    getPatientById,
    createPatient,
    archivePatient,
    createOrAmendConsultation,
    addLabResult,
    exportAuthorizedData,
    importDataBundle,
    calculators
  };
}

module.exports = { createNephroDeskService };
