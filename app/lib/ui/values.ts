import { readColor, type Theme } from './theme.ts'

/** What a property accepts. The model sends JSON; this decides the Luau. */
export type Kind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'color'
  | 'udim'
  | 'udim2'
  | 'vector2'
  | 'rect'
  | 'gradient'
  | { enum: string }

export type Value = unknown

const quote = (value: string) =>
  `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`

const numbers = (value: unknown, count: number): number[] | null => {
  if (!Array.isArray(value) || value.length !== count) return null
  const parsed = value.map(Number)
  return parsed.every((entry) => Number.isFinite(entry)) ? parsed : null
}

/** One property value as a Luau literal, or null when the shape is wrong. */
export function encode(kind: Kind, value: Value, palette: Theme): string | null {
  if (typeof kind === 'object') {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(value)) return null
    return `Enum.${kind.enum}.${value}`
  }

  switch (kind) {
    case 'string':
      return typeof value === 'string' ? quote(value) : null

    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : null

    case 'boolean':
      return typeof value === 'boolean' ? String(value) : null

    case 'color': {
      const rgb = typeof value === 'string' ? readColor(value, palette) : null
      return rgb ? `Color3.fromRGB(${rgb.r}, ${rgb.g}, ${rgb.b})` : null
    }

    case 'udim': {
      if (typeof value === 'number') return `UDim.new(0, ${value})`
      const parts = numbers(value, 2)
      return parts ? `UDim.new(${parts[0]}, ${parts[1]})` : null
    }

    case 'udim2': {
      const parts = numbers(value, 4)
      return parts ? `UDim2.new(${parts.join(', ')})` : null
    }

    case 'vector2': {
      const parts = numbers(value, 2)
      return parts ? `Vector2.new(${parts.join(', ')})` : null
    }

    case 'rect': {
      const parts = numbers(value, 4)
      return parts ? `Rect.new(${parts.join(', ')})` : null
    }

    case 'gradient': {
      const stops = Array.isArray(value) ? value : []
      const colors = stops
        .map((stop) => (typeof stop === 'string' ? readColor(stop, palette) : null))
        .filter((rgb): rgb is NonNullable<typeof rgb> => rgb !== null)

      if (colors.length < 2) return null

      const keypoints = colors.map((rgb, index) => {
        const at = (index / (colors.length - 1)).toFixed(3)
        return `ColorSequenceKeypoint.new(${at}, Color3.fromRGB(${rgb.r}, ${rgb.g}, ${rgb.b}))`
      })

      return `ColorSequence.new({ ${keypoints.join(', ')} })`
    }

    default:
      return null
  }
}

const guiObject: Record<string, Kind> = {
  Visible: 'boolean',
  Active: 'boolean',
  ZIndex: 'number',
  LayoutOrder: 'number',
  Rotation: 'number',
  AnchorPoint: 'vector2',
  Position: 'udim2',
  Size: 'udim2',
  BackgroundColor3: 'color',
  BackgroundTransparency: 'number',
  BorderSizePixel: 'number',
  ClipsDescendants: 'boolean',
  Selectable: 'boolean',
  AutomaticSize: { enum: 'AutomaticSize' },
}

const text: Record<string, Kind> = {
  Text: 'string',
  TextColor3: 'color',
  TextSize: 'number',
  TextScaled: 'boolean',
  TextWrapped: 'boolean',
  TextTransparency: 'number',
  RichText: 'boolean',
  LineHeight: 'number',
  Font: { enum: 'Font' },
  TextXAlignment: { enum: 'TextXAlignment' },
  TextYAlignment: { enum: 'TextYAlignment' },
  TextTruncate: { enum: 'TextTruncate' },
}

const image: Record<string, Kind> = {
  Image: 'string',
  ImageColor3: 'color',
  ImageTransparency: 'number',
  ScaleType: { enum: 'ScaleType' },
  SliceCenter: 'rect',
  SliceScale: 'number',
  TileSize: 'udim2',
  ResampleMode: { enum: 'ResamplerMode' },
}

