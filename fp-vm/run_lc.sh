#!/bin/sh
for f in lc/*.lc; do
  echo "=== $f ==="
  node lambdac.js "$f" 2>/dev/null && node fpvm.js "${f%.lc}.fbc"
done
