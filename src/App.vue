<script setup lang="ts">
// 加油站班次交接 —— 现金袋拆箱移交页。
// 分层：cashbag/types（资料）、rules（核对规则）、storage（保存）、components（界面）。
import { reactive } from "vue";
import { useShiftStore } from "./cashbag/useShiftStore";
import ShiftWorkspace from "./cashbag/components/ShiftWorkspace.vue";
import type { ShiftKind } from "./cashbag/types";

const store = useShiftStore();

const createForm = reactive({
  businessDate: new Date().toISOString().slice(0, 10),
  kind: "早班" as ShiftKind,
  manager: ""
});

function addShift() {
  if (!createForm.businessDate) return;
  store.addShift({ ...createForm });
  createForm.manager = "";
}

const kindOptions: ShiftKind[] = ["早班", "中班", "晚班"];
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 现金管理</p>
          <h1>现金袋拆箱移交</h1>
          <p class="subtitle">
            交班登记袋号、封签、封存金额与签字人；异常只能待核交。接班拆箱录实点，
            长款、短款、假币须定责任、写情况并经站长确认；确认后只读，重开改动留旧值与原因。
          </p>
        </div>
        <div class="stack">
          <span class="tag">袋号唯一</span>
          <span class="tag">封签核验</span>
          <span class="tag">差异定责</span>
          <span class="tag">站长确认</span>
          <span class="tag">改值留痕</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric"><span>班次总数</span><strong>{{ store.stats.value.total }}</strong></article>
        <article class="metric"><span>现金袋</span><strong>{{ store.stats.value.bagTotal }}</strong></article>
        <article class="metric"><span>待核/待确认</span><strong>{{ store.stats.value.pending }}</strong></article>
        <article class="metric"><span>已结班</span><strong>{{ store.stats.value.closed }}</strong></article>
      </section>

      <section class="layout">
        <aside class="sidebar panel">
          <h2>班次</h2>
          <form class="create-shift" @submit.prevent="addShift">
            <label>营业日期
              <input v-model="createForm.businessDate" type="date" required />
            </label>
            <label>班次
              <select v-model="createForm.kind">
                <option v-for="k in kindOptions" :key="k" :value="k">{{ k }}</option>
              </select>
            </label>
            <label>站长
              <input v-model="createForm.manager" placeholder="站长姓名" autocomplete="off" />
            </label>
            <button type="submit">新建班次</button>
          </form>

          <ul class="shift-list">
            <li
              v-for="s in store.shifts.value"
              :key="s.id"
              :class="{ active: s.id === store.selectedId.value }"
              @click="store.select(s.id)"
            >
              <div class="shift-item-head">
                <strong>{{ s.businessDate }} {{ s.kind }}</strong>
                <span class="status-pill" :data-status="s.status">{{ s.status }}</span>
              </div>
              <div class="shift-item-meta">
                {{ s.bags.length }} 袋 · 站长 {{ s.manager || "—" }}
              </div>
            </li>
          </ul>

          <button type="button" class="secondary reset-btn" @click="confirm('恢复演示数据将清空本机记录，确认？') && store.reset()">
            重置演示数据
          </button>
        </aside>

        <section class="main-panel panel">
          <ShiftWorkspace
            v-if="store.selectedShift.value"
            :key="store.selectedShift.value.id"
            :shift-id="store.selectedId.value"
          />
          <div v-else class="empty">请先新建或选择一个班次</div>
        </section>
      </section>
    </div>
  </main>
</template>
