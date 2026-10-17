/**
 * NephroDesk AI Pro — Validated Clinical Calculators Engine
 * Pure, deterministic, decimal-safe functions independent of UI and storage.
 *
 * AUTHORITATIVE SOURCES:
 * 1. CKD-EPI 2021 Creatinine (Race-Free):
 *    Inker LA, Eneanya ND, Coresh J, et al. New Creatinine- and Cystatin C-Based
 *    Equations to Estimate GFR without Race. N Engl J Med. 2021;385(19):1737-1749.
 *    PMID: 34554658 | https://pubmed.ncbi.nlm.nih.gov/34554658/
 * 2. KDIGO 2024 CKD Guideline:
 *    KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of
 *    Chronic Kidney Disease. Kidney Int. 2024;105(4S):S117-S314. PMID: 38490803
 * 3. Fractional Excretion of Sodium (FeNa):
 *    Espinel CH. The FENa test. Use in the differential diagnosis of acute renal
 *    failure. JAMA. 1976;236(6):579-581. PMID: 947239
 * 4. Serum Anion Gap & Albumin-Corrected Anion Gap:
 *    Figge J, Jabor A, Kazda A, Fencl V. Anion gap and hypoalbuminemia.
 *    Crit Care Med. 1998;26(11):1807-1810. PMID: 9824071
 * 5. Cockcroft-Gault Creatinine Clearance:
 *    Cockcroft DW, Gault MH. Prediction of creatinine clearance from serum
 *    creatinine. Nephron. 1976;16(1):31-41. PMID: 1244564
 */

const CREATININE_UMOL_PER_MGDL = 88.4; // Standard molar conversion (MW = 113.12 g/mol)
const CREATININE_MG_PER_MMOL = 113.12;

function isFinitePositive(val) {
  return typeof val === "number" && Number.isFinite(val) && val > 0;
}

