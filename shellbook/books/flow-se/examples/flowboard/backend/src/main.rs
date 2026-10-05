mod tasks;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tasks::{Store, Task};

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".into());
    let data_file = std::env::var("DATA_FILE").unwrap_or_else(|_| "data/tasks.json".into());
    let frontend_dir = std::env::var("FRONTEND_DIR").unwrap_or_else(|_| "dist".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).expect("bind 失敗");
    println!("flowboard listening on {addr}");
    let store = Arc::new(Mutex::new(Store::new(data_file.as_ref())));
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let store = store.clone();
        let frontend_dir = frontend_dir.clone();
        std::thread::spawn(move || handle(stream, store, &frontend_dir));
    }
}

struct Request {
    method: String,
    path: String,
    body: String,
}

fn read_request(stream: &mut std::net::TcpStream) -> Option<Request> {
    let mut buf = vec![0u8; 65536];
    let mut total = 0;
    // 先讀到 header 結束
    let header_end = loop {
        let n = stream.read(&mut buf[total..]).ok()?;
        if n == 0 {
            return None;
        }
        total += n;
        if let Some(pos) = find(&buf[..total], b"\r\n\r\n") {
            break pos + 4;
        }
        if total >= buf.len() {
            return None;
        }
    };
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = header.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let content_length = lines
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            (k.trim().eq_ignore_ascii_case("content-length")).then(|| v.trim().parse().unwrap_or(0))
        })
        .next()
        .unwrap_or(0);
    while total < header_end + content_length {
        let n = stream.read(&mut buf[total..]).ok()?;
        if n == 0 {
            break;
        }
        total += n;
    }
    let body = String::from_utf8_lossy(&buf[header_end..total.min(header_end + content_length)]).to_string();
    Some(Request { method, path, body })
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn handle(mut stream: std::net::TcpStream, store: Arc<Mutex<Store>>, frontend_dir: &str) {
    let Some(req) = read_request(&mut stream) else {
        return;
    };
    let resp = route(&req, store, frontend_dir);
    let _ = stream.write_all(resp.as_bytes());
}

fn route(req: &Request, store: Arc<Mutex<Store>>, frontend_dir: &str) -> String {
    let m = req.method.as_str();
    let p = req.path.as_str();
    match (m, p) {
        ("GET", "/api/health") => json(200, r#"{"status":"ok"}"#),
        ("GET", "/api/tasks") => {
            let s = store.lock().unwrap();
            json(200, &tasks::to_json(s.all()))
        }
        ("POST", "/api/tasks") => match tasks::field_title(&req.body) {
            Some(title) if !title.trim().is_empty() => {
                let task: Task = store.lock().unwrap().add(title);
                json(201, &format!("{{\"id\":{},\"title\":\"{}\",\"done\":false}}", task.id, tasks::escape(&task.title)))
            }
            _ => json(400, r#"{"error":"title 必填"}"#),
        },
        ("PATCH", p) if p.starts_with("/api/tasks/") => {
            let id: Option<u64> = p["/api/tasks/".len()..].parse().ok();
            let done = req.body.contains("true");
            match id.and_then(|id| store.lock().unwrap().set_done(id, done)) {
                Some(t) => json(200, &format!("{{\"id\":{},\"title\":\"{}\",\"done\":{}}}", t.id, tasks::escape(&t.title), t.done)),
                None => json(404, r#"{"error":"找不到任務"}"#),
            }
        }
        ("DELETE", p) if p.starts_with("/api/tasks/") => {
            let id: Option<u64> = p["/api/tasks/".len()..].parse().ok();
            match id.map(|id| store.lock().unwrap().remove(id)) {
                Some(true) => status(204, ""),
                _ => json(404, r#"{"error":"找不到任務"}"#),
            }
        }
        ("GET", path) if !path.starts_with("/api") => serve_static(path, frontend_dir),
        _ => json(404, r#"{"error":"not found"}"#),
    }
}

fn status(code: u16, body: &str) -> String {
    let text = match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    format!("HTTP/1.1 {code} {text}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
}

fn json(code: u16, body: &str) -> String {
    let head = status(code, body);
    head.replacen("\r\n", "\r\nContent-Type: application/json\r\n", 1)
}

fn serve_static(path: &str, dir: &str) -> String {
    let file = match path {
        "/" | "/index.html" => "index.html",
        "/app.js" => "app.js",
        "/style.css" => "style.css",
        _ => return status(404, "not found"),
    };
    let ctype = match file {
        f if f.ends_with(".html") => "text/html; charset=utf-8",
        f if f.ends_with(".js") => "text/javascript; charset=utf-8",
        _ => "text/css; charset=utf-8",
    };
    match std::fs::read(format!("{dir}/{file}")) {
        Ok(bytes) => {
            let mut head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .into_bytes();
            head.extend_from_slice(&bytes);
            String::from_utf8_lossy(&head).into_owned()
        }
        Err(_) => status(404, "frontend dist 尚未建置，請先到 frontend 執行 npm run build"),
    }
}
