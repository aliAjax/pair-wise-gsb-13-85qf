<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCashBagStore } from "../cashbag/store";
import {
  RESPONSIBILITY_OPTIONS,
  type BagDraft,
  type CashBag,
  type CashDifference,
  type CorrectDraft,
  type DispositionDraft,
  type Responsibility,
  type SealState
} from "../cashbag/types";

const store = useCashBagStore();

// ---------- 班次 ----------

const selectedShiftId = ref<string | null>(store.shifts[0]?.id ?? null);
const showCreate = ref(false);
const createForm = reactive({ type: "早班", date: today(), outOperator: "", inOperator: "" });

const shiftTypes = ["早班", "中班", "晚班"] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function submitCreate() {
  if (!createForm.date || !createForm.outOperator.trim()) {
    flash("请填写班次日期和交班人", "error");
    return;
  }
  const shift = store.createShift({ ...createForm });
  selectedShiftId.value = shift.id;
  showCreate.value = false;
  createForm.date = today();
  createForm.outOperator = "";
  createForm.inOperator = "";
  flash("已开班，可登记现金袋");
}

const currentShift = computed(() =>
  store.shifts.find((item) => item.id === selectedShiftId.value) ?? null
);
const currentBags = computed(() =>
  currentShift.value ? store.bagsOf(currentShift.value.id) : []
);
const activeDiffs = computed(() =>
  currentShift.value ? store.activeDiffsOf(currentShift.value.id) : []
);
const voidedDiffs = computed(() =>
  currentShift.value
    ? store.diffsOf(currentShift.value.id).filter((diff) => diff.status === "已作废")
    : []
);
const currentLogs = computed(() =>
  currentShift.value ? store.logsOf(currentShift.value.id) : []
);
const currentCheck = computed(() =>
  currentShift.value ? store.check(currentShift.value.id) : null
);

watch(selectedShiftId, () => {
  editingBagId.value = null;
  correctingBagId.value = null;
  openBagId.value = null;
  editingDiffId.value = null;
});

// ---------- 提示 ----------

const message = ref<{ text: string; tone: "ok" | "error" } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
function flash(text: string, tone: "ok" | "error" = "ok") {
  message.value = { text, tone };
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (message.value = null), 3200);
}

function guard(result: { ok: boolean; error?: string }): boolean {
  if (!result.ok) {
    flash(result.error ?? "操作失败", "error");
    return false;
  }
  return true;
}

// ---------- 交班登记 ----------

const registerForm = reactive<BagDraft>({
  bagNo: "",
  sealNo: "",
  sealState: "完好",
  sealedAmount: null,
  handedBy: ""
});

function submitRegister() {
  if (!currentShift.value) return;
  const result = store.registerBag(currentShift.value.id, { ...registerForm });
  if (!guard(result)) return;
  if (result.issues.length > 0) {
    flash(`已登记，但存在“${result.issues.join("、")}”，班次只能待核交，不能结束`, "error");
  } else {
    flash("现金袋已登记");
  }
  registerForm.bagNo = "";
  registerForm.sealNo = "";
  registerForm.sealState = "完好";
  registerForm.sealedAmount = null;
  registerForm.handedBy = "";
}

// ---------- 待核交：登记更正 ----------

const editingBagId = ref<string | null>(null);
const editForm = reactive<BagDraft>({
  bagNo: "",
  sealNo: "",
  sealState: "完好",
  sealedAmount: null,
  handedBy: ""
});

function startEditBag(bag: CashBag) {
  editingBagId.value = bag.id;
  editForm.bagNo = bag.bagNo;
  editForm.sealNo = bag.sealNo;
  editForm.sealState = bag.sealState;
  editForm.sealedAmount = bag.sealedAmount;
  editForm.handedBy = bag.handedBy;
}

function submitEditBag(bag: CashBag) {
  const result = store.fixBag(bag.id, { ...editForm });
  if (!guard(result)) return;
  editingBagId.value = null;
  flash(
    result.issues.length > 0
      ? `已保存，仍存在“${result.issues.join("、")}”，继续待核交`
      : "异常已排除，可正常交接",
    result.issues.length > 0 ? "error" : "ok"
  );
}

