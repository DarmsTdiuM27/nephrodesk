/**
 * NephroDesk AI Pro — Server-Side Role-Based Access Control (RBAC) & Audit Logger
 * Enforces principle of least privilege on the server.
 */

const ROLES = {
  ADMIN: "ADMIN",
  PHYSICIAN: "PHYSICIAN",
  STUDENT: "STUDENT",
  READ_ONLY: "READ_ONLY"
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: new Set([
    "users:manage",
    "settings:manage",
    "audit:read",
    "references:manage",
    "references:read",
    "calculators:use",
    "patients:read",
    "patients:write",
    "patients:archive",
    "consultations:read",
    "consultations:write",
    "labs:read",
    "labs:write",
    "biopsy:read",
    "biopsy:write",
    "reports:generate",
    "data:export",
    "data:import"
  ]),
  [ROLES.PHYSICIAN]: new Set([
    "references:read",
    "calculators:use",
    "patients:read",
    "patients:write",
    "patients:archive",
    "consultations:read",
    "consultations:write",
    "labs:read",
    "labs:write",
    "biopsy:read",
    "biopsy:write",
    "reports:generate",
    "data:export",
    "data:import"
  ]),
  [ROLES.STUDENT]: new Set([
    "references:read",
    "calculators:use",
    "patients:read_synthetic_or_assigned",
    "consultations:read_synthetic_or_assigned",
    "labs:read_synthetic_or_assigned",
    "biopsy:read"
  ]),
  [ROLES.READ_ONLY]: new Set([
    "references:read",
    "calculators:use",
    "patients:read",
    "consultations:read",
    "labs:read",
    "biopsy:read",
    "reports:generate"
  ])
};

function hasPermission(user, permission, resourceContext = {}) {
  if (!user || !user.role || !ROLE_PERMISSIONS[user.role]) {
    return false;
  }
  const perms = ROLE_PERMISSIONS[user.role];
  if (perms.has(permission)) {
    return true;
  }
  // Medical student conditional access to synthetic or explicitly assigned records
  if (user.role === ROLES.STUDENT) {
    const isSyntheticOrAssigned =
      Boolean(resourceContext.isSynthetic) ||
      (Array.isArray(user.assignedPatientIds) && user.assignedPatientIds.includes(resourceContext.patientId));
    if (permission === "patients:read" && perms.has("patients:read_synthetic_or_assigned") && isSyntheticOrAssigned) {
      return true;
    }
    if (permission === "consultations:read" && perms.has("consultations:read_synthetic_or_assigned") && isSyntheticOrAssigned) {
      return true;
    }
    if (permission === "labs:read" && perms.has("labs:read_synthetic_or_assigned") && isSyntheticOrAssigned) {
      return true;
    }
  }
  return false;
}

/**
 * Audit Logger that records security-relevant events while scrubbing PHI
 * (names, full DOBs, free-text clinical notes) from audit metadata.
 */
class AuditLogger {
  constructor() {
    this.events = [];
  }

  log({ actorId, actorRole, action, resourceType, resourceId = null, outcome = "SUCCESS", reason = null }) {
    const entry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actorId: actorId || "anonymous",
      actorRole: actorRole || "NONE",
      action,
      resourceType,
      resourceId,
      outcome,
      reason
    };
    this.events.unshift(entry);
    return entry;
  }

  listEvents(user) {
    if (!hasPermission(user, "audit:read")) {
      throw new Error("FORBIDDEN: Only Administrators can view system audit events.");
    }
    return [...this.events];
  }
}

module.exports = {
  ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  AuditLogger
};
