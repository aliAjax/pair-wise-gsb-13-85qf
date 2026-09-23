// 现金袋拆箱移交 —— 保存层：localStorage 存取、班次/现金袋的状态操作。
// 所有写操作均返回新数据并追加审计记录，不依赖 Vue 与界面。

import {
  calcDifference,
  checkOpenEntry,
  readyToConfirm,
  round2,
  validateShiftBags,
  type BagDraft
} from "./rules";
import type {
  AuditEntry,
  BagProblem,
  CashBag,
  Database,
  Shift,
  ShiftKind,
  ShiftStatus
} from "./types";

const STORAGE_KEY = "dfwlfront-7-cashbag-v1";

function uid(prefix = ""): string {
  return `${prefix}${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function audit(
  action: AuditEntry["action"],
  actor: string,
  message: string,
  extra?: Pick<AuditEntry, "changes" | "reason">
): AuditEntry {
  return { id: uid("a-"), at: now(), actor: actor || "未署名", action, message, ...extra };
}

function withAudit(shift: Shift, entry: AuditEntry): Shift {
  return { ...shift, audit: [...shift.audit, entry] };
}

// —— 初始化与种子数据 ——

function seedBag(partial: Partial<CashBag> & Pick<CashBag, "bagNo" | "sealNo" | "sealedAmount" | "sealedBy">): CashBag {
  return {
    id: uid("b-"),
    handoverNote: "",
    sealBrokenAtHandover: false,
    opened: false,
    openedAt: null,
    openedBy: "",
    countedAmount: null,
    counterfeitAmount: null,
    counterfeitCount: null,
    difference: null,
    problem: "正常",
    responsibility: "",
    differenceDesc: "",
    createdAt: now(),
    ...partial
  };
}

function seedDatabase(): Database {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const shift: Shift = {
    id: uid("s-"),
    businessDate: dateStr,
    kind: "早班",
    manager: "周站长",
    status: "进行中",
    everConfirmed: false,
    reopenCount: 0,
    createdAt: now(),
    handedAt: null,
    confirmedAt: null,
    bags: [
      seedBag({ bagNo: "D0921", sealNo: "F330101", sealedAmount: 8300, sealedBy: "李明", handoverNote: "早班现金封袋" }),
      seedBag({ bagNo: "D0922", sealNo: "F330102", sealedAmount: 6400, sealedBy: "李明" })
    ],
    audit: [audit("登记", "李明", "新建班次并登记 2 个现金袋（示例数据）")]
  };
  return { version: 1, shifts: [shift] };
}

export function loadDatabase(): Database {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDatabase();
    saveDatabase(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shifts)) {
      return seedDatabase();
    }
    return parsed;
  } catch {
    return seedDatabase();
  }
}

export function saveDatabase(db: Database): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function resetDatabase(): Database {
  const seeded = seedDatabase();
  saveDatabase(seeded);
  return seeded;
}

// —— 班次操作 ——

export class ShiftRuleError extends Error {}

function requireStatus(shift: Shift, allowed: ShiftStatus[]): void {
  if (!allowed.includes(shift.status)) {
    throw new ShiftRuleError(`当前状态「${shift.status}」不允许该操作`);
  }
}

export function createShift(input: {
  businessDate: string;
  kind: ShiftKind;
  manager: string;
}): Shift {
  const shift: Shift = {
    id: uid("s-"),
    businessDate: input.businessDate,
    kind: input.kind,
    manager: input.manager.trim(),
    status: "进行中",
    everConfirmed: false,
    reopenCount: 0,
    createdAt: now(),
    handedAt: null,
    confirmedAt: null,
    bags: [],
    audit: []
  };
  return withAudit(shift, audit("登记", input.manager, `新建${input.kind}班次`));
}

export function registerBag(shift: Shift, draft: BagDraft, actor: string): Shift {
  requireStatus(shift, ["进行中", "待核交"]);
  const bag: CashBag = seedBag({
    bagNo: draft.bagNo.trim(),
    sealNo: draft.sealNo.trim(),
    sealedAmount: draft.sealedAmount === null ? null : round2(draft.sealedAmount),
    sealedBy: draft.sealedBy.trim(),
    handoverNote: draft.handoverNote.trim(),
    sealBrokenAtHandover: draft.sealBrokenAtHandover
  });
  const issues = validateShiftBags([...shift.bags, bag]);
  let next = { ...shift, bags: [...shift.bags, bag] };
  const flags = issues.map((i) => i.message).join("；") || "资料齐全";
  next = withAudit(next, audit("登记", actor, `登记现金袋 ${bag.bagNo}（封存 ¥${bag.sealedAmount ?? "缺失"}），核对：${flags}`));
  return next;
}

export function updateBagBeforeHandover(
  shift: Shift,
  bagId: string,
  draft: BagDraft,
  actor: string
): Shift {
  requireStatus(shift, ["进行中", "待核交"]);
  const old = shift.bags.find((b) => b.id === bagId);
  if (!old) throw new ShiftRuleError("现金袋不存在");
  const updated: CashBag = {
    ...old,
    bagNo: draft.bagNo.trim(),
    sealNo: draft.sealNo.trim(),
    sealedAmount: draft.sealedAmount === null ? null : round2(draft.sealedAmount),
    sealedBy: draft.sealedBy.trim(),
    handoverNote: draft.handoverNote.trim(),
    sealBrokenAtHandover: draft.sealBrokenAtHandover
  };
  const issues = validateShiftBags(shift.bags.map((b) => (b.id === bagId ? updated : b)));
  let next: Shift = { ...shift, bags: shift.bags.map((b) => (b.id === bagId ? updated : b)) };
  next = withAudit(next, audit("登记", actor, `修改现金袋 ${draft.bagNo || "?"} 登记资料，核对：${issues.map((i) => i.message).join("；") || "通过"}`));
  return next;
}

export function removeBag(shift: Shift, bagId: string, actor: string): Shift {
  requireStatus(shift, ["进行中", "待核交"]);
  const bag = shift.bags.find((b) => b.id === bagId);
  let next: Shift = { ...shift, bags: shift.bags.filter((b) => b.id !== bagId) };
  if (bag) next = withAudit(next, audit("登记", actor, `删除现金袋 ${bag.bagNo}`));
  return next;
}

/** 正常结束班次并移交：有任何硬异常一律拒绝 */
export function handoverNormal(shift: Shift, actor: string): Shift {
  requireStatus(shift, ["进行中"]);
  if (shift.bags.length === 0) throw new ShiftRuleError("尚未登记现金袋，不能结束班次");
  const issues = validateShiftBags(shift.bags);
  if (issues.length > 0) {
    throw new ShiftRuleError(`只能待核交：${issues.map((i) => i.message).join("；")}`);
  }
  let next: Shift = { ...shift, status: "已移交", handedAt: now() };
  next = withAudit(next, audit("移交", actor, `结束班次，移交 ${shift.bags.length} 个现金袋`));
  return next;
}

/** 异常只能待核交：班次未结，接班不能拆箱 */
export function handoverPending(shift: Shift, actor: string): Shift {
  requireStatus(shift, ["进行中", "待核交"]);
  if (shift.bags.length === 0) throw new ShiftRuleError("尚未登记现金袋");
  const issues = validateShiftBags(shift.bags);
  if (issues.length === 0) throw new ShiftRuleError("资料核对无误，请直接正常移交");
  let next: Shift = { ...shift, status: "待核交" };
  next = withAudit(next, audit("移交", actor, `按待核交移交：${issues.map((i) => i.message).join("；")}；原班次未结`));
  return next;
}

/** 待核交整改完成后正常移交 */
export function resolveAndHandover(shift: Shift, actor: string): Shift {
  requireStatus(shift, ["待核交"]);
  const issues = validateShiftBags(shift.bags);
  if (issues.length > 0) {
    throw new ShiftRuleError(`仍有未核清问题：${issues.map((i) => i.message).join("；")}`);
  }
  let next: Shift = { ...shift, status: "已移交", handedAt: now() };
  next = withAudit(next, audit("移交", actor, "问题核改完成，现金袋正常移交接班拆箱"));
  return next;
}

export interface OpenEntry {
  countedAmount: number | null;
  counterfeitAmount: number | null;
  counterfeitCount: number | null;
  openedBy: string;
  responsibility: CashBag["responsibility"];
  differenceDesc: string;
}

/** 接班拆箱：录入实点；有长短款/假币时强制责任与情况说明 */
export function saveOpenEntry(shift: Shift, bagId: string, entry: OpenEntry): Shift {
  requireStatus(shift, ["已移交", "待站长确认"]);
  const old = shift.bags.find((b) => b.id === bagId);
  if (!old) throw new ShiftRuleError("现金袋不存在");

  const merged: CashBag = {
    ...old,
    countedAmount: entry.countedAmount === null ? null : round2(entry.countedAmount),
    counterfeitAmount: entry.counterfeitAmount === null ? null : round2(entry.counterfeitAmount),
    counterfeitCount: entry.counterfeitCount,
    openedBy: entry.openedBy.trim(),
    responsibility: entry.responsibility,
    differenceDesc: entry.differenceDesc.trim()
  };
  const check = checkOpenEntry(merged);
  if (check.missing.length > 0) {
    throw new ShiftRuleError(`缺少必填项：${check.missing.join("、")}`);
  }
  merged.difference = calcDifference(merged);
  merged.problem = check.problem;
  merged.opened = true;
  merged.openedAt = old.openedAt ?? now();

  let next: Shift = {
    ...shift,
    // 未确认前修改录入，回到已移交，需重新提交站长确认
    status: shift.everConfirmed ? shift.status : "已移交",
    bags: shift.bags.map((b) => (b.id === bagId ? merged : b))
  };
  const varianceText = check.hasVariance
    ? `存在${check.problem}，差额 ¥${merged.difference ?? 0}，责任：${entry.responsibility}`
    : "账实一致";
  next = withAudit(next, audit("拆箱", entry.openedBy, `拆箱现金袋 ${old.bagNo}，实点 ¥${merged.countedAmount}，假币 ¥${merged.counterfeitAmount ?? 0}，${varianceText}`));
  return next;
}

/** 全部拆箱完成，提交站长确认；原班次仍未结 */
export function submitForConfirm(shift: Shift, actor: string): Shift {
  requireStatus(shift, ["已移交"]);
  const ready = readyToConfirm(shift);
  if (!ready.ok) throw new ShiftRuleError(ready.reason);
  const varianceBags = shift.bags.filter((b) => b.problem !== "正常");
  let next: Shift = { ...shift, status: "待站长确认" };
  next = withAudit(
    next,
    audit(
      "申请确认",
      actor,
      varianceBags.length
        ? `提交站长确认：${varianceBags.map((b) => `${b.bagNo}(${b.problem})`).join("、")}`
        : "全部现金袋账实一致，提交站长确认结班"
    )
  );
  return next;
}

/** 站长确认 → 结班，之后只读 */
export function confirmByManager(shift: Shift, manager: string, note: string): Shift {
  requireStatus(shift, ["待站长确认"]);
  const ready = readyToConfirm(shift);
  if (!ready.ok) throw new ShiftRuleError(ready.reason);
  if (!manager.trim()) throw new ShiftRuleError("需由站长签字确认");
  let next: Shift = {
    ...shift,
    status: "已结班",
    everConfirmed: true,
    confirmedAt: now(),
    manager: manager.trim()
  };
  next = withAudit(next, audit("站长确认", manager, `站长确认结班${note ? `：${note.trim()}` : "，长短款/假币处理已核定"}`));
  return next;
}

/** 重开：班次、现金袋、差异与处理保持对应，仅回到待确认状态 */
export function reopenShift(shift: Shift, actor: string, reason: string): Shift {
  requireStatus(shift, ["已结班"]);
  if (!reason.trim()) throw new ShiftRuleError("重开必须写明原因");
  let next: Shift = {
    ...shift,
    status: "待站长确认",
    reopenCount: shift.reopenCount + 1
  };
  next = withAudit(next, audit("重开", actor, `重开已结班次（第 ${next.reopenCount} 次）`, { reason: reason.trim() }));
  return next;
}

const REVISABLE_FIELDS = [
  "bagNo",
  "sealNo",
  "sealedAmount",
  "sealedBy",
  "countedAmount",
  "counterfeitAmount",
  "counterfeitCount",
  "responsibility",
  "differenceDesc"
] as const;

type RevisableField = (typeof REVISABLE_FIELDS)[number];
export type ConfirmedRevision = Partial<Pick<CashBag, RevisableField>>;

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "空";
  if (field.toLowerCase().includes("amount")) return `¥${value}`;
  return String(value);
}

/** 确认后的改动：旧值与原因另存为审计记录，并重算差异 */
export function reviseAfterConfirm(
  shift: Shift,
  bagId: string,
  patch: ConfirmedRevision,
  actor: string,
  reason: string
): Shift {
  requireStatus(shift, ["待站长确认"]);
  if (!shift.everConfirmed) throw new ShiftRuleError("班次尚未经站长确认，无需走改值留痕");
  if (!reason.trim()) throw new ShiftRuleError("改动确认后的数据必须填写原因");
  const old = shift.bags.find((b) => b.id === bagId);
  if (!old) throw new ShiftRuleError("现金袋不存在");

  const changes: AuditEntry["changes"] = [];
  for (const field of REVISABLE_FIELDS) {
    if (!(field in patch)) continue;
    const from = old[field];
    const to = patch[field];
    if (from !== to) {
      changes.push({ field, from: displayValue(field, from), to: displayValue(field, to) });
    }
  }
  if (changes.length === 0) throw new ShiftRuleError("内容没有变化");

  const updated: CashBag = { ...old, ...patch };
  if (updated.countedAmount !== null) updated.countedAmount = round2(updated.countedAmount);
  if (updated.counterfeitAmount !== null) updated.counterfeitAmount = round2(updated.counterfeitAmount);
  updated.difference = calcDifference(updated);
  const check = checkOpenEntry(updated);
  if (check.missing.length > 0) throw new ShiftRuleError(`改动后缺少必填项：${check.missing.join("、")}`);
  updated.problem = check.problem as BagProblem;

  let next: Shift = { ...shift, bags: shift.bags.map((b) => (b.id === bagId ? updated : b)) };
  next = withAudit(
    next,
    audit("改值", actor, `现金袋 ${old.bagNo} 确认后改动 ${changes.length} 项，旧值与原因已留档`, {
      changes,
      reason: reason.trim()
    })
  );
  return next;
}

export function shiftBlockingIssues(shift: Shift) {
  return validateShiftBags(shift.bags);
}
