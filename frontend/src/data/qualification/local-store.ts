import { QUALIFICATION_SEED_EXIT_CHECKS, QUALIFICATION_SEED_RECORDS } from './seed'
import type { QualificationState } from './types'

// 资质归档域单独存一份：归档包、备案版本、上传会话、退场事项都在这里持久化。
const STORAGE_KEY = 'underground-pipeline-inspection:qualification'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): QualificationState {
  return {
    records: clone(QUALIFICATION_SEED_RECORDS),
    packages: [],
    sessions: [],
    exitChecks: clone(QUALIFICATION_SEED_EXIT_CHECKS),
    seq: 100,
  }
}

function readState(): QualificationState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QualificationState>
    return {
      records: parsed.records ?? clone(fallback.records),
      packages: parsed.packages ?? [],
      sessions: parsed.sessions ?? [],
      exitChecks: parsed.exitChecks ?? clone(fallback.exitChecks),
      seq: parsed.seq ?? fallback.seq,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: QualificationState | null = null

export function qualificationState(): QualificationState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function persistQualification(): void {
  if (cache && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function resetQualification(): QualificationState {
  cache = seedState()
  persistQualification()
  return cache
}

export function nextSeq(): number {
  const state = qualificationState()
  state.seq += 1
  persistQualification()
  return state.seq
}
