<script setup lang="ts">
// 接班拆箱：录入实点金额、假币；长短款/假币必须选择责任并写明情况。
import { computed, reactive, watch } from "vue";
import { calcDifference, formatMoney, round2 } from "../rules";
import { RESPONSIBILITIES, type CashBag } from "../types";
import type { OpenEntry } from "../storage";

const props = defineProps<{
  bag: CashBag;
  sealed: boolean; // 是否已结班（只读）
}>();
const emit = defineEmits<{
  save: [entry: OpenEntry];
}>();

const form = reactive({
  countedAmount: null as number | null,
  counterfeitAmount: 0,
  counterfeitCount: 0,
  openedBy: "",
  responsibility: "" as CashBag["responsibility"],
  differenceDesc: ""
});

watch(
  () => props.bag.id,
  () => {
    form.countedAmount = props.bag.countedAmount;
    form.counterfeitAmount = props.bag.counterfeitAmount ?? 0;
    form.counterfeitCount = props.bag.counterfeitCount ?? 0;
    form.openedBy = props.bag.openedBy;
    form.responsibility = props.bag.responsibility;
    form.differenceDesc = props.bag.differenceDesc;
  },
  { immediate: true }
);

const difference = computed(() =>
  calcDifference({
    countedAmount: form.countedAmount === null ? null : round2(form.countedAmount),
    counterfeitAmount: form.counterfeitAmount,
    sealedAmount: props.bag.sealedAmount
  })
);

const hasFake = computed(() => form.counterfeitAmount > 0 || form.counterfeitCount > 0);
const hasVariance = computed(() => (difference.value !== null && difference.value !== 0) || hasFake.value);
const problem = computed(() => {
  if (hasFake.value) return "假币";
  if (difference.value !== null && difference.value > 0) return "长款";
  if (difference.value !== null && difference.value < 0) return "短款";
  return "正常";
});

const missing = computed(() => {
  const list: string[] = [];
  if (form.countedAmount === null || form.countedAmount < 0) list.push("实点金额");
  if (form.counterfeitAmount < 0 || form.counterfeitCount < 0) list.push("假币数据");
  if (!form.openedBy.trim()) list.push("拆箱人");
  if (hasVariance.value) {
    if (!form.responsibility) list.push("差异责任");
    if (!form.differenceDesc.trim()) list.push("情况说明");
  }
  return list;
});

const canSave = computed(() => missing.value.length === 0);

function save() {
  emit("save", {
    countedAmount: form.countedAmount === null ? null : round2(form.countedAmount),
    counterfeitAmount: round2(form.counterfeitAmount),
    counterfeitCount: form.counterfeitCount,
    openedBy: form.openedBy,
    responsibility: form.responsibility,
    differenceDesc: form.differenceDesc
  });
}
</script>

<template>
  <div class="count-box">
    <div class="form-grid form-grid-2">
      <label>
        实点金额（元）
        <input v-model.number="form.countedAmount" type="number" min="0" step="0.01" :disabled="sealed" placeholder="拆箱清点现金" />
      </label>
      <label>
        拆箱人
        <input v-model="form.openedBy" :disabled="sealed" placeholder="接班人签字" autocomplete="off" />
      </label>
      <label>
        假币面额合计（元）
        <input v-model.number="form.counterfeitAmount" type="number" min="0" step="0.01" :disabled="sealed" />
      </label>
      <label>
        假币张数
        <input v-model.number="form.counterfeitCount" type="number" min="0" step="1" :disabled="sealed" />
      </label>
    </div>

    <div class="diff-line" :class="{ 'diff-bad': hasVariance, 'diff-ok': !hasVariance && difference !== null }">
      <span>封存 {{ formatMoney(bag.sealedAmount) }}</span>
      <span>实点 {{ formatMoney(form.countedAmount) }}</span>
      <span>假币 {{ formatMoney(form.counterfeitAmount) }}</span>
      <strong>
        差额 {{ difference === null ? "—" : formatMoney(difference) }}
        <em class="problem-tag" :data-problem="problem">{{ problem }}</em>
      </strong>
    </div>

    <template v-if="hasVariance">
      <div class="form-grid form-grid-2">
        <label>
          差异责任 <span class="req">*</span>
          <select v-model="form.responsibility" :disabled="sealed">
            <option value="">请选择责任方</option>
            <option v-for="r in RESPONSIBILITIES" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="span-2">
          情况说明 <span class="req">*</span>
          <textarea
            v-model="form.differenceDesc"
            :disabled="sealed"
            placeholder="写明长款/短款/假币发生经过、券别与现场情况"
          />
        </label>
      </div>
    </template>

    <ul v-if="missing.length" class="issue-list">
      <li class="issue-err">提交前还需：{{ missing.join("、") }}</li>
    </ul>

    <div v-if="!sealed" class="inline-actions">
      <button type="button" :disabled="!canSave" @click="save">
        {{ bag.opened ? "更新实点" : "保存拆箱记录" }}
      </button>
    </div>
  </div>
</template>
