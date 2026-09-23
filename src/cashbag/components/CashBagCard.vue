<script setup lang="ts">
// 单个现金袋卡片：交班登记信息 + 接班拆箱录入；已结班只读，重开后可改值留痕。
import { computed, reactive, ref, watch } from "vue";
import { formatMoney } from "../rules";
import type { CashBag, Shift } from "../types";
import type { ConfirmedRevision } from "../storage";
import BagRegisterForm from "./BagRegisterForm.vue";
import OpenCountForm from "./OpenCountForm.vue";

const props = defineProps<{
  shift: Shift;
  bag: CashBag;
  editing: boolean;
}>();

const emit = defineEmits<{
  edit: [bag: CashBag];
  cancelEdit: [];
  saveEdit: [draft: import("../rules").BagDraft];
  remove: [bag: CashBag];
  saveCount: [bagId: string, entry: import("../storage").OpenEntry];
  revise: [bagId: string, patch: ConfirmedRevision, reason: string];
}>();

const sealed = computed(() => props.shift.status === "已结班");
const canOpen = computed(() => ["已移交", "待站长确认"].includes(props.shift.status));
const showCount = computed(() => canOpen.value || sealed.value);
const canEditRegister = computed(() => ["进行中", "待核交"].includes(props.shift.status));

const revising = ref(false);
const reviseReason = ref("");
const reviseForm = reactive({
  sealedAmount: null as number | null,
  countedAmount: null as number | null,
  counterfeitAmount: 0,
  responsibility: "" as CashBag["responsibility"],
  differenceDesc: ""
});
const reviseError = ref("");

function startRevise() {
  reviseForm.sealedAmount = props.bag.sealedAmount;
  reviseForm.countedAmount = props.bag.countedAmount;
  reviseForm.counterfeitAmount = props.bag.counterfeitAmount ?? 0;
  reviseForm.responsibility = props.bag.responsibility;
  reviseForm.differenceDesc = props.bag.differenceDesc;
  reviseReason.value = "";
  reviseError.value = "";
  revising.value = true;
}

function submitRevise() {
  if (!reviseReason.value.trim()) {
    reviseError.value = "必须填写改动原因，旧值与原因将一并存档";
    return;
  }
  emit("revise", props.bag.id, { ...reviseForm }, reviseReason.value);
  revising.value = false;
}

// 重新结班后收起改值面板，回到只读
watch(sealed, (value) => {
  if (value) revising.value = false;
});
</script>

<template>
  <article class="bag-card" :class="{ 'is-sealed': sealed, 'is-variance': bag.opened && bag.problem !== '正常' }">
    <header class="bag-head">
      <div>
        <span class="bag-no">袋号 {{ bag.bagNo }}</span>
        <span class="bag-seal">封签 {{ bag.sealNo }}</span>
      </div>
      <div class="bag-badges">
        <span v-if="bag.sealBrokenAtHandover" class="badge badge-warn">封签破损</span>
        <span v-if="bag.opened" class="badge" :class="bag.problem === '正常' ? 'badge-ok' : 'badge-err'">
          {{ bag.problem }}
        </span>
        <span v-else-if="canOpen" class="badge badge-idle">待拆箱</span>
      </div>
    </header>

    <!-- 交班登记 -->
    <template v-if="!editing">
      <dl class="bag-dl">
        <div><dt>封存金额</dt><dd>{{ formatMoney(bag.sealedAmount) }}</dd></div>
        <div><dt>签字人</dt><dd>{{ bag.sealedBy }}</dd></div>
        <div><dt>登记时间</dt><dd>{{ new Date(bag.createdAt).toLocaleString("zh-CN") }}</dd></div>
        <div v-if="bag.handoverNote"><dt>备注</dt><dd>{{ bag.handoverNote }}</dd></div>
      </dl>

      <div v-if="canEditRegister" class="inline-actions">
        <button type="button" class="secondary" @click="emit('edit', bag)">修改</button>
        <button type="button" class="danger" @click="emit('remove', bag)">删除</button>
      </div>
    </template>

    <BagRegisterForm
      v-else
      :shift="shift"
      :editing="bag"
      @submit="(d) => emit('saveEdit', d)"
      @cancel="emit('cancelEdit')"
    />

    <!-- 接班拆箱 -->
    <section v-if="showCount" class="bag-open">
      <h4>接班拆箱</h4>
      <template v-if="bag.opened && !revising">
        <dl class="bag-dl">
          <div><dt>实点金额</dt><dd>{{ formatMoney(bag.countedAmount) }}</dd></div>
          <div><dt>假币</dt><dd>{{ formatMoney(bag.counterfeitAmount) }} / {{ bag.counterfeitCount ?? 0 }} 张</dd></div>
          <div><dt>差额</dt>
            <dd :class="(bag.difference ?? 0) === 0 ? 'num-ok' : 'num-bad'">
              {{ formatMoney(bag.difference) }}（{{ bag.problem }}）
            </dd>
          </div>
          <div v-if="bag.problem !== '正常'"><dt>责任</dt><dd>{{ bag.responsibility || "未划分" }}</dd></div>
          <div v-if="bag.problem !== '正常'"><dt>情况说明</dt><dd>{{ bag.differenceDesc }}</dd></div>
          <div><dt>拆箱人</dt><dd>{{ bag.openedBy }}</dd></div>
          <div><dt>拆箱时间</dt><dd>{{ bag.openedAt ? new Date(bag.openedAt).toLocaleString("zh-CN") : "—" }}</dd></div>
        </dl>
        <!-- 未确认：可直接更正实点；已确认后重开：改动须填原因并保留旧值 -->
        <button v-if="!sealed" type="button" class="secondary" @click="shift.everConfirmed ? startRevise() : (revising = true)">
          {{ shift.everConfirmed ? "改动确认值（留痕）" : "更正实点" }}
        </button>
      </template>

      <!-- 未确认前更正：走拆箱录入，不产生改值留痕 -->
      <OpenCountForm
        v-else-if="!sealed && (!shift.everConfirmed || !revising)"
        :bag="bag"
        :sealed="false"
        @save="(entry) => { emit('saveCount', bag.id, entry); revising = false; }"
      />

      <!-- 已确认后重开：改值必须填原因，旧值另存 -->
      <div v-else-if="revising && shift.everConfirmed && !sealed" class="revise-box">
        <div class="form-grid form-grid-2">
          <label>封存金额
            <input v-model.number="reviseForm.sealedAmount" type="number" step="0.01" />
          </label>
          <label>实点金额
            <input v-model.number="reviseForm.countedAmount" type="number" step="0.01" />
          </label>
          <label>假币合计
            <input v-model.number="reviseForm.counterfeitAmount" type="number" step="0.01" />
          </label>
          <label>差异责任
            <select v-model="reviseForm.responsibility">
              <option value="">请选择</option>
              <option v-for="r in ['交班方','接班方','站方承担']" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="span-2">情况说明
            <textarea v-model="reviseForm.differenceDesc" />
          </label>
          <label class="span-2">
            改动原因 <span class="req">*</span>
            <textarea v-model="reviseReason" placeholder="确认后的改动须写明原因，旧值随审计记录另存" />
          </label>
        </div>
        <p v-if="reviseError" class="form-error">{{ reviseError }}</p>
        <div class="inline-actions">
          <button type="button" @click="submitRevise">提交改动并留档</button>
          <button type="button" class="secondary" @click="revising = false">取消</button>
        </div>
      </div>
    </section>
  </article>
</template>
