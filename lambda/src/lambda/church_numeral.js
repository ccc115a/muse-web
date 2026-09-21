// 避免 parser <-> church 循環依賴：數字糖展開只放這裡
import { Var, Abs, App } from './ast.js';

export function churchNumeral(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`不合法的數字：${n}`);
  let body = Var('x');
  for (let i = 0; i < n; i++) body = App(Var('f'), body);
  return Abs('f', Abs('x', body));
}
