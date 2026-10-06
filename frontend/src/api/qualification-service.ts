import { listRows } from '@/data/local-store'
import {
  qualificationState,
  saveQualificationState,
} from '@/data/qualification-store'
import {
  SLOT_META,
  earliestExpiry,
  evaluateDocs,
  slotMeta,
  todayText,
} from '@/api/qualification-rules'
import type { EntryRow } from '@/data/types'
import type {
  ExitCheckItem,
  GateResult,
  QualificationFiling,
  QualificationPackage,
  QualificationSlot,
  UploadSession,
  UploadStep,
  UploadStepKey,
  UploadedDocument,
} from '@/data/qualification-types'

const CONTRACTOR_KEY = 'contractor'

export { SLOT_META, slotMeta }

export const STEP_LABELS: Record<UploadStepKey, string> = {
  package: '接收归档包',
  qualification: '上传资质等级证书',
  special_cert: '上传特种作业操作证',
  enterprise: '上传所属企业材料',
  submit: '提交归档备案',
}

// ---------- 工具 ----------

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function tokenStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)}MB`
  }
  return `${Math.max(1, Math.round(size / 1024))}KB`
}

// 文件指纹：优先 Web Crypto 计算 SHA-256，非安全上下文降级为同步哈希。
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  const bytes = new Uint8Array(buffer)
  let hash = 5381
  for (const byte of bytes) {
    hash = ((hash << 5) + hash + byte) >>> 0
  }
  return `fallback-${hash.toString(16)}`
}

// ---------- 归档包打包下载 / 回导 ----------

export function buildPackage(row: EntryRow): QualificationPackage {
  return {
    packageToken: `PKG-${String(row['队伍编号'])}-${tokenStamp()}`,
    contractorId: Number(row.id),
    teamCode: String(row['队伍编号'] ?? ''),
    teamName: String(row['队伍名称'] ?? ''),
    qualificationGrade: String(row['资质等级'] ?? ''),
    enterprise: String(row['所属企业'] ?? ''),
    contact: String(row['联系人'] ?? ''),
    phone: String(row['联系电话'] ?? ''),
    exportedAt: nowText(),
    slots: SLOT_META.map((meta) => ({
      slot: meta.slot,
      label: meta.label,
      required: meta.required,
      hint: meta.hint,
    })),
  }
}

export function packageJson(pkg: QualificationPackage): string {
  return JSON.stringify(pkg, null, 2)
}

export function downloadPackage(row: EntryRow): void {
  const pkg = buildPackage(row)
  const blob = new Blob([jsonHeader(), packageJson(pkg)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `资质归档包-${pkg.teamCode}.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 纯前端环境没有打包工具，归档包用 UTF-8 JSON，文件头注明用途。
function jsonHeader(): string {
  return '【施工队伍资质文件归档包】请审核人按 slots 槽位补充证件材料后，在系统中上传。\n'
}

export function parsePackageText(text: string): QualificationPackage {
  const cleaned = text.replace(/^【[\s\S]*?】[^\n]*\n/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('归档包解析失败：不是系统导出的归档包文件')
  }
  const pkg = parsed as Partial<QualificationPackage>
  if (!pkg || typeof pkg !== 'object' || !pkg.packageToken || !pkg.teamCode) {
    throw new Error('归档包内容不完整：缺少归档包标识或队伍编号')
  }
  const rows = listRows(CONTRACTOR_KEY)
  const row = rows.find((item) => String(item['队伍编号']) === String(pkg.teamCode))
  if (!row) {
    throw new Error(`归档包对应队伍 ${pkg.teamCode} 不在施工队伍名册中`)
  }
  return { ...(pkg as QualificationPackage), contractorId: Number(row.id) }
}

// ---------- 逐条校验：有效期 / 作业范围 / 所属企业 ----------
// 纯规则在 qualification-rules.ts；这里做备案版本与准入编排。

export function listFilings(contractorId?: number): QualificationFiling[] {
  const { filings } = qualificationState()
  const sorted = [...filings].sort((a, b) => b.id - a.id)
  return contractorId === undefined
    ? sorted
    : sorted.filter((item) => item.contractorId === contractorId)
}

export function latestFiling(contractorId: number): QualificationFiling | undefined {
  return listFilings(contractorId)[0]
}

