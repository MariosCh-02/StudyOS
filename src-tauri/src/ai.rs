//! Optional AI providers (OpenAI, Anthropic, Ollama).
//!
//! API keys live in the Windows Credential Manager (via `keyring`), never in
//! the database, settings or sync. Requests are made here rather than from
//! the web view so the key never has to leave Rust after it is saved, and
//! nothing is sent unless the user starts an AI action.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const KEYRING_SERVICE: &str = "StudyOS";
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_PROMPT_CHARS: usize = 400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    OpenAi,
    Anthropic,
    Ollama,
}

impl Provider {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "openai" => Ok(Self::OpenAi),
            "anthropic" => Ok(Self::Anthropic),
            "ollama" => Ok(Self::Ollama),
            _ => Err("Choose an AI provider in Settings first.".into()),
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Ollama => "ollama",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Ollama => "Ollama",
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    provider: String,
    model: String,
    base_url: Option<String>,
    system: String,
    prompt: String,
    max_tokens: u32,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct AiReply {
    text: String,
    /// True when the model stopped because it hit the token limit.
    truncated: bool,
}

// ------------------------------------------------------------------ keys

fn entry(provider: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("ai-{}", provider.id())).map_err(|e| format!("Windows Credential Manager is unavailable: {e}"))
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Paste your API key.".into());
    }
    if key.len() > 512 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That doesn't look like an API key (no spaces, at most 512 characters).".into());
    }
    Ok(())
}

fn read_key(provider: Provider) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the API key from Windows Credential Manager: {e}")),
    }
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    let p = Provider::parse(&provider)?;
    let key = key.trim();
    validate_key(key)?;
    entry(p)?.set_password(key).map_err(|e| format!("Couldn't save the key in Windows Credential Manager: {e}"))
}

#[tauri::command]
pub fn ai_has_key(provider: String) -> Result<bool, String> {
    Ok(read_key(Provider::parse(&provider)?)?.is_some())
}

#[tauri::command]
pub fn ai_delete_key(provider: String) -> Result<(), String> {
    match entry(Provider::parse(&provider)?)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the key: {e}")),
    }
}

// --------------------------------------------------------------- requests

/// True for this computer and private-network hosts (where an Ollama server lives).
fn is_local_host(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if h == "localhost" || h == "::1" || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".home.arpa") {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private() || ip.is_link_local();
    }
    // A single-label name (e.g. "gpu-box") resolves on the local network.
    !h.is_empty() && !h.contains('.') && !h.contains(':') && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The Ollama server address: http(s), this computer or the local network, no
/// credentials, query or fragment. Prevents the AI feature being used to send
/// data to arbitrary internet hosts.
fn ollama_base(base_url: Option<&str>) -> Result<String, String> {
    let url = base_url.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_OLLAMA_URL).trim_end_matches('/').to_string();
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")).ok_or("The Ollama address must start with http:// or https://")?;
    if rest.contains(char::is_whitespace) || rest.contains(['@', '?', '#', '\\']) {
        return Err("The Ollama address can't contain spaces, @, ? or #.".into());
    }
    let authority = rest.split('/').next().unwrap_or_default();
    let host = if authority.starts_with('[') { authority.split(']').next().map(|h| format!("{h}]")).unwrap_or_default() } else { authority.rsplit_once(':').map_or(authority, |(h, _)| h).to_string() };
    if !is_local_host(&host) {
        return Err("The Ollama address must be this computer (localhost) or a computer on your local network.".into());
    }
    Ok(url)
}

