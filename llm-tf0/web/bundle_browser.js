// web/bundle_browser.js
const fs = require('fs');
const path = require('path');

const pretrainText = fs.readFileSync(path.join(__dirname, '../corpus/pretrain.txt'), 'utf8');
const finetuneText = fs.readFileSync(path.join(__dirname, '../corpus/finetune.txt'), 'utf8');

const bundleData = {
  pretrainText: pretrainText.slice(0, 5000), // 取前 5000 字作為展示用語料
  finetuneText: finetuneText.slice(0, 3000)
};

fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public/corpus.json'), JSON.stringify(bundleData));
console.log('成功建立瀏覽器專用語料 json 檔');
