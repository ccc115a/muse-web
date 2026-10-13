-- 02_adt.ml : list / tree 遞迴 + pattern match
-- 執行: node mlc.js ml/02_adt.ml && node fpvm.js ml/02_adt.fbc

datatype tree = Leaf | Node of tree * int * tree;

letrec size t = match t with Leaf -> 0 | Node l v r -> size l + 1 + size r;
letrec sum t = match t with Leaf -> 0 | Node l v r -> sum l + v + sum r;
letrec depth t = match t with
  Leaf -> 0
| Node l v r -> 1 + (if depth l > depth r then depth l else depth r);

let t = Node (Node Leaf 3 Leaf) 5 (Node Leaf 7 Leaf);
display (size t); newline ();
display (sum t); newline ();
display (depth t); newline ();

-- 原生 list: :: 與 match
letrec length xs = match xs with [] -> 0 | h :: t -> 1 + length t;
letrec map f xs = match xs with [] -> [] | h :: t -> f h :: map f t;
display (length [1, 2, 3, 4]); newline ();
display (map (fun x -> x * 2) [1, 2, 3]); newline ();

-- tuple pattern
let swap p = match p with (a, b) -> (b, a);
display (swap (1, 2)); newline ()
