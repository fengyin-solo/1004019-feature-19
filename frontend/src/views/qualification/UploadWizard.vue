<template>
  <div class="modal-mask" @click.self="emit('closed')">
    <div class="modal modal-lg">
      <header class="modal-head">
        <div>
          <h3>资质归档包补充上传</h3>
          <p class="modal-sub">
            {{ session.teamCode }} · 会话 {{ session.id }} · 归档包 {{ session.packageId }}
          </p>
        </div>
        <button class="btn ghost" type="button" @click="emit('closed')">关闭</button>
      </header>

      <div class="wizard-summary" :class="{ interrupted: session.status === '已中断' }">
        <span>{{ session.note || '等待上传' }}</span>
        <span>审核人：{{ session.reviewer }}</span>
      </div>

      <ol class="stepper">
        <li
          v-for="(item, index) in session.items"
          :key="item.kind"
          class="step"
          :class="stepClass(index)"
        >
          <div class="step-head">
            <span class="step-no">{{ index + 1 }}</span>
            <strong>{{ item.kind }}</strong>
            <span class="step-state">{{ stateText(item) }}</span>
          </div>

          <div v-if="index >= firstEditableIndex" class="step-body">
            <label class="form-line">
              <span>证件编号</span>
              <input v-model="drafts[index].certNo" :disabled="item.status === 'validated'" placeholder="证件/证书编号" />
            </label>
            <label class="form-line">
              <span>有效期至</span>
              <input v-model="drafts[index].validUntil" :disabled="item.status === 'validated'" placeholder="YYYY-MM-DD 或 长期" />
            </label>
            <label class="form-line">
              <span>作业范围</span>
              <input v-model="drafts[index].workScope" :disabled="item.status === 'validated'" placeholder="须覆盖管网施工养护相关作业" />
            </label>
            <label class="form-line">
              <span>所属企业</span>
              <input v-model="drafts[index].company" :disabled="item.status === 'validated'" placeholder="与队伍所属企业一致" />
            </label>
            <div class="form-line file-line">
              <span>证照附件</span>
              <input
                class="file-input"
                type="file"
                :disabled="item.status === 'validated'"
                @change="onPickFile(index, $event)"
              />
              <button class="btn ghost mini" type="button" :disabled="item.status === 'validated'" @click="fillDemo(index)">
                填入示例
              </button>
            </div>
            <p v-if="item.message" class="step-message" :class="messageClass(item.status)">
              {{ item.message }}
            </p>
            <div class="step-actions">
              <button
                class="btn primary mini"
                type="button"
                :disabled="item.status === 'validated' || busy === index"
                @click="doUpload(index)"
              >
                {{ busy === index ? '上传校验中…' : `上传并校验（${item.kind}）` }}
              </button>
            </div>
          </div>
          <p v-else class="step-done">已校验通过，{{ item.updatedAt }}</p>
        </li>
      </ol>

      <footer class="modal-foot">
        <button class="btn danger-ghost" type="button" @click="abandon">放弃本次上传</button>
        <div class="foot-right">
          <button class="btn warn-ghost" type="button" :disabled="session.status === '已完成'" @click="simulateInterrupt">
            模拟网络中断
          </button>
          <button
            v-if="session.status === '已中断'"
            class="btn"
            type="button"
            @click="resume"
          >
            从第 {{ session.failStep + 1 }} 步继续
          </button>
          <button class="btn primary" type="button" :disabled="!allValidated" @click="submit">
            提交备案
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  discardSession,
  digestFields,
  finalizeUpload,
  interruptUpload,
  resumeUpload,
  saveDraft,
  uploadItem,
} from '@/data/qualification/qualification-service'
import { DOC_KINDS, type DocKind, type SessionItemStatus, type UploadSession } from '@/data/qualification/types'

const props = defineProps<{ session: UploadSession }>()
const emit = defineEmits<{
  (event: 'changed', session: UploadSession): void
  (event: 'closed'): void
}>()

interface DraftRow {
  certNo: string
  validUntil: string
  workScope: string
  company: string
  fileName: string
  fileSize: number
  fileHash: string
}

const drafts = reactive<DraftRow[]>([])
const busy = ref<number | null>(null)

function syncDrafts() {
  props.session.items.forEach((item, index) => {
    if (!drafts[index]) {
      drafts.push({
        certNo: item.certNo,
        validUntil: item.validUntil,
        workScope: item.workScope,
        company: item.company,
        fileName: item.fileName,
        fileSize: item.fileSize,
        fileHash: item.fileHash,
      })
    } else {
      Object.assign(drafts[index], {
        certNo: item.certNo,
        validUntil: item.validUntil,
        workScope: item.workScope,
        company: item.company,
        fileName: item.fileName,
        fileSize: item.fileSize,
        fileHash: item.fileHash,
      })
    }
  })
}
syncDrafts()

