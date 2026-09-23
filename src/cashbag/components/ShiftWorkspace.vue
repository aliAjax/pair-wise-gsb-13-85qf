<script setup lang="ts">
// 班次工作区：按班次状态呈现 交班登记 / 接班拆箱 / 站长确认 / 只读 四个阶段。
import { computed, ref } from "vue";
import { useShiftStore } from "../useShiftStore";
import { readyToConfirm } from "../rules";
import type { BagDraft } from "../rules";
import type { CashBag } from "../types";
import type { ConfirmedRevision, OpenEntry } from "../storage";
import BagRegisterForm from "./BagRegisterForm.vue";
import CashBagCard from "./CashBagCard.vue";

const props = defineProps<{ shiftId: string }>();
const store = useShiftStore();

const shift = computed(() => store.shifts.value.find((s) => s.id === props.shiftId));

const handoverActor = ref("");
const editingId = ref<string | null>(null);
const confirmOpen = ref(false);
const managerName = ref("");
const confirmNote = ref("");
const reopenOpen = ref(false);
const reopenReason = ref("");

const status = computed(() => shift.value?.status ?? "进行中");
const bags = computed(() => shift.value?.bags ?? []);
const issues = computed(() => (shift.value ? store.blockingIssues(shift.value) : []));
const sealed = computed(() => status.value === "已结班");
const isRegisterPhase = computed(() => ["进行中", "待核交"].includes(status.value));
const isOpenPhase = computed(() => ["已移交", "待站长确认"].includes(status.value));
const ready = computed(() => (shift.value ? readyToConfirm(shift.value) : { ok: false, reason: "" }));
const openedCount = computed(() => bags.value.filter((b) => b.opened).length);

const editingBag = computed(() => bags.value.find((b) => b.id === editingId.value) ?? null);

function onRegister(draft: BagDraft) {
  if (editingId.value) {
    store.updateBag(editingId.value, draft, draft.sealedBy);
    editingId.value = null;
  } else {
    store.register(draft, draft.sealedBy);
  }
}

function onRemove(bag: CashBag) {
  const actor = handoverActor.value || bag.sealedBy;
  if (confirm(`确认删除现金袋 ${bag.bagNo}？`)) store.deleteBag(bag.id, actor);
}

function onSaveCount(bagId: string, entry: OpenEntry) {
  store.saveCount(bagId, entry);
}

function onRevise(bagId: string, patch: ConfirmedRevision, reason: string) {
  store.revise(bagId, patch, handoverActor.value || "接班方", reason);
}

function normalHandover() {
  store.doNormalHandover(handoverActor.value || "交班方");
}
function pendingHandover() {
  store.doPendingHandover(handoverActor.value || "交班方");
}
function resolveHandover() {
  store.doResolve(handoverActor.value || "交班方");
}

function doSubmitConfirm() {
  store.submitConfirm(handoverActor.value || "接班方");
}
function doConfirm() {
  if (store.confirm(managerName.value, confirmNote.value)) {
    confirmOpen.value = false;
    managerName.value = "";
    confirmNote.value = "";
  }
}
function doReopen() {
  if (store.reopen(handoverActor.value || managerName.value, reopenReason.value)) {
    reopenOpen.value = false;
    reopenReason.value = "";
  }
}

const statusHint: Record<string, string> = {
  进行中: "交班登记中：核对袋号、封签、封存金额与签字人，核对无误才能结束班次。",
  待核交: "只能待核交：存在袋号重复/封签破损/金额缺失，原班次未结，接班不能拆箱。",
  已移交: "已移交接班：逐袋拆箱录入实点；长短款与假币须选责任、写情况，再提交站长确认。",
  待站长确认: "已提交站长确认：未确认前原班次未结；确认后只读。",
  已结班: "已结班并只读。如需改动须重开班次，旧值与原因另行存档。"
};
</script>