// ---------- 正式交接 ----------

const inOperatorName = ref("");

function submitHandOver() {
  if (!currentShift.value) return;
  const result = store.handOver(currentShift.value.id, inOperatorName.value);
  if (guard(result)) {
    flash("班次已交接，接班方可拆箱实点");
  }
}

// ---------- 接班拆箱 ----------

const openBagId = ref<string | null>(null);
const openForm = reactive({ openedBy: "", counted: 0, counterfeit: 0 });

function startOpen(bag: CashBag) {
  openBagId.value = bag.id;
  openForm.openedBy = currentShift.value?.inOperator ?? "";
  openForm.counted = bag.sealedAmount ?? 0;
  openForm.counterfeit = 0;
}

function submitOpen(bag: CashBag) {
  if (!currentShift.value) return;
  const result = store.openBag(currentShift.value.id, bag.id, {
    openedBy: openForm.openedBy,
    countedAmount: openForm.counted,
    counterfeitAmount: openForm.counterfeit
  });
  if (!guard(result)) return;
  openBagId.value = null;
  if (result.diffs && result.diffs.length > 0) {
    flash(`拆箱完成，发现${result.diffs.join("、")}，须选责任、写情况并经站长确认`, "error");
  } else {
    flash("拆箱完成，账实一致");
  }
}

// ---------- 差异处理 ----------

const editingDiffId = ref<string | null>(null);
const diffForm = reactive<{ responsibility: Responsibility | ""; detail: string }>({
  responsibility: "",
  detail: ""
});

function startEditDiff(diff: CashDifference) {
  editingDiffId.value = diff.id;
  diffForm.responsibility = diff.responsibility ?? "";
  diffForm.detail = diff.detail;
}

function submitDisposition(diff: CashDifference) {
  if (!diffForm.responsibility) {
    flash("请选择责任归属", "error");
    return;
  }
  const draft: DispositionDraft = {
    responsibility: diffForm.responsibility as Responsibility,
    detail: diffForm.detail
  };
  if (guard(store.saveDisposition(diff.id, draft))) {
    editingDiffId.value = null;
    flash("处理意见已保存，等待站长确认");
  }
}

const managerName = ref("");

function submitConfirm(diff: CashDifference) {
  if (guard(store.confirmDifference(diff.id, managerName.value))) {
    managerName.value = "";
    flash("站长已确认，该差异转为只读");
  }
}

// ---------- 确认后修正（只读改动留痕） ----------

const correctingBagId = ref<string | null>(null);
const correctForm = reactive<CorrectDraft>({
  sealedAmount: null,
  countedAmount: 0,
  counterfeitAmount: 0,
  dispositions: {},
  reason: "",
  changedBy: ""
});

function startCorrect(bag: CashBag) {
  correctingBagId.value = bag.id;
  correctForm.sealedAmount = bag.sealedAmount;
  correctForm.countedAmount = bag.countedAmount ?? 0;
  correctForm.counterfeitAmount = bag.counterfeitAmount ?? 0;
  correctForm.dispositions = {};
  correctForm.reason = "";
  correctForm.changedBy = "";
  for (const diff of diffsForBag(bag.id)) {
    correctForm.dispositions[diff.kind] = {
      responsibility: diff.responsibility ?? RESPONSIBILITY_OPTIONS[0],
      detail: diff.detail
    };
  }
}

function submitCorrect(bag: CashBag) {
  if (guard(store.correctBag(bag.id, { ...correctForm, dispositions: { ...correctForm.dispositions } }))) {
    correctingBagId.value = null;
    flash("修正已保存，旧值与原因已留痕；如改了金额或处理，须重新经站长确认");
  }
}

// ---------- 结班 ----------

function submitClose() {
  if (!currentShift.value) return;
  const result = store.closeShift(currentShift.value.id);
  if (result.ok) {
    flash("班次已结束");
  } else {
    flash(result.errors.join("；"), "error");
  }
}

