<template>
  <div v-if="open" class="wizard-mask" @click.self="interrupt">
    <section class="wizard-dialog" role="dialog" aria-modal="true">
      <header class="wizard-head">
        <div>
          <h3>资质文件归档包 · 补充上传</h3>
          <p v-if="session" class="wizard-sub">
            会话 {{ session.id }} · {{ session.teamCode }} · 最近更新 {{ session.updatedAt }}
          </p>
        </div>
        <button class="btn ghost" type="button" @click="interrupt">保存进度并中断</button>
      </header>

      <ol class="step-track">
        <li
          v-for="step in session ? session.steps : pendingSteps"
          :key="step.key"
          class="step-chip"
          :class="[`chip-${step.state}`, { active: session && step.key === activeKey }]"
        >
          <span class="chip-index">{{ stateMark(step.state) }}</span>
          <span class="chip-label">{{ step.label }}</span>
        </li>
      </ol>

      <!-- 尚未建立会话：第 1 步接收归档包 -->
      <div v-if="!session" class="wizard-body">
        <h4>第 1 步：接收资质文件归档包</h4>
        <p class="muted-text">
          审核人先在施工队伍清单下载归档包，核对队伍编号、资质等级与所属企业后在此导入；
          线下已领取归档包的，也可以直接开始补件。
        </p>
        <div v-if="imported" class="package-card">
          <p><strong>已导入归档包：</strong>{{ imported.packageToken }}</p>
          <p>队伍编号：{{ imported.teamCode }} ｜ 资质等级：{{ imported.qualificationGrade }}</p>
          <p>所属企业：{{ imported.enterprise }}</p>
        </div>
        <div v-else class="package-actions">
          <label class="btn">
            选择归档包文件（.json）
            <input ref="packageInput" type="file" accept=".json,application/json" hidden @change="onPickPackage" />
          </label>
          <button class="btn" type="button" @click="startOffline">线下已领取，直接补件</button>
        </div>
        <p v-if="packageError" class="error-text">{{ packageError }}</p>
      </div>

      <!-- 材料条目 -->
      <div v-else-if="activeSlot" class="wizard-body">
        <h4>{{ activeStep.label }}</h4>
        <p class="muted-text">{{ activeMeta.hint }}；系统将逐条校验证件有效期、作业范围与所属企业。</p>

        <div class="form-grid">
          <label class="form-cell">
            <span>证件文件</span>
            <input type="file" @change="onPickDoc" />
          </label>
          <label class="form-cell">
            <span>证件编号</span>
            <input v-model="form.certNo" placeholder="如 D244030222" />
          </label>
          <label class="form-cell grow-2">
            <span>作业范围（证件载明）</span>
            <input v-model="form.scope" :placeholder="scopePlaceholder" />
          </label>
          <label class="form-cell grow-2">
            <span>所属企业（证件载明）</span>
            <input v-model="form.enterprise" placeholder="须与队伍所属企业一致" />
          </label>
          <label class="form-cell">
            <span>有效期起</span>
            <input v-model="form.validFrom" type="date" />
          </label>
          <label class="form-cell">
            <span>有效期止（长期有效可填"长期"）</span>
            <input v-model="form.validUntil" placeholder="2029-09-01 或 长期" />
          </label>
        </div>

        <div v-if="form.fileName" class="file-summary">
          已选文件：{{ form.fileName }}（{{ formatFileSize(form.fileSize) }}）
          <span v-if="hashing" class="muted-text">正在计算文件指纹…</span>
          <span v-else class="fingerprint">指纹 {{ shortChecksum }}</span>
          <span v-if="duplicateHint" class="dup-tag">该文件已备案，提交时将按重复文件跳过</span>
        </div>
        <div v-if="activeStep.state === 'failed'" class="fail-banner">
          上一次传输在本条目失败：{{ activeStep.message }}。请修正后从本条目继续，前面已完成条目不会重传。
        </div>
        <p v-if="docError" class="error-text">{{ docError }}</p>

        <label class="simulate-line">
          <input v-model="simulateFail" type="checkbox" />
          模拟本条目传输失败（演示断点续传与失败条目续传）
        </label>
      </div>

      <!-- 提交归档 -->
      <div v-else-if="session && activeKey === 'submit'" class="wizard-body">
        <h4>第 5 步：提交归档备案</h4>
        <div class="review-list">
          <div v-for="step in materialSteps" :key="step.key" class="review-row" :class="`chip-${step.state}`">
            <span class="review-name">{{ step.label }}</span>
            <span class="review-file">{{ step.doc?.fileName ?? '未上传' }}</span>
            <span class="review-state">{{ stateText(step.state) }}</span>
          </div>
        </div>
        <label class="form-cell reviewer-line">
          <span>审核人</span>
          <input v-model="reviewer" placeholder="审核人补充后上传，请署名" />
        </label>
        <p v-if="submitMessage" :class="submitOk ? 'ok-text' : 'error-text'">{{ submitMessage }}</p>
      </div>

      <footer class="wizard-foot">
        <div class="foot-tip">
          <span v-if="progressText">{{ progressText }}</span>
        </div>
        <div class="foot-actions">
          <button class="btn" type="button" :disabled="!canPrev" @click="goPrev">上一步</button>
          <button
            v-if="activeSlot"
            class="btn primary"
            type="button"
            :disabled="hashing"
            @click="uploadCurrent"
          >
            {{ activeStep.state === 'failed' ? '从失败条目继续上传' : '上传本条目' }}
          </button>
          <button
            v-else-if="session && activeKey === 'submit'"
            class="btn primary"
            type="button"
            @click="submit"
          >
            提交归档
          </button>
          <button
            v-else-if="session"
            class="btn primary"
            type="button"
            @click="goNext"
          >
            下一步
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  STEP_LABELS,
  SLOT_META,
  completeStep,
  discardSession,
  failStep,
  formatFileSize,
  hashFile,
  listFilings,
  listSessions,
  parsePackageText,
  resumeTarget,
  saveReviewer,
  startSession,
  submitUpload,
} from '@/api/qualification-service'
import { listRows } from '@/data/local-store'
import type {
  QualificationPackage,
  QualificationSlot,
  UploadSession,
  UploadStep,
  UploadStepKey,
  UploadedDocument,
} from '@/data/qualification-types'

