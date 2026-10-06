<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal modal-lg">
      <header class="modal-head">
        <div>
          <h3>资质备案历史版本</h3>
          <p class="modal-sub">
            {{ record.teamName }}（{{ record.teamCode }}）· 记录号 {{ record.recordNo }}
            · 旧资质全部按历史版本保留，仅当前版本用于作业安排校验
          </p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <section class="version-block current">
        <header class="version-head">
          <strong>当前版本 v{{ record.currentVersion }}</strong>
          <span>备案时间：{{ record.filedAt }}</span>
          <span>审核人：{{ record.reviewer }}</span>
        </header>
        <DocTable :docs="record.snapshot.docs" />
      </section>

      <section v-for="version in [...record.history].reverse()" :key="version.version" class="version-block history">
        <header class="version-head">
          <strong>历史版本 v{{ version.version }}</strong>
          <span>备案时间：{{ version.filedAt }}</span>
          <span>审核人：{{ version.reviewer }}</span>
          <span class="replace-reason">{{ version.replacedReason }}</span>
        </header>
        <DocTable :docs="version.snapshot.docs" />
      </section>

      <p v-if="!record.history.length" class="empty-state">暂无历史版本，该队伍只备案过一次。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from 'vue'

import { DOC_KINDS, type QualificationSnapshot } from '@/data/qualification/types'

const DocTable = defineComponent({
  props: { docs: { type: Object as () => QualificationSnapshot['docs'], required: true } },
  setup(props) {
    return () =>
      h('table', { class: 'data-table version-table' }, [
        h('thead', {}, h('tr', {}, [
          h('th', {}, '材料'),
          h('th', {}, '证件编号'),
          h('th', {}, '有效期至'),
          h('th', {}, '作业范围'),
          h('th', {}, '所属企业'),
          h('th', {}, '附件'),
        ])),
        h(
          'tbody',
          {},
          DOC_KINDS.map((kind) =>
            h('tr', { key: kind }, [
              h('td', {}, kind),
              h('td', {}, props.docs[kind].certNo),
              h('td', {}, props.docs[kind].validUntil),
              h('td', {}, props.docs[kind].workScope),
              h('td', {}, props.docs[kind].company),
              h('td', { class: 'muted' }, `${props.docs[kind].fileName}（${(props.docs[kind].fileSize / 1024).toFixed(0)}KB）`),
            ]),
          ),
        ),
      ])
  },
})

defineProps<{ record: import('@/data/qualification/types').QualificationRecord }>()
const emit = defineEmits<{ (event: 'close'): void }>()
</script>
