import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleExpr } from '../src/lambda/parser.js';
import { pretty } from '../src/lambda/pretty.js';
import { reduceTrace, expandDefs } from '../src/lambda/reducer.js';
import { CHURCH_SRC, CHURCH_GROUPS, tryDecode } from '../src/lambda/church.js';

function churchLib() {
  const m = new Map();
  for (const [k, src] of Object.entries(CHURCH_SRC)) m.set(k, parseSingleExpr(src));
  return m;
}

test('library 全部可解析', () => {
  for (const [k, src] of Object.entries(CHURCH_SRC)) {
    assert.ok(parseSingleExpr(src), k);
  }
});

test('AND TRUE FALSE → FALSE', () => {
  const lib = churchLib();
  const start = expandDefs(parseSingleExpr('AND TRUE FALSE'), lib);
  const { steps, status } = reduceTrace(start, 100);
  assert.equal(status, 'normal');
  // FALSE ≡ ZERO：解讀可能是 0 或 FALSE，兩者皆正確
  assert.ok([false, 0].includes(tryDecode(steps.at(-1).expr)?.value));
});

test('ISZERO 0 → TRUE，ISZERO 1 → FALSE', () => {
  const lib = churchLib();
  for (const [src, want] of [['ISZERO 0', true], ['ISZERO 1', false]]) {
    const start = expandDefs(parseSingleExpr(src), lib);
    const { steps, status } = reduceTrace(start, 100);
    assert.equal(status, 'normal');
    const v = tryDecode(steps.at(-1).expr)?.value;
    // TRUE ≡ 1、FALSE ≡ 0：兩種解讀皆正確
    assert.ok(want === true ? [true, 1].includes(v) : [false, 0].includes(v), `${src} 得到 ${v}`);
  }
});

test('FACT 3 → 6（步數較多）', () => {
  const lib = churchLib();
  const start = expandDefs(parseSingleExpr('FACT 3'), lib);
  const { steps, status } = reduceTrace(start, 2000);
  assert.equal(status, 'normal');
  assert.equal(tryDecode(steps.at(-1).expr)?.value, 6);
});

test('groups 涵蓋所有定義', () => {
  const all = new Set(CHURCH_GROUPS.flatMap((g) => g.names));
  for (const k of Object.keys(CHURCH_SRC)) assert.ok(all.has(k), k);
});

test('pretty：Church 5 來回', () => {
  assert.equal(pretty(parseSingleExpr('5')), 'λf x. f (f (f (f (f x))))');
});
