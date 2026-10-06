<template>
  <section class="page" data-module="qualification">
    <header class="page-head">
      <div>
        <h2>施工队伍资质文件归档</h2>
        <p class="page-desc">
          队伍编号、资质等级、特种作业证、所属企业材料打包下载，审核人补充后上传；
          系统逐条校验证件有效期、作业范围和所属企业，重复文件不生成第二份备案，旧资质按历史版本保留。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="rescan">复查作业中队伍资质</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in cards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section v-if="interrupted.length" class="interrupt-banner">
      <div class="banner-line">
        <strong>有 {{ interrupted.length }} 个归档包上传中断：</strong>
        <span v-for="session in interrupted" :key="session.id" class="banner-chip">
          {{ session.teamCode }} · {{ session.note }}
          <button class="link" type="button" @click="openSession(session.id)">继续上传</button>
        </span>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>队伍编号/名称</span>
        <input v-model="keyword" placeholder="按队伍编号、名称或所属企业检索" />
      </label>
      <label class="filter-item">
        <span>资质状态</span>
        <select v-model="validity">
          <option value="">全部</option>
          <option value="ok">有效已备案</option>
          <option value="invalid">资质失效</option>
          <option value="missing">未归档</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>队伍编号</th>
          <th>队伍名称</th>
          <th>资质等级</th>
          <th>所属企业</th>
          <th>备案状态</th>
          <th>资质校验</th>
          <th>上传进度</th>
          <th>归档操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in filteredViews" :key="String(view.team.id)">
          <td>{{ view.team['队伍编号'] }}</td>
          <td>{{ view.team['队伍名称'] }}</td>
          <td>{{ view.team['资质等级'] }}</td>
          <td>{{ view.team['所属企业'] }}</td>
          <td>
            <template v-if="view.record">
              <span class="badge ok">已备案 v{{ view.record.currentVersion }}</span>
              <div class="sub-text">{{ view.record.recordNo }} · {{ view.record.filedAt }}</div>
            </template>
            <span v-else class="badge missing">未归档</span>
          </td>
          <td>
            <span v-if="!view.record" class="badge missing">证照缺失</span>
            <span v-else-if="view.evaluation.blocking" class="badge bad">
              {{ view.evaluation.expiredKinds.length ? '资质过期' : '校验异常' }}
            </span>
            <span v-else class="badge ok">校验通过</span>
            <ul v-if="view.evaluation.reasons.length" class="reason-list">
              <li v-for="reason in view.evaluation.reasons" :key="reason">{{ reason }}</li>
            </ul>
          </td>
          <td>
            <template v-if="view.activeSession">
              <span class="badge" :class="view.activeSession.status === '已中断' ? 'warn' : 'info'">
                {{ progressText(view.activeSession) }}
              </span>
              <div class="sub-text">{{ view.activeSession.note }}</div>
            </template>
            <span v-else class="sub-text">无进行中的上传</span>
          </td>
          <td class="row-actions wrap">
            <button class="link" type="button" @click="download(view.team.id)">下载归档包</button>
            <button class="link" type="button" @click="startUpload(view.team.id)">
              {{ view.activeSession ? '继续补充上传' : '补充上传' }}
            </button>
            <button v-if="view.record" class="link" type="button" @click="openHistory(view.team.id)">
              历史版本
            </button>
          </td>
        </tr>
        <tr v-if="!filteredViews.length">
          <td colspan="8" class="empty-state">没有符合条件的施工队伍</td>
        </tr>
      </tbody>
    </table>

    <section class="exit-section">
      <h3>退场核查事项</h3>
      <p class="page-desc">资质过期或证照缺失时不能安排作业；已在作业中的队伍自动生成退场核查事项，退场完成联动清退。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>核查单号</th>
            <th>队伍编号</th>
            <th>队伍名称</th>
            <th>触发原因</th>
            <th>来源</th>
            <th>生成时间</th>
            <th>状态</th>
            <th>处理人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="check in exitChecks" :key="check.id">
            <td>{{ check.id }}</td>
            <td>{{ check.teamCode }}</td>
            <td>{{ check.teamName }}</td>
            <td>
              <ul class="reason-list">
                <li v-for="reason in check.reasons" :key="reason">{{ reason }}</li>
              </ul>
            </td>
            <td>{{ check.source }}</td>
            <td>{{ check.createdAt }}</td>
            <td><span class="badge" :class="check.status === '已退场' || check.status === '已关闭' ? 'ok' : 'warn'">{{ check.status }}</span></td>
            <td>{{ check.handler || '—' }}</td>
            <td class="row-actions">
              <button v-if="check.status === '待退场核查'" class="link" type="button" @click="advance(check.id)">开始核查</button>
              <button v-if="check.status === '核查中'" class="link" type="button" @click="advance(check.id)">确认退场</button>
              <button
                v-if="check.status === '待退场核查' || check.status === '核查中'"
                class="link"
                type="button"
                @click="closeCheck(check.id)"
              >
                资质已补齐，关闭
              </button>
              <span v-else class="sub-text">{{ check.resolvedAt }}</span>
            </td>
          </tr>
          <tr v-if="!exitChecks.length">
            <td colspan="9" class="empty-state">暂无退场核查事项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>归档包、备案版本与上传会话保存在本机浏览器中，刷新不丢失</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <UploadWizard
      v-if="activeSession"
      :session="activeSession"
      @changed="onSessionChanged"
      @closed="activeSession = null"
    />
    <VersionHistory v-if="historyRecord" :record="historyRecord" @close="historyRecord = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  advanceExitCheck,
  closeExitCheck as closeExitCheckService,
  downloadPackage,
  getSession,
  getTeamRecord,
  listArchiveViews,
  listExitChecks,
  listInterruptedSessions,
  qualificationStats,
  scanActiveTeams,
  startUpload as startUploadService,
} from '@/data/qualification/qualification-service'
import type {
  ArchiveView,
  ExitCheck,
  QualificationRecord,
  UploadSession,
} from '@/data/qualification/types'
import UploadWizard from './UploadWizard.vue'
import VersionHistory from './VersionHistory.vue'

