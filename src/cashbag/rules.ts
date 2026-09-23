/**
 * 现金袋拆箱移交 —— 核对规则
 * 纯函数，不读写存储、不依赖界面；输入资料，输出判定结果。
 */
import type {
  BagDraft,
  CashBag,
  CashDifference,
  CashBagState,
  DiffKind,
  Shift
} from "./types";

/** 袋号规范化：去空白后比较 */
export function normalizeBagNo(value: string): string {
  return value.trim();
}

/** 封存金额是否有效：必须为不小于 0 的数字（null / NaN 视为缺失） */
export function isAmountMissing(amount: number | null): boolean {
  return amount === null || !Number.isFinite(amount) || amount < 0;
}

/**
 * 检查一个登记袋是否存在阻断结班的问题。
 * @param others 同班次内除当前编辑袋之外的已登记袋
 */
export function checkBagDraft(draft: BagDraft, others: CashBag[]): string[] {
  const issues: string[] = [];
  const bagNo = normalizeBagNo(draft.bagNo);
  if (!bagNo) {
    issues.push("袋号未填写");
  } else if (
    others.some((bag) => normalizeBagNo(bag.bagNo) === bagNo)
  ) {
    issues.push("袋号重复");
  }
  if (!draft.sealNo.trim()) issues.push("封签号未填写");
  if (draft.sealState === "破损") issues.push("封签破损");
  if (isAmountMissing(draft.sealedAmount)) issues.push("金额缺失");
  if (!draft.handedBy.trim()) issues.push("签字人未填写");
  return issues;
}

/** 已登记袋是否带问题（用于列表展示与结班判定） */
export function bagIssues(bag: CashBag, state: CashBagState): string[] {
  const issues: string[] = [];
  const bagNo = normalizeBagNo(bag.bagNo);
  const duplicate = state.bags.some(
    (other) =>
      other.id !== bag.id &&
      other.shiftId === bag.shiftId &&
      normalizeBagNo(other.bagNo) === bagNo
  );
  if (duplicate) issues.push("袋号重复");
  if (bag.sealState === "破损") issues.push("封签破损");
  if (isAmountMissing(bag.sealedAmount)) issues.push("金额缺失");
  return issues;
}

/** 差异计算结果 */
export interface DiffResult {
  kind: DiffKind;
  amount: number;
}

/**
 * 拆箱核对：实点 vs 封存，另计假币。
 * - 实点 > 封存：长款
 * - 实点 < 封存：短款
 * - 假币金额 > 0：假币（可与长/短款并存）
 */
export function computeDifferences(
  sealedAmount: number,
  countedAmount: number,
  counterfeitAmount: number
): DiffResult[] {
  const diffs: DiffResult[] = [];
  const delta = round2(countedAmount - sealedAmount);
  if (delta > 0) diffs.push({ kind: "长款", amount: delta });
  if (delta < 0) diffs.push({ kind: "短款", amount: Math.abs(delta) });
  if (counterfeitAmount > 0) {
    diffs.push({ kind: "假币", amount: counterfeitAmount });
  }
  return diffs;
}

/** 单个差异是否已完整处理（选了责任且写明情况） */
export function isDispositionComplete(diff: CashDifference): boolean {
  return diff.responsibility !== null && diff.detail.trim().length > 0;
}

/** 单个差异是否经站长确认 */
export function isConfirmed(diff: CashDifference): boolean {
  return diff.status === "已确认"
    && diff.managerConfirmedBy !== null
    && diff.managerConfirmedBy.trim() !== "";
}

export interface ShiftCheck {
  /** 是否有任意现金袋 */
  hasBags: boolean;
  /** 带阻断问题（袋号重复/封签破损/金额缺失）的袋 */
  blockingBags: Array<{ bag: CashBag; issues: string[] }>;
  /** 是否还有未拆箱的袋 */
  hasUnopened: boolean;
  /** 待处理（缺责任或情况）的差异 */
  pendingDisposition: CashDifference[];
  /** 已处理但未经站长确认的差异 */
  pendingConfirm: CashDifference[];
  /** 是否可以结束班次 */
  canClose: boolean;
  /** 不能结班时的原因 */
  closeBlockers: string[];
  /** 是否存在袋级问题 —— 存在则只能待核交，不能交接 */
  canHandOver: boolean;
}

function activeDiffs(state: CashBagState, shiftId: string): CashDifference[] {
  return state.differences.filter(
    (diff) => diff.shiftId === shiftId && diff.status !== "已作废"
  );
}

/** 对班次做一次完整核对 */
export function checkShift(state: CashBagState, shift: Shift): ShiftCheck {
  const bags = state.bags.filter((bag) => bag.shiftId === shift.id);
  const blockingBags = bags
    .map((bag) => ({ bag, issues: bagIssues(bag, state) }))
    .filter((entry) => entry.issues.length > 0);
  const hasUnopened = bags.some((bag) => bag.stage !== "已拆箱");
  const diffs = activeDiffs(state, shift.id);
  const pendingDisposition = diffs.filter((diff) => !isDispositionComplete(diff));
  const pendingConfirm = diffs.filter(
    (diff) => isDispositionComplete(diff) && !isConfirmed(diff)
  );

  const closeBlockers: string[] = [];
  if (bags.length === 0) closeBlockers.push("尚未登记现金袋");
  if (blockingBags.length > 0) {
    closeBlockers.push("存在袋号重复、封签破损或金额缺失的现金袋，只能待核交");
  }
  if (hasUnopened) closeBlockers.push("仍有现金袋未拆箱实点");
  if (pendingDisposition.length > 0) {
    closeBlockers.push("长款、短款或假币未选择责任或未写明情况");
  }
  if (pendingConfirm.length > 0) {
    closeBlockers.push("差异尚未经站长确认，原班次不能结束");
  }

  return {
    hasBags: bags.length > 0,
    blockingBags,
    hasUnopened,
    pendingDisposition,
    pendingConfirm,
    canClose: closeBlockers.length === 0,
    closeBlockers,
    // 袋级问题未排除前不能正式交接，只能挂待核交
    canHandOver: bags.length > 0 && blockingBags.length === 0
  };
}

/** 金额统一保留两位 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
