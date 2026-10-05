use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: u64,
    pub title: String,
    pub done: bool,
}

pub struct Store {
    tasks: Vec<Task>,
    next_id: u64,
    path: PathBuf,
}

impl Store {
    pub fn new(path: &Path) -> Self {
        let mut s = Store {
            tasks: Vec::new(),
            next_id: 1,
            path: path.to_path_buf(),
        };
        s.load();
        s
    }

    fn load(&mut self) {
        let Ok(content) = fs::read_to_string(&self.path) else {
            return;
        };
        for task in parse_tasks(&content) {
            self.next_id = self.next_id.max(task.id + 1);
            self.tasks.push(task);
        }
    }

    fn save(&self) {
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = fs::create_dir_all(parent);
            }
        }
        let _ = fs::write(&self.path, to_json(&self.tasks));
    }

    pub fn all(&self) -> &[Task] {
        &self.tasks
    }

    pub fn add(&mut self, title: String) -> Task {
        let task = Task {
            id: self.next_id,
            title,
            done: false,
        };
        self.next_id += 1;
        self.tasks.push(task.clone());
        self.save();
        task
    }

    pub fn set_done(&mut self, id: u64, done: bool) -> Option<Task> {
        let task = self.tasks.iter_mut().find(|t| t.id == id)?;
        task.done = done;
        let task = task.clone();
        self.save();
        Some(task)
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.tasks.len();
        self.tasks.retain(|t| t.id != id);
        let removed = self.tasks.len() != before;
        if removed {
            self.save();
        }
        removed
    }
}

pub fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn to_json(tasks: &[Task]) -> String {
    let items: Vec<String> = tasks
        .iter()
        .map(|t| {
            format!(
                "{{\"id\":{},\"title\":\"{}\",\"done\":{}}}",
                t.id,
                escape(&t.title),
                t.done
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// 解析我們自己產出的 JSON（陣列內物件只有 id/title/done）。
pub fn parse_tasks(s: &str) -> Vec<Task> {
    let s = s.trim();
    if s.len() < 2 || !s.starts_with('[') {
        return Vec::new();
    }
    let inner = &s[1..s.len() - 1];
    split_objects(inner)
        .iter()
        .filter_map(|obj| parse_one(obj))
        .collect()
}

fn split_objects(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut cur = String::new();
    let mut in_str = false;
    let mut esc = false;
    for ch in s.chars() {
        if in_str {
            cur.push(ch);
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                cur.push(ch);
            }
            '{' => {
                depth += 1;
                cur.push(ch);
            }
            '}' => {
                depth -= 1;
                cur.push(ch);
                if depth == 0 {
                    out.push(cur.clone());
                    cur.clear();
                }
            }
            _ => {
                if depth > 0 {
                    cur.push(ch);
                }
            }
        }
    }
    out
}

/// 從 POST body 取出 title（供 main.rs 用）。
pub fn field_title(body: &str) -> Option<String> {
    field_str(body, "\"title\"")
}

fn parse_one(obj: &str) -> Option<Task> {
    let id = field_num(obj, "\"id\"")? as u64;
    let title = field_str(obj, "\"title\"")?;
    let done = field_bool(obj, "\"done\"")?;
    Some(Task { id, title, done })
}

fn field_num(obj: &str, key: &str) -> Option<i64> {
    let v = field_raw(obj, key)?;
    v.trim().parse().ok()
}

fn field_bool(obj: &str, key: &str) -> Option<bool> {
    match field_raw(obj, key)?.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn field_str(obj: &str, key: &str) -> Option<String> {
    let v = field_raw(obj, key)?.trim().to_string();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        Some(unescape(&v[1..v.len() - 1]))
    } else {
        None
    }
}

fn field_raw<'a>(obj: &'a str, key: &str) -> Option<&'a str> {
    let start = obj.find(key)? + key.len();
    let rest = obj[start..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    if rest.starts_with('"') {
        // 字串：找到配對的結束引號
        let bytes = rest.as_bytes();
        let mut i = 1;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => i += 2,
                b'"' => return Some(&rest[..=i]),
                _ => i += 1,
            }
        }
        None
    } else {
        let end = rest.find([',', '}']).unwrap_or(rest.len());
        Some(rest[..end].trim())
    }
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('n') => out.push('\n'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("flowboard-{name}-{}.json", std::process::id()))
    }

    fn clean(p: &Path) {
        let _ = fs::remove_file(p);
    }

    #[test]
    fn add_assigns_incremental_ids() {
        let p = tmp_path("ids");
        let mut s = Store::new(&p);
        let a = s.add("第一項".into());
        let b = s.add("第二項".into());
        assert_eq!((a.id, b.id), (1, 2));
        clean(&p);
    }

    #[test]
    fn set_done_and_remove() {
        let p = tmp_path("done");
        let mut s = Store::new(&p);
        let t = s.add("做完它".into());
        assert!(s.set_done(t.id, true).unwrap().done);
        assert!(s.set_done(999, true).is_none());
        assert!(s.remove(t.id));
        assert!(!s.remove(t.id));
        assert!(s.all().is_empty());
        clean(&p);
    }

    #[test]
    fn state_persists_across_instances() {
        let p = tmp_path("persist");
        let mut s = Store::new(&p);
        s.add("存檔測試 \"引號\" \\ 反斜線".into());
        drop(s);
        let s2 = Store::new(&p);
        assert_eq!(s2.all().len(), 1);
        assert_eq!(s2.all()[0].title, "存檔測試 \"引號\" \\ 反斜線");
        clean(&p);
    }

    #[test]
    fn bad_json_loads_empty() {
        let p = tmp_path("bad");
        fs::write(&p, "這不是 json").unwrap();
        let s = Store::new(&p);
        assert!(s.all().is_empty());
        clean(&p);
    }
}
