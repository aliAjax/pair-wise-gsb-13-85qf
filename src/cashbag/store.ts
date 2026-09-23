/**
 * 现金袋拆箱移交 —— 编排层（Pinia）
 * 组合资料模型、核对规则与保存层；所有状态变更经由此处，重开后从存档恢复，
 * 班次 / 现金袋 / 差异 / 处理通过 id 互相对应。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { loadState, resetState, saveState } from "./repository";
import {
  bagIssues,
  checkBagDraft,
  checkShift,
  computeDifferences,
  isAmountMissing,
  isDispositionComplete,
  round2
} from "./rules";
import type {
  BagDraft,
  CashBag,
  CashBagState,
  CashDifference,
  ChangeLog,
  CorrectDraft,
  DiffKind,
  DispositionDraft,
  OpenDraft,
  Shift
} from "./types";

function uuid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const useCashBagStore = defineStore("cashbag", () => {
  const initial = loadState();
  const shifts = ref<Shift[]>(initial.shifts);
  const bags = ref<CashBag[]>(initial.bags);
  const differences = ref<CashDifference[]>(initial.differences);
  const changeLogs = ref<ChangeLog[]>(initial.changeLogs);

  function persist() {
    saveState({
      shifts: shifts.value,
      bags: bags.value,
      differences: differences.value,
      changeLogs: changeLogs.value
    });
  }

  // ---------- 查询 ----------

  function bagsOf(shiftId: string) {
    return bags.value.filter((bag) => bag.shiftId === shiftId);
  }

  function diffsOf(shiftId: string) {
    return differences.value.filter((diff) => diff.shiftId === shiftId);
  }

  function activeDiffsOf(shiftId: string) {
    return diffsOf(shiftId).filter((diff) => diff.status !== "已作废");
  }

  function logsOf(shiftId: string) {
    return changeLogs.value
      .filter((log) => log.shiftId === shiftId)
      .sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
  }

  function bagIssuesOf(bag: CashBag): string[] {
    return bagIssues(bag, snapshot());
  }

  function check(shiftId: string) {
    const shift = shifts.value.find((item) => item.id === shiftId);
    return shift
      ? checkShift(snapshot(), shift)
      : null;
  }

  /** 供纯函数规则使用的只读快照 */
  function snapshot(): CashBagState {
    return {
      shifts: shifts.value,
      bags: bags.value,
      differences: differences.value,
      changeLogs: changeLogs.value
    };
  }

  const stats = computed(() => {
    const byStage = (stage: Shift["stage"]) =>
      shifts.value.filter((shift) => shift.stage === stage).length;
    return {
      total: shifts.value.length,
      verifying: byStage("待核交"),
      pendingConfirm: shifts.value.filter(
        (shift) => activeDiffsOf(shift.id).some((diff) => diff.status !== "已确认")
      ).length,
      closed: byStage("已结班"),
      bagCount: bags.value.length
    };
  });

  // ---------- 班次 ----------

  /** 开班：交班登记前先建班次 */
  function createShift(input: {
    type: string;
    date: string;
    outOperator: string;
    inOperator?: string;
  }): Shift {
    const shift: Shift = {
      id: uuid("shift"),
      type: input.type,
      date: input.date,
      outOperator: input.outOperator.trim(),
      inOperator: input.inOperator?.trim() ?? "",
      stage: "进行中",
      handedAt: null,
      closedAt: null,
      createdAt: new Date().toISOString()
    };
    shifts.value = [shift, ...shifts.value];
    persist();
    return shift;
  }

  /**
   * 交班登记现金袋。
   * 袋号重复、封签破损、金额缺失属于现场异常：允许登记，但班次只能挂待核交；
   * 其余填写错误（空袋号、缺签字人等）直接拒绝。
   * 返回问题列表（空数组表示登记正常）。
   */
  function registerBag(shiftId: string, draft: BagDraft): { ok: boolean; issues: string[]; error?: string } {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, issues: [], error: "班次不存在" };
    if (shift.stage === "已结班") return { ok: false, issues: [], error: "班次已结班，不能再登记" };

    const others = bags.value.filter(
      (bag) => bag.shiftId === shiftId
    );
    const issues = checkBagDraft(draft, others);
    const fatal = issues.filter(
      (issue) => issue !== "袋号重复" && issue !== "封签破损" && issue !== "金额缺失"
    );
    if (fatal.length > 0) {
      return { ok: false, issues, error: fatal.join("、") };
    }

    const bag: CashBag = {
      id: uuid("bag"),
      shiftId,
      bagNo: draft.bagNo.trim(),
      sealNo: draft.sealNo.trim(),
      sealState: draft.sealState,
      sealedAmount: isAmountMissing(draft.sealedAmount) ? null : round2(draft.sealedAmount as number),
      handedBy: draft.handedBy.trim(),
      registeredAt: new Date().toISOString(),
      stage: "已登记",
      openedBy: null,
      openedAt: null,
      countedAmount: null,
      counterfeitAmount: null
    };
    bags.value.push(bag);

    // 任何环节登记出三类异常，班次立即挂待核交（已结班在上面已拒绝）
    if (issues.length > 0 && shift.stage !== "待核交") {
      shift.stage = "待核交";
    }
    persist();
    return { ok: true, issues };
  }

  /**
   * 待核交期间的登记更正（站长确认前）：
   * 用于消除袋号重复、封签破损、金额缺失等异常，不留改动记录；
   * 更正后若全班异常清空，班次自动回到“进行中”，可正常交接。
   */
  function fixBag(
    bagId: string,
    draft: BagDraft
  ): { ok: boolean; issues: string[]; error?: string } {
    const bag = bags.value.find((item) => item.id === bagId);
    if (!bag) return { ok: false, issues: [], error: "现金袋不存在" };
    const shift = shiftOf(bag.shiftId);
    if (!shift) return { ok: false, issues: [], error: "班次不存在" };
    if (shift.stage === "已结班") return { ok: false, issues: [], error: "班次已结班" };
    if (bag.stage === "已拆箱" || isConfirmedBag(bag)) {
      return { ok: false, issues: [], error: "已拆箱或已确认的现金袋只能走“修正”留痕" };
    }
    const others = bags.value.filter(
      (item) => item.shiftId === bag.shiftId && item.id !== bagId
    );
    const issues = checkBagDraft(draft, others);
    const fatal = issues.filter(
      (issue) => issue !== "袋号重复" && issue !== "封签破损" && issue !== "金额缺失"
    );
    if (fatal.length > 0) return { ok: false, issues, error: fatal.join("、") };

    bag.bagNo = draft.bagNo.trim();
    bag.sealNo = draft.sealNo.trim();
    bag.sealState = draft.sealState;
    bag.sealedAmount = isAmountMissing(draft.sealedAmount)
      ? null
      : round2(draft.sealedAmount as number);
    bag.handedBy = draft.handedBy.trim();

    // 异常全部排除后解除待核交：已交接过的回“已交接”，否则回“进行中”
    if (shift.stage === "待核交") {
      const stillBlocking = bagsOf(shift.id).some(
        (item) => bagIssues(item, snapshot()).length > 0
      );
      if (!stillBlocking) {
        shift.stage = shift.handedAt ? "已交接" : "进行中";
      }
    }
    persist();
    return { ok: true, issues };
  }

  /** 正式交接（交票给接班方）：存在袋级问题时禁止，只能继续待核交 */
  function handOver(shiftId: string, inOperator: string): { ok: boolean; error?: string } {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, error: "班次不存在" };
    const result = check(shiftId);
    if (!result) return { ok: false, error: "核对失败" };
    if (!result.canHandOver) {
      if (!result.hasBags) return { ok: false, error: "尚未登记现金袋，不能交接" };
      return { ok: false, error: "现金袋存在袋号重复、封签破损或金额缺失，只能待核交" };
    }
    shift.inOperator = inOperator.trim() || shift.inOperator;
    shift.stage = "已交接";
    shift.handedAt = new Date().toISOString();
    persist();
    return { ok: true };
  }

  /** 接班拆箱：录入实点金额与假币，按规则生成差异（长/短款、假币可并存） */
  function openBag(
    shiftId: string,
    bagId: string,
    draft: OpenDraft
  ): { ok: boolean; error?: string; diffs?: DiffKind[] } {
    const shift = shifts.value.find((item) => item.id === shiftId);
    const bag = bags.value.find((item) => item.id === bagId);
    if (!shift || !bag) return { ok: false, error: "班次或现金袋不存在" };
    if (shift.stage !== "已交接") return { ok: false, error: "班次尚未交接，不能拆箱" };
    if (bag.stage === "已拆箱") return { ok: false, error: "该现金袋已拆箱" };
    if (bagIssuesOf(bag).length > 0) {
      return { ok: false, error: "该袋仍有袋号/封签/封存金额异常，请先在待核交中处理" };
    }
    if (!draft.openedBy.trim()) return { ok: false, error: "请填写拆箱人" };
    if (!Number.isFinite(draft.countedAmount) || draft.countedAmount < 0) {
      return { ok: false, error: "请录入有效的实点金额" };
    }
    if (!Number.isFinite(draft.counterfeitAmount) || draft.counterfeitAmount < 0) {
      return { ok: false, error: "请录入有效的假币金额" };
    }

    const counted = round2(draft.countedAmount);
    const counterfeit = round2(draft.counterfeitAmount);
    bag.stage = "已拆箱";
    bag.openedBy = draft.openedBy.trim();
    bag.openedAt = new Date().toISOString();
    bag.countedAmount = counted;
    bag.counterfeitAmount = counterfeit;

    const found = computeDifferences(bag.sealedAmount as number, counted, counterfeit);
    for (const item of found) {
      differences.value.push({
        id: uuid("diff"),
        shiftId,
        bagId,
        kind: item.kind,
        amount: item.amount,
        responsibility: null,
        detail: "",
        status: "待确认",
        managerConfirmedBy: null,
        managerConfirmedAt: null,
        createdFromSealed: bag.sealedAmount,
        createdFromCounted: counted
      });
    }
    persist();
    return { ok: true, diffs: found.map((item) => item.kind) };
  }

  /** 保存差异处理（责任 + 情况）；未经站长确认前原班次保持未结 */
  function saveDisposition(
    diffId: string,
    draft: DispositionDraft
  ): { ok: boolean; error?: string } {
    const diff = differences.value.find((item) => item.id === diffId);
    if (!diff) return { ok: false, error: "差异不存在" };
    if (diff.status === "已作废") return { ok: false, error: "该差异记录已作废" };
    if (isConfirmedDiff(diff)) {
      return { ok: false, error: "站长已确认，请使用“修正”功能并填写原因" };
    }
    if (!draft.responsibility) return { ok: false, error: "请选择责任归属" };
    if (!draft.detail.trim()) return { ok: false, error: "请写明差异情况" };
    diff.responsibility = draft.responsibility;
    diff.detail = draft.detail.trim();
    // 状态仍为待确认：处理完整不代表站长已确认
    persist();
    return { ok: true };
  }

  /** 站长确认：确认后该差异只读；原班次仍须全部确认并拆箱后才能结班 */
  function confirmDifference(diffId: string, manager: string): { ok: boolean; error?: string } {
    const diff = differences.value.find((item) => item.id === diffId);
    if (!diff) return { ok: false, error: "差异不存在" };
    if (!isDispositionComplete(diff)) {
      return { ok: false, error: "请先选择责任并写明情况" };
    }
    if (!manager.trim()) return { ok: false, error: "请填写站长姓名" };
    diff.status = "已确认";
    diff.managerConfirmedBy = manager.trim();
    diff.managerConfirmedAt = new Date().toISOString();
    persist();
    return { ok: true };
  }

  /** 结束班次：规则不通过时拒绝（含待核交异常、未拆箱、未确认差异） */
  function closeShift(shiftId: string): { ok: boolean; errors: string[] } {
    const shift = shifts.value.find((item) => item.id === shiftId);
    const result = check(shiftId);
    if (!shift || !result) return { ok: false, errors: ["班次不存在"] };
    if (!result.canClose) return { ok: false, errors: result.closeBlockers };
    shift.stage = "已结班";
    shift.closedAt = new Date().toISOString();
    persist();
    return { ok: true, errors: [] };
  }

  // ---------- 确认后的只读与修正留痕 ----------

  function isConfirmedBag(bag: CashBag): boolean {
    return activeDiffsOf(bag.shiftId).some(
      (diff) => diff.bagId === bag.id && diff.status === "已确认"
    ) || shiftOf(bag.shiftId)?.stage === "已结班";
  }

  function isConfirmedDiff(diff: CashDifference): boolean {
    return diff.status === "已确认";
  }

  function shiftOf(shiftId: string): Shift | undefined {
    return shifts.value.find((item) => item.id === shiftId);
  }

  /**
   * 确认后修正：
   * - 旧值逐条写入改动记录（changeLog），并必须填写原因；
   * - 金额改动导致的旧差异标记“已作废”保留，按新金额重新生成差异与处理；
   * - 已结班次因此回到“已交接”，须重新经站长确认后才能再结班，
   *   即“重开后班次、现金袋、差异与处理仍对应”。
   */
  function correctBag(bagId: string, draft: CorrectDraft): { ok: boolean; error?: string } {
    const bag = bags.value.find((item) => item.id === bagId);
    if (!bag) return { ok: false, error: "现金袋不存在" };
    const shift = shiftOf(bag.shiftId);
    if (!shift) return { ok: false, error: "班次不存在" };
    if (bag.stage !== "已拆箱") return { ok: false, error: "该袋尚未拆箱" };
    if (!isConfirmedBag(bag)) {
      return { ok: false, error: "该袋尚未经站长确认，无需走修正留痕" };
    }
    if (!draft.reason.trim()) return { ok: false, error: "修正必须填写原因" };
    if (!draft.changedBy.trim()) return { ok: false, error: "请填写操作人" };
    if (isAmountMissing(draft.sealedAmount)) return { ok: false, error: "封存金额缺失，只能先待核交" };
    if (!Number.isFinite(draft.countedAmount) || draft.countedAmount < 0) {
      return { ok: false, error: "请录入有效的实点金额" };
    }
    if (!Number.isFinite(draft.counterfeitAmount) || draft.counterfeitAmount < 0) {
      return { ok: false, error: "请录入有效的假币金额" };
    }

    const nowIso = new Date().toISOString();
    const operator = draft.changedBy.trim();
    const reason = draft.reason.trim();
    const newSealed = round2(draft.sealedAmount as number);
    const newCounted = round2(draft.countedAmount);
    const newCounterfeit = round2(draft.counterfeitAmount);

    const oldDiffs = activeDiffsOf(bag.shiftId).filter((diff) => diff.bagId === bagId);
    const amountChanged =
      bag.sealedAmount !== newSealed ||
      bag.countedAmount !== newCounted ||
      bag.counterfeitAmount !== newCounterfeit;

    // 1) 金额字段留痕
    const amountLogs: Array<[string, string, string]> = [
      ["封存金额", fmtAmount(bag.sealedAmount), fmtAmount(newSealed)],
      ["实点金额", fmtAmount(bag.countedAmount), fmtAmount(newCounted)],
      ["假币金额", fmtAmount(bag.counterfeitAmount), fmtAmount(newCounterfeit)]
    ];
    for (const [field, oldValue, newValue] of amountLogs) {
      if (oldValue !== newValue) {
        changeLogs.value.push(makeLog(bag, field, oldValue, newValue, reason, operator, nowIso));
      }
    }

    // 2) 应用新金额
    bag.sealedAmount = newSealed;
    bag.countedAmount = newCounted;
    bag.counterfeitAmount = newCounterfeit;

    // 3) 旧差异：金额变了就作废保留；否则在原记录上更新处理意见并留痕
    if (amountChanged) {
      for (const diff of oldDiffs) diff.status = "已作废";
      const regenerated = computeDifferences(newSealed, newCounted, newCounterfeit);
      for (const item of regenerated) {
        const disposition = draft.dispositions[item.kind];
        differences.value.push({
          id: uuid("diff"),
          shiftId: bag.shiftId,
          bagId,
          kind: item.kind,
          amount: item.amount,
          responsibility: disposition?.responsibility ?? null,
          detail: disposition?.detail?.trim() ?? "",
          status: "待确认",
          managerConfirmedBy: null,
          managerConfirmedAt: null,
          createdFromSealed: newSealed,
          createdFromCounted: newCounted
        });
      }
    } else {
      for (const diff of oldDiffs) {
        const disposition = draft.dispositions[diff.kind];
        if (!disposition) continue;
        if (!disposition.responsibility || !disposition.detail.trim()) {
          return { ok: false, error: `“${diff.kind}”处理须同时选择责任并写明情况` };
        }
        let changed = false;
        if (disposition.responsibility !== diff.responsibility) {
          changeLogs.value.push(
            makeDiffLog(
              bag,
              diff,
              "责任归属",
              diff.responsibility ?? "（未选择）",
              disposition.responsibility,
              reason,
              operator,
              nowIso
            )
          );
          diff.responsibility = disposition.responsibility;
          changed = true;
        }
        const nextDetail = disposition.detail.trim();
        if (nextDetail !== diff.detail) {
          changeLogs.value.push(
            makeDiffLog(
              bag,
              diff,
              "情况说明",
              diff.detail || "（空）",
              nextDetail,
              reason,
              operator,
              nowIso
            )
          );
          diff.detail = nextDetail;
          changed = true;
        }
        // 处理意见改动后需站长重新确认
        if (changed) {
          diff.status = "待确认";
          diff.managerConfirmedBy = null;
          diff.managerConfirmedAt = null;
        }
      }
    }

    // 4) 已结班次重开，直到新差异全部确认后才能再结
    if (shift.stage === "已结班") {
      shift.stage = "已交接";
      shift.closedAt = null;
    }
    persist();
    return { ok: true };
  }

  function makeLog(
    bag: CashBag,
    field: string,
    oldValue: string,
    newValue: string,
    reason: string,
    changedBy: string,
    changedAt: string
  ): ChangeLog {
    return {
      id: uuid("log"),
      shiftId: bag.shiftId,
      bagId: bag.id,
      diffId: null,
      field,
      oldValue,
      newValue,
      reason,
      changedBy,
      changedAt
    };
  }

  function makeDiffLog(
    bag: CashBag,
    diff: CashDifference,
    field: string,
    oldValue: string,
    newValue: string,
    reason: string,
    changedBy: string,
    changedAt: string
  ): ChangeLog {
    return {
      ...makeLog(bag, field, oldValue, newValue, reason, changedBy, changedAt),
      diffId: diff.id
    };
  }

  function fmtAmount(value: number | null): string {
    return value === null ? "（缺失）" : String(value);
  }

  function resetDemo() {
    const seeded = resetState();
    shifts.value = seeded.shifts;
    bags.value = seeded.bags;
    differences.value = seeded.differences;
    changeLogs.value = seeded.changeLogs;
  }

  return {
    // state
    shifts,
    bags,
    differences,
    changeLogs,
    stats,
    // queries
    bagsOf,
    diffsOf,
    activeDiffsOf,
    logsOf,
    bagIssuesOf,
    check,
    // mutations
    createShift,
    registerBag,
    fixBag,
    handOver,
    openBag,
    saveDisposition,
    confirmDifference,
    closeShift,
    correctBag,
    isConfirmedBag,
    isConfirmedDiff,
    resetDemo
  };
});

export type { DiffKind };
