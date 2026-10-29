/** CSV in and out: export a table, and read a file the person drops in. */
const cell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

export function downloadCsv(filename: string, rows: string[][]) {
  // A BOM so Excel opens accents (Rosé, Château) correctly.
  const blob = new Blob(['﻿' + rows.map((r) => r.map((v) => cell(v ?? '')).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
