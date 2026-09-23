// 临时端到端验证（不进入最终代码）：覆盖待核交、拆箱差异、站长确认、重开改值留痕。
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
} as unknown as Storage;

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log("  ✓", msg); }
  else { fail++; console.error("  ✗", msg); }
}
function throws(fn: () => unknown, msg: string) {
  try { fn(); fail++; console.error("  ✗ 未抛错:", msg); }
  catch { pass++; console.log("  ✓ 抛错:", msg); }
}

const {
  createShift, registerBag, handoverNormal, handoverPending,
  resolveAndHandover, updateBagBeforeHandover, saveOpenEntry,
  submitForConfirm, confirmByManager, reopenShift, reviseAfterConfirm, ShiftRuleError
} = await import("/workspace/src/cashbag/storage.ts");

console.log("1. 正常登记 → 结束班次 → 拆箱账实一致 → 确认结班");
{
  let s = createShift({ businessDate: "2026-09-23", kind: "早班", manager: "周站长" });
  s = registerBag(s, { bagNo: "D1001", sealNo: "F1", sealedAmount: 1000, sealedBy: "李明", handoverNote: "", sealBrokenAtHandover: false }, "李明");
  s = handoverNormal(s, "李明");
  ok(s.status === "已移交", "核对无误可正常结束班次");
  const bag = s.bags[0];
  throws(() => saveOpenEntry(s, bag.id, { countedAmount: 900, counterfeitAmount: 0, counterfeitCount: 0, openedBy: "王芳", responsibility: "", differenceDesc: "" }), "短款未选责任/写情况被拒");
  throws(() => saveOpenEntry(s, bag.id, { countedAmount: null, counterfeitAmount: 0, counterfeitCount: 0, openedBy: "王芳", responsibility: "", differenceDesc: "" }), "未点实点被拒");
  s = saveOpenEntry(s, bag.id, { countedAmount: 1000, counterfeitAmount: 0, counterfeitCount: 0, openedBy: "王芳", responsibility: "", differenceDesc: "" }, );
  s = submitForConfirm(s, "王芳");
  ok(s.status === "待站长确认", "账实一致可提交站长确认");
  throws(() => confirmByManager(s, "", ""), "站长未签字不能确认");
  s = confirmByManager(s, "周站长", "");
  ok(s.status === "已结班" && s.everConfirmed, "站长确认后结班");
}

console.log("2. 袋号重复 / 封签破损 / 金额缺失 → 只能待核交");
{
  let s = createShift({ businessDate: "2026-09-23", kind: "中班", manager: "周站长" });
  s = registerBag(s, { bagNo: "D2001", sealNo: "F1", sealedAmount: 500, sealedBy: "李明", handoverNote: "", sealBrokenAtHandover: false }, "李明");
  s = registerBag(s, { bagNo: "D2001", sealNo: "F2", sealedAmount: 600, sealedBy: "李明", handoverNote: "", sealBrokenAtHandover: false }, "李明");
  throws(() => handoverNormal(s, "李明"), "袋号重复不能结束班次");
  s = handoverPending(s, "李明");
  ok(s.status === "待核交", "重复袋号按待核交移交，班次未结");
  throws(() => resolveAndHandover(s, "李明"), "问题未改完不能正常移交");
  const dup = s.bags[1];
  s = updateBagBeforeHandover(s, dup.id, { bagNo: "D2002", sealNo: "F2", sealedAmount: 600, sealedBy: "李明", handoverNote: "", sealBrokenAtHandover: false }, "李明");
  throws(() => handoverNormal(s, "李明"), "待核交状态不能直接结束（须走核改完成）");
  s = resolveAndHandover(s, "李明");
  ok(s.status === "已移交", "核改袋号后正常移交");

  // 封签破损
  let s2 = createShift({ businessDate: "2026-09-23", kind: "晚班", manager: "周站长" });
  s2 = registerBag(s2, { bagNo: "D3001", sealNo: "F9", sealedAmount: 300, sealedBy: "张三", handoverNote: "", sealBrokenAtHandover: true }, "张三");
  throws(() => handoverNormal(s2, "张三"), "封签破损不能结束班次");
  s2 = handoverPending(s2, "张三");
  ok(s2.status === "待核交", "封签破损只能待核交");

  // 金额缺失
  let s3 = createShift({ businessDate: "2026-09-23", kind: "早班", manager: "周站长" });
  s3 = registerBag(s3, { bagNo: "D4001", sealNo: "F4", sealedAmount: null, sealedBy: "李四", handoverNote: "", sealBrokenAtHandover: false }, "李四");
  throws(() => handoverNormal(s3, "李四"), "金额缺失不能结束班次");
  s3 = handoverPending(s3, "李四");
  ok(s3.status === "待核交", "金额缺失只能待核交");
}

