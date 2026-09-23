/**
 * 现金袋拆箱移交 —— 保存层
 * 只负责 localStorage 读写、存档版本与种子数据；不包含核对规则与界面逻辑。
 */
import type { CashBagState } from "./types";

const STORAGE_KEY = "dfwlfront-7-cashbag";
const STORAGE_VERSION = 1;

/** 首次打开时的演示数据，覆盖三种状态：已结班 / 待站长确认 / 待核交 */
export function seedState(): CashBagState {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);

  const shiftClosed: CashBagState["shifts"][number] = {
    id: "seed-shift-1",
    type: "早班",
    date: today,
    outOperator: "王建国",
    inOperator: "李秀兰",
    stage: "已结班",
    handedAt: iso(3 * 3600_000),
    closedAt: iso(2 * 3600_000),
    createdAt: iso(4 * 3600_000)
  };
  const shiftPending: CashBagState["shifts"][number] = {
    id: "seed-shift-2",
    type: "中班",
    date: today,
    outOperator: "李秀兰",
    inOperator: "赵志强",
    stage: "已交接",
    handedAt: iso(3600_000),
    closedAt: null,
    createdAt: iso(2 * 3600_000)
  };
  const shiftVerify: CashBagState["shifts"][number] = {
    id: "seed-shift-3",
    type: "晚班",
    date: today,
    outOperator: "赵志强",
    inOperator: "",
    stage: "待核交",
    handedAt: null,
    closedAt: null,
    createdAt: iso(1800_000)
  };

  return {
    shifts: [shiftClosed, shiftPending, shiftVerify],
    bags: [
      {
        id: "seed-bag-1",
        shiftId: "seed-shift-1",
        bagNo: "CB20260923-01",
        sealNo: "SL-880112",
        sealState: "完好",
        sealedAmount: 8300,
        handedBy: "王建国",
        registeredAt: iso(4 * 3600_000),
        stage: "已拆箱",
        openedBy: "李秀兰",
        openedAt: iso(3 * 3600_000),
        countedAmount: 8300,
        counterfeitAmount: 0
      },
      {
        id: "seed-bag-2",
        shiftId: "seed-shift-2",
        bagNo: "CB20260923-02",
        sealNo: "SL-880145",
        sealState: "完好",
        sealedAmount: 6400,
        handedBy: "李秀兰",
        registeredAt: iso(2 * 3600_000),
        stage: "已拆箱",
        openedBy: "赵志强",
        openedAt: iso(3000_000),
        countedAmount: 6350,
        counterfeitAmount: 0
      },
      {
        id: "seed-bag-3",
        shiftId: "seed-shift-3",
        bagNo: "CB20260923-03",
        sealNo: "SL-880177",
        sealState: "破损",
        sealedAmount: 5200,
        handedBy: "赵志强",
        registeredAt: iso(1800_000),
        stage: "已登记",
        openedBy: null,
        openedAt: null,
        countedAmount: null,
        counterfeitAmount: null
      }
    ],
    differences: [
      {
        id: "seed-diff-1",
        shiftId: "seed-shift-2",
        bagId: "seed-bag-2",
        kind: "短款",
        amount: 50,
        responsibility: "交班方责任",
        detail: "交班清点误差 50 元，已电话核实。",
        status: "待确认",
        managerConfirmedBy: null,
        managerConfirmedAt: null,
        createdFromSealed: 6400,
        createdFromCounted: 6350
      }
    ],
    changeLogs: []
  };
}

/** 读取存档；不存在时返回种子数据，解析失败时回退为空档防止页面崩溃 */
export function loadState(): CashBagState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as Partial<CashBagState> & { version?: number };
    return {
      shifts: parsed.shifts ?? [],
      bags: parsed.bags ?? [],
      differences: parsed.differences ?? [],
      changeLogs: parsed.changeLogs ?? []
    };
  } catch {
    return { shifts: [], bags: [], differences: [], changeLogs: [] };
  }
}

/** 写入存档 */
export function saveState(state: CashBagState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: STORAGE_VERSION, ...state })
  );
}

/** 清除存档并恢复种子数据（界面中的"重置演示数据"使用） */
export function resetState(): CashBagState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}

export { STORAGE_KEY };
