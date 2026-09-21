import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleExpr, parseProgram } from '../src/lambda/parser.js';
import { pretty } from '../src/lambda/pretty.js';

test('解析 λ 與 \\ 等價', () => {
  assert.equal(pretty(parseSingleExpr('λx. x')), pretty(parseSingleExpr('\\x. x')));
  assert.equal(pretty(parseSingleExpr('lambda x. x')), 'λx. x');
});

test('多參數 λx y. 縮寫', () => {
  assert.equal(pretty(parseSingleExpr('λx y. x')), 'λx y. x');
});

test('application 左結合', () => {
  assert.equal(pretty(parseSingleExpr('a b c')), 'a b c');
});

test('數字糖展開為 Church numeral', () => {
  assert.equal(pretty(parseSingleExpr('2')), 'λf x. f (f x)');
  assert.equal(pretty(parseSingleExpr('0')), 'λf x. x');
});

test('括號與註解', () => {
  assert.equal(pretty(parseSingleExpr('(λx. x) y # comment')), 'λx. x y'.replace('λx. x y', '(λx. x) y'));
});

test('parseProgram 定義與 main', () => {
  const { defs, mains } = parseProgram('ID = λx. x\nID y');
  assert.ok(defs.has('ID'));
  assert.equal(mains.length, 1);
  assert.equal(pretty(mains[0]), 'ID y');
});