// 当前有效材料：按槽位取该槽位最新备案的那一份（重复文件不重传，旧版其余槽位继续有效）。
export function effectiveDocs(contractorId: number): UploadedDocument[] {
  const bySlot = new Map<QualificationSlot, UploadedDocument>()
  // listFilings 已按 id 倒序：先遇到的就是该槽位最新版本。
  for (const filing of listFilings(contractorId)) {
    for (const doc of filing.docs) {
      if (!bySlot.has(doc.slot)) {
        bySlot.set(doc.slot, doc)
      }
    }
  }
  return SLOT_META.map((meta) => bySlot.get(meta.slot)).filter(
    (doc): doc is UploadedDocument => Boolean(doc),
  )
}

// 资质准入：只有「资质过期」「证照缺失」两种硬性拦截，作业范围/企业问题留在备案校验里体现。
export function contractorGate(
  contractorId: number,
  today = todayText(),
): GateResult {
  const rows = listRows(CONTRACTOR_KEY)
  const row = rows.find((item) => Number(item.id) === contractorId)
  if (!row) {
    return { allowed: false, reason: '证照缺失', message: '施工队伍不存在' }
  }
  const latest = latestFiling(contractorId)
  if (!latest) {
    return {
      allowed: false,
      reason: '证照缺失',
      message: `${String(row['队伍编号'])} 尚无资质备案记录，证照缺失，不能安排作业`,
    }
  }
  const docsBySlot = new Map<QualificationSlot, UploadedDocument>()
  for (const doc of effectiveDocs(contractorId)) {
    docsBySlot.set(doc.slot, doc)
  }
  for (const meta of SLOT_META) {
    if (meta.required && !docsBySlot.has(meta.slot)) {
      return {
        allowed: false,
        reason: '证照缺失',
        message: `${String(row['队伍编号'])} 缺少${meta.label}，不能安排作业`,
        latest,
      }
    }
  }
  for (const doc of docsBySlot.values()) {
    const until = doc.validUntil.trim()
    if (until !== '' && until !== '长期' && until < today) {
      return {
        allowed: false,
        reason: '资质过期',
        message: `${String(row['队伍编号'])} 的${slotMeta(doc.slot).label}「${doc.fileName}」已于 ${until} 过期，不能安排作业`,
        latest,
      }
    }
  }
  return {
    allowed: true,
    reason: null,
    message: `${String(row['队伍编号'])} 资质在有效期内，可安排作业`,
    latest,
  }
}

// ---------- 退场核查事项 ----------

export function listExitChecks(): ExitCheckItem[] {
  return [...qualificationState().exitChecks].sort((a, b) => b.id - a.id)
}

export function ensureExitCheck(
  contractorId: number,
  gate: GateResult,
  source: ExitCheckItem['source'],
  filingId?: number,
): ExitCheckItem | null {
  if (gate.allowed || !gate.reason) {
    return null
  }
  const rows = listRows(CONTRACTOR_KEY)
  const row = rows.find((item) => Number(item.id) === contractorId)
  if (!row) {
    return null
  }
  const state = qualificationState()
  const duplicated = state.exitChecks.some(
    (item) =>
      item.contractorId === contractorId &&
      item.status === '待核查' &&
      item.reason === gate.reason,
  )
  if (duplicated) {
    return null
  }
  state.seqExit += 1
  const item: ExitCheckItem = {
    id: state.seqExit,
    contractorId,
    teamCode: String(row['队伍编号']),
    teamName: String(row['队伍名称']),
    reason: gate.reason,
    source,
    createdAt: nowText(),
    status: '待核查',
    detail:
      gate.reason === '资质过期'
        ? '队伍仍在作业中但资质已过期，需核查人员、设备与在施工序退场。'
        : '队伍仍在作业中但资质证照缺失，需核查人员、设备与在施工序退场。',
    filingId,
  }
  state.exitChecks.push(item)
  saveQualificationState(state)
  return item
}

// 定时/进入页面时巡检：所有「作业中」队伍统一过一遍闸门。
export function scanWorkingContractors(): ExitCheckItem[] {
  const created: ExitCheckItem[] = []
  const rows = listRows(CONTRACTOR_KEY)
  for (const row of rows) {
    if (String(row.status) !== '作业中') {
      continue
    }
    const gate = contractorGate(Number(row.id))
    const item = ensureExitCheck(
      Number(row.id),
      gate,
      '资质巡检',
      gate.latest?.id,
    )
    if (item) {
      created.push(item)
    }
  }
  return created
}

