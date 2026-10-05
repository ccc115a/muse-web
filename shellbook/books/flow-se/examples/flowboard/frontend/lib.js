// 純函式（無 DOM 依賴），可被 node --test 直接測試
export function pendingCount(tasks) {
  return tasks.filter((t) => !t.done).length;
}

export function summaryText(tasks) {
  return `共 ${tasks.length} 項，未完成 ${pendingCount(tasks)} 項`;
}
