/** 施工队伍资质文件归档领域模型：归档包、备案记录（含历史版本）、上传会话、退场核查事项。 */

import type { EntryRow } from '@/data/types'

/** 归档包内固定的四类材料，系统按此顺序逐条校验。 */
export const DOC_KINDS = ['队伍编号', '资质等级', '特种作业证', '所属企业材料'] as const
export type DocKind = (typeof DOC_KINDS)[number]

/** 逐条校验可能发现的问题类型。 */
export type ProblemType = '证照缺失' | '资质过期' | '作业范围不符' | '企业不符' | '编号不符' | '文件重复'

/** 归档包中的单份材料（上传通过后的结构，也是备案版本里的快照）。 */
export interface ArchiveDoc {
  kind: DocKind
  certNo: string // 证件编号：队伍编号 / 资质证书号 / 特种作业操作证号 / 营业执照号
  validUntil: string // 有效期至 YYYY-MM-DD，队伍编号、企业材料允许“长期”
  workScope: string // 作业范围 / 经营范围
  company: string // 证件记载的所属企业
  fileName: string // 实际上传的附件文件名
  fileSize: number
  fileHash: string // 去重指纹
  uploadedAt: string
}

/** 备案通过时一整包四份材料的快照。 */
export interface QualificationSnapshot {
  docs: Record<DocKind, ArchiveDoc>
  grade: string
  company: string
  scope: string
}

/** 被替换下来的旧资质，按历史版本永久保留。 */
export interface HistoryVersion {
  version: number
  reviewer: string
  filedAt: string
  snapshot: QualificationSnapshot
  replacedReason: string
}

/** 一支队伍只有一份备案记录；重新上传且内容有变时追加版本，内容一致不产生第二份记录。 */
export interface QualificationRecord {
  id: number
  recordNo: string
  teamId: number
  teamCode: string
  teamName: string
  currentVersion: number
  reviewer: string
  filedAt: string
  snapshot: QualificationSnapshot
  history: HistoryVersion[]
}

/** 审核人下载过的归档包（一个队伍每次下载生成一个包号）。 */
export interface ArchivePackage {
  packageId: string
  teamId: number
  createdAt: string
}

export type SessionItemStatus = 'pending' | 'validated' | 'failed' | 'interrupted'

/** 上传会话中的一个步骤条目。 */
export interface UploadItem {
  kind: DocKind
  status: SessionItemStatus
  certNo: string
  validUntil: string
  workScope: string
  company: string
  fileName: string
  fileSize: number
  fileHash: string
  message: string
  updatedAt: string
}

/** 可断点续传的上传会话：四步固定顺序，中断时记住停在第几步。 */
export interface UploadSession {
  id: string
  packageId: string
  teamId: number
  teamCode: string
  reviewer: string
  createdAt: string
  updatedAt: string
  status: '进行中' | '已中断' | '已完成'
  failStep: number // 0 起，中断/失败停在哪一步
  note: string
  items: UploadItem[]
  finishedAt?: string
}

export type ExitCheckStatus = '待退场核查' | '核查中' | '已退场' | '已关闭'

/** 资质过期或证照缺失且队伍仍在作业中时，系统生成的退场核查事项。 */
export interface ExitCheck {
  id: string
  teamId: number
  teamCode: string
  teamName: string
  reasons: string[]
  source: '资质过期' | '证照缺失'
  createdAt: string
  status: ExitCheckStatus
  handler: string
  resolvedAt?: string
}

export interface QualificationState {
  records: QualificationRecord[]
  packages: ArchivePackage[]
  sessions: UploadSession[]
  exitChecks: ExitCheck[]
  seq: number
}

/** 列表页行视图：队伍 + 现行备案 + 动态校验结果 + 未完成会话。 */
export interface ArchiveView {
  team: EntryRow
  record?: QualificationRecord
  evaluation: import('./qualification-service').TeamEvaluation
  activeSession?: UploadSession
  lastPackage?: ArchivePackage
}
