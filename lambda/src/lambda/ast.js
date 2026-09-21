// AST 節點：Var / Abs / App（不可變風格：reducer 每次回傳新節點）
export const Var = (name) => ({ type: 'Var', name });
export const Abs = (param, body) => ({ type: 'Abs', param, body });
export const App = (fn, arg) => ({ type: 'App', fn, arg });

export function clone(node) {
  if (node.type === 'Var') return Var(node.name);
  if (node.type === 'Abs') return Abs(node.param, clone(node.body));
  return App(clone(node.fn), clone(node.arg));
}

/** 自由變數集合 */
export function freeVars(node, bound = new Set(), out = new Set()) {
  if (node.type === 'Var') {
    if (!bound.has(node.name)) out.add(node.name);
  } else if (node.type === 'Abs') {
    bound.add(node.param);
    freeVars(node.body, bound, out);
    bound.delete(node.param);
  } else {
    freeVars(node.fn, bound, out);
    freeVars(node.arg, bound, out);
  }
  return out;
}

export function freeVarsSet(node) {
  return freeVars(node, new Set(), new Set());
}

/** 所有變數名（含 bound），用於 fresh 命名 */
export function allNames(node, out = new Set()) {
  if (node.type === 'Var') out.add(node.name);
  else if (node.type === 'Abs') {
    out.add(node.param);
    allNames(node.body, out);
  } else {
    allNames(node.fn, out);
    allNames(node.arg, out);
  }
  return out;
}

export function freshVar(usedSet, base) {
  if (!usedSet.has(base)) return base;
  let i = 1;
  // x -> x' -> x'' ... 之後改用 x1, x2，避免無限撇號
  let cand = `${base}'`;
  while (usedSet.has(cand)) {
    cand = `${base}${i}`;
    i++;
  }
  return cand;
}

/** 結構相等（α-嚴格相等，不是 α-equivalence） */
export function structurallyEqual(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'Var') return a.name === b.name;
  if (a.type === 'Abs') return a.param === b.param && structurallyEqual(a.body, b.body);
  return structurallyEqual(a.fn, b.fn) && structurallyEqual(a.arg, b.arg);
}
