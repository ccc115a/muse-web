// Church 編碼 library：名字 -> 原始碼（皆為核心 lambda 語法）
export const CHURCH_SRC = {
  // --- Booleans ---
  TRUE: 'λt. λf. t',
  FALSE: 'λt. λf. f',
  AND: 'λp. λq. p q p',
  OR: 'λp. λq. p p q',
  NOT: 'λp. p FALSE TRUE',
  IF: 'λc. λa. λb. c a b',
  // --- Numerals ---
  ZERO: 'λf. λx. x',
  SUCC: 'λn. λf. λx. f (n f x)',
  PLUS: 'λm. λn. λf. λx. m f (n f x)',
  MULT: 'λm. λn. λf. m (n f)',
  EXP: 'λm. λn. n m',
  ISZERO: 'λn. n (λx. FALSE) TRUE',
  // PRED 用 pair 法（Church 經典技巧）
  PAIR: 'λx. λy. λs. s x y',
  FST: 'λp. p TRUE',
  SND: 'λp. p FALSE',
  PRED: 'λn. FST (n (λp. PAIR (SND p) (SUCC (SND p))) (PAIR ZERO ZERO))',
  SUB: 'λm. λn. n PRED m',
  LEQ: 'λm. λn. ISZERO (SUB m n)',
  EQ: 'λm. λn. AND (LEQ m n) (LEQ n m)',
  // --- Lists ---
  NIL: 'λc. λn. n',
  CONS: 'λh. λt. λc. λn. c h (t c n)',
  HEAD: 'λl. l (λh. λt. h) FALSE',
  TAIL: 'λl. FST (l (λx. λp. PAIR (SND p) (CONS x (SND p))) (PAIR NIL NIL))',
  ISNIL: 'λl. l (λh. λt. FALSE) TRUE',
  // --- Combinators ---
  I: 'λx. x',
  K: 'λx. λy. x',
  S: 'λx. λy. λz. x z (y z)',
  B: 'λf. λg. λx. f (g x)',
  C: 'λf. λx. λy. f y x',
  OMEGA: '(λx. x x) (λx. x x)',
  Y: 'λf. (λx. f (x x)) (λx. f (x x))',
  // --- Recursion（用 Y 定義） ---
  FACT: 'Y (λf. λn. IF (ISZERO n) 1 (MULT n (f (PRED n))))',
  FIB: 'Y (λf. λn. IF (ISZERO n) 0 (IF (ISZERO (PRED n)) 1 (PLUS (f (PRED n)) (f (PRED (PRED n))))))',
};

export const CHURCH_GROUPS = [
  { group: '布林邏輯', names: ['TRUE', 'FALSE', 'AND', 'OR', 'NOT', 'IF'] },
  { group: '數字與算術', names: ['ZERO', 'SUCC', 'PLUS', 'MULT', 'EXP', 'ISZERO', 'PRED', 'SUB', 'LEQ', 'EQ'] },
  { group: 'Pair / List', names: ['PAIR', 'FST', 'SND', 'NIL', 'CONS', 'HEAD', 'TAIL', 'ISNIL'] },
  { group: '組合子', names: ['I', 'K', 'S', 'B', 'C', 'OMEGA', 'Y'] },
  { group: '遞迴', names: ['FACT', 'FIB'] },
];

/** 嘗試把 normal form 解讀回數字 / 布林，失敗回 null。
 *  注意 Church 編碼中 FALSE ≡ ZERO（同為 λt.λf.f）、TRUE ≡ 1，
 *  此時兩種解讀都成立，會一併標示。 */
export function tryDecode(node) {
  const n = decodeNumeral(node);
  const b = decodeBoolean(node);
  if (n !== null && b !== null) {
    return { kind: 'boolnum', value: n, text: `解讀為 Church 數字 ${n}，同時也是 ${b ? 'TRUE' : 'FALSE'}（兩者在 Church 編碼中是同一項）` };
  }
  if (n !== null) return { kind: 'number', value: n, text: `解讀為 Church 數字 ${n}` };
  if (b !== null) return { kind: 'boolean', value: b, text: `解讀為 ${b ? 'TRUE' : 'FALSE'}` };
  return null;
}

function decodeNumeral(node) {
  // λf.λx. f^n(x)
  if (node.type !== 'Abs') return null;
  const f = node.param;
  const inner = node.body;
  if (!inner || inner.type !== 'Abs') return null;
  const x = inner.param;
  let cur = inner.body;
  let count = 0;
  while (cur.type === 'App' && cur.fn.type === 'Var' && cur.fn.name === f) {
    count++;
    cur = cur.arg;
    if (count > 10000) return null;
  }
  if (cur.type === 'Var' && cur.name === x) return count;
  return null;
}

function decodeBoolean(node) {
  // λt.λf. t | λt.λf. f
  if (node.type !== 'Abs') return null;
  const inner = node.body;
  if (!inner || inner.type !== 'Abs') return null;
  const b = inner.body;
  if (b.type === 'Var' && b.name === node.param) return true;
  if (b.type === 'Var' && b.name === inner.param) return false;
  return null;
}
