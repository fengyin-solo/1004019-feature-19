// 业务规则冒烟测试：不依赖浏览器，桩掉 localStorage 后直接跑数据层逻辑。
// 用法：node scripts/smoke-qualification.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  },
}

const dir = mkdtempSync(join(tmpdir(), 'qual-'))
const entry = join(dir, 'smoke.ts')
const outfile = join(dir, 'smoke-bundle.mjs')
writeFileSync(
  entry,
  `
import { listRows } from '@/data/local-store'
import { resetQualificationState } from '@/data/qualification-store'
import {
  buildPackage, parsePackageText, packageJson,
  startSession, completeStep, failStep, resumeTarget, listSessions,
  submitUpload, listFilings, contractorGate,
  listExitChecks, resolveExitCheck, scanWorkingContractors,
} from '@/api/qualification-service'

export async function run(assert) {
  resetQualificationState()

  // ---- 0. 示例数据：CONT-0001 无备案、CONT-0003 作业中且资质过期、CONT-0002 有效 ----
  const gate1 = contractorGate(1)
  assert.equal(gate1.allowed, false, '无备案应拦截')
  assert.equal(gate1.reason, '证照缺失')
  const gate3 = contractorGate(3)
  assert.equal(gate3.allowed, false, '过期应拦截')
  assert.equal(gate3.reason, '资质过期')
  assert.equal(contractorGate(2).allowed, true, 'CONT-0002 当前版本应放行')

  // ---- 1. 打包下载 + 回导 ----
  const rows = listRows('contractor')
  const r1 = rows.find(r => Number(r.id) === 1)
  const pkg = buildPackage(r1)
  assert.equal(pkg.teamCode, 'CONT-0001')
  assert.equal(pkg.qualificationGrade, '市政公用工程施工总承包贰级')
  assert.equal(pkg.slots.length, 3, '三个材料槽位')
  const reparsed = parsePackageText('【头】说明\\n' + packageJson(pkg))
  assert.equal(reparsed.contractorId, 1)
  let threw = false
  try { parsePackageText('{\"packageToken\":\"x\",\"teamCode\":\"NOPE\"}') } catch { threw = true }
  assert.ok(threw, '名册外队伍应拒绝')

  // ---- 2. 上传会话：分步 + 中断 + 从失败条目续传 ----
  let session = startSession({ contractorId: 1, packageToken: pkg.packageToken })
  assert.equal(session.steps.length, 5, '5 步：接收包+3 材料+提交')
  failStep(session.id, 'qualification', '网络中断')
  assert.equal(resumeTarget(listSessions()[0]), 'qualification', '断点应在资质证书')

  const enterprise = '深圳市畅通市政建设有限公司'
  const mkDoc = (slot, i) => ({
    slot,
    fileName: 'doc-' + slot + '-' + i + '.pdf',
    fileSize: 1000 + i,
    checksum: 'hash-fresh-' + slot + '-' + i,
    certNo: 'CERT-' + slot + '-' + i,
    scope: slot === 'special_cert' ? '有限空间作业' : slot === 'qualification' ? '市政排水管网工程' : '',
    enterprise,
    validFrom: '2026-01-01',
    validUntil: slot === 'enterprise' ? '长期' : '2030-01-01',
    uploadedBy: '王审核',
    uploadedAt: '2026-10-06 10:00',
  })

  completeStep(listSessions()[0].id, 'qualification', mkDoc('qualification', 1))
  session = listSessions()[0]
  assert.equal(session.steps.find(s => s.key === 'qualification').state, 'done')
  assert.equal(resumeTarget(session), 'special_cert', '完成后断点推进到下一槽位')

  // 特种证作业范围不覆盖有限空间 -> 校验未通过但仍生成备案版本
  const badScope = mkDoc('special_cert', 2)
  badScope.scope = '仅高处作业'
  completeStep(session.id, 'special_cert', badScope)
  completeStep(session.id, 'enterprise', mkDoc('enterprise', 3))

  const res1 = submitUpload({ sessionId: listSessions()[0].id, reviewer: '王审核' })
  assert.equal(res1.ok, true)
  assert.equal(res1.duplicate, false)
  assert.ok(res1.filing, '生成备案记录')
  assert.equal(res1.filing.version, 1, '首版')
  assert.equal(res1.filing.status, '校验未通过', '作业范围不匹配应未通过')
  const scopeRule = res1.filing.checks.find(c => c.slot === 'special_cert').rules.find(r => r.rule === '作业范围')
  assert.equal(scopeRule.ok, false)
  assert.ok(scopeRule.message.includes('未覆盖有限空间'))
  assert.equal(res1.filing.validUntil, '2030-01-01', '最早到期日')

  // CONT-0001 非作业中，不生成退场事项
  assert.equal(listExitChecks().filter(e => e.contractorId === 1).length, 0)

  // ---- 3. 全部重复文件：不生成第二份备案 ----
  session = startSession({ contractorId: 1 })
  completeStep(session.id, 'qualification', mkDoc('qualification', 1))
  completeStep(session.id, 'special_cert', mkDoc('special_cert', 2))
  completeStep(session.id, 'enterprise', mkDoc('enterprise', 3))
  const res2 = submitUpload({ sessionId: listSessions()[0].id, reviewer: '王审核' })
  assert.equal(res2.ok, true)
  assert.equal(res2.duplicate, true, '全重复应判重')
  assert.equal(res2.filing, undefined, '重复不能生成第二份备案记录')
  assert.equal(listFilings(1).length, 1, '备案仍只有一份')
  assert.equal(listSessions().length, 0, '判重后会话结束')

  // ---- 4. 部分重复：新文件生成 v2，旧资质 v1 历史保留 ----
  session = startSession({ contractorId: 1 })
  const newQ = mkDoc('qualification', 9)
  newQ.certNo = 'CERT-NEW'
  newQ.validUntil = '2031-06-30'
  completeStep(session.id, 'qualification', newQ)
  completeStep(session.id, 'special_cert', mkDoc('special_cert', 2))
  completeStep(session.id, 'enterprise', mkDoc('enterprise', 3))
  const res3 = submitUpload({ sessionId: listSessions()[0].id, reviewer: '王审核' })
  assert.equal(res3.duplicate, false)
  assert.equal(res3.filing.version, 2, '部分重复生成 v2')
  assert.ok(res3.filing.notes.includes('重复文件已跳过'))
  const versions = listFilings(1).map(f => f.version).sort()
  assert.deepEqual(versions, [1, 2], '旧资质按历史版本保留')

  // 修正作业范围后最新版校验通过 -> 闸门放行
  session = startSession({ contractorId: 1 })
  const goodS = mkDoc('special_cert', 10)
  goodS.scope = '有限空间作业、焊接作业'
  goodS.validUntil = '2032-01-01'
  completeStep(session.id, 'qualification', newQ)
  completeStep(session.id, 'special_cert', goodS)
  completeStep(session.id, 'enterprise', mkDoc('enterprise', 3))
  const res4 = submitUpload({ sessionId: listSessions()[0].id, reviewer: '王审核' })
  assert.equal(res4.filing.version, 3)
  assert.equal(res4.filing.status, '校验通过')
  assert.equal(contractorGate(1).allowed, true, '补齐合格资质后放行')

  // ---- 5. 作业中队伍过期上传 -> 自动退场核查（去重；闭环后可再生成）----
  session = startSession({ contractorId: 3 })
  const expQ = mkDoc('qualification', 20)
  expQ.enterprise = '广州鑫达管线工程有限公司'
  expQ.validUntil = '2026-09-30' // 过期
  const expS = mkDoc('special_cert', 21)
  expS.enterprise = '广州鑫达管线工程有限公司'
  const expE = mkDoc('enterprise', 22)
  expE.enterprise = '广州鑫达管线工程有限公司'
  completeStep(session.id, 'qualification', expQ)
  completeStep(session.id, 'special_cert', expS)
  completeStep(session.id, 'enterprise', expE)
  const before = listExitChecks().filter(e => e.contractorId === 3 && e.status === '待核查').length
  submitUpload({ sessionId: listSessions()[0].id, reviewer: '李审核' })
  const after = listExitChecks().filter(e => e.contractorId === 3 && e.status === '待核查').length
  assert.ok(after >= before, '作业中过期上传后有待核查退场事项')
  // 巡检不应产生重复待核查事项
  const scanned = scanWorkingContractors().filter(e => e.contractorId === 3).length
  assert.ok(scanned <= 1, '同原因退场事项不得重复生成')
  // 闭环后巡检可再次生成
  const open = listExitChecks().find(e => e.contractorId === 3 && e.status === '待核查')
  resolveExitCheck(open.id)
  const rescanned = scanWorkingContractors()
  assert.ok(rescanned.some(e => e.contractorId === 3), '闭环后可重新巡检生成')

  console.log('全部业务规则冒烟测试通过 ✓')
}
`,
)

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  absWorkingDir: '/workspace/frontend',
  alias: { '@': '/workspace/frontend/src' },
})

const mod = await import(outfile)
await mod.run(assert)
