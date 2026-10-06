import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import { nextSeq, persistQualification, qualificationState } from './local-store'
import { buildZip } from './zip'
import {
  DOC_KINDS,
  type ArchiveDoc,
  type ArchivePackage,
  type ArchiveView,
  type DocKind,
  type ExitCheck,
  type ExitCheckStatus,
  type ProblemType,
  type QualificationRecord,
  type QualificationSnapshot,
  type UploadItem,
  type UploadSession,
} from './types'

/**
 * 施工队伍资质文件归档包业务规则全部收敛在本文件：
 * 归档包下载、补充上传、逐条校验（有效期/作业范围/所属企业）、
 * 重复文件不产生第二份备案、旧资质历史版本保留、
 * 资质失效拦截作业安排并为作业中队伍生成退场核查、上传中断断点续传。
 */

const TEAM_MODULE = 'contractor'
const LONG_TERM_KINDS: DocKind[] = ['队伍编号', '所属企业材料']
const SCOPE_KINDS: DocKind[] = ['资质等级', '特种作业证', '所属企业材料']
// 作业范围命中下列任一关键词即视为覆盖本系统管网作业，关键词维护在一处。
const SCOPE_KEYWORDS = [
  '排水', '管网', '管道', '井下', '有限空间', '非开挖',
  '检测', '修复', '清洗', '养护', '维修', '特种作业', '市政',
]

export interface DocProblem {
  type: ProblemType
  message: string
}

export interface DocInput {
  kind: DocKind
  certNo: string
  validUntil: string
  workScope: string
  company: string
  fileName: string
  fileSize: number
  fileHash: string
}

export interface TeamEvaluation {
  hasRecord: boolean
  problems: Array<DocProblem & { kind?: DocKind }>
  expiredKinds: DocKind[]
  missingKinds: DocKind[]
  scopeKinds: DocKind[]
  companyKinds: DocKind[]
  codeKinds: DocKind[]
  reasons: string[]
  blocking: boolean
}