/// Reads a response body, refusing more than `limit` bytes.
async fn read_capped(mut res: reqwest::Response, limit: usize) -> Result<String, reqwest::Error> {
    let mut buf = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        if buf.len() + chunk.len() > limit {
            break; // the parser will report an unreadable (truncated) answer
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

struct HttpCall {
    url: String,
    headers: Vec<(&'static str, String)>,
    body: Value,
}

fn build_call(p: Provider, req: &AiRequest, key: Option<&str>) -> Result<HttpCall, String> {
    let model = req.model.trim();
    if model.is_empty() {
        return Err("Choose a model in Settings â†’ AI.".into());
    }
    let max_tokens = req.max_tokens.clamp(16, 16_000);
    let need_key = || key.map(str::to_string).ok_or_else(|| format!("Add your {} API key in Settings â†’ AI.", p.label()));
    Ok(match p {
        Provider::OpenAi => HttpCall {
            url: "https://api.openai.com/v1/chat/completions".into(),
            headers: vec![("authorization", format!("Bearer {}", need_key()?))],
            body: json!({
                "model": model,
                "max_completion_tokens": max_tokens,
                "messages": [
                    { "role": "system", "content": req.system },
                    { "role": "user", "content": req.prompt },
                ],
            }),
        },
        Provider::Anthropic => HttpCall {
            url: "https://api.anthropic.com/v1/messages".into(),
            headers: vec![("x-api-key", need_key()?), ("anthropic-version", ANTHROPIC_VERSION.into())],
            body: json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": req.system,
                "messages": [{ "role": "user", "content": req.prompt }],
            }),
        },
        Provider::Ollama => {
            let headers = vec![];
            HttpCall {
                url: format!("{}/api/chat", ollama_base(req.base_url.as_deref())?),
                headers,
                body: json!({
                    "model": model,
                    "stream": false,
                    "options": { "num_predict": max_tokens },
                    "messages": [
                        { "role": "system", "content": req.system },
                        { "role": "user", "content": req.prompt },
                    ],
                }),
            }
        }
    })
}

fn parse_reply(p: Provider, v: &Value) -> Result<AiReply, String> {
    let (text, truncated) = match p {
        Provider::OpenAi => {
            let choice = &v["choices"][0];
            (choice["message"]["content"].as_str().map(str::to_string), choice["finish_reason"] == "length")
        }
        Provider::Anthropic => {
            let parts: Vec<&str> = v["content"].as_array().map(|a| a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect()).unwrap_or_default();
            (if parts.is_empty() { None } else { Some(parts.join("")) }, v["stop_reason"] == "max_tokens")
        }
        Provider::Ollama => (v["message"]["content"].as_str().map(str::to_string), v["done_reason"] == "length"),
    };
    match text {
        Some(t) if !t.trim().is_empty() => Ok(AiReply { text: t, truncated }),
        _ => Err(format!("{} returned an empty answer. Try again or choose another model.", p.label())),
    }
}

/// A short, user-facing message for a failed HTTP response.
fn http_error(p: Provider, status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().or_else(|| v["error"].as_str()).map(str::to_string))
        .map(|m| m.chars().take(300).collect::<String>());
    let base = match status {
        401 | 403 => format!("{} rejected the API key. Check it in Settings â†’ AI.", p.label()),
        404 => format!("{} doesn't know this model. Pick another one in Settings â†’ AI.", p.label()),
        429 => format!("{} says you've hit a rate limit or your quota. Wait a moment or check your plan.", p.label()),
        500..=599 => format!("{} is having problems right now ({status}). Try again later.", p.label()),
        _ => format!("{} request failed ({status}).", p.label()),
    };
    match detail {
        Some(d) if !d.is_empty() => format!("{base} Details: {d}"),
        _ => base,
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .user_agent("StudyOS")
        .build()
        .map_err(|e| e.to_string())
}

fn network_error(p: Provider, url: &str, e: &reqwest::Error) -> String {
    if p == Provider::Ollama && e.is_connect() {
        return format!("Couldn't reach Ollama at {url}. Is it installed and running (ollama serve)?");
    }
    if e.is_timeout() {
        return format!("{} took too long to answer. Try a shorter selection or a faster model.", p.label());
    }
    format!("Couldn't reach {}. Check your internet connection.", p.label())
}

#[tauri::command]
pub async fn ai_complete(request: AiRequest) -> Result<AiReply, String> {
    let p = Provider::parse(&request.provider)?;
    if request.prompt.len() > MAX_PROMPT_CHARS {
        return Err("The text is too long to send. Select a smaller part.".into());
    }
    let key = read_key(p)?;
    let call = build_call(p, &request, key.as_deref())?;
    let mut rb = client()?.post(&call.url).json(&call.body);
    for (k, v) in &call.headers {
        rb = rb.header(*k, v);
    }
    let res = rb.send().await.map_err(|e| network_error(p, &call.url, &e))?;
    let status = res.status().as_u16();
    let body = read_capped(res, MAX_RESPONSE_BYTES).await.map_err(|e| network_error(p, &call.url, &e))?;
    if !(200..300).contains(&status) {
        return Err(http_error(p, status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| format!("{} sent a response StudyOS couldn't read.", p.label()))?;
    parse_reply(p, &v)
}

/// Largest chat request body (conversation + tool results) the agent may send.
const MAX_CHAT_BODY_BYTES: usize = 2 * 1024 * 1024;

/// Endpoint and auth headers for a provider's chat API (the body is built by the frontend agent).
fn chat_target(p: Provider, base_url: Option<&str>, key: Option<&str>) -> Result<(String, Vec<(&'static str, String)>), String> {
    let need_key = || key.map(str::to_string).ok_or_else(|| format!("Add your {} API key in Settings â†’ AI.", p.label()));
    Ok(match p {
        Provider::OpenAi => ("https://api.openai.com/v1/chat/completions".into(), vec![("authorization", format!("Bearer {}", need_key()?))]),
        Provider::Anthropic => ("https://api.anthropic.com/v1/messages".into(), vec![("x-api-key", need_key()?), ("anthropic-version", ANTHROPIC_VERSION.into())]),
        Provider::Ollama => (format!("{}/api/chat", ollama_base(base_url)?), vec![]),
    })
}

/// In-flight assistant requests, so Stop can cancel them (dropping the
/// connection also makes Ollama stop generating).
fn inflight() -> &'static std::sync::Mutex<std::collections::HashMap<String, tokio::task::AbortHandle>> {
    static MAP: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, tokio::task::AbortHandle>>> = std::sync::OnceLock::new();
    MAP.get_or_init(Default::default)
}

/// Reads an Ollama NDJSON stream, forwarding text as it arrives, and returns
/// the assembled reply in the same shape as a non-streamed response.
async fn read_ollama_stream(mut res: reqwest::Response, on_token: &tauri::ipc::Channel<String>, p: Provider, url: &str) -> Result<Value, String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut content = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    let mut done_reason = Value::Null;
    let mut total = 0usize;
    let handle_line = |line: &[u8], content: &mut String, tool_calls: &mut Vec<Value>, done_reason: &mut Value| -> Result<(), String> {
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        let v: Value = serde_json::from_slice(line).map_err(|_| format!("{} sent a response StudyOS couldn't read.", p.label()))?;
        if let Some(err) = v["error"].as_str() {
            return Err(format!("{} error: {}", p.label(), err.chars().take(300).collect::<String>()));
        }
        if let Some(delta) = v["message"]["content"].as_str() {
            if !delta.is_empty() {
                content.push_str(delta);
                let _ = on_token.send(delta.to_string());
            }
        }
        if let Some(calls) = v["message"]["tool_calls"].as_array() {
            tool_calls.extend(calls.iter().cloned());
        }
        if v["done"] == true {
            *done_reason = v["done_reason"].clone();
        }
        Ok(())
    };
    while let Some(chunk) = res.chunk().await.map_err(|e| network_error(p, url, &e))? {
        total += chunk.len();
        if total > MAX_RESPONSE_BYTES {
            return Err(format!("{} sent too much data.", p.label()));
        }
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            handle_line(&line, &mut content, &mut tool_calls, &mut done_reason)?;
        }
    }
    handle_line(&buf, &mut content, &mut tool_calls, &mut done_reason)?;
    Ok(json!({ "message": { "role": "assistant", "content": content, "tool_calls": tool_calls }, "done_reason": done_reason }))
}

async fn send_chat(p: Provider, base_url: Option<String>, mut body: Value, on_token: Option<tauri::ipc::Channel<String>>) -> Result<Value, String> {
    let obj = body.as_object_mut().ok_or("Invalid chat request.")?;
    if !obj.get("model").and_then(Value::as_str).is_some_and(|m| !m.trim().is_empty()) {
        return Err("Choose a model in Settings â†’ AI.".into());
    }
    // Ollama streams (text appears as it is written); the cloud APIs answer quickly in one piece.
    let stream = p == Provider::Ollama && on_token.is_some();
    obj.insert("stream".into(), Value::Bool(stream));
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_CHAT_BODY_BYTES {
        return Err("The conversation is too long. Start a new chat.".into());
    }
    let key = read_key(p)?;
    let (url, headers) = chat_target(p, base_url.as_deref(), key.as_deref())?;
    let mut rb = client()?.post(&url).header("content-type", "application/json").body(bytes);
    for (k, v) in &headers {
        rb = rb.header(*k, v);
    }
    let res = rb.send().await.map_err(|e| network_error(p, &url, &e))?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let text = read_capped(res, MAX_RESPONSE_BYTES).await.map_err(|e| network_error(p, &url, &e))?;
        return Err(http_error(p, status, &text));
    }
    if stream {
        return read_ollama_stream(res, on_token.as_ref().expect("checked"), p, &url).await;
    }
    let text = read_capped(res, MAX_RESPONSE_BYTES).await.map_err(|e| network_error(p, &url, &e))?;
    serde_json::from_str(&text).map_err(|_| format!("{} sent a response StudyOS couldn't read.", p.label()))
}

