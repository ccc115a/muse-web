#!/bin/bash
set -x

npm test

npm run build --workspace=@md-gh/web

npm run test:e2e --workspace=@md-gh/web

ls -la apps/web/dist/index.html extensions/vscode-md-gh/md-gh.vsix || true
