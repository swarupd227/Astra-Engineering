import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, AlertCircle, Copy } from "lucide-react";
import type { PreviewRow, RowStatus } from "./types";

const STATUS_META: Record<
  RowStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  valid: {
    label: "Valid",
    className: "text-emerald-600 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  error: {
    label: "Error",
    className: "text-rose-600 dark:text-rose-400",
    icon: AlertCircle,
  },
  duplicate: {
    label: "Duplicate",
    className: "text-amber-600 dark:text-amber-400",
    icon: Copy,
  },
};

export function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">
        No data rows were found in the uploaded file.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
      <div className="max-h-[42vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Details / Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const meta = STATUS_META[row.status];
              const Icon = meta.icon;
              const scopeLabel =
                row.data.scope +
                (row.data.organization
                  ? ` · ${row.data.organization}`
                  : row.data.project
                    ? ` · ${row.data.project}`
                    : "");
              return (
                <TableRow key={row.rowNumber}>
                  <TableCell className="text-muted-foreground">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.className}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    {row.data.userName || "—"}
                  </TableCell>
                  <TableCell>{row.data.email || "—"}</TableCell>
                  <TableCell>{row.data.role || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {scopeLabel || "—"}
                  </TableCell>
                  <TableCell>
                    {row.errors.length > 0 ? (
                      <ul className="space-y-0.5">
                        {row.errors.map((err, i) => (
                          <li
                            key={i}
                            className="text-xs text-rose-600 dark:text-rose-400"
                          >
                            {err.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Ready to create
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