// ---------- 展示辅助 ----------

function diffsForBag(bagId: string): CashDifference[] {
  return activeDiffs.value.filter((diff) => diff.bagId === bagId);
}

function bagOf(bagId: string): CashBag | undefined {
  return currentBags.value.find((bag) => bag.id === bagId);
}

function fmtMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function stageClass(stage: string): string {
  return {
    进行中: "stage-open",
    待核交: "stage-verify",
    已交接: "stage-handed",
    已结班: "stage-closed"
  }[stage] ?? "";
}

function kindClass(kind: string): string {
  return { 长款: "kind-over", 短款: "kind-short", 假币: "kind-fake" }[kind] ?? "";
}

function resetDemo() {
  store.resetDemo();
  selectedShiftId.value = store.shifts[0]?.id ?? null;
  flash("已恢复演示数据");
}
</script>

<template>
  <div class="cashbag-page">
    <!-- 顶部概览 -->
    <section class="metrics">
      <article class="metric">
        <span>班次总数</span>
        <strong>{{ store.stats.total }}</strong>
      </article>
      <article class="metric">
        <span>待核交（不能结班）</span>
        <strong class="warn">{{ store.stats.verifying }}</strong>
      </article>
      <article class="metric">
        <span>差异待站长确认</span>
        <strong class="warn">{{ store.stats.pendingConfirm }}</strong>
      </article>
      <article class="metric">
        <span>已结班 / 现金袋</span>
        <strong>{{ store.stats.closed }} / {{ store.stats.bagCount }}</strong>
      </article>
    </section>

    <transition name="fade">
      <p v-if="message" class="flash" :class="message.tone">{{ message.text }}</p>
    </transition>

    <div class="layout">
      <!-- 左：班次列表 -->
      <aside class="panel shift-list">
        <div class="toolbar">
          <h2>班次</h2>
          <button type="button" class="secondary small" @click="showCreate = !showCreate">
            {{ showCreate ? "收起" : "开班登记" }}
          </button>
        </div>

        <form v-if="showCreate" class="create-box" @submit.prevent="submitCreate">
          <label>
            班次
            <select v-model="createForm.type">
              <option v-for="item in shiftTypes" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label>
            日期
            <input v-model="createForm.date" type="date" required />
          </label>
          <label>
            交班人
            <input v-model="createForm.outOperator" placeholder="交班签字人" required />
          </label>
          <label>
            接班人（可后补）
            <input v-model="createForm.inOperator" placeholder="接班签字人" />
          </label>
          <button type="submit" class="small">开班</button>
        </form>

        <div v-if="store.shifts.length === 0" class="empty">暂无班次，点击“开班登记”</div>
        <button
          v-for="shift in store.shifts"
          :key="shift.id"
          type="button"
          class="shift-item"
          :class="{ active: shift.id === selectedShiftId }"
          @click="selectedShiftId = shift.id"
        >
          <span class="shift-item-main">
            <strong>{{ shift.date }} {{ shift.type }}</strong>
            <small>{{ shift.outOperator }} → {{ shift.inOperator || "待接班" }}</small>
          </span>
          <span class="badge" :class="stageClass(shift.stage)">{{ shift.stage }}</span>
        </button>

        <button type="button" class="ghost small reset-btn" @click="resetDemo">重置演示数据</button>
      </aside>

      <!-- 右：班次详情 -->
      <section class="panel detail">
        <div v-if="!currentShift" class="empty big">请选择或新建一个班次</div>

        <template v-else>
          <header class="detail-head">
            <div>
              <h2>{{ currentShift.date }} {{ currentShift.type }} · 现金袋拆箱移交</h2>
              <p class="people">
                交班：<b>{{ currentShift.outOperator }}</b>
                ｜ 接班：<b>{{ currentShift.inOperator || "待接班" }}</b>
              </p>
              <p class="times">
                交接 {{ fmtTime(currentShift.handedAt) }} ｜ 结班 {{ fmtTime(currentShift.closedAt) }}
              </p>
            </div>
            <span class="badge lg" :class="stageClass(currentShift.stage)">{{ currentShift.stage }}</span>
          </header>

          <!-- 交班登记 + 正式交接 -->
          <div v-if="currentShift.stage !== '已结班'" class="subpanel">
            <h3>① 交班登记现金袋</h3>
            <p class="hint">
              登记袋号、封签、封存金额和签字人。袋号重复、封签破损或金额缺失时只可登记为
              <b>待核交</b>，不能正式交接、不能结束班次。
            </p>
            <form class="reg-grid" @submit.prevent="submitRegister">
              <label>
                袋号
                <input v-model="registerForm.bagNo" placeholder="如 CB20260923-01" required />
              </label>
              <label>
                封签号
                <input v-model="registerForm.sealNo" placeholder="封签编号" required />
              </label>
              <label>
                封签状态
                <select v-model="registerForm.sealState">
                  <option value="完好">完好</option>
                  <option value="破损">破损</option>
                </select>
              </label>
              <label>
                封存金额
                <input
                  v-model.number="registerForm.sealedAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="缺失则留空，只能待核交"
                />
              </label>
              <label>
                交班签字人
                <input v-model="registerForm.handedBy" placeholder="签字人姓名" required />
              </label>
              <button type="submit" class="small">登记现金袋</button>
            </form>

            <div v-if="currentShift.stage === '进行中'" class="handover-row">
              <label class="inline">
                接班签字人
                <input v-model="inOperatorName" :placeholder="currentShift.inOperator || '接班人姓名'" />
              </label>
              <button type="button" @click="submitHandOver">正式交接给接班方</button>
            </div>
            <div v-else-if="currentShift.stage === '待核交'" class="notice warn-box">
              班次处于待核交：现金袋存在袋号重复、封签破损或金额缺失。请在下方更正登记；
              异常排除前不能交接，更不能结束班次。
            </div>
          </div>

          <!-- 现金袋列表 -->
          <div class="subpanel">
            <h3>② 现金袋（{{ currentBags.length }}）</h3>

            <div v-if="currentBags.length === 0" class="empty">本班次尚未登记现金袋</div>

            <article v-for="bag in currentBags" :key="bag.id" class="bag-card">
              <div class="bag-head">
                <div>
                  <strong class="bag-no">袋号 {{ bag.bagNo }}</strong>
                  <span class="bag-seal">封签 {{ bag.sealNo }}（{{ bag.sealState }}）</span>
                </div>
                <div class="bag-head-right">
                  <span
                    v-for="issue in store.bagIssuesOf(bag)"
                    :key="issue"
                    class="badge stage-verify"
                  >{{ issue }}</span>
                  <span class="badge" :class="bag.stage === '已拆箱' ? 'stage-closed' : 'stage-open'">
                    {{ bag.stage }}
                  </span>
                </div>
              </div>

              <!-- 待核交更正（确认前） -->
              <form
                v-if="editingBagId === bag.id"
                class="reg-grid tight"
                @submit.prevent="submitEditBag(bag)"
              >
                <label>袋号<input v-model="editForm.bagNo" required /></label>
                <label>封签号<input v-model="editForm.sealNo" required /></label>
                <label>
                  封签状态
                  <select v-model="editForm.sealState">
                    <option value="完好">完好</option>
                    <option value="破损">破损</option>
                  </select>
                </label>
                <label>
                  封存金额
                  <input v-model.number="editForm.sealedAmount" type="number" min="0" step="0.01" />
                </label>
                <label>交班签字人<input v-model="editForm.handedBy" required /></label>
                <div class="btn-row">
                  <button type="submit" class="small">保存更正</button>
                  <button type="button" class="secondary small" @click="editingBagId = null">取消</button>
                </div>
              </form>

              <template v-else>
                <div class="kv-grid">
                  <span>封存金额：<b>{{ fmtMoney(bag.sealedAmount) }}</b></span>
                  <span>交班签字：{{ bag.handedBy }}</span>
                  <span>登记时间：{{ fmtTime(bag.registeredAt) }}</span>
                  <span v-if="bag.stage === '已拆箱'">
                    实点金额：<b :class="(bag.countedAmount ?? 0) >= (bag.sealedAmount ?? 0) ? 'over' : 'short'">
                      {{ fmtMoney(bag.countedAmount) }}
                    </b>
                  </span>
                  <span v-if="bag.stage === '已拆箱'">假币：<b class="fake">{{ fmtMoney(bag.counterfeitAmount) }}</b></span>
                  <span v-if="bag.stage === '已拆箱'">拆箱人：{{ bag.openedBy }}（{{ fmtTime(bag.openedAt) }}）</span>
                </div>

                <!-- 接班拆箱录入 -->
                <form
                  v-if="openBagId === bag.id"
                  class="reg-grid tight"
                  @submit.prevent="submitOpen(bag)"
                >
                  <label>拆箱人<input v-model="openForm.openedBy" required /></label>
                  <label>实点金额<input v-model.number="openForm.counted" type="number" min="0" step="0.01" required /></label>
                  <label>假币金额<input v-model.number="openForm.counterfeit" type="number" min="0" step="0.01" required /></label>
                  <div class="btn-row">
                    <button type="submit" class="small">确认拆箱实点</button>
                    <button type="button" class="secondary small" @click="openBagId = null">取消</button>
                  </div>
                </form>

                <!-- 操作按钮 -->
                <div v-else class="btn-row">
                  <button
                    v-if="currentShift.stage !== '已结班'
                      && bag.stage === '已登记'
                      && store.bagIssuesOf(bag).length === 0
                      && currentShift.stage === '已交接'"
                    type="button"
                    class="small"
                    @click="startOpen(bag)"
                  >接班拆箱录入</button>
                  <button
                    v-if="currentShift.stage !== '已结班' && bag.stage === '已登记'"
                    type="button"
                    class="secondary small"
                    @click="startEditBag(bag)"
                  >{{ store.bagIssuesOf(bag).length > 0 ? "更正登记（解除待核交）" : "修改登记" }}</button>
                  <button
                    v-if="bag.stage === '已拆箱' && store.isConfirmedBag(bag)"
                    type="button"
                    class="secondary small"
                    @click="startCorrect(bag)"
                  >修正（留痕）</button>
                  <span v-if="store.isConfirmedBag(bag)" class="readonly-tag">已确认 · 只读</span>
                </div>

                <!-- 确认后修正面板 -->
                <form
                  v-if="correctingBagId === bag.id"
                  class="correct-box"
                  @submit.prevent="submitCorrect(bag)"
                >
                  <p class="notice warn-box">
                    确认后资料只读。此处改动将保留旧值和原因另存；改动金额会重新生成差异并作废旧记录，
                    已结班次会重开，须重新由站长确认后才能再结班。
                  </p>
                  <div class="reg-grid tight">
                    <label>
                      封存金额（原值 {{ fmtMoney(bag.sealedAmount) }}）
                      <input v-model.number="correctForm.sealedAmount" type="number" min="0" step="0.01" required />
                    </label>
                    <label>
                      实点金额（原值 {{ fmtMoney(bag.countedAmount) }}）
                      <input v-model.number="correctForm.countedAmount" type="number" min="0" step="0.01" required />
                    </label>
                    <label>
                      假币金额（原值 {{ fmtMoney(bag.counterfeitAmount) }}）
                      <input v-model.number="correctForm.counterfeitAmount" type="number" min="0" step="0.01" required />
                    </label>
                  </div>

                  <div
                    v-for="diff in diffsForBag(bag.id)"
                    :key="diff.id"
                    class="disposition-edit"
                  >
                    <p class="disp-title"><span class="badge" :class="kindClass(diff.kind)">{{ diff.kind }} {{ fmtMoney(diff.amount) }}</span> 处理意见</p>
                    <label>
                      责任
                      <select v-model="correctForm.dispositions[diff.kind]!.responsibility">
                        <option v-for="opt in RESPONSIBILITY_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
                      </select>
                    </label>
                    <label>
                      情况
                      <textarea
                        v-model="correctForm.dispositions[diff.kind]!.detail"
                        rows="2"
                      />
                    </label>
                  </div>

                  <div class="reg-grid tight two-col">
                    <label>
                      改动原因（必填）
                      <input v-model="correctForm.reason" placeholder="如：封存单误录，复核监控后更正" required />
                    </label>
                    <label>
                      操作人
                      <input v-model="correctForm.changedBy" required />
                    </label>
                  </div>
                  <div class="btn-row">
                    <button type="submit" class="small danger-btn">提交修正并留痕</button>
                    <button type="button" class="secondary small" @click="correctingBagId = null">取消</button>
                  </div>
                </form>
              </template>
            </article>
          </div>

          <!-- 差异与处理 -->
          <div class="subpanel">
            <h3>③ 拆箱差异与处理（{{ activeDiffs.length }}）</h3>
            <p class="hint">
              长款、短款、假币必须选择责任、写明情况并由站长确认；未确认前原班次不能结束。
            </p>

            <div v-if="activeDiffs.length === 0" class="empty">暂无差异（未拆箱或账实一致）</div>

            <article v-for="diff in activeDiffs" :key="diff.id" class="diff-card">
              <div class="diff-head">
                <span class="badge lg" :class="kindClass(diff.kind)">
                  {{ diff.kind }} {{ fmtMoney(diff.amount) }}
                </span>
                <span class="muted">袋号 {{ bagOf(diff.bagId)?.bagNo ?? diff.bagId }}</span>
                <span class="badge" :class="diff.status === '已确认' ? 'stage-closed' : 'stage-verify'">
                  {{ diff.status }}
                </span>
              </div>

              <!-- 未确认：录入/修改处理意见 -->
              <form
                v-if="editingDiffId === diff.id"
                class="reg-grid tight"
                @submit.prevent="submitDisposition(diff)"
              >
                <label>
                  责任归属
                  <select v-model="diffForm.responsibility" required>
                    <option value="" disabled>请选择责任</option>
                    <option v-for="opt in RESPONSIBILITY_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                </label>
                <label>
                  差异情况
                  <textarea v-model="diffForm.detail" rows="2" placeholder="写明长短款/假币经过" required />
                </label>
                <div class="btn-row">
                  <button type="submit" class="small">保存处理意见</button>
                  <button type="button" class="secondary small" @click="editingDiffId = null">取消</button>
                </div>
              </form>

              <template v-else>
                <div class="kv-grid">
                  <span>责任：<b>{{ diff.responsibility ?? "未选择" }}</b></span>
                  <span>情况：{{ diff.detail || "未填写" }}</span>
                </div>

                <!-- 站长确认行 -->
                <div v-if="diff.status !== '已确认'" class="confirm-row">
                  <button type="button" class="secondary small" @click="startEditDiff(diff)">
                    {{ diff.responsibility ? "修改处理意见" : "填写责任与情况" }}
                  </button>
                  <label class="inline">
                    站长确认
                    <input v-model="managerName" placeholder="站长姓名" :disabled="!diff.responsibility || !diff.detail" />
                  </label>
                  <button
                    type="button"
                    class="small"
                    :disabled="!diff.responsibility || !diff.detail"
                    @click="submitConfirm(diff)"
                  >站长确认</button>
                </div>
                <p v-else class="confirmed-line">
                  ✓ 已由站长 <b>{{ diff.managerConfirmedBy }}</b> 于 {{ fmtTime(diff.managerConfirmedAt) }} 确认，资料只读；
                  如需改动请用现金袋上的“修正（留痕）”。
                </p>
              </template>
            </article>

            <div v-if="voidedDiffs.length > 0" class="voided">
              <h4>已作废的旧差异（修正后保留）</h4>
              <p v-for="diff in voidedDiffs" :key="diff.id">
                <span class="badge" :class="kindClass(diff.kind)">{{ diff.kind }} {{ fmtMoney(diff.amount) }}</span>
                {{ diff.responsibility ?? "—" }} ｜ {{ diff.detail || "—" }}
              </p>
            </div>
          </div>

          <!-- 结班 -->
          <div class="subpanel">
            <h3>④ 结束班次</h3>
            <ul v-if="currentCheck && currentCheck.closeBlockers.length > 0" class="blockers">
              <li v-for="blocker in currentCheck.closeBlockers" :key="blocker">⚠ {{ blocker }}</li>
            </ul>
            <p v-else-if="currentShift.stage !== '已结班'" class="notice ok-box">
              全部现金袋已拆箱，差异均已选责任、写明情况并经站长确认，可以结束班次。
            </p>
            <p v-else class="notice ok-box">班次已结。所有现金袋、差异与处理为只读；修正会使班次重开并留痕。</p>
            <button
              type="button"
              :disabled="!currentCheck?.canClose || currentShift.stage === '已结班'"
              @click="submitClose"
            >结束班次</button>
          </div>

          <!-- 改动留痕 -->
          <div class="subpanel">
            <h3>改动留痕（{{ currentLogs.length }}）</h3>
            <div v-if="currentLogs.length === 0" class="empty">暂无确认后的修正记录</div>
            <table v-else class="log-table">
              <thead>
                <tr>
                  <th>时间</th><th>现金袋</th><th>字段</th><th>旧值</th><th>新值</th><th>原因</th><th>操作人</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in currentLogs" :key="log.id">
                  <td>{{ fmtTime(log.changedAt) }}</td>
                  <td>{{ bagOf(log.bagId ?? "")?.bagNo ?? "—" }}</td>
                  <td>{{ log.field }}</td>
                  <td class="old-val">{{ log.oldValue }}</td>
                  <td class="new-val">{{ log.newValue }}</td>
                  <td>{{ log.reason }}</td>
                  <td>{{ log.changedBy }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cashbag-page {
  display: grid;
  gap: 16px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.metric {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px 16px;
}
.metric span {
  display: block;
  color: #69758c;
  font-size: 13px;
}
.metric strong {
  display: block;
  margin-top: 6px;
  font-size: 26px;
}
.metric strong.warn {
  color: #c84b31;
}

.flash {
  margin: 0;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}
.flash.ok {
  background: #e8f4ef;
  color: #14724f;
  border: 1px solid #bfe3d4;
}
.flash.error {
  background: #fdecea;
  color: #b23a24;
  border: 1px solid #f3c5bd;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.panel {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.toolbar h2 {
  margin: 0;
  font-size: 18px;
}

button.small {
  padding: 7px 12px;
  font-size: 13px;
}
button.ghost {
  background: transparent;
  color: #69758c;
  border: 1px dashed #c6d0de;
}
button.danger-btn {
  background: #c84b31;
}

.create-box {
  display: grid;
  gap: 8px;
  border: 1px solid #e1e8f1;
  background: #f8fafd;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.create-box label {
  font-size: 13px;
}

.shift-list {
  display: grid;
  gap: 8px;
  position: sticky;
  top: 16px;
}
.shift-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  background: #f7f9fc;
  color: #172033;
  border: 1px solid #e1e8f1;
  border-radius: 8px;
  padding: 10px 12px;
}
.shift-item:hover {
  border-color: #9db7cf;
}
.shift-item.active {
  border-color: #176b87;
  background: #ecf5f8;
  box-shadow: inset 3px 0 0 #176b87;
}
.shift-item-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.shift-item-main small {
  color: #69758c;
}
.reset-btn {
  justify-self: start;
  margin-top: 4px;
}

.detail {
  display: grid;
  gap: 14px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid #e8eef5;
  padding-bottom: 12px;
}
.detail-head h2 {
  margin: 0 0 6px;
  font-size: 19px;
}
.people,
.times {
  margin: 2px 0;
  color: #536078;
  font-size: 13px;
}

.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  background: #e8eef5;
  color: #445069;
  white-space: nowrap;
}
.badge.lg {
  padding: 5px 12px;
  font-size: 13px;
}
.stage-open {
  background: #e8f1fb;
  color: #1c5da8;
}
.stage-verify {
  background: #fdecea;
  color: #b23a24;
}
.stage-handed {
  background: #fff3df;
  color: #a3651a;
}
.stage-closed {
  background: #e8f4ef;
  color: #14724f;
}
.kind-over {
  background: #e8f4ef;
  color: #14724f;
}
.kind-short {
  background: #fdecea;
  color: #b23a24;
}
.kind-fake {
  background: #f3e8fb;
  color: #7a2db0;
}

