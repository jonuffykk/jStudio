import type { Layout } from './geometry.ts'
import { metrics } from './theme.ts'
import type { Value } from './values.ts'

export type Preset = {
  props?: Record<string, Value>
  layout?: Layout
  helpers?: { class: string; name: string; props: Record<string, Value> }[]
  states?: Record<string, Record<string, Value>>
}

const corner = (radius = metrics.radius) => ({
  class: 'UICorner',
  name: 'Corner',
  props: { CornerRadius: radius },
})

const stroke = (color = 'line', thickness = metrics.stroke) => ({
  class: 'UIStroke',
  name: 'Stroke',
  props: { Color: color, Thickness: thickness },
})

/**
 * Named looks, resolved in the app. A node says `style: "primary"` and gets a
 * button that already has its radius, its type and its three states.
 */
export const styles: Record<string, Preset> = {
  screen: {
    props: { ResetOnSpawn: false, IgnoreGuiInset: true, ZIndexBehavior: 'Sibling' },
  },

  panel: {
    props: { BackgroundColor3: 'surface', BorderSizePixel: 0 },
    layout: { padding: metrics.pad, direction: 'vertical', gap: metrics.gap },
    helpers: [corner(), stroke()],
  },

  card: {
    props: { BackgroundColor3: 'surfaceHigh', BorderSizePixel: 0 },
    layout: { padding: 12, direction: 'vertical', gap: 6 },
    helpers: [corner(metrics.radiusSmall)],
  },

  blank: {
    props: { BackgroundTransparency: 1, BorderSizePixel: 0 },
  },

  title: {
    props: {
      BackgroundTransparency: 1,
      TextColor3: 'text',
      Font: 'GothamBold',
      TextSize: 22,
      TextXAlignment: 'Left',
      TextWrapped: true,
    },
    layout: { width: 'fill', height: 'hug' },
  },

  subtitle: {
    props: {
      BackgroundTransparency: 1,
      TextColor3: 'textDim',
      Font: 'Gotham',
      TextSize: 15,
      TextXAlignment: 'Left',
      TextWrapped: true,
    },
    layout: { width: 'fill', height: 'hug' },
  },

  body: {
    props: {
      BackgroundTransparency: 1,
      TextColor3: 'text',
      Font: 'Gotham',
      TextSize: 14,
      TextXAlignment: 'Left',
      TextWrapped: true,
    },
    layout: { width: 'fill', height: 'hug' },
  },

  caption: {
    props: {
      BackgroundTransparency: 1,
      TextColor3: 'textFaint',
      Font: 'Gotham',
      TextSize: 12,
      TextXAlignment: 'Left',
    },
    layout: { width: 'fill', height: 'hug' },
  },

  primary: {
    props: {
      BackgroundColor3: 'primary',
      TextColor3: 'onPrimary',
      Font: 'GothamBold',
      TextSize: 16,
      AutoButtonColor: false,
      BorderSizePixel: 0,
    },
    layout: { width: 'fill', height: { px: metrics.control } },
    helpers: [corner(metrics.radiusSmall)],
    states: {
      Hover: { BackgroundColor3: 'primaryHover' },
      Pressed: { BackgroundColor3: 'primaryPressed' },
    },
  },

  secondary: {
    props: {
      BackgroundColor3: 'surfaceHigh',
      TextColor3: 'text',
      Font: 'GothamMedium',
      TextSize: 16,
      AutoButtonColor: false,
      BorderSizePixel: 0,
    },
    layout: { width: 'fill', height: { px: metrics.control } },
    helpers: [corner(metrics.radiusSmall), stroke()],
    states: { Hover: { BackgroundColor3: 'line' } },
  },

  ghost: {
    props: {
      BackgroundTransparency: 1,
      TextColor3: 'textDim',
      Font: 'GothamMedium',
      TextSize: 15,
      AutoButtonColor: false,
    },
    layout: { width: 'fill', height: { px: metrics.control } },
    helpers: [corner(metrics.radiusSmall)],
    states: { Hover: { BackgroundTransparency: 0.9, TextColor3: 'text' } },
  },

  danger: {
    props: {
      BackgroundColor3: 'danger',
      TextColor3: 'onDanger',
      Font: 'GothamBold',
      TextSize: 16,
      AutoButtonColor: false,
      BorderSizePixel: 0,
    },
    layout: { width: 'fill', height: { px: metrics.control } },
    helpers: [corner(metrics.radiusSmall)],
    states: { Hover: { BackgroundTransparency: 0.1 } },
  },

  input: {
    props: {
      BackgroundColor3: 'background',
      TextColor3: 'text',
      PlaceholderColor3: 'textFaint',
      Font: 'Gotham',
      TextSize: 15,
      TextXAlignment: 'Left',
      ClearTextOnFocus: false,
      BorderSizePixel: 0,
    },
    layout: { width: 'fill', height: { px: metrics.control } },
    helpers: [
      corner(metrics.radiusSmall),
      stroke(),
      { class: 'UIPadding', name: 'Padding', props: { PaddingLeft: 12, PaddingRight: 12 } },
    ],
  },

  list: {
    props: { BackgroundTransparency: 1, BorderSizePixel: 0, ScrollBarThickness: 4 },
    layout: { width: 'fill', direction: 'vertical', gap: metrics.gap },
    helpers: [],
  },

  divider: {
    props: { BackgroundColor3: 'line', BorderSizePixel: 0 },
    layout: { width: 'fill', height: { px: 1 } },
  },

  badge: {
    props: {
      BackgroundColor3: 'surfaceHigh',
      TextColor3: 'textDim',
      Font: 'GothamMedium',
      TextSize: 12,
    },
    layout: { width: 'hug', height: { px: 22 }, padding: [0, 8, 0, 8] },
    helpers: [corner(999)],
  },
}

export const styleNames = Object.keys(styles)
