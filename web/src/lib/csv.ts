// Minimal RFC 4180 CSV parser. PapaParse'a bağımlılık eklemiyoruz —
// kullanıcı verisi için makul boyutta yeterli ve güvenli.

export type CSVRow = Record<string, string>

export type CSVParseResult = {
  headers: string[]
  rows: CSVRow[]
  warnings: string[]
}

export function parseCSV(input: string): CSVParseResult {
  const warnings: string[] = []
  const records: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip BOM
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1)

  while (i < input.length) {
    const c = input[i]

    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          // escaped quote
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"') {
      // Quote may only start at field beginning
      if (field.length > 0) warnings.push(`row ${records.length + 1}: quote in middle of field`)
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      cur.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r' && input[i + 1] === '\n') {
      cur.push(field)
      records.push(cur)
      cur = []
      field = ''
      i += 2
      continue
    }
    if (c === '\n' || c === '\r') {
      cur.push(field)
      records.push(cur)
      cur = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  // last field
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    records.push(cur)
  }

  if (records.length === 0) {
    return { headers: [], rows: [], warnings }
  }

  const headers = records[0].map((h) => h.trim())
  const rows: CSVRow[] = records.slice(1).map((rec, idx) => {
    const r: CSVRow = {}
    if (rec.length !== headers.length) {
      warnings.push(`row ${idx + 2}: ${rec.length} columns, expected ${headers.length}`)
    }
    headers.forEach((h, j) => {
      r[h] = (rec[j] ?? '').trim()
    })
    return r
  })

  // Drop trivially-empty rows (all blank)
  const cleaned = rows.filter((r) => Object.values(r).some((v) => v.length > 0))

  return { headers, rows: cleaned, warnings }
}

// Generate CSV string from rows; for password export.
export function toCSV(headers: string[], rows: Record<string, string>[]): string {
  const escape = (v: string) => {
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h] ?? '')).join(','))
  }
  return lines.join('\n')
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
