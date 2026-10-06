/** 施工队伍资质文件归档包领域模型。纯前端环境：只持久化证件元数据与文件指纹，不存文件正文。 */

// 归档包要求审核人补充的三类材料槽位
export type QualificationSlot = 'qualification' | 'special_cert' | 'enterprise'

export const SLOT_KEYS: QualificationSlot[] = ['qualification', 'special_cert', 'enterprise']

// 下载给审核人的归档包：由队伍登记信息打包，审核人按槽位补件后再上传
export type QualificationPackage = {
  packageToken: string
  contractorId: number
  teamCode: string // 队伍编号
  teamName: string
  qualificationGrade: string // 资质等级
  enterprise: string // 所属企业
  contact: string
  phone: string
  exportedAt: string
  slots: { slot: QualificationSlot; label: string; required: boolean; hint: string }[]
}

// 审核人对每份证件补充录入的元数据
export type UploadedDocument = {
  slot: QualificationSlot
  fileName: string
  fileSize: number
  checksum: string // 文件指纹（SHA-256），重复文件判定依据
  certNo: string // 证件编号
  scope: string // 证件载明的作业范围
  enterprise: string // 证件载明的所属企业
  validFrom: string // 有效期起
  validUntil: string // 有效期止；"长期" 表示长期有效
  uploadedBy: string
  uploadedAt: string
}

// 逐条校验结果：每份证件都要过有效期、作业范围、所属企业三条规则
export type DocCheck = {
  slot: QualificationSlot
  label: string
  fileName: string
  rules: { rule: '有效期' | '作业范围' | '所属企业'; ok: boolean; message: string }[]
  passed: boolean
}

// 资质备案记录：一次上传归档生成一条，同一队伍按 version 留存历史版本
export type QualificationFiling = {
  id: number
  contractorId: number
  teamCode: string
  version: number
  packageToken: string
  reviewer: string
  filedAt: string
  validUntil: string // 取各证件最早到期日，全部长期则为"长期"
  status: '校验通过' | '校验未通过'
  docs: UploadedDocument[]
  checks: DocCheck[]
  notes: string
}

export type UploadStepKey = 'package' | QualificationSlot | 'submit'
export type UploadItemState = 'pending' | 'done' | 'failed'

export type UploadStep = {
  key: UploadStepKey
  label: string
  state: UploadItemState
  message: string
  doc?: UploadedDocument
}

// 上传会话：分步推进，中断后连同每一步状态一起持久化，支持从失败条目续传
export type UploadSession = {
  id: string
  contractorId: number
  teamCode: string
  packageToken: string
  reviewer: string
  startedAt: string
  updatedAt: string
  steps: UploadStep[]
}

// 退场核查事项：作业中队伍资质过期或证照缺失时生成
export type ExitCheckItem = {
  id: number
  contractorId: number
  teamCode: string
  teamName: string
  reason: '资质过期' | '证照缺失'
  source: '资质上传校验' | '资质巡检'
  createdAt: string
  status: '待核查' | '已闭环'
  detail: string
  filingId?: number
}

export type QualificationState = {
  filings: QualificationFiling[]
  sessions: UploadSession[]
  exitChecks: ExitCheckItem[]
  seqFiling: number
  seqExit: number
}

export type GateResult = {
  allowed: boolean
  reason: '资质过期' | '证照缺失' | null
  message: string
  latest?: QualificationFiling
}