const props = defineProps<{
  open: boolean
  contractorId: number | null
  imported: QualificationPackage | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'filed'): void
}>()

const packageInput = ref<HTMLInputElement | null>(null)
const packageError = ref('')
const session = ref<UploadSession | null>(null)
const activeKey = ref<UploadStepKey>('package')
const hashing = ref(false)
const docError = ref('')
const simulateFail = ref(false)
const submitMessage = ref('')
const submitOk = ref(false)
const reviewer = ref('')

const emptyForm = (): UploadedDocument => ({
  slot: 'qualification',
  fileName: '',
  fileSize: 0,
  checksum: '',
  certNo: '',
  scope: '',
  enterprise: '',
  validFrom: '',
  validUntil: '',
  uploadedBy: '',
  uploadedAt: '',
})
const form = ref<UploadedDocument>(emptyForm())

const pendingSteps: UploadStep[] = [
  { key: 'package', label: STEP_LABELS.package, state: 'pending', message: '' },
  ...SLOT_META.map((meta) => ({
    key: meta.slot as UploadStepKey,
    label: STEP_LABELS[meta.slot],
    state: 'pending' as const,
    message: '',
  })),
  { key: 'submit', label: STEP_LABELS.submit, state: 'pending', message: '' },
]

const materialSteps = computed(() =>
  session.value ? session.value.steps.filter((step) => step.key !== 'package' && step.key !== 'submit') : [],
)

const activeStep = computed<UploadStep>(
  () =>
    session.value?.steps.find((step) => step.key === activeKey.value) ?? {
      key: activeKey.value,
      label: STEP_LABELS[activeKey.value],
      state: 'pending',
      message: '',
    },
)

const activeSlot = computed<QualificationSlot | null>(() =>
  activeKey.value === 'package' || activeKey.value === 'submit'
    ? null
    : (activeKey.value as QualificationSlot),
)

const activeMeta = computed(() =>
  activeSlot.value ? SLOT_META.find((meta) => meta.slot === activeSlot.value)! : SLOT_META[0],
)

const scopePlaceholder = computed(() =>
  activeSlot.value === 'special_cert'
    ? '须包含有限空间作业等类别'
    : '须覆盖排水/管网/市政作业',
)

const shortChecksum = computed(() =>
  form.value.checksum ? `${form.value.checksum.slice(0, 16)}…` : '',
)

const priorChecksums = computed<Set<string>>(() => {
  if (!session.value) {
    return new Set()
  }
  const set = new Set<string>()
  for (const filing of listFilings(session.value.contractorId)) {
    for (const doc of filing.docs) {
      set.add(doc.checksum)
    }
  }
  for (const step of session.value.steps) {
    if (step.doc && step.key !== activeKey.value) {
      set.add(step.doc.checksum)
    }
  }
  return set
})

const duplicateHint = computed(
  () => Boolean(form.value.checksum) && priorChecksums.value.has(form.value.checksum),
)

const progressText = computed(() => {
  if (!session.value) {
    return '等待接收归档包'
  }
  const total = session.value.steps.length
  const done = session.value.steps.filter((step) => step.state === 'done').length
  const failed = session.value.steps.filter((step) => step.state === 'failed').length
  const currentLabel = STEP_LABELS[resumeTarget(session.value)]
  return `已完成 ${done}/${total} 步${failed ? `，${failed} 步失败` : ''}；断点位置：${currentLabel}`
})

