/**
 * The palette a screen is built from. Tokens are resolved here, in the app, and
 * land in the place as plain Color3 and UDim values — nothing is written to the
 * game to make a theme work.
 */
export type Theme = Record<string, string>

export const theme: Theme = {
  background: '#0F1014',
  surface: '#171922',
  surfaceHigh: '#1F2230',
  line: '#2A2E3D',

  primary: '#6C5CE7',
  primaryHover: '#7D6FEB',
  primaryPressed: '#5A4BD1',
  onPrimary: '#FFFFFF',

  text: '#F2F3F7',
  textDim: '#A8AEC1',
  textFaint: '#6F7689',

  ok: '#37C08A',
  warn: '#E8B04B',
  danger: '#E5484D',
  onDanger: '#FFFFFF',
}

export type Rgb = { r: number; g: number; b: number }

/** #RGB, #RRGGBB or a token name. */
export function readColor(value: string, palette: Theme): Rgb | null {
  const raw = palette[value] ?? value
  const hex = raw.trim().replace(/^#/, '')

  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex

  if (!/^[0-9a-f]{6}$/i.test(full)) return null

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/** Sizes that keep a screen coherent without anyone thinking about them. */
export const metrics = {
  radius: 12,
  radiusSmall: 8,
  gap: 10,
  pad: 16,
  control: 44,
  stroke: 1,
}
