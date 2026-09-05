'use client'

import { useEffect } from 'react'
import { groupModels, pickDefaultModel, type ModelInfo } from '@/app/lib/models'
import { useStore } from '@/app/lib/state'
import { Icon, Spinner } from '@/app/ui/primitives'

/** Loads the provider catalogue whenever the provider or the key changes. */
export function useCatalog(): { list: ModelInfo[]; loading: boolean } {
  const store = useStore()
  const { settings, apiKey, models, modelsLoading } = store
  const list = models[settings.providerId] ?? []

  useEffect(() => {
    void store
      .loadModels()
      .then((loaded) => {
        if (loaded.length === 0) return
        if (!loaded.some((entry) => entry.id === settings.model)) {
          void store.patchSettings({ model: pickDefaultModel(loaded.map((entry) => entry.id)) })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId, apiKey])

  return { list, loading: modelsLoading }
}

/** The one model picker, used everywhere outside the chat composer. */
export function ModelSelect({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const { t } = useStore()
  const { list, loading } = useCatalog()

  const known = list.length > 0 ? list : value ? [{ id: value, label: value } as ModelInfo] : []
  const groups = groupModels(known)

  return (
    <div className="relative">
      <select
        value={value}
        disabled={loading && list.length === 0}
        aria-label={t('settings.model')}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 pr-8 text-sm text-text outline-none transition-colors focus:border-focus disabled:opacity-60"
      >
        {groups.length === 0 ? <option value="">{t('settings.noModels')}</option> : null}
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
                {model.free ? ` · ${t('settings.free')}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
        {loading ? (
          <Spinner className="size-3.5" />
        ) : (
          <Icon name="chevron" className="size-3.5 rotate-90 text-faint" />
        )}
      </span>
    </div>
  )
}