const canPrev = computed(() => {
  if (!session.value) {
    return false
  }
  const index = session.value.steps.findIndex((step) => step.key === activeKey.value)
  return index > 0
})

function stateMark(state: UploadStep['state']): string {
  if (state === 'done') {
    return '✓'
  }
  if (state === 'failed') {
    return '!'
  }
  return '·'
}

function stateText(state: UploadStep['state']): string {
  if (state === 'done') {
    return '已完成'
  }
  if (state === 'failed') {
    return '失败'
  }
  return '待上传'
}

function contractorEnterprise(id: number): string {
  const row = listRows('contractor').find((item) => Number(item.id) === id)
  return String(row?.['所属企业'] ?? '')
}

function hydrateFormFromStep(step: UploadStep): void {
  if (step.doc) {
    form.value = { ...step.doc }
    return
  }
  form.value = {
    ...emptyForm(),
    slot: step.key as QualificationSlot,
    enterprise: session.value ? contractorEnterprise(session.value.contractorId) : '',
  }
}

function beginSession(contractorId: number, token: string, message: string): void {
  session.value = startSession({
    contractorId,
    packageToken: token || undefined,
    packageMessage: token ? message : undefined,
  })
  if (!token) {
    const pkgStep = session.value.steps[0]
    pkgStep.state = 'done'
    pkgStep.message = message
  }
  reviewer.value = session.value.reviewer
  activeKey.value = resumeTarget(session.value)
  hydrateFormFromStep(activeStep.value)
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    resetWizard()
    if (props.imported) {
      beginSession(props.imported.contractorId, props.imported.packageToken, `已导入归档包 ${props.imported.packageToken}`)
    } else if (props.contractorId !== null) {
      // 该队伍有中断会话就直接回到断点；没有则停在第 1 步，由审核人选择导入归档包或直接补件。
      const existing = listSessions().find(
        (item) => item.contractorId === props.contractorId,
      )
      if (existing && hasProgress(existing)) {
        session.value = existing
        reviewer.value = existing.reviewer
        activeKey.value = resumeTarget(existing)
        hydrateFormFromStep(activeStep.value)
      }
    }
  },
)

function hasProgress(target: UploadSession): boolean {
  return (
    target.reviewer.trim() !== '' ||
    target.steps
      .filter((step) => step.key !== 'package')
      .some((step) => step.state !== 'pending')
  )
}

function resetWizard(): void {
  session.value = null
  activeKey.value = 'package'
  packageError.value = ''
  docError.value = ''
  submitMessage.value = ''
  submitOk.value = false
  simulateFail.value = false
  form.value = emptyForm()
}

async function onPickPackage(event: Event): Promise<void> {
  packageError.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  try {
    const text = await file.text()
    const pkg = parsePackageText(text)
    beginSession(pkg.contractorId, pkg.packageToken, `已导入归档包 ${pkg.packageToken}`)
  } catch (error) {
    packageError.value = error instanceof Error ? error.message : '归档包读取失败'
  } finally {
    input.value = ''
  }
}

function startOffline(): void {
  if (props.contractorId === null) {
    packageError.value = '请先指定要补件的施工队伍'
    return
  }
  beginSession(props.contractorId, '', '线下已领取归档包，直接补件上传')
}

async function onPickDoc(event: Event): Promise<void> {
  docError.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !activeSlot.value) {
    return
  }
  hashing.value = true
  try {
    const checksum = await hashFile(file)
    form.value.slot = activeSlot.value
    form.value.fileName = file.name
    form.value.fileSize = file.size
    form.value.checksum = checksum
  } catch {
    docError.value = `文件「${file.name}」读取失败，请重新选择`
  } finally {
    hashing.value = false
    input.value = ''
  }
}

function validateDoc(): string {
  if (!form.value.fileName) {
    return '请选择要上传的证件文件'
  }
  if (!form.value.certNo.trim()) {
    return '请补充证件编号'
  }
  if (activeMeta.value.scopeKeywords.length > 0 && !form.value.scope.trim()) {
    return '请补充证件载明的作业范围'
  }
  if (!form.value.enterprise.trim()) {
    return '请补充证件载明的所属企业'
  }
  if (!form.value.validFrom.trim()) {
    return '请补充有效期起'
  }
  const until = form.value.validUntil.trim()
  if (!until) {
    return '请补充有效期止，长期有效请填写"长期"'
  }
  if (until !== '长期' && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return '有效期止格式应为 YYYY-MM-DD 或"长期"'
  }
  return ''
}

