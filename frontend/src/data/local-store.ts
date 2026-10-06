import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'
// 种子结构调整后（如施工队伍示例换成真实资质数据）抬升版本，旧缓存自动重建。
const SEED_VERSION = 2
const VERSION_KEY = 'underground-pipeline-inspection:seed-version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeSeed(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(SEED_VERSION))
  }
  return fallback
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  if (window.localStorage.getItem(VERSION_KEY) !== String(SEED_VERSION)) {
    return writeSeed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return writeSeed()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    return writeSeed()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
