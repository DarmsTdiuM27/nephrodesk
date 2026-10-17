/**
 * NephroDesk AI Pro — Validation, Normalization & Safe Import/Export Utilities
 */

function normalizeSearchText(input) {
  if (input === null || input === undefined) return "";
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validatePatientPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Payload must be a JSON object."] };
  }
  if (!payload.mrn || String(payload.mrn).trim().length < 3) {
    errors.push("Medical Record Number (MRN) is required (min 3 chars).");
  }
  if (!payload.displayName || String(payload.displayName).trim().length < 2) {
    errors.push("Patient name or approved pseudonym is required (min 2 chars).");
  }
  const age = Number(payload.age);
  if (!Number.isFinite(age) || age < 0 || age > 120) {
    errors.push("Valid patient age (0–120) is required.");
  }
  if (!["female", "male"].includes(String(payload.sex || "").toLowerCase())) {
    errors.push("Sex variable required for clinical equations ('female' or 'male') must be specified.");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

function validateImportBundle(bundle, existingPatients = []) {
  const errors = [];
  if (!bundle || typeof bundle !== "object") {
    return { valid: false, errors: ["Import payload must be a valid JSON object."] };
  }
  if (bundle.schemaVersion !== "nephrodesk.export.v1") {
    errors.push(`Unsupported or missing schemaVersion: expected 'nephrodesk.export.v1', got '${bundle.schemaVersion}'.`);
  }
  if (!Array.isArray(bundle.patients)) {
    errors.push("Import bundle must contain a 'patients' array.");
  } else {
    bundle.patients.forEach((p, idx) => {
      const check = validatePatientPayload(p);
      if (!check.valid) {
        errors.push(`Patient[${idx}]: ${check.errors.join("; ")}`);
      }
    });
  }

  const existingMrns = new Set(existingPatients.map((p) => String(p.mrn).toUpperCase()));
  const existingIds = new Set(existingPatients.map((p) => p.id));
  const duplicates = [];

  if (Array.isArray(bundle.patients)) {
    for (const p of bundle.patients) {
      if (existingIds.has(p.id) || existingMrns.has(String(p.mrn || "").toUpperCase())) {
        duplicates.push({ id: p.id, mrn: p.mrn, displayName: p.displayName });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    duplicates,
    summary: {
      patientCount: Array.isArray(bundle.patients) ? bundle.patients.length : 0,
      consultationCount: Array.isArray(bundle.consultations) ? bundle.consultations.length : 0,
      labResultCount: Array.isArray(bundle.labResults) ? bundle.labResults.length : 0,
      duplicateCount: duplicates.length
    }
  };
}

module.exports = {
  normalizeSearchText,
  escapeHtml,
  validatePatientPayload,
  validateImportBundle
};
