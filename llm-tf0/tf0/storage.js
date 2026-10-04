'use strict';

const fs = require('fs');
const path = require('path');

function saveWeights(varList, filePath) {
  const data = varList.map((v) => ({
    shape: v.shape,
    dtype: v.dtype,
    data: Array.from(v.data)
  }));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
  console.log(`[tf0] 成功儲存 ${varList.length} 個變數權重至: ${filePath}`);
}

function loadWeights(varList, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[tf0] 找不到權重檔案: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.length !== varList.length) {
    throw new Error(`[tf0] 權重數量 mismatch: 檔案內有 ${data.length} 個，但模型提供 ${varList.length} 個`);
  }
  for (let i = 0; i < varList.length; i++) {
    const src = data[i].data;
    const dest = varList[i].data;
    for (let j = 0; j < dest.length; j++) dest[j] = src[j];
  }
  console.log(`[tf0] 成功載入 ${varList.length} 個變數權重自: ${filePath}`);
}

module.exports = {
  saveWeights,
  loadWeights,
  save: saveWeights,
  load: loadWeights
};