export function resolveExitCheck(id: number): void {
  const state = qualificationState()
  const target = state.exitChecks.find((item) => item.id === id)
  if (target) {
    target.status = '已闭环'
    saveQualificationState(state)
  }
}

// ---------- 上传会话（断点续传） ----------

export function listSessions(): UploadSession[] {
  return [...qualificationState().sessions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
}

function buildSteps(): UploadStep[] {
  return [
    { key: 'package', label: STEP_LABELS.package, state: 'pending', message: '' },
    ...SLOT_META.map((meta) => ({
      key: meta.slot as UploadStepKey,
      label: STEP_LABELS[meta.slot],
      state: 'pending' as const,
      message: '',
    })),
    { key: 'submit', label: STEP_LABELS.submit, state: 'pending', message: '' },
  ]
}

// 同一队伍只保留一个上传会话：resume 时回到中断会话；新建则覆盖尚未提交的旧会话。
export function startSession(input: {
  contractorId: number
  packageToken?: string
  packageMessage?: string
  resume?: boolean
}): UploadSession {
  const state = qualificationState()
  const existing = state.sessions.find(
    (item) => item.contractorId === input.contractorId,
  )
  if (existing && input.resume) {
    return existing
  }
  if (existing && !input.resume) {
    state.sessions = state.sessions.filter((item) => item.id !== existing.id)
  }
  const row = listRows(CONTRACTOR_KEY).find(
    (item) => Number(item.id) === input.contractorId,
  )
  if (!row) {
    throw new Error('施工队伍不存在')
  }
  const steps = buildSteps()
  steps[0].state = 'done'
  steps[0].message =
    input.packageMessage ??
    (input.packageToken
      ? `已导入归档包 ${input.packageToken}`
      : '线下已领取归档包，直接补件上传')
  const session: UploadSession = {
    id: `SES-${String(row['队伍编号'])}-${tokenStamp()}`,
    contractorId: input.contractorId,
    teamCode: String(row['队伍编号']),
    packageToken: input.packageToken ?? '',
    reviewer: '',
    startedAt: nowText(),
    updatedAt: nowText(),
    steps,
  }
  state.sessions.push(session)
  saveQualificationState(state)
  return session
}

function persistSession(session: UploadSession): void {
  const state = qualificationState()
  const index = state.sessions.findIndex((item) => item.id === session.id)
  session.updatedAt = nowText()
  if (index >= 0) {
    state.sessions[index] = session
  } else {
    state.sessions.push(session)
  }
  saveQualificationState(state)
}

export function saveReviewer(sessionId: string, reviewer: string): void {
  const state = qualificationState()
  const session = state.sessions.find((item) => item.id === sessionId)
  if (session) {
    session.reviewer = reviewer
    persistSession(session)
  }
}

// 完成一个材料条目：校验通过才置 done；读文件/录入异常置 failed，进度照样落库。
export function completeStep(
  sessionId: string,
  key: UploadStepKey,
  doc: UploadedDocument,
): void {
  const state = qualificationState()
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session) {
    throw new Error('上传会话已失效，请重新发起')
  }
  const step = session.steps.find((item) => item.key === key)
  if (!step) {
    throw new Error(`会话里没有「${STEP_LABELS[key]}」这一步`)
  }
  step.state = 'done'
  step.message = `${doc.fileName}（${formatFileSize(doc.fileSize)}）已接收，指纹 ${doc.checksum.slice(0, 12)}…`
  step.doc = doc
  persistSession(session)
}

export function failStep(sessionId: string, key: UploadStepKey, message: string): void {
  const state = qualificationState()
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session) {
    return
  }
  const step = session.steps.find((item) => item.key === key)
  if (step) {
    step.state = 'failed'
    step.message = message
    persistSession(session)
  }
}

export function resumeTarget(session: UploadSession): UploadStepKey {
  const failed = session.steps.find((step) => step.state === 'failed')
  if (failed) {
    return failed.key
  }
  const pending = session.steps.find((step) => step.state === 'pending')
  return pending?.key ?? 'submit'
}

export function discardSession(sessionId: string): void {
  const state = qualificationState()
  state.sessions = state.sessions.filter((item) => item.id !== sessionId)
  saveQualificationState(state)
}

