export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string }

const MAX_LINES = 4_000

/** Longest common subsequence over lines, trimmed to a context window around each change. */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split('\n').slice(0, MAX_LINES)
  const right = after.split('\n').slice(0, MAX_LINES)

  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  )

  for (let row = left.length - 1; row >= 0; row--) {
    for (let column = right.length - 1; column >= 0; column--) {
      table[row]![column] =
        left[row] === right[column]
          ? (table[row + 1]![column + 1] ?? 0) + 1
          : Math.max(table[row + 1]![column] ?? 0, table[row]![column + 1] ?? 0)
    }
  }

  const lines: DiffLine[] = []
  let row = 0
  let column = 0

  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      lines.push({ kind: 'same', text: left[row] ?? '' })
      row++
      column++
    } else if ((table[row + 1]![column] ?? 0) >= (table[row]![column + 1] ?? 0)) {
      lines.push({ kind: 'remove', text: left[row] ?? '' })
      row++
    } else {
      lines.push({ kind: 'add', text: right[column] ?? '' })
      column++
    }
  }

  while (row < left.length) lines.push({ kind: 'remove', text: left[row++] ?? '' })
  while (column < right.length) lines.push({ kind: 'add', text: right[column++] ?? '' })

  return lines
}

export type DiffStat = { added: number; removed: number }

export function diffStat(lines: DiffLine[]): DiffStat {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'remove').length,
  }
}

/** Drops long runs of untouched lines so the reader only sees what moved. */
export function condense(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Set<number>()

  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let offset = -context; offset <= context; offset++) keep.add(index + offset)
  })

  const output: DiffLine[] = []
  let gap = false

  lines.forEach((line, index) => {
    if (keep.has(index)) {
      output.push(line)
      gap = false
      return
    }
    if (!gap) {
      output.push({ kind: 'same', text: '⋯' })
      gap = true
    }
  })

  return output
}
