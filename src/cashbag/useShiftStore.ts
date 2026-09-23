// 现金袋拆箱移交 —— 状态层：把保存层操作接入 Vue 响应式状态并自动持久化。

import { computed, ref } from "vue";
import {
  confirmByManager,
  createShift,
  handoverNormal,
  handoverPending,
  loadDatabase,
  registerBag,
  removeBag,
  reopenShift,
  resetDatabase,
  resolveAndHandover,
  reviseAfterConfirm,
  saveDatabase,
  saveOpenEntry,
  ShiftRuleError,
  submitForConfirm,
  updateBagBeforeHandover,
  type ConfirmedRevision,
  type OpenEntry
} from "./storage";
import { shiftBlockingIssues } from "./storage";
import type { BagDraft } from "./rules";
import type { Database, Shift, ShiftKind } from "./types";

const db = ref<Database>(loadDatabase());
const selectedId = ref<string>(db.value.shifts[0]?.id ?? "");
const lastError = ref("");

function persist() {
  saveDatabase(db.value);
}

function mutate(id: string, producer: (shift: Shift) => Shift): Shift {
  const current = db.value.shifts.find((s) => s.id === id);
  if (!current) throw new ShiftRuleError("班次不存在");
  const next = producer(current);
  db.value = {
    ...db.value,
    shifts: db.value.shifts.map((s) => (s.id === id ? next : s))
  };
  persist();
  return next;
}

export function useShiftStore() {
  const shifts = computed(() =>
    [...db.value.shifts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );

  const selectedShift = computed<Shift | undefined>(() =>
    db.value.shifts.find((s) => s.id === selectedId.value)
  );

  const stats = computed(() => {
    const list = db.value.shifts;
    return {
      total: list.length,
      open: list.filter((s) => s.status !== "已结班").length,
      pending: list.filter((s) => s.status === "待核交" || s.status === "待站长确认").length,
      closed: list.filter((s) => s.status === "已结班").length,
      bagTotal: list.reduce((acc, s) => acc + s.bags.length, 0)
    };
  });

  /** 统一执行，规则错误返回 false 并写入 lastError */
  function run(action: () => Shift): Shift | null {
    try {
      lastError.value = "";
      return action();
    } catch (err) {
      lastError.value = err instanceof ShiftRuleError ? err.message : "操作失败";
      return null;
    }
  }

  function select(id: string) {
    selectedId.value = id;
    lastError.value = "";
  }

  function addShift(input: { businessDate: string; kind: ShiftKind; manager: string }) {
    const shift = createShift(input);
    db.value = { ...db.value, shifts: [shift, ...db.value.shifts] };
    persist();
    selectedId.value = shift.id;
    lastError.value = "";
    return shift;
  }

  function register(bag: BagDraft, actor: string) {
    if (!selectedId.value) return null;
    return run(() => mutate(selectedId.value, (s) => registerBag(s, bag, actor)));
  }

  function updateBag(bagId: string, bag: BagDraft, actor: string) {
    return run(() => mutate(selectedId.value, (s) => updateBagBeforeHandover(s, bagId, bag, actor)));
  }

  function deleteBag(bagId: string, actor: string) {
    return run(() => mutate(selectedId.value, (s) => removeBag(s, bagId, actor)));
  }

  function doNormalHandover(actor: string) {
    return run(() => mutate(selectedId.value, (s) => handoverNormal(s, actor)));
  }

  function doPendingHandover(actor: string) {
    return run(() => mutate(selectedId.value, (s) => handoverPending(s, actor)));
  }

  function doResolve(actor: string) {
    return run(() => mutate(selectedId.value, (s) => resolveAndHandover(s, actor)));
  }

  function saveCount(bagId: string, entry: OpenEntry) {
    return run(() => mutate(selectedId.value, (s) => saveOpenEntry(s, bagId, entry)));
  }

  function submitConfirm(actor: string) {
    return run(() => mutate(selectedId.value, (s) => submitForConfirm(s, actor)));
  }

  function confirm(manager: string, note: string) {
    return run(() => mutate(selectedId.value, (s) => confirmByManager(s, manager, note)));
  }

  function reopen(actor: string, reason: string) {
    return run(() => mutate(selectedId.value, (s) => reopenShift(s, actor, reason)));
  }

  function revise(bagId: string, patch: ConfirmedRevision, actor: string, reason: string) {
    return run(() => mutate(selectedId.value, (s) => reviseAfterConfirm(s, bagId, patch, actor, reason)));
  }

  function blockingIssues(shift: Shift) {
    return shiftBlockingIssues(shift);
  }

  function reset() {
    db.value = resetDatabase();
    selectedId.value = db.value.shifts[0]?.id ?? "";
    lastError.value = "";
  }

  return {
    shifts,
    stats,
    selectedShift,
    selectedId,
    lastError,
    select,
    addShift,
    register,
    updateBag,
    deleteBag,
    doNormalHandover,
    doPendingHandover,
    doResolve,
    saveCount,
    submitConfirm,
    confirm,
    reopen,
    revise,
    blockingIssues,
    reset
  };
}
