import { useEffect, useState } from 'react'
import api from '../../lib/api'

interface Extension {
  plugin: string
  slot: string
  label?: string
  url?: string
  icon?: string
}

export default function ExtensionSlot({ name, className = '' }: { name: string; className?: string }) {
  const [items, setItems] = useState<Extension[]>([])

  useEffect(() => {
    let cancelled = false
    api.get('/plugins/ui-extensions')
      .then(({ data }) => {
        if (cancelled) return
        setItems((data?.extensions || []).filter((x: Extension) => x.slot === name))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [name])

  if (items.length === 0) return null

  return (
    <div className={className}>
      {items.map((item, i) => (
        item.url ? (
          <a key={i} href={item.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:text-gray-100">
            {item.label || item.plugin}
          </a>
        ) : (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-xs text-gray-300">
            {item.label || item.plugin}
          </span>
        )
      ))}
    </div>
  )
}
