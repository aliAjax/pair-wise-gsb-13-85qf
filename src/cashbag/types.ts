// 现金袋拆箱移交 —— 资料层：只描述数据结构，不做任何校验与存取。

export type ShiftKind = "早班" | "中班" | "晚班";

/** 进行中：交班登记；待核交：异常未解决，不能结束班次；
 *  已移交：接班可拆箱；待站长确认：差异已录入；已结班：只读（重开后可改） */
export type ShiftStatus =
  | "进行中"
  | "待核交"
  | "已移交"
  | "待站长确认"
  | "已结班";

export const SHIFT_STATUS_FLOW: readonly ShiftStatus[] = [
  "进行中",
  "待核交",
  "已移交",
  "待站长确认",
  "已结班"
];

export type Responsibility = "" | "交班方" | "接班方" | "站方承担";

export const RESPONSIBILITIES: readonly Exclude<Responsibility, "">[] = [
  "交班方",
  "接班方",
  "站方承担"
];

export type BagProblem = "正常" | "长款" | "短款" | "假币";

/** 封袋检查时发现的异常（交班环节） */
export type BagIssueCode =
  | "袋号重复"
  | "封签破损"
  | "金额缺失"
  | "资料不全";

export interface CashBag {
  id: string;
  bagNo: string;
  sealNo: string;
  /** 封存金额；null 表示金额缺失 */
  sealedAmount: number | null;
  sealedBy: string;
  handoverNote: string;
  /** 交班时即发现封签破损，只能待核交 */
  sealBrokenAtHandover: boolean;
  createdAt: string;

  // —— 接班拆箱录入 ——
  opened: boolean;
  openedAt: string | null;
  openedBy: string;
  /** 实点金额 */
  countedAmount: number | null;
  /** 假币面额合计 */
  counterfeitAmount: number | null;
  counterfeitCount: number | null;
  difference: number | null;
  problem: BagProblem;
  responsibility: Responsibility;
  differenceDesc: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action:
    | "登记"
    | "移交"
    | "拆箱"
    | "申请确认"
    | "结班"
    | "站长确认"
    | "重开"
    | "改值";
  message: string;
  changes?: Array<{ field: string; from: string; to: string }>;
  reason?: string;
}

export interface Shift {
  id: string;
  businessDate: string;
  kind: ShiftKind;
  manager: string;
  status: ShiftStatus;
  /** 是否已完成过一次站长确认；确认后的改动必须保留旧值与原因 */
  everConfirmed: boolean;
  reopenCount: number;
  createdAt: string;
  handedAt: string | null;
  confirmedAt: string | null;
  bags: CashBag[];
  audit: AuditEntry[];
}

export interface Database {
  version: 1;
  shifts: Shift[];
}
