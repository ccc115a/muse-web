/* flowboard 前端：純 vanilla JS，直接呼叫 Rust 後端 API */
const API = "/api/tasks";
const list = document.getElementById("task-list");
const summary = document.getElementById("summary");
const form = document.getElementById("add-form");
const input = document.getElementById("new-title");

async function reload() {
  const res = await fetch(API);
  const tasks = await res.json();
  list.innerHTML = "";
  for (const t of tasks) {
    const li = document.createElement("li");
    if (t.done) li.className = "done";
    li.dataset.id = t.id;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = t.done;
    box.setAttribute("aria-label", `完成 ${t.title}`);
    box.addEventListener("change", async () => {
      await fetch(`${API}/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: box.checked }),
      });
      reload();
    });

    const span = document.createElement("span");
    span.textContent = t.title;

    const del = document.createElement("button");
    del.textContent = "刪除";
    del.setAttribute("aria-label", `刪除 ${t.title}`);
    del.addEventListener("click", async () => {
      await fetch(`${API}/${t.id}`, { method: "DELETE" });
      reload();
    });

    li.append(box, span, del);
    list.appendChild(li);
  }
  const pending = tasks.filter((t) => !t.done).length;
  summary.textContent = `共 ${tasks.length} 項，未完成 ${pending} 項`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  input.value = "";
  reload();
});

reload();
