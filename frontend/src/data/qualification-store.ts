import { evaluateDocs } from '@/api/qualification-rules'
import type {
  ExitCheckItem,
  QualificationFiling,
  QualificationState,
  UploadedDocument,
} from './qualification-types'

// 资质归档域独立持久化，不与通用清单混用同一个 storage key。
const QUALIFICATION_KEY = 'underground-pipeline-inspection:qualification'

function doc(
  partial: Omit<UploadedDocument, 'uploadedBy' | 'uploadedAt'>,
): UploadedDocument {
  return {
    ...partial,
    uploadedBy: '王审核',
    uploadedAt: partial.validFrom < '2026-05-01' ? '2026-04-20 09:30' : '2026-09-18 14:10',
  }
}

// 示例备案：CONT-0003 保留一版已过期的旧资质，用来演示历史版本、拦截作业与退场核查。
function buildSeed(): QualificationState {
  const filing1: QualificationFiling = {
    id: 1,
    contractorId: 2,
    teamCode: 'CONT-0002',
    version: 1,
    packageToken: 'PKG-CONT-0002-1',
    reviewer: '王审核',
    filedAt: '2026-03-15 10:05',
    validUntil: '2026-08-31',
    status: '校验通过',
    docs: [
      doc({
        slot: 'qualification',
        fileName: '市政公用工程施工总承包贰级-2023.pdf',
        fileSize: 1_820_000,
        checksum: 'seed-0002-q-v1',
        certNo: 'D244030221',
        scope: '市政公用工程施工总承包贰级（含城市排水管道施工）',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2023-09-01',
        validUntil: '2026-08-31',
      }),
      doc({
        slot: 'special_cert',
        fileName: '特种作业操作证-2023批次.pdf',
        fileSize: 960_000,
        checksum: 'seed-0002-s-v1',
        certNo: 'T4403002023004512',
        scope: '焊接与热切割作业、有限空间作业',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2023-03-01',
        validUntil: '2029-03-01',
      }),
      doc({
        slot: 'enterprise',
        fileName: '营业执照-2023.pdf',
        fileSize: 1_240_000,
        checksum: 'seed-0002-e-v1',
        certNo: '91440300MA5F2K7X11',
        scope: '各类工程建设活动（依法须经批准的项目，经相关部门批准后方可开展经营活动）',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2018-06-12',
        validUntil: '长期',
      }),
    ],
    checks: [],
    notes: '历史版本：上一备案周期归档，企业资质已于 2026-08-31 到期。',
  }

  const filing2: QualificationFiling = {
    id: 2,
    contractorId: 2,
    teamCode: 'CONT-0002',
    version: 2,
    packageToken: 'PKG-CONT-0002-2',
    reviewer: '王审核',
    filedAt: '2026-09-18 14:10',
    validUntil: '2029-09-01',
    status: '校验通过',
    docs: [
      doc({
        slot: 'qualification',
        fileName: '市政公用工程施工总承包贰级-2026.pdf',
        fileSize: 1_860_000,
        checksum: 'seed-0002-q-v2',
        certNo: 'D2440300222',
        scope: '市政公用工程施工总承包贰级（含城市排水管道、地下管网工程施工）',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2026-09-01',
        validUntil: '2029-09-01',
      }),
      doc({
        slot: 'special_cert',
        fileName: '特种作业操作证-2026批次.pdf',
        fileSize: 980_000,
        checksum: 'seed-0002-s-v2',
        certNo: 'T4403002026007788',
        scope: '焊接与热切割作业、有限空间作业、高处作业',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2026-03-01',
        validUntil: '2032-03-01',
      }),
      doc({
        slot: 'enterprise',
        fileName: '营业执照-2026.pdf',
        fileSize: 1_260_000,
        checksum: 'seed-0002-e-v2',
        certNo: '91440300MA5F2K7X11',
        scope: '各类工程建设活动',
        enterprise: '深圳市畅通市政建设有限公司',
        validFrom: '2018-06-12',
        validUntil: '长期',
      }),
    ],
    checks: [],
    notes: '当前有效版本：企业资质换证后重新归档。',
  }

  const filing3: QualificationFiling = {
    id: 3,
    contractorId: 3,
    teamCode: 'CONT-0003',
    version: 1,
    packageToken: 'PKG-CONT-0003-1',
    reviewer: '李审核',
    filedAt: '2026-02-10 11:20',
    validUntil: '2026-09-30',
    status: '校验通过',
    docs: [
      doc({
        slot: 'qualification',
        fileName: '市政公用工程施工总承包叁级.pdf',
        fileSize: 1_710_000,
        checksum: 'seed-0003-q-v1',
        certNo: 'D344030886',
        scope: '市政公用工程施工总承包叁级（含排水管道维修）',
        enterprise: '广州鑫达管线工程有限公司',
        validFrom: '2023-10-01',
        validUntil: '2026-09-30',
      }),
      doc({
        slot: 'special_cert',
        fileName: '特种作业操作证-鑫达.pdf',
        fileSize: 870_000,
        checksum: 'seed-0003-s-v1',
        certNo: 'T4401002023009921',
        scope: '有限空间作业',
        enterprise: '广州鑫达管线工程有限公司',
        validFrom: '2023-02-15',
        validUntil: '2029-02-15',
      }),
      doc({
        slot: 'enterprise',
        fileName: '营业执照-鑫达.pdf',
        fileSize: 1_180_000,
        checksum: 'seed-0003-e-v1',
        certNo: '91440101MA9T3B8Y66',
        scope: '各类工程建设活动',
        enterprise: '广州鑫达管线工程有限公司',
        validFrom: '2019-03-20',
        validUntil: '长期',
      }),
    ],
    checks: [],
    notes: '队伍仍在作业中，企业资质 2026-09-30 到期后未续传。',
  }

  const exit: ExitCheckItem = {
    id: 1,
    contractorId: 3,
    teamCode: 'CONT-0003',
    teamName: '广州鑫达管线工程有限公司第三施工队',
    reason: '资质过期',
    source: '资质巡检',
    createdAt: '2026-10-01 08:00',
    status: '待核查',
    detail: '企业资质证书已于 2026-09-30 到期，队伍当前处于作业中，需核查人员、设备退场。',
    filingId: 3,
  }

  // 历史版本的逐条校验结果按今天重算：filing1 的企业资质已过期，filing3 同样过期。
  for (const [filing, enterprise] of [
    [filing1, '深圳市畅通市政建设有限公司'],
    [filing2, '深圳市畅通市政建设有限公司'],
    [filing3, '广州鑫达管线工程有限公司'],
  ] as const) {
    filing.checks = evaluateDocs(filing.docs, enterprise)
    filing.status = filing.checks.every((check) => check.passed) ? '校验通过' : '校验未通过'
  }

  return {
    filings: [filing1, filing2, filing3],
    sessions: [],
    exitChecks: [exit],
    seqFiling: 3,
    seqExit: 1,
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): QualificationState {
  const fallback = buildSeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(QUALIFICATION_KEY)
  if (!raw) {
    window.localStorage.setItem(QUALIFICATION_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QualificationState>
    return {
      filings: parsed.filings ?? fallback.filings,
      sessions: parsed.sessions ?? [],
      exitChecks: parsed.exitChecks ?? fallback.exitChecks,
      seqFiling: parsed.seqFiling ?? fallback.seqFiling,
      seqExit: parsed.seqExit ?? fallback.seqExit,
    }
  } catch {
    window.localStorage.setItem(QUALIFICATION_KEY, JSON.stringify(fallback))
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

export function saveQualificationState(state: QualificationState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUALIFICATION_KEY, JSON.stringify(state))
  }
}

export function resetQualificationState(): QualificationState {
  const fresh = buildSeed()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUALIFICATION_KEY, JSON.stringify(fresh))
  }
  cache = clone(fresh)
  return cache
}

export function qualificationStorageKey(): string {
  return QUALIFICATION_KEY
}