// ---------- 提交归档：去重、版本、退场联动 ----------

export type SubmitResult = {
  ok: boolean
  message: string
  duplicate: boolean
  filing?: QualificationFiling
  exitCreated?: ExitCheckItem | null
}

export type SubmitInput = {
  sessionId: string
  reviewer: string
}

export function submitUpload(input: SubmitInput): SubmitResult {
  const state = qualificationState()
  const session = state.sessions.find((item) => item.id === input.sessionId)
  if (!session) {
    return { ok: false, duplicate: false, message: '上传会话已失效，请重新发起' }
  }
  const unfinished = session.steps.find(
    (step) => step.key !== 'submit' && step.state !== 'done',
  )
  if (unfinished) {
    return {
      ok: false,
      duplicate: false,
      message: `「${unfinished.label}」尚未完成${unfinished.state === 'failed' ? '（失败条目）' : ''}，请先从该条目续传`,
    }
  }
  const reviewer = input.reviewer.trim() || session.reviewer.trim()
  if (!reviewer) {
    return { ok: false, duplicate: false, message: '请填写审核人' }
  }

  const uploaded: UploadedDocument[] = session.steps
    .filter((step) => step.doc)
    .map((step) => ({ ...(step.doc as UploadedDocument), uploadedBy: reviewer }))

  const row = listRows(CONTRACTOR_KEY).find(
    (item) => Number(item.id) === session.contractorId,
  )
  if (!row) {
    return { ok: false, duplicate: false, message: '施工队伍已不在名册中' }
  }
  const teamEnterprise = String(row['所属企业'] ?? '')

  // 重复文件判定：同一队伍历史备案里出现过相同指纹的文件，直接跳过，不重复备案。
  const priorChecksums = new Set(
    state.filings
      .filter((item) => item.contractorId === session.contractorId)
      .flatMap((item) => item.docs.map((doc) => doc.checksum)),
  )
  const seenInBatch = new Set<string>()
  const fresh: UploadedDocument[] = []
  const skipped: string[] = []
  for (const doc of uploaded) {
    if (priorChecksums.has(doc.checksum) || seenInBatch.has(doc.checksum)) {
      skipped.push(doc.fileName)
      continue
    }
    seenInBatch.add(doc.checksum)
    fresh.push(doc)
  }

  if (fresh.length === 0) {
    // 全部是重复文件：不生成第二份备案记录，会话直接结束。
    state.sessions = state.sessions.filter((item) => item.id !== session.id)
    saveQualificationState(state)
    return {
      ok: true,
      duplicate: true,
      message: `上传的 ${skipped.length} 份文件均为已备案文件，按重复文件处理，未生成第二份备案记录`,
    }
  }

  const checks = evaluateDocs(fresh, teamEnterprise)
  const passed = checks.every((check) => check.passed)
  const previous = state.filings
    .filter((item) => item.contractorId === session.contractorId)
    .sort((a, b) => b.version - a.version)[0]
  const version = (previous?.version ?? 0) + 1

  state.seqFiling += 1
  const filing: QualificationFiling = {
    id: state.seqFiling,
    contractorId: session.contractorId,
    teamCode: session.teamCode,
    version,
    packageToken: session.packageToken,
    reviewer,
    filedAt: nowText(),
    validUntil: earliestExpiry(fresh),
    status: passed ? '校验通过' : '校验未通过',
    docs: fresh,
    checks,
    notes:
      skipped.length > 0
        ? `重复文件已跳过，未重复备案：${skipped.join('、')}`
        : '',
  }
  state.filings.push(filing)
  state.sessions = state.sessions.filter((item) => item.id !== session.id)
  saveQualificationState(state)

  // 已在进行中的队伍：新备案资质过期或证照缺失，同步生成退场核查事项。
  const gate = contractorGate(session.contractorId)
  const exitCreated =
    String(row.status) === '作业中'
      ? ensureExitCheck(session.contractorId, gate, '资质上传校验', filing.id)
      : null

  return {
    ok: true,
    duplicate: false,
    filing,
    exitCreated,
    message: passed
      ? `已生成第 ${version} 版备案记录，${fresh.length} 份证件全部校验通过`
      : `已生成第 ${version} 版备案记录，存在 ${checks.filter((c) => !c.passed).length} 份证件校验未通过，请查看明细`,
  }
}