function uploadCurrent(): void {
  if (!session.value || !activeSlot.value) {
    return
  }
  docError.value = ''
  const message = validateDoc()
  if (message) {
    docError.value = message
    return
  }
  if (simulateFail.value) {
    failStep(
      session.value.id,
      activeKey.value,
      `文件「${form.value.fileName}」传输中断（模拟失败），已完成条目已保存`,
    )
    syncSession()
    docError.value = '本条目传输失败，进度已保存，可稍后从本条目继续'
    simulateFail.value = false
    return
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const doc: UploadedDocument = {
    ...form.value,
    slot: activeSlot.value,
    uploadedBy: reviewer.value || session.value.reviewer,
    uploadedAt: stamp,
  }
  completeStep(session.value.id, activeKey.value, doc)
  syncSession()
  goNext()
}

function syncSession(): void {
  // startSession/completeStep 都落库了，这里只需把最新会话拉回视图。
  const state = JSON.parse(JSON.stringify(session.value)) as UploadSession
  session.value = state
}

function goNext(): void {
  if (!session.value) {
    return
  }
  const target = resumeTarget(session.value)
  activeKey.value = target
  hydrateFormFromStep(activeStep.value)
}

function goPrev(): void {
  if (!session.value) {
    return
  }
  const index = session.value.steps.findIndex((step) => step.key === activeKey.value)
  if (index <= 0) {
    return
  }
  activeKey.value = session.value.steps[index - 1].key
  hydrateFormFromStep(activeStep.value)
}

watch(reviewer, (value) => {
  if (session.value && value.trim()) {
    saveReviewer(session.value.id, value.trim())
  }
})

function submit(): void {
  if (!session.value) {
    return
  }
  submitMessage.value = ''
  const result = submitUpload({ sessionId: session.value.id, reviewer: reviewer.value })
  submitOk.value = result.ok
  if (result.ok) {
    let message = result.message
    if (result.exitCreated) {
      message += `；该队伍作业中，已生成退场核查事项（${result.exitCreated.reason}）`
    }
    submitMessage.value = message
    emit('filed')
    window.setTimeout(() => emit('close'), 1200)
    return
  }
  submitMessage.value = result.message
  syncSession()
  activeKey.value = resumeTarget(session.value)
  hydrateFormFromStep(activeStep.value)
}

function interrupt(): void {
  if (session.value && !session.value.steps.some((step) => step.state === 'done')) {
    discardSession(session.value.id)
  }
  emit('close')
}
</script>

<style scoped>
.wizard-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.wizard-dialog {
  width: 820px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.wizard-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.wizard-head h3 { margin: 0; font-size: 16px; }
.wizard-sub { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.step-track {
  list-style: none;
  display: flex;
  gap: 6px;
  padding: 12px 20px;
  margin: 0;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
}
.step-chip {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 12px;
  color: var(--muted);
}
.step-chip.active { border-color: var(--brand); color: #1f2937; box-shadow: 0 0 0 1px var(--brand); }
.chip-done { background: #ecfdf3; border-color: #abefc6; color: #067647; }
.chip-failed { background: #fef3f2; border-color: #fda29b; color: #b42318; }
.chip-index {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e2e8f0;
  font-size: 11px;
}
.chip-done .chip-index { background: #12b76a; color: #fff; }
.chip-failed .chip-index { background: #f04438; color: #fff; }
.chip-label { line-height: 1.3; }
.wizard-body { padding: 16px 20px; }
.wizard-body h4 { margin: 0 0 8px; font-size: 14px; }
.muted-text { color: var(--muted); font-size: 13px; }
.package-card {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
  font-size: 13px;
}
.package-card p { margin: 4px 0; }
.package-actions { display: flex; gap: 10px; margin-top: 12px; }
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  margin-top: 12px;
}
.form-cell { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.form-cell.grow-2 { grid-column: span 2; }
.form-cell input {
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  color: #1f2937;
}
.file-summary {
  margin-top: 12px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.fingerprint { color: var(--muted); }
.dup-tag { color: #b54708; background: #fffaeb; border: 1px solid #fedf89; border-radius: 999px; padding: 1px 8px; }
.fail-banner {
  margin-top: 10px;
  padding: 8px 10px;
  background: #fef3f2;
  border: 1px solid #fda29b;
  border-radius: 6px;
  color: #b42318;
  font-size: 12px;
}
.simulate-line { display: flex; gap: 6px; align-items: center; margin-top: 12px; font-size: 12px; color: var(--muted); }
.review-list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.review-row {
  display: grid;
  grid-template-columns: 160px 1fr 70px;
  gap: 8px;
  padding: 8px 10px;
  font-size: 13px;
  border-top: 1px solid var(--border);
}
.review-row:first-child { border-top: none; }
.review-state { text-align: right; }
.reviewer-line { margin-top: 12px; max-width: 320px; }
.ok-text { color: #067647; font-size: 13px; }
.wizard-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}
.foot-tip { font-size: 12px; color: var(--muted); }
.foot-actions { display: flex; gap: 8px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
