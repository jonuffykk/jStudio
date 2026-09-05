'use client'

import { useEffect, useState } from 'react'
import { images } from '@/app/lib/ipc'

const PREFIX = 'asset:'
const cache = new Map<string, string>()

export const isReference = (value: string) => value.startsWith(PREFIX)

/** Moves a data URL into the app folder and returns the reference stored in the transcript. */
export async function storeImage(dataUrl: string): Promise<string> {
  if (isReference(dataUrl)) return dataUrl

  try {
    const name = await images.save(dataUrl)
    const reference = `${PREFIX}${name}`
    cache.set(reference, dataUrl)
    return reference
  } catch {
    return dataUrl
  }
}

export async function resolveImage(value: string): Promise<string> {
  if (!isReference(value)) return value

  const cached = cache.get(value)
  if (cached) return cached

  const loaded = await images.load(value.slice(PREFIX.length)).catch(() => null)
  if (loaded) cache.set(value, loaded)
  return loaded ?? ''
}

export function useImage(value: string): string {
  const [src, setSrc] = useState(() => (isReference(value) ? (cache.get(value) ?? '') : value))

  useEffect(() => {
    let alive = true
    void resolveImage(value).then((resolved) => {
      if (alive) setSrc(resolved)
    })
    return () => {
      alive = false
    }
  }, [value])

  return src
}
