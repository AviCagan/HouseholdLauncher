import { useEffect, useState } from 'react'
import { useData } from '@/store/useData'
import { cachedPreview, listFolders, preview, useDrive, type DriveFolder } from './drive'

/** A Drive file's picture, fetched once and cached; `fallback` until it arrives. */
export function usePreview(fileId: string | null, size: number, fallback: string | null = null): string | null {
  const connected = useDrive((s) => s.status?.connected === true)
  const [url, setUrl] = useState<string | null>(() => (fileId ? cachedPreview(fileId, size) : null))

  useEffect(() => {
    setUrl(fileId ? cachedPreview(fileId, size) : null)
    if (!fileId || !connected) return
    let alive = true
    void preview(fileId, size).then((u) => {
      if (alive && u) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [fileId, size, connected])

  return url ?? fallback
}

/** Folders in the Warranties folder that no item points at yet. */
export function useUnlinkedFolders(): { folders: DriveFolder[]; loading: boolean; reload: () => void } {
  const connected = useDrive((s) => s.status?.connected === true)
  const items = useData((s) => s.inventory_items)
  const [all, setAll] = useState<DriveFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!connected) return
    let alive = true
    setLoading(true)
    listFolders()
      .then((f) => alive && setAll(f))
      .catch(() => alive && setAll([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [connected, tick])

  const linked = new Set(items.map((i) => i.drive_folder_id).filter(Boolean))
  return { folders: all.filter((f) => !linked.has(f.id)), loading, reload: () => setTick((t) => t + 1) }
}