/** Every class a screen is made of, and what each one accepts. */
export const classes: Record<string, Record<string, Kind>> = {
  ScreenGui: {
    Enabled: 'boolean',
    ResetOnSpawn: 'boolean',
    IgnoreGuiInset: 'boolean',
    DisplayOrder: 'number',
    ZIndexBehavior: { enum: 'ZIndexBehavior' },
  },
  Frame: guiObject,
  CanvasGroup: { ...guiObject, GroupTransparency: 'number', GroupColor3: 'color' },
  ScrollingFrame: {
    ...guiObject,
    CanvasSize: 'udim2',
    AutomaticCanvasSize: { enum: 'AutomaticSize' },
    ScrollBarThickness: 'number',
    ScrollBarImageColor3: 'color',
    ScrollBarImageTransparency: 'number',
    ScrollingDirection: { enum: 'ScrollingDirection' },
    ElasticBehavior: { enum: 'ElasticBehavior' },
  },
  TextLabel: { ...guiObject, ...text },
  TextButton: { ...guiObject, ...text, AutoButtonColor: 'boolean', Modal: 'boolean' },
  TextBox: {
    ...guiObject,
    ...text,
    PlaceholderText: 'string',
    PlaceholderColor3: 'color',
    ClearTextOnFocus: 'boolean',
    MultiLine: 'boolean',
    TextEditable: 'boolean',
  },
  ImageLabel: { ...guiObject, ...image },
  ImageButton: { ...guiObject, ...image, AutoButtonColor: 'boolean' },
  ViewportFrame: { ...guiObject, Ambient: 'color', LightColor: 'color', LightDirection: 'vector2' },

  UICorner: { CornerRadius: 'udim' },
  UIStroke: {
    Color: 'color',
    Thickness: 'number',
    Transparency: 'number',
    ApplyStrokeMode: { enum: 'ApplyStrokeMode' },
    LineJoinMode: { enum: 'LineJoinMode' },
  },
  UIGradient: { Color: 'gradient', Rotation: 'number', Offset: 'vector2', Enabled: 'boolean' },
  UIPadding: {
    PaddingTop: 'udim',
    PaddingBottom: 'udim',
    PaddingLeft: 'udim',
    PaddingRight: 'udim',
  },
  UIListLayout: {
    Padding: 'udim',
    FillDirection: { enum: 'FillDirection' },
    HorizontalAlignment: { enum: 'HorizontalAlignment' },
    VerticalAlignment: { enum: 'VerticalAlignment' },
    SortOrder: { enum: 'SortOrder' },
    Wraps: 'boolean',
  },
  UIGridLayout: {
    CellSize: 'udim2',
    CellPadding: 'udim2',
    FillDirection: { enum: 'FillDirection' },
    HorizontalAlignment: { enum: 'HorizontalAlignment' },
    VerticalAlignment: { enum: 'VerticalAlignment' },
    SortOrder: { enum: 'SortOrder' },
    FillDirectionMaxCells: 'number',
  },
  UIScale: { Scale: 'number' },
  UIAspectRatioConstraint: {
    AspectRatio: 'number',
    AspectType: { enum: 'AspectType' },
    DominantAxis: { enum: 'DominantAxis' },
  },
  UISizeConstraint: { MinSize: 'vector2', MaxSize: 'vector2' },
  UITextSizeConstraint: { MinTextSize: 'number', MaxTextSize: 'number' },
}

export const isUiClass = (name: string) => name in classes

export type Written = { lines: string[]; skipped: string[] }

/** Turns one node's properties into assignments, naming what it had to drop. */
export function writeProps(
  variable: string,
  className: string,
  props: Record<string, Value>,
  palette: Theme
): Written {
  const known = classes[className]
  if (!known) return { lines: [], skipped: [`${className} is not a class this tool builds`] }

  const lines: string[] = []
  const skipped: string[] = []

  for (const [name, value] of Object.entries(props)) {
    const kind = known[name]
    if (!kind) {
      skipped.push(`${className}.${name}`)
      continue
    }

    const literal = encode(kind, value, palette)
    if (literal === null) {
      skipped.push(`${className}.${name}`)
      continue
    }

    lines.push(`${variable}.${name} = ${literal}`)
  }

  return { lines, skipped }
}
