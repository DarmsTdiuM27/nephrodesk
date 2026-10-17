/**
 * NephroDesk AI Pro — Automated Unit, Integration, E2E Workflow & Security Test Suite
 * Uses Node.js built-in test runner (node:test) and strict assertions (node:assert/strict).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateCkdEpi2021,
  calculateFeNa,
  calculateAnionGap,
  calculateUrineRatio,
  calculateCockcroftGault,
  calculateFreeWaterDeficit,
  convertCreatinineToMgDl
} = require("../src/shared/calculators");

const { ROLES, hasPermission } = require("../src/shared/rbac");
const { normalizeSearchText, validatePatientPayload, validateImportBundle } = require("../src/shared/validation");
const { createNephroDeskService } = require("../src/server/app");

// ============================================================================
// 1. CLINICAL CALCULATOR UNIT & REFERENCE VERIFICATION TESTS
// ============================================================================

test("CKD-EPI 2021 — Reference Case 1: 50yo Female, SCr 0.7 mg/dL (boundary SCr/k = 1.0)", () => {
  // At SCr = 0.7 mg/dL for female (k = 0.7): min(1,1)^a * max(1,1)^-1.2 = 1
  // eGFR = 142 * (0.9938^50) * 1.012 = 142 * 0.7327355 * 1.012 = 105.297 -> 105.3 mL/min/1.73m2
  const res = calculateCkdEpi2021({ age: 50, sex: "female", creatinine: 0.7, creatinineUnit: "mg/dL" });
  assert.equal(res.egfr, 105.3);
  assert.equal(res.gCategory, "G1");
  assert.ok(res.warningsEn.length >= 3);
  assert.ok(res.warningsFr.length >= 3);
});

test("CKD-EPI 2021 — Reference Case 2: 60yo Male, SCr 0.9 mg/dL (boundary SCr/k = 1.0)", () => {
  // At SCr = 0.9 mg/dL for male (k = 0.9): eGFR = 142 * (0.9938^60) = 142 * 0.688555 = 97.77 -> 97.8
  const res = calculateCkdEpi2021({ age: 60, sex: "male", creatinine: 0.9, creatinineUnit: "mg/dL" });
  assert.equal(res.egfr, 97.8);
  assert.equal(res.gCategory, "G1");
});

test("CKD-EPI 2021 — Reference Case 3: 65yo Male, SCr 176.8 µmol/L (2.0 mg/dL) — Unit Conversion & G3b", () => {
  // 176.8 µmol/L / 88.4 = 2.0 mg/dL
  // ratio = 2.0 / 0.9 = 2.222222...
  // eGFR = 142 * 1 * (2.222222^-1.200) * (0.9938^65) = 142 * 0.3834058 * 0.6674736 = 36.3524 -> 36.4
  const resUmol = calculateCkdEpi2021({ age: 65, sex: "male", creatinine: 176.8, creatinineUnit: "µmol/L" });
  const resMgDl = calculateCkdEpi2021({ age: 65, sex: "male", creatinine: 2.0, creatinineUnit: "mg/dL" });
  assert.equal(resUmol.egfr, 36.4);
  assert.equal(resUmol.egfr, resMgDl.egfr);
  assert.equal(resUmol.gCategory, "G3b");
});

test("CKD-EPI 2021 — Rejects pediatric age (<18), missing sex, negative/zero or implausible SCr", () => {
  assert.throws(() => calculateCkdEpi2021({ age: 15, sex: "male", creatinine: 1.0 }), /adult age between 18 and 120/);
  assert.throws(() => calculateCkdEpi2021({ age: 45, sex: "unknown", creatinine: 1.0 }), /Sex variable required/);
  assert.throws(() => calculateCkdEpi2021({ age: 45, sex: "female", creatinine: 0 }), /positive finite value/);
  assert.throws(() => calculateCkdEpi2021({ age: 45, sex: "female", creatinine: -1.2 }), /positive finite value/);
  assert.throws(() => calculateCkdEpi2021({ age: 45, sex: "female", creatinine: 45, creatinineUnit: "mg/dL" }), /physiologically plausible bounds/);
});

test("FeNa — Reference Case 1: Oliguric Prerenal Pattern (UNa 10, PNa 140, UCr 100 mg/dL, PCr 2.0 mg/dL)", () => {
  // FeNa = 100 * (10 * 2.0) / (140 * 100) = 2000 / 14000 = 0.142857 -> 0.14%
  const res = calculateFeNa({
    urineSodium: 10,
    plasmaSodium: 140,
    urineCreatinine: 100,
    urineCreatinineUnit: "mg/dL",
    plasmaCreatinine: 2.0,
    plasmaCreatinineUnit: "mg/dL"
  });
  assert.equal(res.fena, 0.14);
  assert.equal(res.category, "low_under_1");
});

test("FeNa — Reference Case 2: Mixed SI Units (PCr 176.8 µmol/L = 2.0 mg/dL, UCr 8.84 mmol/L = 100 mg/dL)", () => {
  const res = calculateFeNa({
    urineSodium: 45,
    plasmaSodium: 138,
    urineCreatinine: 8.84,
    urineCreatinineUnit: "mmol/L",
    plasmaCreatinine: 176.8,
    plasmaCreatinineUnit: "µmol/L"
  });
  // 8.84 mmol/L * 11.312 = 99.998 mg/dL; FeNa = 100 * (45 * 2.0) / (138 * 100) = 0.65%
  assert.equal(res.fena, 0.65);
});

test("FeNa — Rejects zero, negative, or physiologically implausible inputs", () => {
  assert.throws(() => calculateFeNa({ urineSodium: 0, plasmaSodium: 140, urineCreatinine: 100, plasmaCreatinine: 1.5 }), /positive finite/);
  assert.throws(() => calculateFeNa({ urineSodium: 20, plasmaSodium: 60, urineCreatinine: 100, plasmaCreatinine: 1.5 }), /Plasma sodium is outside/);
});

test("Anion Gap & Figge Albumin Correction — Uncorrected & Hypoalbuminemia Case", () => {
  // Na = 140, Cl = 104, HCO3 = 18 => Uncorrected AG = 140 - 122 = 18.0 mmol/L
  // Albumin = 2.0 g/dL (20 g/L) => Corrected AG (ref 4.0) = 18 + 2.5*(4.0 - 2.0) = 23.0 mmol/L
  // Corrected AG (Figge 4.4) = 18 + 2.5*(4.4 - 2.0) = 24.0 mmol/L
  const res = calculateAnionGap({
    sodium: 140,
    chloride: 104,
    bicarbonate: 18,
    albumin: 20,
    albuminUnit: "g/L"
  });
  assert.equal(res.anionGap, 18.0);
  assert.equal(res.correctedAnionGap, 23.0);
  assert.equal(res.correctedAnionGapFigge44, 24.0);
});

test("Urine PCR & ACR — Strictly distinguishes uACR vs uPCR and converts units accurately", () => {
  // Urine Albumin = 45 mg/dL, Urine Creatinine = 150 mg/dL (0.15 g/dL) => uACR = 45 / 0.15 = 300 mg/g
  const acr = calculateUrineRatio({
    analyteType: "albumin",
    analyteValue: 45,
    analyteUnit: "mg/dL",
    urineCreatinine: 150,
    urineCreatinineUnit: "mg/dL"
  });
  assert.equal(acr.testCode, "uACR");
  assert.equal(acr.ratioMgPerG, 300.0);
  assert.ok(acr.kdigoCategory.startsWith("A2"));

  // Urine Protein = 1.2 g/L (120 mg/dL), Urine Creatinine = 1.0 g/L (100 mg/dL = 0.1 g/dL) => uPCR = 1200 mg/g
  const pcr = calculateUrineRatio({
    analyteType: "protein",
    analyteValue: 1.2,
    analyteUnit: "g/L",
    urineCreatinine: 1.0,
    urineCreatinineUnit: "g/L"
  });
  assert.equal(pcr.testCode, "uPCR");
  assert.equal(pcr.ratioMgPerG, 1200.0);
});

test("Cockcroft-Gault & Free Water Deficit — Reference Verification", () => {
  // CG: 70yo Female, 65 kg, SCr 1.5 mg/dL => ((140-70)*65)/(72*1.5) * 0.85 = (4550/108)*0.85 = 35.81 -> 35.8 mL/min
  const cg = calculateCockcroftGault({ age: 70, sex: "female", weightKg: 65, creatinine: 1.5, creatinineUnit: "mg/dL" });
  assert.equal(cg.crcl, 35.8);

  // FWD: 70 kg, TBW factor 0.6 => TBW = 42 L; Measured Na = 158, Target Na = 140 => 42 * ((158/140)-1) = 5.4 L
  const fwd = calculateFreeWaterDeficit({ weightKg: 70, measuredSodium: 158, targetSodium: 140, bodyWaterFactor: 0.6 });
  assert.equal(fwd.tbwLiters, 42.0);
  assert.equal(fwd.deficitLiters, 5.4);
});

// ============================================================================
// 2. RBAC, SECURITY, WORKFLOW INTEGRATION & DATA MANAGEMENT TESTS
// ============================================================================

test("Localization & French Accent-Insensitive Search Normalization", () => {
  assert.equal(normalizeSearchText("Élodie Néphropathie Chronique"), "elodie nephropathie chronique");
  const service = createNephroDeskService();
  const { user: physician } = service.authenticate("usr_phys_1");

  const resultsWithAccent = service.listPatients(physician, { query: "Élodie" });
  const resultsWithoutAccent = service.listPatients(physician, { query: "elodie" });
  assert.equal(resultsWithAccent.length, 1);
  assert.equal(resultsWithoutAccent.length, 1);
  assert.equal(resultsWithAccent[0].id, "pat_syn_002");
});

test("Server-Side RBAC — Medical Student & Read-Only Access Restrictions", () => {
  const service = createNephroDeskService();
  const { user: student } = service.authenticate("usr_stud_1");
  const { user: readOnly } = service.authenticate("usr_ro_1");

  // Student can read synthetic/assigned pat_syn_001, but CANNOT read non-synthetic unassigned pat_syn_002
  const allowedPat = service.getPatientById(student, "pat_syn_001");
  assert.equal(allowedPat.id, "pat_syn_001");
  assert.throws(() => service.getPatientById(student, "pat_syn_002"), /FORBIDDEN/);

  // Student and Read-Only user cannot create patients, enter labs, or export data
  assert.throws(() => service.createPatient(student, { mrn: "MRN-999", displayName: "Test", age: 40, sex: "male" }), /FORBIDDEN/);
  assert.throws(() => service.createPatient(readOnly, { mrn: "MRN-999", displayName: "Test", age: 40, sex: "male" }), /FORBIDDEN/);
  assert.throws(() => service.exportAuthorizedData(readOnly), /FORBIDDEN/);
});

test("Consultation Version History — Finalized consultations require amendment trail and never overwrite", () => {
  const service = createNephroDeskService();
  const { user: physician } = service.authenticate("usr_phys_1");

  // Amending enc_syn_001 without amendmentReason must fail
  assert.throws(
    () =>
      service.createOrAmendConsultation(physician, {
        consultationId: "enc_syn_001",
        assessment: "Updated assessment without reason"
      }),
    /requires an explicit amendment reason/
  );

  // Amending with valid reason appends version 2 and preserves version 1
  const amended = service.createOrAmendConsultation(physician, {
    consultationId: "enc_syn_001",
    amendmentReason: "Addendum suite à la réception du contrôle de kaliémie post-consultation",
    assessment: "MRC G3bA3 stable, kaliémie contrôlée à 4,8 mmol/L."
  });
  assert.equal(amended.status, "AMENDED");
  assert.equal(amended.versions.length, 2);
  assert.equal(amended.versions[0].versionNumber, 1);
  assert.equal(amended.versions[1].versionNumber, 2);
  assert.match(amended.versions[1].amendmentReason, /kaliémie/);
});

test("XSS Output Encoding & Safe Import/Export with Duplicate Detection", () => {
  const service = createNephroDeskService();
  const { user: physician } = service.authenticate("usr_phys_1");
  const { user: admin } = service.authenticate("usr_admin_1");

  const created = service.createPatient(physician, {
    mrn: "SYN-XSS-009",
    displayName: "<script>alert('xss')</script>M. Test",
    age: 55,
    sex: "male"
  });
  assert.ok(!created.displayName.includes("<script>"));
  assert.ok(created.displayName.includes("&lt;script&gt;"));

  // Export dataset
  const exported = service.exportAuthorizedData(physician);
  assert.equal(exported.schemaVersion, "nephrodesk.export.v1");
  assert.equal(exported.patients.length, 3);

  // Re-importing same bundle without allowOverwrite must detect duplicates and reject overwrite
  const preview = service.importDataBundle(physician, exported, { previewOnly: true });
  assert.equal(preview.valid, true);
  assert.equal(preview.duplicates.length, 3);
  assert.throws(() => service.importDataBundle(physician, exported, { allowOverwrite: false }), /DUPLICATE_RECORDS_DETECTED/);

  // Audit events are accessible to Admin and rejected for Physician
  assert.throws(() => service.auditLogger.listEvents(physician), /FORBIDDEN/);
  const auditLogs = service.auditLogger.listEvents(admin);
  assert.ok(auditLogs.length >= 5);
});


test("HTTP Server Health Check & Security Headers Verification", async () => {
  const { server } = require("../src/server/index");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.ok(res.headers.get("content-security-policy").includes("default-src 'self'"));
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.product, "NephroDesk AI Pro");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Patient Archive Workflow & Lab Result Flagging with Custom Reference Ranges", () => {
  const service = createNephroDeskService();
  const { user: physician } = service.authenticate("usr_phys_1");

  // Enter hyperkalemic lab result with custom lab reference range (3.5 - 5.0 mmol/L)
  const lab = service.addLabResult(physician, {
    patientId: "pat_syn_001",
    testCode: "K",
    testNameFr: "Potassium plasmatique",
    testNameEn: "Serum Potassium",
    value: 5.9,
    unit: "mmol/L",
    labSource: "Labo Urgences CHU",
    refLow: 3.5,
    refHigh: 5.0,
    verified: true
  });
  assert.equal(lab.flag, "HIGH");

  // Archive patient record reversibly
  const archived = service.archivePatient(physician, "pat_syn_002", "Transfert vers un autre centre de dialyse");
  assert.equal(archived.status, "ARCHIVED");
  const activeList = service.listPatients(physician, { includeArchived: false });
  assert.equal(activeList.some((p) => p.id === "pat_syn_002"), false);
  const allList = service.listPatients(physician, { includeArchived: true });
  assert.equal(allList.some((p) => p.id === "pat_syn_002"), true);
});
