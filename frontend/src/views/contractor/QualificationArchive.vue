<template>
  <section class="page" data-module="contractor-qualification">
    <header class="page-head">
      <div>
        <h2>施工队伍资质文件归档</h2>
        <p class="page-desc">
          打包下载队伍编号、资质等级、特种作业证与所属企业材料；审核人补充后上传，系统逐条校验证件有效期、作业范围与所属企业。
          重复文件不重复备案，旧资质按历史版本保留；资质过期或证照缺失禁止安排作业，作业中队伍自动生成退场核查事项。
        </p>
      </div>
      <div class="page-actions">
        <label class="btn primary">
          导入归档包上传
          <input type="file" accept=".json,application/json" hidden @change="onImportPackage" />
        </label>
        <button class="btn" type="button" @click="runScan">资质巡检（作业中队伍）</button>
        <button class="btn ghost" type="button" @click="resetAll">重置资质数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">施工队伍与资质准入</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>队伍编号</th>
          <th>队伍名称</th>
          <th>资质等级</th>
          <th>所属企业</th>
          <th>队伍状态</th>
          <th>资质准入</th>
          <th>当前备案</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in contractors" :key="String(row.id)">
          <td>{{ row['队伍编号'] }}</td>
          <td>{{ row['队伍名称'] }}</td>
          <td>{{ row['资质等级'] }}</td>
          <td>{{ row['所属企业'] }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span class="gate-tag" :class="gateOf(Number(row.id)).allowed ? 'gate-ok' : 'gate-block'">
              {{ gateOf(Number(row.id)).allowed ? '可作业' : gateOf(Number(row.id)).reason }}
            </span>
            <p class="cell-tip">{{ gateOf(Number(row.id)).message }}</p>
          </td>
          <td>
            <template v-if="gateOf(Number(row.id)).latest">
              v{{ gateOf(Number(row.id)).latest!.version }} · 至
              {{ gateOf(Number(row.id)).latest!.validUntil }}
            </template>
            <span v-else class="muted">未备案</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="downloadPackage(row)">下载归档包</button>
            <button class="link" type="button" @click="openWizard(Number(row.id))">
              {{ hasSession(Number(row.id)) ? '续传归档' : '补充上传' }}
            </button>
            <button class="link" type="button" @click="arrange(Number(row.id))">安排作业</button>
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="sessions.length" class="panel">
      <h3 class="section-title">中断的上传会话（{{ sessions.length }}）</h3>
      <p class="muted-text">上传中断时已标出完成到哪一步，续传直接从失败条目继续，已完成条目不会重传。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>会话</th>
            <th>队伍编号</th>
            <th>开始时间</th>
            <th>最近更新</th>
            <th>完成到哪一步</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="session in sessions" :key="session.id">
            <td>{{ session.id }}</td>
            <td>{{ session.teamCode }}</td>
            <td>{{ session.startedAt }}</td>
            <td>{{ session.updatedAt }}</td>
            <td>
              <div v-for="step in session.steps" :key="step.key" class="progress-line" :class="`chip-${step.state}`">
                <span>{{ step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : '·' }}</span>
                <span class="progress-label">{{ step.label }}</span>
                <span v-if="step.message" class="progress-msg">：{{ step.message }}</span>
              </div>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openWizard(session.contractorId)">从失败条目继续</button>
              <button class="link danger" type="button" @click="abandon(session.id)">放弃会话</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="section-title">退场核查事项</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>队伍编号</th>
            <th>队伍名称</th>
            <th>触发原因</th>
            <th>来源</th>
            <th>生成时间</th>
            <th>事项说明</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in exitChecks" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ item.teamCode }}</td>
            <td>{{ item.teamName }}</td>
            <td><span class="gate-tag gate-block">{{ item.reason }}</span></td>
            <td>{{ item.source }}</td>
            <td>{{ item.createdAt }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.status }}</td>
            <td>
              <button
                v-if="item.status === '待核查'"
                class="link"
                type="button"
                @click="closeExit(item.id)"
              >
                核查闭环
              </button>
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="!exitChecks.length">
            <td colspan="9" class="empty-state">暂无退场核查事项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="section-title">资质备案记录（历史版本保留）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>备案号</th>
            <th>队伍编号</th>
            <th>版本</th>
            <th>审核人</th>
            <th>归档时间</th>
            <th>最早到期</th>
            <th>校验结论</th>
            <th>备注</th>
            <th>明细</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="filing in filings" :key="filing.id">
            <tr>
              <td>{{ filing.id }}</td>
              <td>{{ filing.teamCode }}</td>
              <td>v{{ filing.version }}</td>
              <td>{{ filing.reviewer }}</td>
              <td>{{ filing.filedAt }}</td>
              <td>{{ filing.validUntil }}</td>
              <td>
                <span class="gate-tag" :class="filing.status === '校验通过' ? 'gate-ok' : 'gate-warn'">
                  {{ filing.status }}
                </span>
              </td>
              <td>{{ filing.notes || '—' }}</td>
              <td>
                <button class="link" type="button" @click="toggleDetail(filing.id)">
                  {{ expanded === filing.id ? '收起' : '查看逐条校验' }}
                </button>
              </td>
            </tr>
            <tr v-if="expanded === filing.id">
              <td colspan="9" class="detail-cell">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th>材料槽位</th>
                      <th>文件</th>
                      <th>证件编号</th>
                      <th>作业范围</th>
                      <th>所属企业</th>
                      <th>有效期</th>
                      <th>逐条校验结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="check in filing.checks" :key="check.slot">
                      <td>{{ check.label }}</td>
                      <td>{{ check.fileName }}</td>
                      <td>{{ docOf(filing.id, check.slot)?.certNo }}</td>
                      <td>{{ docOf(filing.id, check.slot)?.scope }}</td>
                      <td>{{ docOf(filing.id, check.slot)?.enterprise }}</td>
                      <td>
                        {{ docOf(filing.id, check.slot)?.validFrom }} ～
                        {{ docOf(filing.id, check.slot)?.validUntil }}
                      </td>
                      <td>
                        <div
                          v-for="rule in check.rules"
                          :key="rule.rule"
                          class="rule-line"
                          :class="rule.ok ? 'rule-ok' : 'rule-bad'"
                        >
                          {{ rule.ok ? '✓' : '✗' }} {{ rule.rule }}：{{ rule.message }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
          <tr v-if="!filings.length">
            <td colspan="9" class="empty-state">暂无备案记录，下载归档包并补充上传后生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span v-if="notice" :class="noticeOk ? 'ok-text' : 'error-text'">{{ notice }}</span>
      <span>资质数据独立持久化于 {{ storageKey }}</span>
    </footer>

    <UploadWizard
      :open="wizardOpen"
      :contractor-id="wizardContractorId"
      :imported="wizardImported"
      @close="onWizardClose"
      @filed="reload"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { runAction } from '@/api/local-service'
import {
  contractorGate,
  discardSession,
  downloadPackage,
  listExitChecks,
  listFilings,
  listSessions,
  parsePackageText,
  resolveExitCheck,
  scanWorkingContractors,
} from '@/api/qualification-service'
import { listRows } from '@/data/local-store'
import {
  qualificationStorageKey,
  resetQualificationState,
} from '@/data/qualification-store'
import { resetRows } from '@/data/local-store'
import type {
  ExitCheckItem,
  GateResult,
  QualificationFiling,
  QualificationPackage,
  QualificationSlot,
  UploadSession,
} from '@/data/qualification-types'
import type { EntryRow } from '@/data/types'
import UploadWizard from './UploadWizard.vue'

const contractors = ref<EntryRow[]>([])
const filings = ref<QualificationFiling[]>([])
const sessions = ref<UploadSession[]>([])
const exitChecks = ref<ExitCheckItem[]>([])
const gateCache = new Map<number, GateResult>()

const notice = ref('')
const noticeOk = ref(false)
const expanded = ref<number | null>(null)

const wizardOpen = ref(false)
const wizardContractorId = ref<number | null>(null)
const wizardImported = ref<QualificationPackage | null>(null)

const storageKey = qualificationStorageKey()

const stats = computed(() => {
  let blocked = 0
  for (const row of contractors.value) {
    if (!contractorGate(Number(row.id)).allowed) {
      blocked += 1
    }
  }
  return [
    { label: '施工队伍', value: contractors.value.length },
    { label: '资质准入拦截', value: blocked },
    { label: '待核查退场事项', value: exitChecks.value.filter((item) => item.status === '待核查').length },
    { label: '中断上传会话', value: sessions.value.length },
    { label: '备案版本总数', value: filings.value.length },
  ]
})

function gateOf(id: number): GateResult {
  const cached = gateCache.get(id)
  if (cached) {
    return cached
  }
  const gate = contractorGate(id)
  gateCache.set(id, gate)
  return gate
}

function hasSession(id: number): boolean {
  return sessions.value.some((session) => session.contractorId === id)
}

function docOf(filingId: number, slot: QualificationSlot) {
  return filings.value
    .find((item) => item.id === filingId)
    ?.docs.find((doc) => doc.slot === slot)
}

function notify(message: string, ok = true): void {
  notice.value = message
  noticeOk.value = ok
}

function reload(): void {
  gateCache.clear()
  contractors.value = listRows('contractor')
  filings.value = listFilings()
  sessions.value = listSessions()
  exitChecks.value = listExitChecks()
}

function arrange(id: number): void {
  const result = runAction('contractor', id, '安排作业')
  notify(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function openWizard(id: number): void {
  wizardImported.value = null
  wizardContractorId.value = id
  wizardOpen.value = true
}

function onWizardClose(): void {
  wizardOpen.value = false
  wizardContractorId.value = null
  wizardImported.value = null
  reload()
}

async function onImportPackage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  try {
    const text = await file.text()
    const pkg = parsePackageText(text)
    wizardContractorId.value = null
    wizardImported.value = pkg
    wizardOpen.value = true
  } catch (error) {
    notify(error instanceof Error ? error.message : '归档包读取失败', false)
  } finally {
    input.value = ''
  }
}

function runScan(): void {
  const created = scanWorkingContractors()
  reload()
  notify(
    created.length
      ? `巡检完成，新生成 ${created.length} 条退场核查事项：${created.map((item) => item.teamCode).join('、')}`
      : '巡检完成，作业中队伍资质均正常，无新增退场核查事项',
  )
}

function closeExit(id: number): void {
  resolveExitCheck(id)
  reload()
  notify(`退场核查事项 ${id} 已闭环`)
}

function abandon(sessionId: string): void {
  discardSession(sessionId)
  reload()
  notify('上传会话已放弃')
}

function toggleDetail(id: number): void {
  expanded.value = expanded.value === id ? null : id
}

function resetAll(): void {
  resetQualificationState()
  resetRows('contractor')
  reload()
  notify('资质归档数据与施工队伍名册已恢复为示例数据')
}

onMounted(() => {
  reload()
  const created = scanWorkingContractors()
  if (created.length) {
    reload()
  }
})
</script>

<style scoped>
.section-title { font-size: 15px; margin: 18px 0 8px; }
.panel { margin-top: 18px; }
.page-actions { display: flex; gap: 8px; align-items: center; }
.cell-tip { margin: 4px 0 0; font-size: 11px; color: var(--muted); max-width: 260px; }
.gate-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
}
.gate-ok { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; }
.gate-block { background: #fef3f2; color: #b42318; border: 1px solid #fda29b; }
.gate-warn { background: #fffaeb; color: #b54708; border: 1px solid #fedf89; }
.muted { color: var(--muted); }
.progress-line { display: flex; gap: 4px; align-items: baseline; font-size: 12px; }
.progress-msg { color: var(--muted); }
.chip-done { color: #067647; }
.chip-failed { color: #b42318; }
.chip-pending { color: var(--muted); }
.detail-cell { background: #f8fafc; padding: 10px; }
.detail-table { width: 100%; border-collapse: collapse; background: #fff; }
.detail-table th, .detail-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
  vertical-align: top;
}
.rule-line { font-size: 12px; }
.rule-ok { color: #067647; }
.rule-bad { color: #b42318; }
.link.danger { color: #b42318; }
.ok-text { color: #067647; }
.muted-text { color: var(--muted); font-size: 12px; margin: 4px 0 8px; }
</style>
