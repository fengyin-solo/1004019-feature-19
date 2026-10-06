<template>
  <section class="page" data-module="contractor">
    <header class="page-head">
      <div>
        <h2>施工队伍管理</h2>
        <p class="page-desc">
          维护施工队伍，围绕队伍编号、队伍名称、资质等级、所属企业做登记、筛选与状态流转；
          资质材料统一在<a class="inline-link" href="/qualification" @click.prevent="goQualification()">资质文件归档</a>页打包上传并逐条校验。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记施工队伍</button>
        <button class="btn" type="button" @click="exportRows">导出施工队伍清单</button>
        <button class="btn" type="button" @click="goQualification()">进入资质文件归档</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>资质备案状态</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="badge" :class="badgeOf(Number(row.id)).cls">{{ badgeOf(Number(row.id)).text }}</span>
            <ul v-if="badgeOf(Number(row.id)).reasons.length" class="reason-list">
              <li v-for="reason in badgeOf(Number(row.id)).reasons" :key="reason">{{ reason }}</li>
            </ul>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions wrap">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="goQualification(Number(row.id))">资质归档</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无施工队伍数据，可先登记施工队伍</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条施工队伍记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  blockScheduleAndEnsureExit,
  canFileArchive,
  evaluateTeam,
  getTeamRecord,
  scanActiveTeams,
} from '@/data/qualification/qualification-service'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('contractor')
const columns = ["队伍编号", "队伍名称", "资质等级", "所属企业", "联系人", "联系电话", "特种作业证", "队伍状态"]
const actions = ["审核备案", "安排作业", "清退队伍"]
const statuses = ["待审核", "已备案", "作业中", "已清退"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '备案队伍', value: rows.value.filter((row) => String(row.status) === '已备案').length },
  { label: '作业中队伍', value: rows.value.filter((row) => String(row.status) === '作业中').length },
  { label: '待审核队伍', value: rows.value.filter((row) => String(row.status) === '待审核').length },
])

function badgeOf(teamId: number): { text: string; cls: string; reasons: string[] } {
  const team = rows.value.find((row) => Number(row.id) === teamId)
  if (!team) {
    return { text: '未知', cls: 'missing', reasons: [] }
  }
  const evaluation = evaluateTeam(team)
  if (!getTeamRecord(teamId)) {
    return { text: '未归档缺证', cls: 'missing', reasons: evaluation.reasons.slice(0, 1) }
  }
  if (evaluation.blocking) {
    return { text: '资质失效', cls: 'bad', reasons: evaluation.reasons }
  }
  return { text: '有效已备案', cls: 'ok', reasons: [] }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function goQualification(teamId?: number) {
  void router.push(teamId ? { path: '/qualification', query: { team: String(teamId) } } : '/qualification')
}

function openCreate() {
  errorMessage.value = '施工队伍登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const teamId = Number(row.id)

  // 审核备案：必须先有通过逐条校验的资质归档备案。
  if (action === '审核备案') {
    const gate = canFileArchive(teamId)
    if (!gate.ok) {
      errorMessage.value = `不能审核备案：${gate.reasons.join('；')}。请先到资质文件归档页打包上传。`
      return
    }
  }

  // 安排作业：资质过期或证照缺失一律拦截；作业中的队伍同步生成退场核查事项。
  if (action === '安排作业') {
    const gate = blockScheduleAndEnsureExit(teamId)
    if (!gate.ok) {
      errorMessage.value = gate.exitCheckId
        ? `不能安排作业：${gate.reasons.join('；')}。队伍正在作业中，已生成退场核查事项 ${gate.exitCheckId}。`
        : `不能安排作业：${gate.reasons.join('；')}`
      reload()
      return
    }
  }

  const result = applyAction(meta.key, teamId, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (action === '安排作业') {
    scanActiveTeams()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '施工队伍列表读取失败'
  }
}

onMounted(() => {
  scanActiveTeams()
  reload()
})
</script>
