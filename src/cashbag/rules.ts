// 现金袋拆箱移交 —— 核对规则层：纯函数，不依赖存储与界面。

import type {
  BagIssueCode,
  CashBag,
  Responsibility,
  Shift
} from "./types";

export interface BagDraft {
  bagNo: string;
  sealNo: string;
  sealedAmount: number | null;
  sealedBy: string;
  handoverNote: string;
  sealBrokenAtHandover: boolean;
}

export interface BagIssue {
  code: BagIssueCode;
  bagId?: string;
  message: string;
}

/** 仅校验单个现金袋自身的登记完整性（跨袋的重复由 shift 级校验） */
export function validateBagDraft(draft: BagDraft): BagIssue[] {
  const issues: BagIssue[] = [];
  if (!draft.bagNo.trim()) {
    issues.push({ code: "资料不全", message: "袋号未填写" });
  }
  if (!draft.sealNo.trim()) {
    issues.push({ code: "资料不全", message: "封签号未填写" });
  }
  if (!draft.sealedBy.trim()) {
    issues.push({ code: "资料不全", message: "签字人未填写" });
  }
  if (draft.sealedAmount === null || !Number.isFinite(draft.sealedAmount) || draft.sealedAmount < 0) {
    issues.push({ code: "金额缺失", message: "封存金额缺失或无效" });
  }
  if (draft.sealBrokenAtHandover) {
    issues.push({ code: "封签破损", message: "交班时封签已破损" });
  }
  return issues;
}

/** 班次级校验：逐袋检查 + 袋号重复；返回全部问题 */
export function validateShiftBags(
  bags: CashBag[],
  draft?: BagDraft & { id?: string }
): BagIssue[] {
  const issues: BagIssue[] = [];
  const seen = new Map<string, string>();

  for (const bag of bags) {
    if (bag.sealedAmount === null) {
      issues.push({ code: "金额缺失", bagId: bag.id, message: `袋 ${bag.bagNo || "?"}：封存金额缺失` });
    }
    if (bag.sealBrokenAtHandover) {
      issues.push({ code: "封签破损", bagId: bag.id, message: `袋 ${bag.bagNo}：封签破损` });
    }
    if (!bag.bagNo.trim() || !bag.sealNo.trim() || !bag.sealedBy.trim()) {
      issues.push({ code: "资料不全", bagId: bag.id, message: `袋 ${bag.bagNo || "?"}：袋号/封签/签字人不全` });
    }
    const key = bag.bagNo.trim();
    if (key) {
      if (seen.has(key)) {
        issues.push({ code: "袋号重复", bagId: bag.id, message: `袋号 ${key} 重复登记` });
      } else {
        seen.set(key, bag.id);
      }
    }
  }

  if (draft) {
    // 编辑场景：草稿不与自身比
    const key = draft.bagNo.trim();
    if (key && seen.has(key) && seen.get(key) !== draft.id) {
      issues.push({ code: "袋号重复", message: `袋号 ${key} 与已登记现金袋重复` });
    }
  }

  return issues;
}

/** 是否存在阻止结束班次的硬异常 */
export function hasBlockingIssue(issues: BagIssue[]): boolean {
  return issues.length > 0;
}

/** 拆箱差异计算：实点 + 假币 vs 封存 */
export function calcDifference(bag: Pick<CashBag, "countedAmount" | "counterfeitAmount" | "sealedAmount">): number | null {
  if (
    bag.countedAmount === null ||
    bag.counterfeitAmount === null ||
    bag.sealedAmount === null
  ) {
    return null;
  }
  return round2(bag.countedAmount + bag.counterfeitAmount - bag.sealedAmount);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface OpenCheckResult {
  /** 是否存在长款/短款/假币，需要走责任与站长确认 */
  hasVariance: boolean;
  problem: CashBag["problem"];
  missing: string[];
}

/** 拆箱录入核对：有差异时责任与情况说明必填 */
export function checkOpenEntry(bag: CashBag): OpenCheckResult {
  const missing: string[] = [];
  if (bag.countedAmount === null || !Number.isFinite(bag.countedAmount) || bag.countedAmount < 0) {
    missing.push("实点金额");
  }
  if (bag.counterfeitAmount === null || bag.counterfeitAmount < 0) {
    missing.push("假币金额");
  }
  if (bag.counterfeitCount === null || bag.counterfeitCount < 0) {
    missing.push("假币张数");
  }
  if (!bag.openedBy.trim()) missing.push("拆箱人");

  const diff = calcDifference(bag);
  const fake = (bag.counterfeitAmount ?? 0) > 0 || (bag.counterfeitCount ?? 0) > 0;
  let problem: CashBag["problem"] = "正常";
  if (diff !== null && diff > 0) problem = "长款";
  if (diff !== null && diff < 0) problem = "短款";
  if (fake) problem = "假币"; // 假币优先展示

  const hasVariance = (diff !== null && diff !== 0) || fake;
  if (hasVariance) {
    if (!bag.responsibility) missing.push("差异责任");
    if (!bag.differenceDesc.trim()) missing.push("情况说明");
  }
  return { hasVariance, problem, missing };
}

/** 整班是否允许站长确认（结班）：所有袋已拆箱，且差异袋资料齐全 */
export function readyToConfirm(shift: Shift): { ok: boolean; reason: string } {
  if (shift.bags.length === 0) return { ok: false, reason: "本班次没有现金袋" };
  for (const bag of shift.bags) {
    if (!bag.opened) return { ok: false, reason: `袋 ${bag.bagNo} 尚未拆箱录入实点` };
    const check = checkOpenEntry(bag);
    if (check.missing.length > 0) {
      return { ok: false, reason: `袋 ${bag.bagNo}：缺少 ${check.missing.join("、")}` };
    }
  }
  // 交班时存在硬异常的，仍须先转为正常移交或维持待核交记录；这里不阻止确认，
  // 因为异常已由接班拆箱结果与站长确认闭环。
  return { ok: true, reason: "" };
}

export function responsibilityLabel(r: Responsibility): string {
  return r || "未划分";
}

export function formatMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `¥${round2(n).toFixed(2)}`;
}
