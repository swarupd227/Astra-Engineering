// Bulk user onboarding via Excel: template generation, parsing, validation and
// per-row creation. Pure logic + a thin create helper that reuses the same
// users / user_roles / member-table writes as the single-user admin flow.
import ExcelJS from "exceljs";
import { db } from "../db";
import {
  users,
  roles as rolesTable,
  userRoles,
  organizationMembers,
  projectMembers,
  auditLogs,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const SCOPE_ID_ALL = "ALL";

// Matches the single-user create route's email rule (.co rejected).
export const BULK_EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{3,}$/;

export const BULK_USER_HEADERS = [
  "User Name",
  "Email Address",
  "Role",
  "Scope",
  "Organization",
  "Project",
] as const;

export interface BulkRefData {
  roles: string[];
  organizations: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}

export interface RawRow {
  rowNumber: number;
  userName: string;
  email: string;
  role: string;
  scope: string;
  organization: string;
  project: string;
}

export type RowStatus = "valid" | "error" | "duplicate";

export interface RowError {
  field: string;
  message: string;
}

export interface CreatePayload {
  email: string;
  displayName: string;
  role: string;
  scope: "org" | "project";
  organizationIds: string[];
  projectIds: string[];
}

export interface ValidatedRow {
  rowNumber: number;
  data: {
    userName: string;
    email: string;
    role: string;
    scope: string;
    organization: string;
    project: string;
  };
  status: RowStatus;
  errors: RowError[];
  payload?: CreatePayload;
}

export interface ExistingUserInfo {
  isDeleted: boolean;
}

export interface ValidateContext {
  refData: BulkRefData;
  tenantId: string;
  existingByEmail: Map<string, ExistingUserInfo>;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export async function generateTemplateBuffer(ref: BulkRefData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DevX";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Users");
  sheet.columns = [
    { header: "User Name", key: "userName", width: 26 },
    { header: "Email Address", key: "email", width: 32 },
    { header: "Role", key: "role", width: 18 },
    { header: "Scope", key: "scope", width: 16 },
    { header: "Organization", key: "organization", width: 30 },
    { header: "Project", key: "project", width: 30 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE9E9EF" },
  };
  headerRow.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const exampleRow = sheet.addRow({
    userName: "EXAMPLE — delete this row",
    email: "jane.doe@company.com",
    role: ref.roles[0] ?? "Developer",
    scope: "Organization",
    organization: "ALL",
    project: "",
  });
  exampleRow.eachCell((cell) => {
    cell.font = { italic: true, color: { argb: "FF9AA0A6" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF6F6F8" },
    };
  });

  const roleList = (ref.roles.length ? ref.roles : ["Viewer"]).join(",");
  for (let r = 2; r <= 500; r++) {
    sheet.getCell(`C${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${roleList}"`],
    };
    sheet.getCell(`D${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Organization,Project"'],
    };
  }

  // Reference sheet so admins can copy exact values.
  const refSheet = wb.addWorksheet("Reference");
  refSheet.columns = [
    { header: "Roles", key: "role", width: 24 },
    { header: "Organizations", key: "org", width: 32 },
    { header: "Projects", key: "project", width: 32 },
  ];
  refSheet.getRow(1).font = { bold: true };
  const maxLen = Math.max(
    ref.roles.length,
    ref.organizations.length,
    ref.projects.length,
  );
  for (let i = 0; i < maxLen; i++) {
    refSheet.addRow({
      role: ref.roles[i] ?? "",
      org: ref.organizations[i]?.name ?? "",
      project: ref.projects[i]?.name ?? "",
    });
  }
  refSheet.addRow({});
  refSheet.addRow({
    role: 'Tip: use "ALL" in Organization/Project to grant all.',
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as Buffer;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text: string }>)
        .map((t) => t.text)
        .join("")
        .trim();
    }
    if (obj.result != null) return String(obj.result).trim();
    if (obj.hyperlink) return String(obj.hyperlink).replace(/^mailto:/i, "").trim();
  }
  return String(v).trim();
}

export async function parseUsersWorkbook(buffer: Buffer): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet("Users") ?? wb.worksheets[0];
  if (!sheet) return [];

  const rows: RawRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const userName = cellText(row.getCell(1));
    const email = cellText(row.getCell(2));
    const role = cellText(row.getCell(3));
    const scope = cellText(row.getCell(4));
    const organization = cellText(row.getCell(5));
    const project = cellText(row.getCell(6));

    const hasAny = [userName, email, role, scope, organization, project].some(
      (v) => v.length > 0,
    );
    if (!hasAny) return; // blank row
    if (/example/i.test(userName)) return; // seeded example row

    rows.push({ rowNumber, userName, email, role, scope, organization, project });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateRows(
  raw: RawRow[],
  ctx: ValidateContext,
): ValidatedRow[] {
  const orgByName = new Map(
    ctx.refData.organizations.map((o) => [o.name.trim().toLowerCase(), o]),
  );
  const projByName = new Map(
    ctx.refData.projects.map((p) => [p.name.trim().toLowerCase(), p]),
  );
  const roleSet = new Set(ctx.refData.roles.map((r) => r.trim().toLowerCase()));
  const seenEmails = new Map<string, number>();

  return raw.map((r) => {
    const errors: RowError[] = [];
    const userName = r.userName.trim();
    const email = r.email.trim();
    const emailLc = email.toLowerCase();
    const roleName = r.role.trim();

    if (!userName) errors.push({ field: "userName", message: "User Name is required" });

    if (!email) {
      errors.push({ field: "email", message: "Email Address is required" });
    } else if (!BULK_EMAIL_REGEX.test(email)) {
      errors.push({ field: "email", message: "Invalid email format" });
    }

    if (!roleName) {
      errors.push({ field: "role", message: "Role is required" });
    } else if (!roleSet.has(roleName.toLowerCase())) {
      errors.push({ field: "role", message: `Role '${roleName}' does not exist` });
    }

    const scopeRaw = r.scope.trim().toLowerCase();
    let scope: "org" | "project" | null = null;
    if (scopeRaw === "organization" || scopeRaw === "org") scope = "org";
    else if (scopeRaw === "project") scope = "project";
    else
      errors.push({
        field: "scope",
        message: "Scope must be 'Organization' or 'Project'",
      });

    let organizationIds: string[] = [];
    let projectIds: string[] = [];

    if (scope === "org") {
      const value = r.organization.trim();
      if (!value) {
        errors.push({
          field: "organization",
          message: "Organization is required for Organization scope",
        });
      } else if (value.toUpperCase() === "ALL") {
        organizationIds = [SCOPE_ID_ALL];
      } else {
        for (const name of value.split(",").map((s) => s.trim()).filter(Boolean)) {
          const match = orgByName.get(name.toLowerCase());
          if (!match)
            errors.push({
              field: "organization",
              message: `Organization '${name}' not found or not accessible`,
            });
          else organizationIds.push(match.id);
        }
      }
    } else if (scope === "project") {
      const value = r.project.trim();
      if (!value) {
        errors.push({
          field: "project",
          message: "Project is required for Project scope",
        });
      } else if (value.toUpperCase() === "ALL") {
        projectIds = [SCOPE_ID_ALL];
      } else {
        for (const name of value.split(",").map((s) => s.trim()).filter(Boolean)) {
          const match = projByName.get(name.toLowerCase());
          if (!match)
            errors.push({
              field: "project",
              message: `Project '${name}' not found or not accessible`,
            });
          else projectIds.push(match.id);
        }
      }
    }

    // Track duplicate reasons separately so a pure duplicate is shown as
    // "duplicate" (not a generic "error"), while a row that ALSO has other
    // problems is still surfaced as an "error".
    let inFileDuplicate = false;
    let activeDuplicate = false;
    if (email) {
      if (seenEmails.has(emailLc)) {
        inFileDuplicate = true;
        errors.push({
          field: "email",
          message: `Duplicate email in file (first seen on row ${seenEmails.get(emailLc)})`,
        });
      } else {
        seenEmails.set(emailLc, r.rowNumber);
      }

      const existing = ctx.existingByEmail.get(emailLc);
      if (existing) {
        if (!existing.isDeleted) {
          activeDuplicate = true;
          errors.push({
            field: "email",
            message: "User already exists in this tenant",
          });
        }
        // soft-deleted in this tenant -> allowed (reactivation)
      }
    }

    const duplicateReasonCount = (inFileDuplicate ? 1 : 0) + (activeDuplicate ? 1 : 0);
    const otherErrorCount = errors.length - duplicateReasonCount;

    let status: RowStatus;
    let payload: CreatePayload | undefined;
    if (otherErrorCount > 0) {
      status = "error";
    } else if (inFileDuplicate || activeDuplicate) {
      status = "duplicate";
    } else {
      status = "valid";
      payload = {
        email,
        displayName: userName,
        role: roleName,
        scope: scope as "org" | "project",
        organizationIds,
        projectIds,
      };
    }

    return {
      rowNumber: r.rowNumber,
      data: {
        userName,
        email,
        role: roleName,
        scope: r.scope.trim(),
        organization: r.organization.trim(),
        project: r.project.trim(),
      },
      status,
      errors,
      payload,
    };
  });
}

export function summarize(rows: ValidatedRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    errors: rows.filter((r) => r.status === "error").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
  };
}

// ---------------------------------------------------------------------------
// Lookups + create
// ---------------------------------------------------------------------------

export async function loadExistingByEmail(
  emails: string[],
  tenantId: string,
): Promise<Map<string, ExistingUserInfo>> {
  const map = new Map<string, ExistingUserInfo>();
  const distinct = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );
  if (distinct.length === 0) return map;

  const rows = await db
    .select({
      email: users.email,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        inArray(sql<string>`lower(${users.email})`, distinct),
      ),
    );

  for (const row of rows) {
    map.set(row.email.toLowerCase(), {
      isDeleted: Boolean(row.isDeleted),
    });
  }
  return map;
}

export interface CreateOpts {
  tenantId: string;
  provider: string;
  actorUserId: string;
}

export async function createBulkUser(
  payload: CreatePayload,
  opts: CreateOpts,
): Promise<{ userId: string; reactivated: boolean }> {
  const scope = payload.scope;
  const ids = scope === "org" ? payload.organizationIds : payload.projectIds;
  const useAll = ids.length === 0 || ids.includes(SCOPE_ID_ALL);
  const scopeId = useAll ? SCOPE_ID_ALL : ids.join(",");

  // Everything (user row + role + memberships + audit) happens in a single
  // transaction so a partial failure never leaves an orphaned account.
  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, opts.tenantId),
          sql`lower(${users.email}) = ${payload.email.toLowerCase()}`,
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    // Active duplicates are filtered out during validation, so this is a guard.
    if (existing && !existing.isDeleted) {
      throw new Error("User already exists");
    }

    let targetUserId: string;
    const reactivated = Boolean(existing?.isDeleted);

    if (existing && existing.isDeleted) {
      targetUserId = existing.id;
      await tx
        .update(users)
        .set({ isDeleted: false, deletedAt: null, displayName: payload.displayName })
        .where(eq(users.id, targetUserId));
    } else {
      targetUserId = randomUUID();
      const inviteAzureOid = `invite-${randomUUID()}`;
      await tx.insert(users).values({
        id: targetUserId,
        email: payload.email,
        displayName: payload.displayName,
        tenantId: opts.tenantId,
        provider: opts.provider,
        azureOid: inviteAzureOid,
        providerUserId: payload.email,
        createdAt: new Date(),
      });
    }

    let roleRec = await tx
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.name, payload.role))
      .limit(1);
    if (roleRec.length === 0) {
      await tx.insert(rolesTable).values({ name: payload.role });
      roleRec = await tx
        .select()
        .from(rolesTable)
        .where(eq(rolesTable.name, payload.role))
        .limit(1);
    }
    const roleRow = roleRec[0];
    if (!roleRow) throw new Error(`Failed to resolve role '${payload.role}'`);

    // On reactivation, clear ALL prior role assignments and member rows for this
    // user in this tenant so a re-onboarded user never carries stale access from
    // before deletion. (Mirrors the single-user reactivation flow.)
    if (reactivated) {
      await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, targetUserId),
            eq(userRoles.tenantId, opts.tenantId),
          ),
        );
      await tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, targetUserId),
            eq(organizationMembers.tenantId, opts.tenantId),
            eq(organizationMembers.role, "member"),
          ),
        );
      await tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.userId, targetUserId),
            eq(projectMembers.tenantId, opts.tenantId),
            eq(projectMembers.role, "member"),
          ),
        );
    }

    await tx.insert(userRoles).values({
      id: randomUUID(),
      userId: targetUserId,
      tenantId: opts.tenantId,
      provider: opts.provider,
      roleId: roleRow.id,
      scopeType: scope,
      scopeId,
      createdBy: opts.actorUserId,
    });

    if (!useAll) {
      for (const id of ids) {
        if (scope === "org") {
          await tx.insert(organizationMembers).values({
            id: randomUUID(),
            userId: targetUserId,
            tenantId: opts.tenantId,
            organizationId: id,
            role: "member",
            invitedBy: opts.actorUserId,
          });
        } else {
          await tx.insert(projectMembers).values({
            id: randomUUID(),
            userId: targetUserId,
            tenantId: opts.tenantId,
            projectId: id,
            role: "member",
            invitedBy: opts.actorUserId,
          });
        }
      }
    }

    try {
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actorUserId: opts.actorUserId,
        targetUserId,
        action: "ROLE_ASSIGNED",
        role: payload.role,
        tenantId: opts.tenantId,
        projectId: scope === "project" && !useAll ? ids[0] : null,
      });
    } catch (auditError) {
      console.warn("[BulkUsers] audit log failed:", auditError);
    }

    return { userId: targetUserId, reactivated };
  });
}
