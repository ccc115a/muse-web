#!/bin/sh
for f in lisp/*.lisp; do
  echo "=== $f ==="
  node lispc.js "$f" 2>/dev/null && node fpvm.js "${f%.lisp}.fbc"
done
