// Capture-avoiding substitution + normal-order 單步 β-reduction + trace
import { Var, Abs, App, clone, freeVarsSet, allNames, freshVar } from './ast.js';
import { pretty } from './pretty.js';

/**
 * subst(body, x, val)：把 body 中自由的 x 換成 val（capture-avoiding）。
 * 回傳 { node, alphas: string[] }，alphas 記錄發生的 α-renaming。
 */
export function subst(body, x, val) {
  const alphas = [];
  const node = go(body);
  return { node, alphas };

  function go(n) {
    if (n.type === 'Var') return n.name === x ? clone(val) : Var(n.name);
    if (n.type === 'App') return App(go(n.fn), go(n.arg));
    // Abs
    if (n.param === x) return Abs(n.param, n.body); // 被遮蔽，不代入（clone 語義等價於原樣）
    const fvVal = freeVarsSet(val);
    if (fvVal.has(n.param)) {
      // 會被捕獲 → α-rename bound var
      const used = new Set([...allNames(n.body), ...allNames(val), ...fvVal, x]);
      const y = freshVar(used, n.param);
      alphas.push(`${n.param} → ${y}（避免 ${y} 被 ${pretty(val)} 捕獲）`);
      const renamedBody = renameBound(n.body, n.param, y);
      return Abs(y, go(renamedBody));
    }
    return Abs(n.param, go(n.body));
  }
}

/** 只 rename 由該 Abs 綁定的變數（遇到同名遮蔽則停） */
function renameBound(node, oldName, newName) {
  if (node.type === 'Var') return Var(node.name === oldName ? newName : node.name);
  if (node.type === 'App') return App(renameBound(node.fn, oldName, newName), renameBound(node.arg, oldName, newName));
  if (node.param === oldName) {
    // 內層同名 Abs：它的 body 屬於內層綁定，不動
    return Abs(node.param, node.body);
  }
  return Abs(node.param, renameBound(node.body, oldName, newName));
}

/**
 * Normal-order 單步：最左最外 redex。
 * 回傳 null（已是 normal form）或 { next, path, paramName, argText, funcText, alphas }。
 * path：redex 在原 expr 的位置（[] = 頂層），供 UI 高亮。
 */
export function stepOnce(node, path = []) {
  if (node.type === 'App' && node.fn.type === 'Abs') {
    const { node: body2, alphas } = subst(node.fn.body, node.fn.param, node.arg);
    return {
      next: body2,
      path: [...path],
      paramName: node.fn.param,
      argText: pretty(node.arg),
      funcText: pretty(node.fn),
      alphas
    };
  }
  if (node.type === 'App') {
    const l = stepOnce(node.fn, [...path, 'fn']);
    if (l) return { ...l, next: App(l.next, node.arg) };
    const r = stepOnce(node.arg, [...path, 'arg']);
    if (r) return { ...r, next: App(node.fn, r.next) };
    return null;
  }
  if (node.type === 'Abs') {
    const b = stepOnce(node.body, [...path, 'body']);
    if (b) return { ...b, next: Abs(node.param, b.next) };
    return null;
  }
  return null; // Var
}

export function isNormalForm(node) {
  return stepOnce(clone(node)) === null;
}

/**
 * 完整 trace：steps[0] 是起始式。
 * 每步 { expr, path(被化簡的 redex 在上一步的位置), label, alphas }。
 * status: 'normal' | 'limit' | 'loop'
 */
export function reduceTrace(start, maxSteps = 200) {
  const steps = [{ expr: clone(start), path: null, label: '起始式', alphas: [] }];
  const seen = new Set([pretty(start)]);
  let cur = clone(start);
  for (let i = 0; i < maxSteps; i++) {
    const s = stepOnce(cur);
    if (!s) return { steps, status: 'normal' };
    cur = s.next;
    const key = pretty(cur);
    const label = `β: (λ${s.paramName}. …) ${s.argText} → 代入 ${s.paramName} := ${s.argText}` +
      (s.alphas.length ? ` ＋ α-轉換：${s.alphas.join('；')}` : '');
    steps.push({ expr: clone(cur), path: null, prevPath: s.path, label, alphas: s.alphas });
    if (seen.has(key)) {
      steps.push({ expr: clone(cur), path: null, label: '偵測到循環（疑似發散，如 Ω），停止', alphas: [] });
      return { steps, status: 'loop' };
    }
    seen.add(key);
  }
  return { steps, status: 'limit' };
}

/** 展開 defs：把自由出現的 def 名換成其 AST（遞迴展開，有循環則丟錯） */
export function expandDefs(node, defMap) {
  const go = (n, stack) => {
    if (n.type === 'Var') {
      if (defMap.has(n.name)) {
        if (stack.includes(n.name)) throw new Error(`定義循環引用：${[...stack, n.name].join(' → ')}`);
        return go(clone(defMap.get(n.name)), [...stack, n.name]);
      }
      return Var(n.name);
    }
    if (n.type === 'Abs') {
      // 若 param 撞到 def 名：遮蔽，body 內的同名不展開
      if (defMap.has(n.param)) {
        // 暫時移除該 def
        const m2 = new Map(defMap);
        m2.delete(n.param);
        return Abs(n.param, go(n.body, stack));
      }
      return Abs(n.param, go(n.body, stack));
    }
    return App(go(n.fn, stack), go(n.arg, stack));
  };
  return go(node, []);
}
