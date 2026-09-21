import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleExpr, parseProgram } from '../src/lambda/parser.js';
import { pretty } from '../src/lambda/pretty.js';
import { stepOnce, reduceTrace, expandDefs } from '../src/lambda/reducer.js';
import { CHURCH_SRC, tryDecode } from '../src/lambda/church.js';

function churchLib() {
  const m = new Map();
  for (const [k, src] of Object.entries(CHURCH_SRC)) m.set(k, parseSingleExpr(src));
  return m;
}

test('基本 β：(λx.x) y → y', () => {
  const e = parseSingleExpr('(λx. x) y');
  const s = stepOnce(e);
  assert.equal(pretty(s.next), 'y');
});

test('capture-avoiding：(λx.λy.x) y 必須 α-rename', () => {
  const e = parseSingleExpr('(λx. λy. x) y');
  const s = stepOnce(e);
  assert.ok(s.alphas.length > 0, '應該發生 α-轉換');
  assert.match(pretty(s.next), /^λy'?\d*\. y$/);
});

test('normal-order 先化簡最左最外', () => {
  const e = parseSingleExpr('(λx. x) ((λy. y) z)');
  const s = stepOnce(e);
  assert.equal(pretty(s.next), '(λy. y) z');
});

test('PLUS 2 3 → 5', () => {
  const lib = churchLib();
  const start = expandDefs(parseSingleExpr('PLUS 2 3'), lib);
  const { steps, status } = reduceTrace(start, 200);
  assert.equal(status, 'normal');
  assert.equal(pretty(steps[steps.length - 1].expr), pretty(parseSingleExpr('5')));
  assert.equal(tryDecode(steps[steps.length - 1].expr)?.value, 5);
});

test('MULT 2 3 → 6', () => {
  const lib = churchLib();
  const start = expandDefs(parseSingleExpr('MULT 2 3'), lib);
  const { steps, status } = reduceTrace(start, 300);
  assert.equal(status, 'normal');
  assert.equal(tryDecode(steps[steps.length - 1].expr)?.value, 6);
});

test('PRED 3 → 2', () => {
  const lib = churchLib();
  const start = expandDefs(parseSingleExpr('PRED 3'), lib);
  const { steps, status } = reduceTrace(start, 500);
  assert.equal(status, 'normal');
  assert.equal(tryDecode(steps[steps.length - 1].expr)?.value, 2);
});

test('OMEGA 發散偵測為 loop', () => {
  const e = parseSingleExpr('(λx. x x) (λx. x x)');
  const { status } = reduceTrace(e, 20);
  assert.equal(status, 'loop');
});

test('expandDefs 循環引用報錯', () => {
  const prog = parseProgram('A = B\nB = A\nA');
  assert.throws(() => expandDefs(prog.mains[0], prog.defs), /循環/);
});