.subpanel {
  border: 1px solid #e8eef5;
  border-radius: 8px;
  padding: 14px;
}
.subpanel h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.hint {
  margin: 0 0 10px;
  color: #69758c;
  font-size: 13px;
}

.reg-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
}
.reg-grid.tight {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 10px;
}
.reg-grid.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
label {
  display: grid;
  gap: 5px;
  color: #445069;
  font-size: 13px;
}
label.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 220px;
}
label.inline input {
  flex: 1;
}

.handover-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #d9e2ee;
}

.notice {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin: 10px 0 0;
}
.warn-box {
  background: #fdecea;
  color: #8f2c1b;
  border: 1px solid #f3c5bd;
}
.ok-box {
  background: #e8f4ef;
  color: #14724f;
  border: 1px solid #bfe3d4;
}

.bag-card {
  border: 1px solid #e1e8f1;
  border-radius: 8px;
  padding: 12px;
  background: #fbfcfe;
  margin-bottom: 10px;
}
.bag-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.bag-no {
  font-size: 15px;
  margin-right: 10px;
}
.bag-seal {
  color: #69758c;
  font-size: 13px;
}
.bag-head-right {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.kv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 14px;
  margin: 10px 0;
  color: #536078;
  font-size: 13px;
}
.over {
  color: #14724f;
}
.short {
  color: #b23a24;
}
.fake {
  color: #7a2db0;
}
.btn-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.readonly-tag {
  font-size: 12px;
  color: #14724f;
  background: #e8f4ef;
  border-radius: 999px;
  padding: 4px 10px;
}