// 纯前端演示没有服务端时钟，统一取本机日期；接回后端时换成服务端时间即可。
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function stamp(): string {
  const now = new Date()
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${today()} ${hour}:${minute}`
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').trim()
}

function isExpired(validUntil: string): boolean {
  return validUntil !== '长期' && /^\d{4}-\d{2}-\d{2}$/.test(validUntil) && validUntil < today()
}

function contractorRows(): EntryRow[] {
  return listRows(TEAM_MODULE)
}

export function getTeam(teamId: number): EntryRow | undefined {
  return contractorRows().find((row) => Number(row.id) === teamId)
}

function syncContractorStatus(teamId: number, status: string): void {
  const rows = contractorRows()
  const index = rows.findIndex((row) => Number(row.id) === teamId)
  if (index < 0) {
    return
  }
  const lastStatus = '已清退'
  const next: EntryRow = {
    ...rows[index],
    status,
    pending: status !== lastStatus,
    abnormal: status === lastStatus ? true : rows[index].abnormal,
  }
  const updated = [...rows]
  updated[index] = next
  saveRows(TEAM_MODULE, updated)
}

/* ---------------- 附件指纹：浏览器有 subtle 就走 SHA-256，否则降级字符串哈希 ---------------- */

export async function digestFile(file: File): Promise<{ hash: string; size: number }> {
  const buffer = await file.arrayBuffer()
  return { hash: await sha256(buffer), size: file.size }
}

export async function digestFields(input: Omit<DocInput, 'fileHash' | 'fileSize'>): Promise<string> {
  const canonical = [input.kind, input.certNo, input.validUntil, input.workScope, input.company, input.fileName].join('|')
  if (crypto?.subtle) {
    const bytes = new TextEncoder().encode(canonical)
    return `form-${(await sha256(bytes.buffer as ArrayBuffer)).slice(0, 24)}`
  }
  return `form-${fallbackHash(canonical)}`
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  return fallbackHash(new TextDecoder().decode(buffer))
}

function fallbackHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return `x${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/* ---------------- 逐条校验：有效期、作业范围、所属企业 ---------------- */

export function validateDoc(input: DocInput, team: EntryRow, sessionHashes: string[]): DocProblem[] {
  const problems: DocProblem[] = []
  const certNo = input.certNo.trim()
  const validUntil = input.validUntil.trim()
  const workScope = input.workScope.trim()
  const company = input.company.trim()
  const fileName = input.fileName.trim()
  const teamCompany = String(team['所属企业'] ?? '')

  if (!certNo) {
    problems.push({ type: '证照缺失', message: `${input.kind}：证件编号缺失` })
  }
  if (!fileName) {
    problems.push({ type: '证照缺失', message: `${input.kind}：未上传证照附件` })
  }

  const allowLongTerm = LONG_TERM_KINDS.includes(input.kind)
  if (!validUntil) {
    problems.push({ type: '证照缺失', message: `${input.kind}：有效期未填写` })
  } else if (validUntil === '长期') {
    if (!allowLongTerm) {
      problems.push({ type: '资质过期', message: `${input.kind}：该证件不允许长期有效，需填写到期日` })
    }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    problems.push({ type: '资质过期', message: `${input.kind}：有效期格式应为 YYYY-MM-DD` })
  } else if (validUntil < today()) {
    problems.push({ type: '资质过期', message: `${input.kind}：证件已于 ${validUntil} 过期` })
  }

  if (SCOPE_KINDS.includes(input.kind)) {
    if (!workScope) {
      problems.push({ type: '证照缺失', message: `${input.kind}：作业/经营范围未填写` })
    } else if (!SCOPE_KEYWORDS.some((keyword) => workScope.includes(keyword))) {
      problems.push({
        type: '作业范围不符',
        message: `${input.kind}：作业范围「${workScope}」未覆盖管网施工养护相关作业`,
      })
    }
    if (!company) {
      problems.push({ type: '证照缺失', message: `${input.kind}：所属企业未填写` })
    } else if (normalize(company) !== normalize(teamCompany)) {
      problems.push({
        type: '企业不符',
        message: `${input.kind}：记载企业「${company}」与队伍所属企业「${teamCompany}」不一致`,
      })
    }
  }

  if (input.kind === '队伍编号' && certNo && certNo !== String(team['队伍编号'] ?? '')) {
    problems.push({
      type: '编号不符',
      message: `队伍编号材料记载「${certNo}」，与队伍编号「${team['队伍编号']}」不一致`,
    })
  }

  // 同一次上传里四个槽位不能放同一份文件；与旧备案相同的文件允许重报，在提交环节做去重。
  if (input.fileHash && sessionHashes.filter((hash) => hash === input.fileHash).length > 1) {
    problems.push({ type: '文件重复', message: `${input.kind}：该文件与本次上传中的其他条目重复` })
  }

  return problems
}

export function getTeamRecord(teamId: number): QualificationRecord | undefined {
  return qualificationState().records.find((record) => record.teamId === teamId)
}

/** 评价一份已备案快照当前是否仍然有效（过期是动态判断，不依赖备案时的结论）。 */
export function evaluateSnapshot(record: QualificationRecord, team: EntryRow): TeamEvaluation {
  const problems: TeamEvaluation['problems'] = []
  const expiredKinds: DocKind[] = []
  const missingKinds: DocKind[] = []
  const scopeKinds: DocKind[] = []
  const companyKinds: DocKind[] = []
  const codeKinds: DocKind[] = []
  const reasons: string[] = []
  const snapshot = record.snapshot
  const teamCompany = String(team['所属企业'] ?? '')

  for (const kind of DOC_KINDS) {
    const doc = snapshot.docs[kind]
    if (!doc) {
      missingKinds.push(kind)
      problems.push({ type: '证照缺失', kind, message: `${kind}材料缺失` })
      reasons.push(`${kind}材料缺失`)
      continue
    }
    if (!LONG_TERM_KINDS.includes(kind) && isExpired(doc.validUntil)) {
      expiredKinds.push(kind)
      problems.push({ type: '资质过期', kind, message: `${kind}已于 ${doc.validUntil} 过期` })
      reasons.push(`${kind}已于 ${doc.validUntil} 过期`)
    }
    if (SCOPE_KINDS.includes(kind) && !SCOPE_KEYWORDS.some((keyword) => doc.workScope.includes(keyword))) {
      scopeKinds.push(kind)
      problems.push({ type: '作业范围不符', kind, message: `${kind}作业范围不覆盖管网作业` })
      reasons.push(`${kind}作业范围不覆盖管网作业`)
    }
    if (normalize(doc.company) !== normalize(teamCompany)) {
      companyKinds.push(kind)
      problems.push({ type: '企业不符', kind, message: `${kind}企业与队伍所属企业不一致` })
      reasons.push(`${kind}企业与队伍所属企业不一致`)
    }
  }

  const teamDoc = snapshot.docs['队伍编号']
  if (teamDoc && teamDoc.certNo !== String(team['队伍编号'] ?? '')) {
    codeKinds.push('队伍编号')
    problems.push({ type: '编号不符', kind: '队伍编号', message: '队伍编号与备案材料不一致' })
    reasons.push('队伍编号与备案材料不一致')
  }

  return {
    hasRecord: true,
    problems,
    expiredKinds,
    missingKinds,
    scopeKinds,
    companyKinds,
    codeKinds,
    reasons,
    blocking: reasons.length > 0,
  }
}

export function evaluateTeam(team: EntryRow): TeamEvaluation {
  const record = getTeamRecord(Number(team.id))
  if (record) {
    return evaluateSnapshot(record, team)
  }
  const missing = DOC_KINDS.map((kind) => `${kind}材料缺失`)
  return {
    hasRecord: false,
    problems: DOC_KINDS.map((kind) => ({ type: '证照缺失' as ProblemType, kind, message: `${kind}材料缺失` })),
    expiredKinds: [],
    missingKinds: [...DOC_KINDS],
    scopeKinds: [],
    companyKinds: [],
    codeKinds: [],
    reasons: missing,
    blocking: true,
  }
}

export function listArchiveViews(): ArchiveView[] {
  const state = qualificationState()
  return contractorRows().map((team) => {
    const teamId = Number(team.id)
    return {
      team,
      record: state.records.find((record) => record.teamId === teamId),
      evaluation: evaluateTeam(team),
      activeSession: state.sessions.find(
        (session) => session.teamId === teamId && session.status !== '已完成',
      ),
      lastPackage: [...state.packages].reverse().find((item) => item.teamId === teamId),
    }
  })
}

/* ---------------- 归档包下载：队伍编号/资质等级/特种作业证/所属企业材料 打包 ---------------- */

function packageEntries(team: EntryRow): { path: string; content: string }[] {
  const code = String(team['队伍编号'] ?? '')
  const name = String(team['队伍名称'] ?? '')
  const grade = String(team['资质等级'] ?? '')
  const company = String(team['所属企业'] ?? '')
  const contact = String(team['联系人'] ?? '')
  const phone = String(team['联系电话'] ?? '')
  const folder = `${code}_${name}/`
  const header = (title: string) =>
    [`【${title}】`, `所属队伍：${name}（${code}）`, `所属企业：${company}`, ''].join('\n')
  const footer =
    '\n填写说明：请审核人补充证件编号、有效期至、作业范围，并将证照扫描件放入本归档包后整体上传。'

  const manifest = {
    packageType: '施工队伍资质文件归档包',
    teamCode: code,
    teamName: name,
    grade,
    company,
    contact,
    phone,
    exportedAt: stamp(),
    docs: DOC_KINDS.map((kind, index) => ({
      slot: index + 1,
      kind,
      fileName: `${String(index + 1).padStart(2, '0')}-${kind}.txt`,
    })),
  }

  return [
    {
      path: `${folder}00-归档说明.txt`,
      content: [
        '施工队伍资质文件归档包',
        `队伍编号：${code}`,
        `队伍名称：${name}`,
        `资质等级：${grade}`,
        `所属企业：${company}`,
        `联系人：${contact} ${phone}`,
        `打包时间：${stamp()}`,
        '',
        '归档包内容（系统将按顺序逐条校验）：',
        '1. 01-队伍编号.txt     —— 队伍编号证明材料',
        '2. 02-资质等级.txt     —— 资质等级证书',
        '3. 03-特种作业证.txt   —— 特种作业操作证（有限空间/井下作业）',
        '4. 04-所属企业材料.txt —— 营业执照等所属企业证明',
        '',
        '审核人补充证件编号、有效期、作业范围并上传附件后，系统逐条校验证件有效期、作业范围和所属企业。',
      ].join('\n'),
    },
    {
      path: `${folder}01-队伍编号.txt`,
      content: `${header('队伍编号证明')}证件编号：${code}\n有效期至：长期\n作业范围：\n附件：\n${footer}`,
    },
    {
      path: `${folder}02-资质等级.txt`,
      content: `${header('资质等级证书')}登记资质等级：${grade}\n证书编号：\n有效期至：\n作业范围：\n附件：\n${footer}`,
    },
    {
      path: `${folder}03-特种作业证.txt`,
      content: `${header('特种作业操作证')}证书编号：\n有效期至：\n准操作业范围（须含有限空间/井下作业）：\n附件：\n${footer}`,
    },
    {
      path: `${folder}04-所属企业材料.txt`,
      content: `${header('所属企业材料（营业执照等）')}统一社会信用代码：\n有效期至（可填长期）：\n经营范围：\n附件：\n${footer}`,
    },
    {
      path: `${folder}manifest.json`,
      content: JSON.stringify(manifest, null, 2),
    },
  ]
}

export function downloadPackage(teamId: number): { filename: string; blob: Blob } | { error: string } {
  const team = getTeam(teamId)
  if (!team) {
    return { error: '没有找到该施工队伍' }
  }
  const state = qualificationState()
  const id = nextSeq()
  const datePart = today().replace(/-/g, '')
  const packageId = `GJD-${datePart}-${String(id).padStart(4, '0')}`
  const pkg: ArchivePackage = { packageId, teamId, createdAt: stamp() }
  state.packages.push(pkg)
  persistQualification()

  const blob = buildZip(packageEntries(team))
  const safeName = String(team['队伍名称'] ?? teamId)
  const filename = `资质归档包_${String(team['队伍编号'] ?? teamId)}_${safeName}.zip`
  return { filename, blob }
}

/* ---------------- 补充上传：会话、断点、逐条校验 ---------------- */

function blankItems(team: EntryRow): UploadItem[] {
  return DOC_KINDS.map((kind) => ({
    kind,
    status: 'pending',
    certNo: kind === '队伍编号' ? String(team['队伍编号'] ?? '') : '',
    validUntil: '',
    workScope: '',
    company: String(team['所属企业'] ?? ''),
    fileName: '',
    fileSize: 0,
    fileHash: '',
    message: '',
    updatedAt: '',
  }))
}

export function startUpload(teamId: number, reviewer: string): UploadSession | { error: string } {
  const team = getTeam(teamId)
  if (!team) {
    return { error: '没有找到该施工队伍' }
  }
  const state = qualificationState()
  const existing = state.sessions.find(
    (session) => session.teamId === teamId && session.status !== '已完成',
  )
  if (existing) {
    return existing
  }
  const id = nextSeq()
  const session: UploadSession = {
    id: `SCS-${String(id).padStart(4, '0')}`,
    packageId: state.packages.filter((pkg) => pkg.teamId === teamId).slice(-1)[0]?.packageId ?? '未关联归档包',
    teamId,
    teamCode: String(team['队伍编号'] ?? ''),
    reviewer: reviewer.trim() || '审核人',
    createdAt: stamp(),
    updatedAt: stamp(),
    status: '进行中',
    failStep: 0,
    note: '',
    items: blankItems(team),
  }
  state.sessions.push(session)
  persistQualification()
  return session
}

export function listInterruptedSessions(): UploadSession[] {
  return qualificationState().sessions.filter((session) => session.status === '已中断')
}

export function getSession(sessionId: string): UploadSession | undefined {
  return qualificationState().sessions.find((session) => session.id === sessionId)
}

function persistSession(session: UploadSession): void {
  persistQualification()
}

function firstOpenStep(session: UploadSession): number {
  const index = session.items.findIndex((item) => item.status !== 'validated')
  return index < 0 ? session.items.length : index
}

/** 只暂存审核人填的内容，不做结论。 */
export function saveDraft(sessionId: string, kind: DocKind, patch: Partial<UploadItem>): UploadSession | undefined {
  const session = getSession(sessionId)
  if (!session) {
    return undefined
  }
  const item = session.items.find((entry) => entry.kind === kind)
  if (!item || item.status === 'validated') {
    return session
  }
  Object.assign(item, {
    certNo: patch.certNo ?? item.certNo,
    validUntil: patch.validUntil ?? item.validUntil,
    workScope: patch.workScope ?? item.workScope,
    company: patch.company ?? item.company,
    fileName: patch.fileName ?? item.fileName,
    fileSize: patch.fileSize ?? item.fileSize,
    fileHash: patch.fileHash ?? item.fileHash,
    updatedAt: stamp(),
  })
  session.updatedAt = stamp()
  persistSession(session)
  return session
}

/** 校验并“上传”单个条目；不通过就停在这一步，等审核人改正后从该条目继续。 */
export function uploadItem(sessionId: string, kind: DocKind): UploadSession | { error: string } {
  const session = getSession(sessionId)
  const team = session ? getTeam(session.teamId) : undefined
  if (!session || !team) {
    return { error: '上传会话已失效，请重新发起补充上传' }
  }
  const index = DOC_KINDS.indexOf(kind)
  const item = session.items[index]
  const input: DocInput = {
    kind,
    certNo: item.certNo,
    validUntil: item.validUntil,
    workScope: item.workScope,
    company: item.company,
    fileName: item.fileName,
    fileSize: item.fileSize,
    fileHash: item.fileHash,
  }
  const hashes = session.items.map((entry) => entry.fileHash).filter(Boolean)
  const problems = validateDoc(input, team, hashes)
  if (problems.length > 0) {
    item.status = 'failed'
    item.message = problems.map((problem) => problem.message).join('；')
    item.updatedAt = stamp()
    session.status = '进行中'
    session.failStep = index
    session.note = `第 ${index + 1} 步「${kind}」校验未通过`
    session.updatedAt = stamp()
    persistSession(session)
    return session
  }
  item.status = 'validated'
  item.message = '校验通过：有效期、作业范围、所属企业均一致'
  item.updatedAt = stamp()
  session.failStep = firstOpenStep(session)
  session.note = `已完成到第 ${session.failStep === DOC_KINDS.length ? DOC_KINDS.length : session.failStep} 步`
  session.updatedAt = stamp()
  persistSession(session)
  return session
}

/** 模拟传输中断：标出已完成到哪一步，当前条目标记中断，允许之后继续。 */
export function interruptUpload(sessionId: string): UploadSession | undefined {
  const session = getSession(sessionId)
  if (!session || session.status === '已完成') {
    return session
  }
  // 以当前条目实际状态重新计算断点，不能依赖上次校验时缓存的 failStep。
  const step = firstOpenStep(session)
  session.failStep = step
  session.status = '已中断'
  if (step < session.items.length) {
    const item = session.items[step]
    if (item.status !== 'validated') {
      item.status = 'interrupted'
      item.message = '传输中断，材料未上传完成'
      item.updatedAt = stamp()
    }
  }
  const doneCount = session.items.filter((item) => item.status === 'validated').length
  session.note = `上传中断：已完成 ${doneCount}/${DOC_KINDS.length} 步，停在第 ${Math.min(step + 1, DOC_KINDS.length)} 步「${step < DOC_KINDS.length ? DOC_KINDS[step] : '提交备案'}」`
  session.updatedAt = stamp()
  persistSession(session)
  return session
}

export function resumeUpload(sessionId: string): UploadSession | undefined {
  const session = getSession(sessionId)
  if (!session) {
    return undefined
  }
  session.status = '进行中'
  const item = session.items[session.failStep]
  if (item && item.status === 'interrupted') {
    item.status = 'pending'
    item.message = ''
  }
  session.note = `已从第 ${session.failStep + 1} 步「${DOC_KINDS[session.failStep]}」继续`
  session.updatedAt = stamp()
  persistSession(session)
  return session
}

export function discardSession(sessionId: string): void {
  const state = qualificationState()
  state.sessions = state.sessions.filter((session) => session.id !== sessionId)
  persistQualification()
}

/* ---------------- 提交备案：重复文件不产生第二份记录，旧资质转历史版本 ---------------- */

function toArchiveDoc(item: UploadItem): ArchiveDoc {
  return {
    kind: item.kind,
    certNo: item.certNo.trim(),
    validUntil: item.validUntil.trim(),
    workScope: item.workScope.trim(),
    company: item.company.trim(),
    fileName: item.fileName.trim(),
    fileSize: item.fileSize,
    fileHash: item.fileHash,
    uploadedAt: item.updatedAt || stamp(),
  }
}

function snapshotFingerprint(snapshot: QualificationSnapshot): string {
  return JSON.stringify(
    DOC_KINDS.map((kind) => {
      const doc = snapshot.docs[kind]
      return [doc.certNo, doc.validUntil, doc.workScope, doc.company, doc.fileName, doc.fileHash]
    }),
  )
}

export interface FinalizeResult {
  ok: boolean
  message: string
  duplicated?: boolean
  record?: QualificationRecord
}

export function finalizeUpload(sessionId: string, reviewer: string): FinalizeResult {
  const session = getSession(sessionId)
  if (!session) {
    return { ok: false, message: '上传会话不存在，无法提交备案' }
  }
  if (session.status === '已完成') {
    return { ok: false, message: '该上传会话已提交备案，请勿重复提交' }
  }
  const open = session.items.filter((item) => item.status !== 'validated')
  if (open.length > 0) {
    const names = open.map((item) => item.kind).join('、')
    return { ok: false, message: `还有 ${names} 未通过逐条校验，不能提交备案` }
  }

  const docs = DOC_KINDS.map((kind) =>
    toArchiveDoc(session.items.find((item) => item.kind === kind)!),
  )
  const snapshot: QualificationSnapshot = {
    docs: Object.fromEntries(docs.map((doc) => [doc.kind, doc])) as QualificationSnapshot['docs'],
    grade: String(getTeam(session.teamId)?.['资质等级'] ?? ''),
    company: docs.find((doc) => doc.kind === '所属企业材料')?.company ?? '',
    scope: docs.find((doc) => doc.kind === '资质等级')?.workScope ?? '',
  }

  const state = qualificationState()
  const existing = state.records.find((record) => record.teamId === session.teamId)
  let record: QualificationRecord
  let duplicated = false

  if (existing && snapshotFingerprint(existing.snapshot) === snapshotFingerprint(snapshot)) {
    // 整包文件与现行备案完全一致：只回写审核人/时间，绝不生成第二份备案记录。
    existing.reviewer = reviewer.trim() || session.reviewer
    record = existing
    duplicated = true
  } else if (existing) {
    const changedKinds = DOC_KINDS.filter(
      (kind) => existing.snapshot.docs[kind].fileHash !== snapshot.docs[kind].fileHash,
    )
    existing.history.push({
      version: existing.currentVersion,
      reviewer: existing.reviewer,
      filedAt: existing.filedAt,
      snapshot: JSON.parse(JSON.stringify(existing.snapshot)) as QualificationSnapshot,
      replacedReason: `因版本 ${existing.currentVersion + 1} 替换归档（变更：${changedKinds.join('、') || '证件信息'}）`,
    })
    existing.currentVersion += 1
    existing.snapshot = snapshot
    existing.reviewer = reviewer.trim() || session.reviewer
    existing.filedAt = stamp()
    record = existing
  } else {
    const id = nextSeq()
    record = {
      id,
      recordNo: `ZGBA-${String(id).padStart(4, '0')}`,
      teamId: session.teamId,
      teamCode: session.teamCode,
      teamName: String(getTeam(session.teamId)?.['队伍名称'] ?? ''),
      currentVersion: 1,
      reviewer: reviewer.trim() || session.reviewer,
      filedAt: stamp(),
      snapshot,
      history: [],
    }
    state.records.push(record)
  }

  session.status = '已完成'
  session.note = duplicated ? '与现行备案一致，未生成第二份备案记录' : `已生成备案记录 ${record.recordNo}（版本 v${record.currentVersion}）`
  session.finishedAt = stamp()
  session.updatedAt = stamp()
  persistQualification()

  // 备案完成后队伍进入已备案（待审核队伍），作业中/已清退的现场状态不回退。
  const currentStatus = String(getTeam(session.teamId)?.status ?? '')
  if (currentStatus === '待审核') {
    syncContractorStatus(session.teamId, '已备案')
  }

  return {
    ok: true,
    duplicated,
    record,
    message: duplicated
      ? '上传文件与现行备案完全一致，未生成第二份备案记录，旧资质按历史版本保留。'
      : `备案完成：记录号 ${record.recordNo}，当前版本 v${record.currentVersion}，旧资质已按历史版本保留。`,
  }
}

/* ---------------- 作业安排联动：失效拦截 + 退场核查 ---------------- */

export interface GateResult {
  ok: boolean
  reasons: string[]
  exitCheckId?: string
}

export function canFileArchive(teamId: number): GateResult {
  const team = getTeam(teamId)
  if (!team) {
    return { ok: false, reasons: ['没有找到该施工队伍'] }
  }
  const evaluation = evaluateTeam(team)
  if (!evaluation.hasRecord) {
    return { ok: false, reasons: ['尚未提交资质文件归档包，不能审核备案'] }
  }
  if (evaluation.blocking) {
    return { ok: false, reasons: evaluation.reasons }
  }
  return { ok: true, reasons: [] }
}

export function canScheduleWork(teamId: number): GateResult {
  const team = getTeam(teamId)
  if (!team) {
    return { ok: false, reasons: ['没有找到该施工队伍'] }
  }
  const evaluation = evaluateTeam(team)
  if (!evaluation.hasRecord) {
    return { ok: false, reasons: ['资质归档包缺失（队伍编号/资质等级/特种作业证/所属企业材料不全）'] }
  }
  if (evaluation.blocking) {
    return { ok: false, reasons: evaluation.reasons }
  }
  return { ok: true, reasons: [] }
}

function ensureExitCheck(teamId: number, reasons: string[]): ExitCheck {
  const team = getTeam(teamId)
  const state = qualificationState()
  const open = state.exitChecks.find(
    (item) => item.teamId === teamId && (item.status === '待退场核查' || item.status === '核查中'),
  )
  const expired = reasons.some((reason) => reason.includes('过期'))
  if (open) {
    for (const reason of reasons) {
      if (!open.reasons.includes(reason)) {
        open.reasons.push(reason)
      }
    }
    persistQualification()
    return open
  }
  const id = nextSeq()
  const check: ExitCheck = {
    id: `TC-${String(id).padStart(4, '0')}`,
    teamId,
    teamCode: String(team?.['队伍编号'] ?? ''),
    teamName: String(team?.['队伍名称'] ?? ''),
    reasons,
    source: expired ? '资质过期' : '证照缺失',
    createdAt: stamp(),
    status: '待退场核查',
    handler: '',
  }
  state.exitChecks.push(check)
  persistQualification()
  return check
}

/** 作业安排被拦截且队伍已经在作业中：必须生成退场核查事项（幂等，不重复开单）。 */
export function blockScheduleAndEnsureExit(teamId: number): GateResult {
  const gate = canScheduleWork(teamId)
  if (gate.ok) {
    return gate
  }
  const status = String(getTeam(teamId)?.status ?? '')
  if (status === '作业中') {
    const check = ensureExitCheck(teamId, gate.reasons)
    return { ...gate, exitCheckId: check.id }
  }
  return gate
}

/** 巡检：对所有作业中队伍复查资质，过期/缺证自动补开退场核查事项。 */
export function scanActiveTeams(): ExitCheck[] {
  const created: ExitCheck[] = []
  for (const team of contractorRows().filter((row) => String(row.status) === '作业中')) {
    const teamId = Number(team.id)
    const evaluation = evaluateTeam(team)
    if (evaluation.blocking) {
      const before = qualificationState().exitChecks.some(
        (item) =>
          item.teamId === teamId &&
          (item.status === '待退场核查' || item.status === '核查中'),
      )
      const check = ensureExitCheck(teamId, evaluation.reasons)
      if (!before) {
        created.push(check)
      }
    }
  }
  return created
}

export function listExitChecks(): ExitCheck[] {
  return [...qualificationState().exitChecks].reverse()
}

export function advanceExitCheck(id: string, handler: string): { ok: boolean; message: string } {
  const check = qualificationState().exitChecks.find((item) => item.id === id)
  if (!check) {
    return { ok: false, message: '退场核查事项不存在' }
  }
  const flow: Record<ExitCheckStatus, ExitCheckStatus | null> = {
    待退场核查: '核查中',
    核查中: '已退场',
    已退场: null,
    已关闭: null,
  }
  const target = flow[check.status]
  if (!target) {
    return { ok: false, message: `退场事项当前为「${check.status}」，无需继续流转` }
  }
  check.status = target
  check.handler = handler.trim() || check.handler || '值班管理员'
  if (target === '已退场') {
    check.resolvedAt = stamp()
    // 退场完成联动施工队伍状态清退。
    syncContractorStatus(check.teamId, '已清退')
  }
  persistQualification()
  return { ok: true, message: `退场事项已流转为「${target}」${target === '已退场' ? '，施工队伍已清退' : ''}` }
}

export function closeExitCheck(id: string, handler: string): { ok: boolean; message: string } {
  const check = qualificationState().exitChecks.find((item) => item.id === id)
  if (!check) {
    return { ok: false, message: '退场核查事项不存在' }
  }
  if (check.status === '已退场' || check.status === '已关闭') {
    return { ok: false, message: `退场事项已完结（${check.status}），不能关闭` }
  }
  check.status = '已关闭'
  check.handler = handler.trim() || check.handler || '值班管理员'
  check.resolvedAt = stamp()
  persistQualification()
  return { ok: true, message: '资质已补齐，退场核查事项关闭' }
}

export function qualificationStats() {
  const views = listArchiveViews()
  const checks = qualificationState().exitChecks
  return {
    teams: views.length,
    filed: views.filter((view) => view.record).length,
    invalid: views.filter((view) => view.record && view.evaluation.blocking).length,
    missing: views.filter((view) => !view.record).length,
    interrupted: listInterruptedSessions().length,
    exitPending: checks.filter((check) => check.status === '待退场核查' || check.status === '核查中').length,
  }
}
