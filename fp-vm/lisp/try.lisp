; try / catch / throw (v1.2)
(display (try (+ 1 2) (catch e "no"))) (newline)          ; 3
(display (try (throw "boom") (catch e e))) (newline)      ; boom
(display (try (car 42) (catch e "caught"))) (newline)     ; caught
(display (try (/ 1 0) (catch e "div0"))) (newline)        ; div0
(display (try nodice (catch e "unbound"))) (newline)      ; unbound
; 巢狀
(display (try (try (throw "inner") (catch e (throw "outer"))) (catch e2 e2))) (newline) ; outer
; 跨函式 unwind
(define (f n) (if (= n 0) (throw "deep") (f (- n 1))))
(display (try (f 1000) (catch e e))) (newline)            ; deep
; try 內尾遞迴 (body 非尾編譯以保 UNTRY，內部迴圈照常 TAILCALL)
(define (sum-loop i acc) (if (= i 0) acc (sum-loop (- i 1) (+ acc i))))
(display (try (sum-loop 1000000 0) (catch e "no"))) (newline)  ; 500000500000
; catch 後處理器堆疊仍平衡
(display (try (throw 1) (catch a (+ a 100)))) (newline)   ; 101
(display "ok") (newline)
