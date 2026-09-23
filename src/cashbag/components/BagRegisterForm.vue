<script setup lang="ts">
// 交班登记现金袋：袋号、封签、封存金额、签字人，现场勾查封签破损。
import { computed, reactive, watch } from "vue";
import { validateBagDraft, validateShiftBags, type BagDraft } from "../rules";
import type { CashBag, Shift } from "../types";

const props = defineProps<{ shift: Shift; editing: CashBag | null }>();
const emit = defineEmits<{
  submit: [draft: BagDraft];
  cancel: [];
}>();

function blank() {
  return {
    bagNo: "",
    sealNo: "",
    sealedAmount: null as number | null,
    sealedBy: "",
    handoverNote: "",
    sealBrokenAtHandover: false
  };
}

const form = reactive(blank());

watch(
  () => props.editing?.id,
  () => {
    if (props.editing) {
      Object.assign(form, {
        bagNo: props.editing.bagNo,
        sealNo: props.editing.sealNo,
        sealedAmount: props.editing.sealedAmount,
        sealedBy: props.editing.sealedBy,
        handoverNote: props.editing.handoverNote,
        sealBrokenAtHandover: props.editing.sealBrokenAtHandover
      });
    } else {
      Object.assign(form, blank());
    }
  },
  { immediate: true }
);

const selfIssues = computed(() =>
  validateBagDraft({ ...form })
);

const duplicateIssue = computed(() => {
  const draft = { ...form, id: props.editing?.id };
  return validateShiftBags(props.shift.bags, draft).filter((i) => i.code === "袋号重复");
});

const issues = computed(() => [...selfIssues.value, ...duplicateIssue.value]);

const canSave = computed(() => form.bagNo.trim() !== "" && form.sealedBy.trim() !== "");

function onSubmit() {
  emit("submit", { ...form });
  if (!props.editing) Object.assign(form, blank());
}
</script>

<template>
  <form class="subpanel" @submit.prevent="onSubmit">
    <h3>{{ editing ? "修改现金袋登记" : "登记现金袋" }}</h3>
    <div class="form-grid form-grid-2">
      <label>
        袋号 <span class="req">*</span>
        <input v-model="form.bagNo" placeholder="如 D0921" autocomplete="off" />
      </label>
      <label>
        封签号 <span class="req">*</span>
        <input v-model="form.sealNo" placeholder="封签编号" autocomplete="off" />
      </label>
      <label>
        封存金额（元） <span class="req">*</span>
        <input
          v-model.number="form.sealedAmount"
          type="number"
          min="0"
          step="0.01"
          placeholder="封袋时金额"
        />
      </label>
      <label>
        签字人 <span class="req">*</span>
        <input v-model="form.sealedBy" placeholder="交班人签字" autocomplete="off" />
      </label>
      <label class="span-2">
        备注
        <input v-model="form.handoverNote" placeholder="封袋情况说明（选填）" autocomplete="off" />
      </label>
      <label class="check-line span-2">
        <input v-model="form.sealBrokenAtHandover" type="checkbox" />
        封签已破损（勾选后该袋只能待核交）
      </label>
    </div>

    <ul v-if="issues.length" class="issue-list">
      <li v-for="(issue, i) in issues" :key="i" :class="issue.code === '封签破损' ? 'issue-warn' : 'issue-err'">
        {{ issue.message }}
      </li>
    </ul>

    <div class="inline-actions">
      <button type="submit" :disabled="!canSave">{{ editing ? "保存修改" : "登记入班" }}</button>
      <button v-if="editing" type="button" class="secondary" @click="emit('cancel')">取消修改</button>
    </div>
  </form>
</template>