const keyword = ref('')
const validity = ref('')
const views = ref<ArchiveView[]>([])
const exitChecks = ref<ExitCheck[]>([])
const message = ref('')
const messageOk = ref(false)
const activeSession = ref<UploadSession | null>(null)
const historyRecord = ref<QualificationRecord | null>(null)

const cards = computed(() => {
  const stats = qualificationStats()
  return [
    { label: '施工队伍', value: stats.teams },
    { label: '已归档备案', value: stats.filed },
    { label: '资质失效（过期/范围/企业）', value: stats.invalid },
    { label: '未归档缺证', value: stats.missing },
    { label: '中断上传', value: stats.interrupted },
    { label: '待退场核查', value: stats.exitPending },
  ]
})

const interrupted = computed(() =>
  listInterruptedSessions().filter(
    (session) => !activeSession.value || session.id !== activeSession.value.id,
  ),
)

const filteredViews = computed(() => {
  const word = keyword.value.trim()
  return views.value.filter((view) => {
    const hit =
      !word ||
      [view.team['队伍编号'], view.team['队伍名称'], view.team['所属企业']]
        .some((value) => String(value ?? '').includes(word))
    if (validity.value === 'ok') {
      return hit && view.record && !view.evaluation.blocking
    }
    if (validity.value === 'invalid') {
      return hit && view.record && view.evaluation.blocking
    }
    if (validity.value === 'missing') {
      return hit && !view.record
    }
    return hit
  })
})

function progressText(session: UploadSession): string {
  const done = session.items.filter((item) => item.status === 'validated').length
  return `${done}/${session.items.length} 步 · ${session.status}`
}

function notify(text: string, ok = false) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  views.value = listArchiveViews()
  exitChecks.value = listExitChecks()
}

function resetFilters() {
  keyword.value = ''
  validity.value = ''
}

function rescan() {
  const created = scanActiveTeams()
  reload()
  notify(
    created.length
      ? `复查发现 ${created.length} 支作业中队伍资质失效，已生成退场核查事项`
      : '复查完成：作业中队伍资质均有效，未新增退场核查事项',
    true,
  )
}

function download(teamId: number) {
  const result = downloadPackage(teamId)
  if ('error' in result) {
    notify(result.error)
    return
  }
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  reload()
  notify(`归档包 ${result.filename} 已生成并开始下载，审核人补充后可在本页上传`, true)
}

function startUpload(teamId: number) {
  const result = startUploadService(teamId, '审核人-王敏')
  if ('error' in result) {
    notify(result.error)
    return
  }
  activeSession.value = result
}

function openSession(sessionId: string) {
  const session = getSession(sessionId)
  if (session) {
    activeSession.value = session
  }
}

function onSessionChanged(session: UploadSession) {
  activeSession.value = getSession(session.id) ?? null
  reload()
}

function openHistory(teamId: number) {
  historyRecord.value = getTeamRecord(teamId) ?? null
}

function advance(id: string) {
  const result = advanceExitCheck(id, '值班管理员')
  notify(result.message, result.ok)
  reload()
}

function closeCheck(id: string) {
  const result = closeExitCheckService(id, '值班管理员')
  notify(result.message, result.ok)
  reload()
}

onMounted(() => {
  // 进入页面先对作业中队伍做一次复查，过期/缺证的自动补开退场核查事项。
  scanActiveTeams()
  reload()
})
</script>