<template>
  <section v-if="shift" class="workspace-detail">
    <!-- 阶段头 -->
    <header class="phase-head">
      <div>
        <span class="status-pill" :data-status="status">{{ status }}</span>
        <span v-if="shift.everConfirmed" class="badge badge-idle">曾确认 · 重开 {{ shift.reopenCount }} 次</span>
      </div>
      <p class="phase-hint">{{ statusHint[status] }}</p>
    </header>

    <p v-if="store.lastError.value" class="form-error">{{ store.lastError.value }}</p>

    <!-- 交班登记阶段 -->
    <template v-if="isRegisterPhase">
      <BagRegisterForm
        v-if="!editingBag"
        :shift="shift"
        :editing="null"
        @submit="onRegister"
      />
      <template v-else>
        <CashBagCard
          :shift="shift"
          :bag="editingBag"
          :editing="true"
          @edit="() => {}"
          @cancel-edit="editingId = null"
          @save-edit="(d) => onRegister(d)"
          @remove="onRemove"
          @save-count="onSaveCount"
          @revise="onRevise"
        />
      </template>

      <ul v-if="issues.length" class="issue-list issue-block">
        <li v-for="(issue, i) in issues" :key="i" class="issue-err">{{ issue.message }}</li>
      </ul>

      <div class="handover-bar subpanel">
        <label class="actor-label">
          交班经办人
          <input v-model="handoverActor" placeholder="签字" autocomplete="off" />
        </label>
        <div class="handover-btns">
          <button type="button" :disabled="issues.length > 0 || bags.length === 0" @click="normalHandover">
            核对无误，结束班次并移交
          </button>
          <button type="button" class="secondary" :disabled="bags.length === 0" @click="pendingHandover">
            存在异常，按待核交移交
          </button>
          <button v-if="status === '待核交'" type="button" @click="resolveHandover">
            核改完成，正常移交
          </button>
        </div>
        <p v-if="issues.length" class="bar-tip">袋号重复、封签破损或金额缺失只能待核交，不能结束班次。</p>
      </div>
    </template>

    <!-- 接班拆箱阶段 -->
    <template v-if="isOpenPhase">
      <div class="open-progress">
        拆箱进度 {{ openedCount }} / {{ bags.length }}
      </div>
      <div class="bag-list">
        <CashBagCard
          v-for="bag in bags"
          :key="bag.id"
          :shift="shift"
          :bag="bag"
          :editing="false"
          @edit="(b) => (editingId = b.id)"
          @cancel-edit="editingId = null"
          @save-edit="onRegister"
          @remove="onRemove"
          @save-count="onSaveCount"
          @revise="onRevise"
        />
      </div>

      <div v-if="status === '已移交'" class="handover-bar subpanel">
        <label class="actor-label">
          接班经办人
          <input v-model="handoverActor" placeholder="签字" autocomplete="off" />
        </label>
        <button type="button" :disabled="!ready.ok" @click="doSubmitConfirm">
          拆箱完成，提交站长确认
        </button>
        <p class="bar-tip">
          {{ ready.ok ? "全部现金袋已拆箱，差异责任与情况齐全。" : ready.reason + "。未确认前原班次未结。" }}
        </p>
      </div>

      <div v-else class="handover-bar subpanel">
        <p class="bar-tip">等待站长确认。确认前可继续更正实点；确认后整班只读。</p>
        <button type="button" @click="confirmOpen = !confirmOpen">
          {{ confirmOpen ? "收起确认" : "站长确认结班" }}
        </button>
        <div v-if="confirmOpen" class="confirm-box">
          <div class="form-grid form-grid-2">
            <label>
              站长签字 <span class="req">*</span>
              <input v-model="managerName" :placeholder="shift.manager || '站长姓名'" autocomplete="off" />
            </label>
            <label class="span-2">
              确认意见
              <textarea v-model="confirmNote" placeholder="对长款、短款、假币责任处理的确认意见" />
            </label>
          </div>
          <p v-if="store.lastError.value" class="form-error">{{ store.lastError.value }}</p>
          <button type="button" :disabled="!managerName.trim()" @click="doConfirm">确认并结班（之后只读）</button>
        </div>
      </div>
    </template>

    <!-- 已结班：只读 + 重开 -->
    <template v-if="sealed">
      <div class="bag-list">
        <CashBagCard
          v-for="bag in bags"
          :key="bag.id"
          :shift="shift"
          :bag="bag"
          :editing="false"
          @edit="() => {}"
          @cancel-edit="() => {}"
          @save-edit="() => {}"
          @remove="() => {}"
          @save-count="() => {}"
          @revise="onRevise"
        />
      </div>
      <div class="handover-bar subpanel">
        <button type="button" class="secondary" @click="reopenOpen = !reopenOpen">
          {{ reopenOpen ? "取消" : "重开班次（改动留痕）" }}
        </button>
        <div v-if="reopenOpen" class="confirm-box">
          <label>
            重开原因 <span class="req">*</span>
            <textarea v-model="reopenReason" placeholder="重开后班次、现金袋、差异与处理仍对应；改动保留旧值与原因" />
          </label>
          <button type="button" :disabled="!reopenReason.trim()" @click="doReopen">确认重开（回到待站长确认）</button>
        </div>
      </div>
    </template>

    <!-- 审计轨迹 -->
    <section class="audit">
      <h3>交接留痕（{{ shift.audit.length }}）</h3>
      <ol>
        <li v-for="entry in [...shift.audit].reverse()" :key="entry.id">
          <div class="audit-line">
            <span class="audit-action" :data-action="entry.action">{{ entry.action }}</span>
            <span class="audit-text">{{ entry.message }}</span>
          </div>
          <div class="audit-meta">
            {{ new Date(entry.at).toLocaleString("zh-CN") }} · {{ entry.actor }}
            <template v-if="entry.reason"> · 原因：{{ entry.reason }}</template>
          </div>
          <ul v-if="entry.changes?.length" class="change-list">
            <li v-for="c in entry.changes" :key="c.field">
              {{ c.field }}：<del>{{ c.from }}</del> → <strong>{{ c.to }}</strong>
            </li>
          </ul>
        </li>
      </ol>
    </section>
  </section>
</template>
