<script setup lang="ts">
import CashBagHandover from "./components/CashBagHandover.vue";

const stack = ["Vue3", "Vite", "TypeScript", "Element Plus"];
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>加油站班次交接 · 现金袋拆箱移交</h1>
          <p class="subtitle">
            交班登记袋号、封签、封存金额与签字人；袋号重复、封签破损或金额缺失只能待核交。
            接班拆箱录入实点，长款、短款和假币须选择责任、写明情况并经站长确认后方可结班；
            确认后只读，改动保留旧值和原因另存。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <CashBagHandover />
    </div>
  </main>
</template>