console.log("3. 长款/假币定责 → 确认 → 重开改值保留旧值与原因");
{
  let s = createShift({ businessDate: "2026-09-23", kind: "早班", manager: "周站长" });
  s = registerBag(s, { bagNo: "D5001", sealNo: "F1", sealedAmount: 1000, sealedBy: "李明", handoverNote: "", sealBrokenAtHandover: false }, "李明");
  s = handoverNormal(s, "李明");
  // 长款 50
  s = saveOpenEntry(s, s.bags[0].id, { countedAmount: 1050, counterfeitAmount: 0, counterfeitCount: 0, openedBy: "王芳", responsibility: "交班方", differenceDesc: "清点多出50元，已查监控" });
  ok(s.bags[0].problem === "长款" && s.bags[0].difference === 50, "自动判定长款并计算差额");
  s = submitForConfirm(s, "王芳");
  s = confirmByManager(s, "周站长", "长款归交班方");
  const bagId = s.bags[0].id;
  ok(s.status === "已结班", "结班后只读");
  throws(() => saveOpenEntry(s, bagId, { countedAmount: 1000, counterfeitAmount: 0, counterfeitCount: 0, openedBy: "王芳", responsibility: "", differenceDesc: "" }), "已结班不能直接改");

  // 重开
  throws(() => reopenShift(s, "周站长", ""), "重开必须写原因");
  s = reopenShift(s, "周站长", "监控复核长款实为误点");
  ok(s.status === "待站长确认" && s.reopenCount === 1, "重开后回到待站长确认");
  ok(s.bags[0].difference === 50 && s.bags[0].problem === "长款" && s.bags[0].responsibility === "交班方", "重开后现金袋/差异/处理仍对应");

  throws(() => reviseAfterConfirm(s, bagId, { countedAmount: 1000, responsibility: "接班方", differenceDesc: "误点更正" }, "周站长", ""), "改值缺原因被拒");
  s = reviseAfterConfirm(s, bagId, { countedAmount: 1000, responsibility: "接班方", differenceDesc: "误点更正" }, "周站长", "监控复核为接班误点");
  ok(s.bags[0].difference === 0 && s.bags[0].problem === "正常", "改值后差额重算");
  const last = s.audit[s.audit.length - 1];
  ok(last.action === "改值" && !!last.reason, "审计记录带原因");
  const fields = (last.changes || []).map((c) => c.field);
  ok(fields.includes("countedAmount") && fields.includes("responsibility"), "旧值→新值逐项另存: " + fields.join(","));
  const countChange = last.changes!.find((c) => c.field === "countedAmount")!;
  ok(countChange.from === "¥1050" && countChange.to === "¥1000", `旧值保留: ${countChange.from} → ${countChange.to}`);
}

console.log("4. 假币场景");
{
  let s = createShift({ businessDate: "2026-09-23", kind: "中班", manager: "周站长" });
  s = registerBag(s, { bagNo: "D6001", sealNo: "F1", sealedAmount: 800, sealedBy: "赵六", handoverNote: "", sealBrokenAtHandover: false }, "赵六");
  s = handoverNormal(s, "赵六");
  s = saveOpenEntry(s, s.bags[0].id, { countedAmount: 700, counterfeitAmount: 100, counterfeitCount: 1, openedBy: "孙七", responsibility: "站方承担", differenceDesc: "一张百元假币，已暂扣登记" });
  ok(s.bags[0].problem === "假币" && s.bags[0].difference === 0, "假币优先标记；实点+假币=封存时差额0");
  s = submitForConfirm(s, "孙七");
  s = confirmByManager(s, "周站长", "假币站方承担");
  ok(s.status === "已结班", "假币经站长确认后结班");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
