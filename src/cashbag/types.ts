/**
 * 现金袋拆箱移交 —— 资料模型
 * 只描述数据结构，不含核对规则、存储方式与界面逻辑。
 */

/** 班次阶段：进行中(交班登记) / 待核交(有异常未查清) / 已交接(待站长确认差异) / 已结班 */
export type ShiftStage = "进行中" | "待核交" | "已交接" | "已结班";

/** 现金袋环节：已登记 / 已拆箱 */
export type BagStage = "已登记" | "已拆箱";

/** 封签状态 */
export type SealState = "完好" | "破损";

/** 差异种类 */
export type DiffKind = "长款" | "短款" | "假币";

/** 差异状态：待站长确认 / 已确认 / 已作废（被修正时保留） */
export type DiffStatus = "待确认" | "已确认" | "已作废";

/** 责任归属选项 */
export const RESPONSIBILITY_OPTIONS = [
  "交班方责任",
  "接班方责任",
  "押运责任",
  "站点承担",
  "银行/封包方责任",
  "待核"
] as const;

export type Responsibility = (typeof RESPONSIBILITY_OPTIONS)[number];

/** 登记环节阻断结班的问题 */
export type BagIssue = "袋号重复" | "封签破损" | "金额缺失";

/** 现金袋 */
export interface CashBag {
  id: string;
  shiftId: string;
  /** 袋号（原文保留） */
  bagNo: string;
  /** 封签号 */
  sealNo: string;
  sealState: SealState;
  /** 封存金额（交班登记），未填写时为 null —— 金额缺失只能待核交 */
  sealedAmount: number | null;
  /** 交班签字人 */
  handedBy: string;
  registeredAt: string;
  stage: BagStage;
  /** 接班拆箱人 */
  openedBy: string | null;
  openedAt: string | null;
  /** 实点金额（接班拆箱录入） */
  countedAmount: number | null;
  /** 实点假币金额 */
  counterfeitAmount: number | null;
}

/** 差异处理记录（长款 / 短款 / 假币） */
export interface CashDifference {
  id: string;
  shiftId: string;
  bagId: string;
  kind: DiffKind;
  /** 差异金额（正数，短款也存绝对值） */
  amount: number;
  /** 责任归属，未选择时为 null */
  responsibility: Responsibility | null;
  /** 情况说明 */
  detail: string;
  status: DiffStatus;
  /** 站长确认人 */
  managerConfirmedBy: string | null;
  managerConfirmedAt: string | null;
  /** 生成时对应的实点/封存值，便于留痕 */
  createdFromSealed: number | null;
  createdFromCounted: number | null;
}

/** 班次 */
export interface Shift {
  id: string;
  /** 班次类型：早班 / 中班 / 晚班 */
  type: string;
  date: string;
  /** 交班人 / 接班人 */
  outOperator: string;
  inOperator: string;
  stage: ShiftStage;
  /** 交接（交票）时间 */
  handedAt: string | null;
  /** 结班时间 */
  closedAt: string | null;
  createdAt: string;
}

/** 改动留痕：确认后的只读资料被改动时，保留旧值并记录原因 */
export interface ChangeLog {
  id: string;
  shiftId: string;
  bagId: string | null;
  diffId: string | null;
  /** 被改字段，如 封存金额 / 责任归属 / 情况说明 */
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  changedBy: string;
  changedAt: string;
}

/** 整体存档 */
export interface CashBagState {
  shifts: Shift[];
  bags: CashBag[];
  differences: CashDifference[];
  changeLogs: ChangeLog[];
}

/** 登记袋时的提交数据 */
export interface BagDraft {
  bagNo: string;
  sealNo: string;
  sealState: SealState;
  sealedAmount: number | null;
  handedBy: string;
}

/** 拆箱时录入的实点数据 */
export interface OpenDraft {
  openedBy: string;
  countedAmount: number;
  counterfeitAmount: number;
}

/** 差异处理提交 */
export interface DispositionDraft {
  responsibility: Responsibility;
  detail: string;
}

/** 确认后修正提交（旧值由系统带出，新值与原因由操作人填写） */
export interface CorrectDraft {
  sealedAmount: number | null;
  countedAmount: number;
  counterfeitAmount: number;
  /**
   * 各差异种类的责任与情况。金额改变会重新生成差异（新 id、种类不变），
   * 因此按种类对应，保证班次、现金袋、差异与处理仍挂钩。
   */
  dispositions: Partial<Record<DiffKind, DispositionDraft>>;
  reason: string;
  changedBy: string;
}
