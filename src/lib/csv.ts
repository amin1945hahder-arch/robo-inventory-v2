/** RFC-4180-ish CSV serializer (with BOM so Excel opens UTF-8 correctly). */
export function toCsv(rows: (string | number)[][]) {
  const out = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return `\uFEFF${out}`;
}

/** Trigger a client-side CSV download named after the dataset and date. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
