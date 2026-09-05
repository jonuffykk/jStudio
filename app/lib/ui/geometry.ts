import { metrics } from './theme.ts'
import type { Value } from './values.ts'

/** Size on one axis: fill the parent, hug the content, or a measured amount. */
export type Extent = 'fill' | 'hug' | { scale?: number; px?: number; min?: number; max?: number }

export type Anchor =
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'center'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'

export type Layout = {
  anchor?: Anchor
  width?: Extent
  height?: Extent
  direction?: 'vertical' | 'horizontal' | 'grid'
  gap?: number
  padding?: number | [number, number, number, number]
  align?: 'start' | 'center' | 'end'
  justify?: 'start' | 'center' | 'end'
  cell?: [number, number]
}

const anchors: Record<Anchor, [number, number]> = {
  topLeft: [0, 0],
  top: [0.5, 0],
  topRight: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottomLeft: [0, 1],
  bottom: [0.5, 1],
  bottomRight: [1, 1],
}

const across = { start: 'Left', center: 'Center', end: 'Right' } as const
const along = { start: 'Top', center: 'Center', end: 'Bottom' } as const

type Axis = { scale: number; offset: number; automatic: boolean; min?: number; max?: number }

function axis(extent: Extent | undefined): Axis {
  if (extent === 'fill') return { scale: 1, offset: 0, automatic: false }
  if (extent === 'hug' || extent === undefined) return { scale: 0, offset: 0, automatic: true }

  return {
    scale: extent.scale ?? 0,
    offset: extent.px ?? 0,
    automatic: extent.scale === undefined && extent.px === undefined,
    min: extent.min,
    max: extent.max,
  }
}

export type Resolved = {
  props: Record<string, Value>
  helpers: { class: string; name: string; props: Record<string, Value> }[]
}

/**
 * Intent becomes geometry here, once, instead of in the model's head: anchors,
 * UDim2, AutomaticSize, padding and the layout that arranges the children.
 */
export function resolveLayout(layout: Layout | undefined, hasChildren: boolean): Resolved {
  const props: Record<string, Value> = {}
  const helpers: Resolved['helpers'] = []

  if (!layout) return { props, helpers }

  if (layout.anchor) {
    const [x, y] = anchors[layout.anchor]
    props.AnchorPoint = [x, y]
    props.Position = [x, 0, y, 0]
  }

  const width = axis(layout.width)
  const height = axis(layout.height)

  if (layout.width !== undefined || layout.height !== undefined) {
    props.Size = [width.scale, width.offset, height.scale, height.offset]

    const grows = width.automatic && height.automatic ? 'XY' : width.automatic ? 'X' : height.automatic ? 'Y' : ''
    if (grows) props.AutomaticSize = grows

    if (width.min || width.max || height.min || height.max) {
      helpers.push({
        class: 'UISizeConstraint',
        name: 'Bounds',
        props: {
          MinSize: [width.min ?? 0, height.min ?? 0],
          MaxSize: [width.max ?? 1e6, height.max ?? 1e6],
        },
      })
    }
  }

  const pad = layout.padding
  if (pad !== undefined) {
    const [top, right, bottom, left] = typeof pad === 'number' ? [pad, pad, pad, pad] : pad
    helpers.push({
      class: 'UIPadding',
      name: 'Padding',
      props: {
        PaddingTop: top,
        PaddingRight: right,
        PaddingBottom: bottom,
        PaddingLeft: left,
      },
    })
  }

  if (layout.direction && hasChildren) {
    const gap = layout.gap ?? metrics.gap

    if (layout.direction === 'grid') {
      const [cellWidth, cellHeight] = layout.cell ?? [120, 120]
      helpers.push({
        class: 'UIGridLayout',
        name: 'Layout',
        props: {
          CellSize: [0, cellWidth, 0, cellHeight],
          CellPadding: [0, gap, 0, gap],
          SortOrder: 'LayoutOrder',
          HorizontalAlignment: across[layout.justify ?? 'center'],
        },
      })
    } else {
      const vertical = layout.direction === 'vertical'
      helpers.push({
        class: 'UIListLayout',
        name: 'Layout',
        props: {
          FillDirection: vertical ? 'Vertical' : 'Horizontal',
          Padding: gap,
          SortOrder: 'LayoutOrder',
          HorizontalAlignment: across[(vertical ? layout.align : layout.justify) ?? 'center'],
          VerticalAlignment: along[(vertical ? layout.justify : layout.align) ?? 'center'],
        },
      })
    }
  }

  return { props, helpers }
}