const firstEditableIndex = computed(() =>
  props.session.items.findIndex((item) => item.status !== 'validated'),
)
const allValidated = computed(
  () =>
    props.session.status !== '已中断' &&
    props.session.items.every((item) => item.status === 'validated'),
)

watch(
  drafts,
  () => {
    const index = firstEditableIndex.value
    if (index >= 0) {
      const kind = DOC_KINDS[index]
      const item = props.session.items[index]
      if (item.status !== 'validated') {
        saveDraft(props.session.id, kind, drafts[index])
      }
    }
  },
  { deep: true },
)

function stepClass(index: number): Record<string, boolean> {
  const item = props.session.items[index]
  return {
    done: item.status === 'validated',
    fail: item.status === 'failed',
    stopped: item.status === 'interrupted',
    active: index === firstEditableIndex.value && item.status !== 'validated',
  }
}

function stateText(item: { status: SessionItemStatus }): string {
  return { pending: '待上传', validated: '已通过', failed: '校验未过', interrupted: '已中断' }[item.status]
}

function messageClass(status: SessionItemStatus): string {
  return status === 'validated' ? 'ok-text' : 'error-text'
}

async function onPickFile(index: number, event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) {
    return
  }
  // 纯前端演示：指纹只取文件名+大小，避免读完整大文件；接后端时改成整文件 SHA-256。
  const canonical = `${file.name}|${file.size}`
  drafts[index].fileName = file.name
  drafts[index].fileSize = file.size
  drafts[index].fileHash = await digestFields({
    kind: DOC_KINDS[index],
    certNo: drafts[index].certNo,
    validUntil: drafts[index].validUntil,
    workScope: drafts[index].workScope,
    company: drafts[index].company,
    fileName: canonical,
  })
  saveDraft(props.session.id, DOC_KINDS[index], drafts[index])
  emitChanged()
}

const DEMO_VALUES: Record<DocKind, { certNo: string; validUntil: string; workScope: string }> = {
  队伍编号: { certNo: '', validUntil: '长期', workScope: '排水管网养护维修' },
  资质等级: { certNo: 'SGZZ-DEMO-0001', validUntil: '长期', workScope: '排水管网施工、养护维修' },
  特种作业证: { certNo: 'TZ-DEMO-0001', validUntil: '2028-12-31', workScope: '有限空间作业、井下特种作业' },
  所属企业材料: { certNo: '91320000DEMO00000X', validUntil: '长期', workScope: '市政公用工程施工、排水管网养护维修' },
}

async function fillDemo(index: number) {
  const kind = DOC_KINDS[index]
  const demo = DEMO_VALUES[kind]
  drafts[index].certNo = kind === '队伍编号' ? props.session.teamCode : demo.certNo
  drafts[index].validUntil = demo.validUntil
  drafts[index].workScope = demo.workScope
  const fileName = `${kind}-${drafts[index].certNo || 'demo'}.pdf`
  drafts[index].fileName = fileName
  drafts[index].fileSize = 204_800 + index * 4096
  drafts[index].fileHash = await digestFields({
    kind,
    certNo: drafts[index].certNo,
    validUntil: drafts[index].validUntil,
    workScope: drafts[index].workScope,
    company: drafts[index].company,
    fileName: `${fileName}|${drafts[index].fileSize}`,
  })
  saveDraft(props.session.id, kind, drafts[index])
  emitChanged()
}

async function doUpload(index: number) {
  const kind = DOC_KINDS[index]
  saveDraft(props.session.id, kind, drafts[index])
  busy.value = index
  // 留出“传输中”的观感，让模拟中断按钮有用武之地。
  await new Promise((resolve) => setTimeout(resolve, 400))
  uploadItem(props.session.id, kind)
  busy.value = null
  syncDrafts()
  emitChanged()
}

function simulateInterrupt() {
  interruptUpload(props.session.id)
  syncDrafts()
  emitChanged()
}

function resume() {
  resumeUpload(props.session.id)
  syncDrafts()
  emitChanged()
}

function submit() {
  const result = finalizeUpload(props.session.id, props.session.reviewer)
  if (!result.ok) {
    window.alert(result.message)
    return
  }
  window.alert(result.message)
  emitChanged(props.session)
  emit('closed')
}

function abandon() {
  if (!window.confirm('放弃后本次已传条目不保留，需要重新下载归档包上传，确认放弃？')) {
    return
  }
  discardSession(props.session.id)
  emit('closed')
}

function emitChanged(session?: UploadSession) {
  emit('changed', session ?? props.session)
}
</script>
