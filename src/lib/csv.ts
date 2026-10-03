/** RFC-4180-ish CSV serializer (with BOM so Excel opens UTF-8 correctly). */
export function toCsv(rows: (string | number)[][]) {
  const out = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return `\uFEFF${out}`;
}

/**
 * Trigger a client-side CSV download named after the dataset and date.
 *
 * - Guarantees the UTF-8 BOM is present even when the caller built the CSV
 *   by hand — without it Excel/Sheets decode Arabic and other non-Latin text
 *   with the system codepage and show nonsense.
 * - Defers revoking the object URL: some browsers (notably Android WebView)
 *   truncate or corrupt a download whose URL is revoked synchronously right
 *   after click() — which also surfaces as garbage in the opened file.
 */
export function downloadCsv(filename: string, csv: string) {
  const withBom = csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}
