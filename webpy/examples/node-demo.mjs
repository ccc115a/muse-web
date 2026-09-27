import runner from "../pythonRunner.js";

async function main() {
  console.log("初始化 Python 環境...");
  await runner.init({
    stdout: (t) => process.stdout.write("[py] " + t + "\n"),
    stderr: (t) => process.stderr.write("[py-err] " + t + "\n"),
  });

  const code = `
def process_data(items, factor):
    return [x * factor for x in items if x % 2 == 0]

result = process_data(data_list, multiplier)
print(f"運算完成,長度: {len(result)}")
result
`;
  const out = await runner.run(code, {
    data_list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    multiplier: 10,
  });
  console.log("JS 收到:", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