/// One turn of the study assistant: sends a provider-format chat request
/// (messages + tool definitions) and returns the provider's JSON reply. The
/// endpoint and API key are fixed here; only the body comes from the app.
/// With `on_token`, Ollama's text is streamed as it is generated; with
/// `request_id`, the request can be cancelled with `ai_cancel`.
#[tauri::command]
pub async fn ai_chat(provider: String, base_url: Option<String>, body: Value, request_id: Option<String>, on_token: tauri::ipc::Channel<String>) -> Result<Value, String> {
    let p = Provider::parse(&provider)?;
    let task = tokio::spawn(send_chat(p, base_url, body, Some(on_token)));
    if let Some(id) = &request_id {
        if let Ok(mut map) = inflight().lock() {
            map.insert(id.clone(), task.abort_handle());
        }
    }
    let result = task.await;
    if let Some(id) = &request_id {
        if let Ok(mut map) = inflight().lock() {
            map.remove(id);
        }
    }
    match result {
        Ok(r) => r,
        Err(e) if e.is_cancelled() => Err("Stopped.".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Cancels an in-flight assistant request (the Stop button).
#[tauri::command]
pub fn ai_cancel(request_id: String) {
    if let Some(handle) = inflight().lock().ok().and_then(|mut m| m.remove(&request_id)) {
        handle.abort();
    }
}

fn parse_models(p: Provider, v: &Value) -> Vec<String> {
    let mut ids: Vec<String> = match p {
        Provider::OpenAi | Provider::Anthropic => v["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect()).unwrap_or_default(),
        Provider::Ollama => v["models"].as_array().map(|a| a.iter().filter_map(|m| m["name"].as_str().map(str::to_string)).collect()).unwrap_or_default(),
    };
    if p == Provider::OpenAi {
        // Only chat-capable families; embeddings, audio, image and moderation models can't answer.
        ids.retain(|id| !["embedding", "whisper", "tts", "dall-e", "moderation", "davinci", "babbage", "transcribe", "image", "realtime", "audio", "search"].iter().any(|bad| id.contains(bad)));
    }
    ids.sort();
    ids.dedup();
    ids
}

/// Models available to this key (or installed in Ollama), to fill the model picker.
#[tauri::command]
pub async fn ai_list_models(provider: String, base_url: Option<String>) -> Result<Vec<String>, String> {
    let p = Provider::parse(&provider)?;
    let key = read_key(p)?;
    let (url, headers): (String, Vec<(&str, String)>) = match p {
        Provider::OpenAi => ("https://api.openai.com/v1/models".into(), vec![("authorization", format!("Bearer {}", key.ok_or("Add your OpenAI API key first.")?))]),
        Provider::Anthropic => (
            "https://api.anthropic.com/v1/models?limit=100".into(),
            vec![("x-api-key", key.ok_or("Add your Anthropic API key first.")?), ("anthropic-version", ANTHROPIC_VERSION.into())],
        ),
        Provider::Ollama => (format!("{}/api/tags", ollama_base(base_url.as_deref())?), vec![]),
    };
    let mut rb = client()?.get(&url);
    for (k, v) in &headers {
        rb = rb.header(*k, v);
    }
    let res = rb.send().await.map_err(|e| network_error(p, &url, &e))?;
    let status = res.status().as_u16();
    let body = read_capped(res, MAX_RESPONSE_BYTES).await.map_err(|e| network_error(p, &url, &e))?;
    if !(200..300).contains(&status) {
        return Err(http_error(p, status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| format!("{} sent a response StudyOS couldn't read.", p.label()))?;
    Ok(parse_models(p, &v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(provider: &str) -> AiRequest {
        AiRequest { provider: provider.into(), model: "m1".into(), base_url: None, system: "sys".into(), prompt: "hello".into(), max_tokens: 500 }
    }

    #[test]
    fn builds_provider_requests() {
        let o = build_call(Provider::OpenAi, &req("openai"), Some("sk-1")).unwrap();
        assert_eq!(o.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(o.headers, vec![("authorization", "Bearer sk-1".to_string())]);
        assert_eq!(o.body["messages"][0]["role"], "system");
        assert_eq!(o.body["max_completion_tokens"], 500);

        let a = build_call(Provider::Anthropic, &req("anthropic"), Some("k")).unwrap();
        assert_eq!(a.body["system"], "sys");
        assert_eq!(a.body["messages"][0]["content"], "hello");
        assert!(a.headers.contains(&("anthropic-version", ANTHROPIC_VERSION.to_string())));

        let l = build_call(Provider::Ollama, &AiRequest { base_url: Some("http://127.0.0.1:11434/ ".into()), ..req("ollama") }, None).unwrap();
        assert_eq!(l.url, "http://127.0.0.1:11434/api/chat");
        assert!(l.headers.is_empty());
        assert_eq!(l.body["stream"], false);
    }

    #[test]
    fn requires_keys_models_and_safe_urls() {
        assert!(build_call(Provider::OpenAi, &req("openai"), None).err().unwrap().contains("API key"));
        assert!(build_call(Provider::Anthropic, &AiRequest { model: " ".into(), ..req("anthropic") }, Some("k")).err().unwrap().contains("model"));
        assert!(build_call(Provider::Ollama, &AiRequest { base_url: Some("file:///etc".into()), ..req("ollama") }, None).is_err());
        for bad in ["https://attacker.example", "http://8.8.8.8:11434", "http://user:pw@localhost:11434", "http://localhost:11434/?x=1", "http://localhost.evil.com"] {
            assert!(ollama_base(Some(bad)).is_err(), "{bad}");
        }
        for ok in ["http://localhost:11434", "http://127.0.0.1:11434/", "http://192.168.1.20:11434", "http://10.0.0.5", "http://[::1]:11434", "http://gpu-box:11434", "https://ollama.lan"] {
            assert!(ollama_base(Some(ok)).is_ok(), "{ok}");
        }
        assert!(Provider::parse("other").is_err());
        assert!(validate_key("sk abc").is_err());
        assert!(validate_key("").is_err());
        assert!(validate_key("sk-proj-abc123").is_ok());
    }

    #[test]
    fn parses_replies() {
        let o = json!({ "choices": [{ "message": { "content": "Hi" }, "finish_reason": "length" }] });
        assert_eq!(parse_reply(Provider::OpenAi, &o).unwrap(), AiReply { text: "Hi".into(), truncated: true });
        let a = json!({ "content": [{ "type": "text", "text": "A" }, { "type": "text", "text": "B" }], "stop_reason": "end_turn" });
        assert_eq!(parse_reply(Provider::Anthropic, &a).unwrap(), AiReply { text: "AB".into(), truncated: false });
        let l = json!({ "message": { "content": "L" }, "done_reason": "stop" });
        assert_eq!(parse_reply(Provider::Ollama, &l).unwrap().text, "L");
        assert!(parse_reply(Provider::OpenAi, &json!({ "choices": [] })).is_err());
    }

    #[test]
    fn explains_http_errors() {
        let e = http_error(Provider::OpenAi, 401, r#"{"error":{"message":"Incorrect API key provided"}}"#);
        assert!(e.contains("rejected the API key") && e.contains("Incorrect API key"));
        assert!(http_error(Provider::Anthropic, 429, "").contains("rate limit"));
        assert!(http_error(Provider::Ollama, 404, r#"{"error":"model 'x' not found"}"#).contains("model 'x' not found"));
    }

    #[test]
    fn lists_chat_models_only() {
        let v = json!({ "data": [{ "id": "text-embedding-3-small" }, { "id": "gpt-b" }, { "id": "gpt-a" }, { "id": "whisper-1" }] });
        assert_eq!(parse_models(Provider::OpenAi, &v), vec!["gpt-a", "gpt-b"]);
        let l = json!({ "models": [{ "name": "llama3.2:latest" }] });
        assert_eq!(parse_models(Provider::Ollama, &l), vec!["llama3.2:latest"]);
    }
}
