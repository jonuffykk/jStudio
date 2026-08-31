import { isDesktop } from '@/app/lib/ipc'

export async function checkUpdate(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const found = await check()
    return found?.version ?? null
  } catch {
    return null
  }
}

export async function installUpdate(): Promise<void> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const found = await check()
  if (!found) return

  await found.downloadAndInstall()
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}
