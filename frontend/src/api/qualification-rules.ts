import type { DocCheck, QualificationSlot, UploadedDocument } from '@/data/qualification-types'

export type SlotMeta = {
  slot: QualificationSlot
  label: string
  required: boolean
  hint: string
  // 作业范围关键词：命中任意一个才算覆盖管网施工作业；企业材料不校验作业范围
  scopeKeywords: string[]
}

export const SLOT_META: SlotMeta[] = [
  {
    slot: 'qualification',
    label: '资质等级证书',
    required: true,
    hint: '上传企业资质证书（载明资质等级与作业范围）',
    scopeKeywords: ['排水', '管网', '市政'],
  },
  {
    slot: 'special_cert',
    label: '特种作业操作证',
    required: true,
    hint: '上传特种作业操作证（有限空间等作业类别）',
    scopeKeywords: ['有限空间'],
  },
  {
    slot: 'enterprise',
    label: '所属企业材料',
    required: true,
    hint: '上传营业执照等所属企业证明材料',
    scopeKeywords: [],
  },
]

export function slotMeta(slot: QualificationSlot): SlotMeta {
  return SLOT_META.find((item) => item.slot === slot) as SlotMeta
}

export function todayText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isExpired(validUntil: string, today = todayText()): boolean {
  const value = validUntil.trim()
  if (value === '' || value === '长期') {
    return false
  }
  return value < today
}

export function earliestExpiry(docs: UploadedDocument[]): string {
  const dated = docs
    .map((doc) => doc.validUntil.trim())
    .filter((value) => value !== '' && value !== '长期')
    .sort()
  return dated[0] ?? '长期'
}

// 对单份证件逐条过三条规则；企业材料没有作业范围要求，只校企业与有效期。
export function evaluateDoc(
  doc: UploadedDocument,
  teamEnterprise: string,
): DocCheck['rules'] {
  const meta = slotMeta(doc.slot)
  const rules: DocCheck['rules'] = []

  const until = doc.validUntil.trim()
  rules.push({
    rule: '有效期',
    ok: until !== '' && (until === '长期' || !isExpired(until)),
    message:
      until === ''
        ? '未填写有效期'
        : until === '长期'
          ? '长期有效'
          : isExpired(until)
            ? `已于 ${until} 过期`
            : `有效期至 ${until}`,
  })

  if (meta.scopeKeywords.length > 0) {
    const hit = meta.scopeKeywords.find((keyword) => doc.scope.includes(keyword))
    rules.push({
      rule: '作业范围',
      ok: doc.scope.trim() !== '' && Boolean(hit),
      message:
        doc.scope.trim() === ''
          ? '未填报作业范围'
          : hit
            ? `覆盖「${hit}」等管网作业`
            : `作业范围「${doc.scope}」未覆盖${meta.scopeKeywords.join('/')}作业`,
    })
  }

  const expected = teamEnterprise.trim()
  const actual = doc.enterprise.trim()
  rules.push({
    rule: '所属企业',
    ok: actual !== '' && actual === expected,
    message:
      actual === ''
        ? '未填写所属企业'
        : actual === expected
          ? `与所属企业「${expected}」一致`
          : `证件企业为「${actual}」，与所属企业「${expected}」不一致`,
  })

  return rules
}

export function evaluateDocs(
  docs: UploadedDocument[],
  teamEnterprise: string,
): DocCheck[] {
  return docs.map((doc) => {
    const rules = evaluateDoc(doc, teamEnterprise)
    return {
      slot: doc.slot,
      label: slotMeta(doc.slot).label,
      fileName: doc.fileName,
      rules,
      passed: rules.every((rule) => rule.ok),
    }
  })
}