.correct-box {
  margin-top: 10px;
  border: 1px solid #f0d4ce;
  background: #fdf7f6;
  border-radius: 8px;
  padding: 12px;
}
.disposition-edit {
  border-top: 1px dashed #e2c4be;
  margin-top: 10px;
  padding-top: 10px;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 10px;
}
.disp-title {
  grid-column: 1 / -1;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.diff-card {
  border: 1px solid #e1e8f1;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
}
.diff-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.muted {
  color: #69758c;
  font-size: 13px;
  flex: 1;
}
.confirm-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 8px;
}
.confirmed-line {
  margin: 8px 0 0;
  color: #14724f;
  font-size: 13px;
  background: #e8f4ef;
  border-radius: 8px;
  padding: 8px 10px;
}
.voided {
  margin-top: 12px;
  border-top: 1px dashed #d9e2ee;
  padding-top: 10px;
  color: #8a94a6;
}
.voided h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.voided p {
  margin: 4px 0;
  font-size: 13px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.blockers {
  margin: 0 0 10px;
  padding-left: 4px;
  list-style: none;
  display: grid;
  gap: 6px;
  color: #b23a24;
  font-size: 13px;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.log-table th,
.log-table td {
  border: 1px solid #e8eef5;
  padding: 7px 9px;
  text-align: left;
  vertical-align: top;
}
.log-table th {
  background: #f5f8fb;
  color: #445069;
}
.old-val {
  color: #b23a24;
  text-decoration: line-through;
}
.new-val {
  color: #14724f;
}

.empty {
  color: #8a94a6;
  font-size: 13px;
  padding: 14px;
  text-align: center;
}
.empty.big {
  padding: 60px 12px;
}

@media (max-width: 980px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .shift-list {
    position: static;
  }
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .reg-grid,
  .reg-grid.tight,
  .kv-grid {
    grid-template-columns: 1fr;
  }
  .disposition-edit {
    grid-template-columns: 1fr;
  }
}
</style>