function roundTo(val, decimals) {
  if (!Number.isFinite(val)) {
    throw new Error("Calculation produced a non-finite number.");
  }
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/**
 * Convert Serum or Urine Creatinine to mg/dL
 */
function convertCreatinineToMgDl(value, unit) {
  if (!isFinitePositive(value)) {
    throw new Error("Creatinine must be a positive finite number.");
  }
  const u = String(unit || "").trim().toLowerCase();
  if (u === "mg/dl") return value;
  if (u === "umol/l" || u === "µmol/l" || u === "micromol/l") {
    return value / CREATININE_UMOL_PER_MGDL;
  }
  if (u === "g/l") return value * 100; // 1 g/L = 100 mg/dL
  if (u === "mmol/l") return (value * CREATININE_MG_PER_MMOL) / 10; // 1 mmol/L = 113.12 mg/L = 11.312 mg/dL
  throw new Error(`Unsupported creatinine unit: ${unit}`);
}

/**
 * 9.1 Estimated Glomerular Filtration Rate — 2021 CKD-EPI Creatinine (Race-Free)
 * Formula:
 * eGFR = 142 * min(SCr/k, 1)^a * max(SCr/k, 1)^(-1.200) * 0.9938^Age * (1.012 if female)
 * k = 0.7 (female) or 0.9 (male)
 * a = -0.241 (female) or -0.302 (male)
 */
function calculateCkdEpi2021({ age, sex, creatinine, creatinineUnit = "mg/dL" }) {
  const numAge = Number(age);
  const numCr = Number(creatinine);

  if (!Number.isFinite(numAge) || numAge < 18 || numAge > 120) {
    throw new Error("CKD-EPI 2021 requires an adult age between 18 and 120 years.");
  }
  const normalizedSex = String(sex || "").trim().toLowerCase();
  if (normalizedSex !== "female" && normalizedSex !== "male" && normalizedSex !== "f" && normalizedSex !== "m") {
    throw new Error("Sex variable required by the CKD-EPI 2021 equation must be 'female' or 'male'.");
  }
  if (!isFinitePositive(numCr)) {
    throw new Error("Serum creatinine must be a positive finite value.");
  }

  const scrMgDl = convertCreatinineToMgDl(numCr, creatinineUnit);
  if (scrMgDl < 0.1 || scrMgDl > 30.0) {
    throw new Error("Serum creatinine is outside physiologically plausible bounds (0.1 to 30.0 mg/dL / 8.8 to 2652 µmol/L).");
  }

  const isFemale = normalizedSex === "female" || normalizedSex === "f";
  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const sexMultiplier = isFemale ? 1.012 : 1.0;

  const ratio = scrMgDl / kappa;
  const minPart = Math.pow(Math.min(ratio, 1.0), alpha);
  const maxPart = Math.pow(Math.max(ratio, 1.0), -1.200);
  const agePart = Math.pow(0.9938, numAge);

  const rawEgfr = 142.0 * minPart * maxPart * agePart * sexMultiplier;
  const egfr = roundTo(rawEgfr, 1);

  let gCategory = "G1";
  let gLabelEn = "G1 (Normal or high, >= 90 mL/min/1.73m²)";
  let gLabelFr = "G1 (Normal ou élevé, >= 90 mL/min/1,73m²)";
  if (egfr < 15) {
    gCategory = "G5";
    gLabelEn = "G5 (Kidney failure, < 15 mL/min/1.73m²)";
    gLabelFr = "G5 (Insuffisance rénale terminale / sévère, < 15 mL/min/1,73m²)";
  } else if (egfr < 30) {
    gCategory = "G4";
    gLabelEn = "G4 (Severely decreased, 15–29 mL/min/1.73m²)";
    gLabelFr = "G4 (Baisse sévère, 15–29 mL/min/1,73m²)";
  } else if (egfr < 45) {
    gCategory = "G3b";
    gLabelEn = "G3b (Moderately to severely decreased, 30–44 mL/min/1.73m²)";
    gLabelFr = "G3b (Baisse modérée à sévère, 30–44 mL/min/1,73m²)";
  } else if (egfr < 60) {
    gCategory = "G3a";
    gLabelEn = "G3a (Mildly to moderately decreased, 45–59 mL/min/1.73m²)";
    gLabelFr = "G3a (Baisse légère à modérée, 45–59 mL/min/1,73m²)";
  } else if (egfr < 90) {
    gCategory = "G2";
    gLabelEn = "G2 (Mildly decreased, 60–89 mL/min/1.73m²)";
    gLabelFr = "G2 (Baisse légère, 60–89 mL/min/1,73m²)";
  }

  return {
    calculatorId: "ckd-epi-2021",
    egfr,
    rawEgfr,
    unit: "mL/min/1.73m²",
    scrMgDl: roundTo(scrMgDl, 3),
    scrUmolL: roundTo(scrMgDl * CREATININE_UMOL_PER_MGDL, 1),
    gCategory,
    gLabelEn,
    gLabelFr,
    formulaUsed: "eGFR = 142 × min(SCr/κ, 1)^α × max(SCr/κ, 1)^(-1.200) × 0.9938^Age × (1.012 if female)",
    source: "Inker LA et al., N Engl J Med 2021;385:1737-1749 (PMID: 34554658); KDIGO 2024 CKD Guideline (PMID: 38490803)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/34554658/",
    warningsEn: [
      "Classification support only: CKD diagnosis requires evidence of kidney damage or eGFR < 60 mL/min/1.73m² persisting for at least 3 months.",
      "Unreliable in Acute Kidney Injury (AKI) or rapidly changing serum creatinine (non-steady state).",
      "May be inaccurate in pregnancy, extremes of muscle mass (amputation, sarcopenia, bodybuilding), severe malnutrition, or vegetarian/creatine-supplemented diets."
    ],
    warningsFr: [
      "Aide à la classification uniquement : le diagnostic de MRC nécessite des marqueurs d'atteinte rénale ou un DFGe < 60 mL/min/1,73m² persistant depuis au moins 3 mois.",
      "Non fiable en cas d'insuffisance rénale aiguë (IRA) ou de créatininémie rapidement évolutive (état non stationnaire).",
      "Précision réduite en cas de grossesse, masse musculaire extrême (amputation, sarcopénie), dénutrition sévère ou prise de créatine."
    ],
    timestamp: new Date().toISOString()
  };
}

/**
 * 9.2 Fractional Excretion of Sodium — FeNa
 * Formula: FeNa (%) = 100 * (U_Na * P_Cr) / (P_Na * U_Cr)
 */
function calculateFeNa({
  urineSodium,
  urineSodiumUnit = "mmol/L",
  plasmaSodium,
  plasmaSodiumUnit = "mmol/L",
  urineCreatinine,
  urineCreatinineUnit = "mg/dL",
  plasmaCreatinine,
  plasmaCreatinineUnit = "mg/dL"
}) {
  const uNa = Number(urineSodium);
  const pNa = Number(plasmaSodium);
  const uCr = Number(urineCreatinine);
  const pCr = Number(plasmaCreatinine);

  if (!isFinitePositive(uNa) || !isFinitePositive(pNa) || !isFinitePositive(uCr) || !isFinitePositive(pCr)) {
    throw new Error("All FeNa inputs (urine Na, plasma Na, urine Cr, plasma Cr) must be positive finite numbers.");
  }

  const validNaUnits = ["mmol/l", "meq/l"];
  if (!validNaUnits.includes(String(urineSodiumUnit).toLowerCase()) || !validNaUnits.includes(String(plasmaSodiumUnit).toLowerCase())) {
    throw new Error("Sodium units must be mmol/L or mEq/L.");
  }

  if (pNa < 100 || pNa > 200) {
    throw new Error("Plasma sodium is outside physiologically plausible bounds (100–200 mmol/L).");
  }
  if (uNa < 1 || uNa > 400) {
    throw new Error("Urine sodium is outside physiologically plausible bounds (1–400 mmol/L).");
  }

  const pCrMgDl = convertCreatinineToMgDl(pCr, plasmaCreatinineUnit);
  const uCrMgDl = convertCreatinineToMgDl(uCr, urineCreatinineUnit);

  if (pCrMgDl < 0.1 || pCrMgDl > 30.0) {
    throw new Error("Plasma creatinine is outside physiologically plausible bounds (0.1–30.0 mg/dL).");
  }
  if (uCrMgDl < 1.0 || uCrMgDl > 1000.0) {
    throw new Error("Urine creatinine is outside physiologically plausible bounds (1.0–1000.0 mg/dL).");
  }

  const rawFeNa = 100.0 * (uNa * pCrMgDl) / (pNa * uCrMgDl);
  const fena = roundTo(rawFeNa, 2);

  let category = "indeterminate";
  if (fena < 1.0) category = "low_under_1";
  else if (fena > 2.0) category = "elevated_over_2";

  return {
    calculatorId: "fena",
    fena,
    rawFeNa,
    unit: "%",
    category,
    normalizedInputs: {
      uNaMmolL: uNa,
      pNaMmolL: pNa,
      pCrMgDl: roundTo(pCrMgDl, 3),
      uCrMgDl: roundTo(uCrMgDl, 2)
    },
    formulaUsed: "FeNa (%) = 100 × (Urine Na × Plasma Cr) / (Plasma Na × Urine Cr)",
    source: "Espinel CH. JAMA 1976;236(6):579-581 (PMID: 947239)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/947239/",
    warningsEn: [
      "FeNa must NEVER be used as a standalone definitive diagnosis of prerenal vs. intrinsic acute kidney injury.",
      "Unreliable after diuretic administration (loop/thiazide diuretics increase natriuresis; consider FEUrea in diuretic-exposed patients).",
      "May be < 1% in intrinsic AKI caused by radiocontrast, rhabdomyolysis/hemolysis, early sepsis, or acute glomerulonephritis.",
      "May be > 1% in prerenal states superimposed on chronic kidney disease, salt-wasting nephropathy, or adrenal insufficiency."
    ],
    warningsFr: [
      "La FeNa ne constitue JAMAIS à elle seule un diagnostic définitif d'IRA fonctionnelle (prérénale) ou organique.",
      "Non interprétable sous diurétiques (les diurétiques augmentent la natriurèse ; envisager la FEUrée).",
      "Peut être < 1 % dans certaines IRA organiques (produits de contraste, rhabdomyolyse, sepsis débutant, glomérulonéphrite aiguë).",
      "Peut être > 1 % lors d'une IRA prérénale sur maladie rénale chronique préexistante ou néphropathie avec perte de sel."
    ],
    timestamp: new Date().toISOString()
  };
}

/**
 * 9.3 Serum Anion Gap & Albumin-Corrected Anion Gap (Figge Equation)
 * Uncorrected: AG = Na - (Cl + HCO3)
 * Albumin-corrected (Figge et al., 1998): Corrected AG = AG + 2.5 * (4.0 - Albumin [g/dL])
 * (Also computes 4.4 g/dL original Figge reference variant for transparency)
 */
function calculateAnionGap({
  sodium,
  chloride,
  bicarbonate,
  electrolyteUnit = "mmol/L",
  albumin = null,
  albuminUnit = "g/dL",
  referenceAlbuminGdL = 4.0
}) {
  const na = Number(sodium);
  const cl = Number(chloride);
  const hco3 = Number(bicarbonate);

  if (!isFinitePositive(na) || !isFinitePositive(cl) || !isFinitePositive(hco3)) {
    throw new Error("Sodium, chloride, and bicarbonate must be positive finite numbers.");
  }
  const u = String(electrolyteUnit || "").toLowerCase();
  if (u !== "mmol/l" && u !== "meq/l") {
    throw new Error("Electrolyte unit must be mmol/L or mEq/L.");
  }
  if (na < 100 || na > 200) throw new Error("Sodium outside plausible range (100–200 mmol/L).");
  if (cl < 50 || cl > 160) throw new Error("Chloride outside plausible range (50–160 mmol/L).");
  if (hco3 < 2 || hco3 > 60) throw new Error("Bicarbonate outside plausible range (2–60 mmol/L).");

  const rawAg = na - (cl + hco3);
  const anionGap = roundTo(rawAg, 1);

  let albuminGdL = null;
  let correctedAnionGap = null;
  let correctedAnionGapFigge44 = null;

  if (albumin !== null && albumin !== undefined && String(albumin).trim() !== "") {
    const albNum = Number(albumin);
    if (!isFinitePositive(albNum)) {
      throw new Error("Albumin must be a positive finite number when provided.");
    }
    const albU = String(albuminUnit || "g/dL").toLowerCase();
    if (albU === "g/dl") {
      albuminGdL = albNum;
    } else if (albU === "g/l") {
      albuminGdL = albNum / 10.0;
    } else {
      throw new Error("Albumin unit must be g/dL or g/L.");
    }
    if (albuminGdL < 0.5 || albuminGdL > 7.0) {
      throw new Error("Serum albumin outside plausible range (0.5–7.0 g/dL or 5–70 g/L).");
    }
    correctedAnionGap = roundTo(rawAg + 2.5 * (referenceAlbuminGdL - albuminGdL), 1);
    correctedAnionGapFigge44 = roundTo(rawAg + 2.5 * (4.4 - albuminGdL), 1);
  }

  return {
    calculatorId: "anion-gap",
    anionGap,
    correctedAnionGap,
    correctedAnionGapFigge44,
    albuminGdL: albuminGdL !== null ? roundTo(albuminGdL, 2) : null,
    unit: "mmol/L",
    referenceRange: "8–12 mmol/L (without potassium; verify local laboratory assay)",
    formulaUsed: "AG = Na⁺ − (Cl⁻ + HCO₃⁻); Corrected AG = AG + 2.5 × (4.0 − Albumin [g/dL])",
    source: "Figge J et al. Crit Care Med 1998;26(11):1807-1810 (PMID: 9824071)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/9824071/",
    warningsEn: [
      "Do not diagnose a specific acid-base disorder from the anion gap alone; correlate with arterial/venous blood gas (pH, PaCO2), clinical history, and lactate/ketones.",
      "Reference ranges depend on the specific ion-selective electrode analyzer used by the local laboratory (typically 8–12 mmol/L).",
      "Hypoalbuminemia masks an elevated anion gap (~2.5 mmol/L decrease per 1 g/dL drop in albumin)."
    ],
    warningsFr: [
      "Ne pas diagnostiquer un trouble acido-basique sur le seul trou anionique ; toujours corréler aux gaz du sang (pH, PaCO2), au lactate et au contexte clinique.",
      "Les valeurs de référence dépendent de l'automate du laboratoire local (habituellement 8–12 mmol/L sans potassium).",
      "L'hypoalbuminémie masque une élévation du trou anionique (baisse d'environ 2,5 mmol/L par baisse de 10 g/L d'albumine)."
    ],
    timestamp: new Date().toISOString()
  };
}

/**
 * 9.4 Urine Protein-to-Creatinine Ratio (uPCR) & Albumin-to-Creatinine Ratio (uACR)
 * Explicitly distinguishes protein (PCR) vs albumin (ACR).
 */
function calculateUrineRatio({
  analyteType, // 'protein' | 'albumin'
  analyteValue,
  analyteUnit = "mg/dL", // 'mg/dL' | 'mg/L' | 'g/L'
  urineCreatinine,
  urineCreatinineUnit = "mg/dL" // 'mg/dL' | 'g/L' | 'mmol/L'
}) {
  const type = String(analyteType || "").trim().toLowerCase();
  if (type !== "protein" && type !== "albumin") {
    throw new Error("Analyte type must be explicitly specified as 'protein' (uPCR) or 'albumin' (uACR).");
  }
  const val = Number(analyteValue);
  const uCr = Number(urineCreatinine);
  if (!isFinitePositive(val) || !isFinitePositive(uCr)) {
    throw new Error("Urine analyte and urine creatinine must be positive finite numbers.");
  }

  // Convert analyte to mg/dL
  let analyteMgDl;
  const aUnit = String(analyteUnit || "").trim().toLowerCase();
  if (aUnit === "mg/dl") analyteMgDl = val;
  else if (aUnit === "mg/l") analyteMgDl = val / 10.0;
  else if (aUnit === "g/l") analyteMgDl = val * 100.0;
  else throw new Error(`Unsupported urine analyte unit: ${analyteUnit}`);

  // Convert urine creatinine to g/dL and mmol/dL
  const uCrMgDl = convertCreatinineToMgDl(uCr, urineCreatinineUnit);
  const uCrGDl = uCrMgDl / 1000.0; // 1000 mg = 1 g
  const uCrMmolDl = uCrMgDl / CREATININE_MG_PER_MMOL;

  const ratioMgPerG = roundTo(analyteMgDl / uCrGDl, 1);
  const ratioMgPerMmol = roundTo(analyteMgDl / uCrMmolDl, 2);

  let kdigoCategory = null;
  if (type === "albumin") {
    if (ratioMgPerG < 30) kdigoCategory = "A1 (< 30 mg/g or < 3 mg/mmol: Normal to mildly increased)";
    else if (ratioMgPerG <= 300) kdigoCategory = "A2 (30–300 mg/g or 3–30 mg/mmol: Moderately increased)";
    else kdigoCategory = "A3 (> 300 mg/g or > 30 mg/mmol: Severely increased)";
  } else {
    if (ratioMgPerG < 150) kdigoCategory = "PCR < 150 mg/g (< 15 mg/mmol): Within typical reference range";
    else if (ratioMgPerG <= 500) kdigoCategory = "PCR 150–500 mg/g (15–50 mg/mmol): Moderately elevated proteinuria";
    else if (ratioMgPerG < 3500) kdigoCategory = "PCR > 500 mg/g (> 50 mg/mmol): Significant proteinuria";
    else kdigoCategory = "PCR >= 3500 mg/g (>= 350 mg/mmol): Nephrotic-range proteinuria";
  }

  return {
    calculatorId: type === "albumin" ? "uacr" : "upcr",
    analyteType: type,
    testCode: type === "albumin" ? "uACR" : "uPCR",
    ratioMgPerG,
    ratioMgPerMmol,
    approxGramsPerDayNote: roundTo(ratioMgPerG / 1000.0, 2),
    kdigoCategory,
    formulaUsed: `${type === "albumin" ? "uACR" : "uPCR"} (mg/g) = [Urine ${type} (mg/dL)] / [Urine creatinine (g/dL)]`,
    source: "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of CKD (PMID: 38490803)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/38490803/",
    warningsEn: [
      "uACR (albumin-to-creatinine ratio) and uPCR (total protein-to-creatinine ratio) measure different analytes and are NOT interchangeable.",
      "Spot urine ratios assume steady-state creatinine excretion (~1 g/day); low muscle mass underestimates and high muscle mass overestimates 24h excretion.",
      "Transient elevations can occur with fever, vigorous exercise, urinary tract infection, orthostatic proteinuria, or marked hyperglycemia."
    ],
    warningsFr: [
      "Le RAC (rapport albuminurie/créatininurie) et le RPC (rapport protéinurie/créatininurie) mesurent des analytes différents et ne sont PAS interchangeables.",
      "Le rapport sur échantillon suppose une excrétion de créatinine stable (~1 g/j) ; il dépend de la masse musculaire.",
      "Une élévation transitoire est possible en cas de fièvre, exercice intense, infection urinaire ou poussée hypertensive/hyperglycémique."
    ],
    timestamp: new Date().toISOString()
  };
}

/**
 * 9.5a Cockcroft-Gault Estimated Creatinine Clearance (eCrCl)
 * Formula: CrCl (mL/min) = ((140 - Age) * Weight_kg) / (72 * SCr_mg/dL) * (0.85 if female)
 */
function calculateCockcroftGault({ age, sex, weightKg, creatinine, creatinineUnit = "mg/dL" }) {
  const numAge = Number(age);
  const numWeight = Number(weightKg);
  const numCr = Number(creatinine);

  if (!Number.isFinite(numAge) || numAge < 18 || numAge > 120) {
    throw new Error("Cockcroft-Gault requires adult age between 18 and 120 years.");
  }
  if (!isFinitePositive(numWeight) || numWeight < 20 || numWeight > 350) {
    throw new Error("Weight must be between 20 and 350 kg.");
  }
  const normalizedSex = String(sex || "").trim().toLowerCase();
  if (!["female", "male", "f", "m"].includes(normalizedSex)) {
    throw new Error("Sex variable must be 'female' or 'male'.");
  }
  const scrMgDl = convertCreatinineToMgDl(numCr, creatinineUnit);
  if (scrMgDl < 0.1 || scrMgDl > 30.0) {
    throw new Error("Serum creatinine outside plausible range (0.1–30.0 mg/dL).");
  }

  const isFemale = normalizedSex === "female" || normalizedSex === "f";
  const rawCrCl = (((140.0 - numAge) * numWeight) / (72.0 * scrMgDl)) * (isFemale ? 0.85 : 1.0);
  const crcl = roundTo(rawCrCl, 1);

  return {
    calculatorId: "cockcroft-gault",
    crcl,
    unit: "mL/min (non-indexed)",
    formulaUsed: "CrCl (mL/min) = [(140 − Age) × Weight (kg)] / [72 × SCr (mg/dL)] × (0.85 if female)",
    source: "Cockcroft DW, Gault MH. Nephron 1976;16(1):31-41 (PMID: 1244564)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/1244564/",
    warningsEn: [
      "Derived in 1976 using non-IDMS-standardized creatinine assays; systematically overestimates GFR in obesity or edematous states.",
      "Expressed in mL/min (not indexed to body surface area); consult approved drug labeling and clinical pharmacist guidance for narrow-therapeutic-index medications."
    ],
    warningsFr: [
      "Équation historique (1976) établie avant la standardisation IDMS de la créatinine ; surestime la clairance en cas d'obésité ou d'œdèmes.",
      "Résultat en mL/min (non indexé à la surface corporelle) ; vérifier les résumés des caractéristiques du produit (RCP) pour l'adaptation posologique."
    ],
    timestamp: new Date().toISOString()
  };
}

/**
 * 9.5b Free Water Deficit in Hypernatremia
 * Formula: FWD (L) = TBW * ((Measured Na / Target Na) - 1)
 */
function calculateFreeWaterDeficit({ weightKg, measuredSodium, targetSodium = 140, bodyWaterFactor = 0.6 }) {
  const w = Number(weightKg);
  const mNa = Number(measuredSodium);
  const tNa = Number(targetSodium);
  const f = Number(bodyWaterFactor);

  if (!isFinitePositive(w) || w < 20 || w > 350) throw new Error("Weight must be between 20 and 350 kg.");
  if (!isFinitePositive(mNa) || mNa <= 145 || mNa > 200) {
    throw new Error("Free water deficit calculator requires hypernatremia (measured Na between 146 and 200 mmol/L).");
  }
  if (!isFinitePositive(tNa) || tNa < 135 || tNa >= mNa) {
    throw new Error("Target sodium must be between 135 mmol/L and less than measured sodium.");
  }
  if (!isFinitePositive(f) || f < 0.4 || f > 0.7) {
    throw new Error("Total body water factor must be between 0.4 and 0.7.");
  }

  const tbw = roundTo(w * f, 1);
  const deficitLiters = roundTo(tbw * ((mNa / tNa) - 1.0), 2);

  return {
    calculatorId: "free-water-deficit",
    deficitLiters,
    tbwLiters: tbw,
    unit: "L",
    formulaUsed: "Free Water Deficit (L) = (Weight × TBW factor) × [(Measured Na / Target Na) − 1]",
    source: "Adrogué HJ, Madias NE. Hypernatremia. N Engl J Med 2000;342(20):1493-1499 (PMID: 10816188)",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/10816188/",
    warningsEn: [
      "Estimates static free-water deficit only; does NOT account for ongoing urinary, gastrointestinal, or insensible water losses.",
      "Rapid correction of chronic hypernatremia risks cerebral edema; rate of plasma sodium reduction generally should not exceed 8–10 mmol/L per 24 hours. Serial electrolyte monitoring every 2–4 hours is required."
    ],
    warningsFr: [
      "Estime uniquement le déficit hydrique statique ; ne prend PAS en compte les pertes urinaires, digestives ou insensibles en cours.",
      "Une correction trop rapide d'une hypernatrémie chronique expose à l'œdème cérébral (ne pas dépasser 8–10 mmol/L par 24 h en général). Surveillance biologique rapprochée indispensable."
    ],
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  CREATININE_UMOL_PER_MGDL,
  convertCreatinineToMgDl,
  calculateCkdEpi2021,
  calculateFeNa,
  calculateAnionGap,
  calculateUrineRatio,
  calculateCockcroftGault,
  calculateFreeWaterDeficit
};
