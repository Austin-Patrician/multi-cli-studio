use chrono::{DateTime, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageUsageData {
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_write_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) total_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSessionSummary {
    pub(crate) session_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) session_id_aliases: Vec<String>,
    pub(crate) timestamp: i64,
    pub(crate) model: String,
    pub(crate) usage: LocalUsageUsageData,
    pub(crate) cost: f64,
    #[serde(default)]
    pub(crate) summary: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) file_size_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) modified_lines: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDailyUsage {
    pub(crate) date: String,
    pub(crate) sessions: i64,
    pub(crate) usage: LocalUsageUsageData,
    pub(crate) cost: f64,
    #[serde(default)]
    pub(crate) models_used: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageModelUsage {
    pub(crate) model: String,
    pub(crate) total_cost: f64,
    pub(crate) total_tokens: i64,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_creation_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) session_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageEngineUsage {
    pub(crate) engine: String,
    pub(crate) count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDailyCodeChange {
    pub(crate) date: String,
    pub(crate) modified_lines: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageWeekData {
    pub(crate) sessions: i64,
    pub(crate) cost: f64,
    pub(crate) tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageTrends {
    pub(crate) sessions: f64,
    pub(crate) cost: f64,
    pub(crate) tokens: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageWeeklyComparison {
    pub(crate) current_week: LocalUsageWeekData,
    pub(crate) last_week: LocalUsageWeekData,
    pub(crate) trends: LocalUsageTrends,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageStatistics {
    pub(crate) project_path: String,
    pub(crate) project_name: String,
    pub(crate) total_sessions: i64,
    pub(crate) total_usage: LocalUsageUsageData,
    pub(crate) estimated_cost: f64,
    pub(crate) sessions: Vec<LocalUsageSessionSummary>,
    pub(crate) daily_usage: Vec<LocalUsageDailyUsage>,
    pub(crate) weekly_comparison: LocalUsageWeeklyComparison,
    pub(crate) by_model: Vec<LocalUsageModelUsage>,
    pub(crate) total_engine_usage_count: i64,
    #[serde(default)]
    pub(crate) engine_usage: Vec<LocalUsageEngineUsage>,
    pub(crate) ai_code_modified_lines: i64,
    #[serde(default)]
    pub(crate) daily_code_changes: Vec<LocalUsageDailyCodeChange>,
    pub(crate) last_updated: i64,
}

#[derive(Default, Clone, Copy)]
struct UsageTotals {
    input: i64,
    cached: i64,
    output: i64,
}

#[derive(Default, Clone, Copy)]
struct CostRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

const USAGE_LIMIT_SESSIONS: usize = 200;
const MAX_GEMINI_TEXT_PREVIEW_CHARS: usize = 512;

#[tauri::command]
pub(crate) fn local_usage_statistics(
    scope: Option<String>,
    provider: Option<String>,
    date_range: Option<String>,
    workspace_path: Option<String>,
) -> Result<LocalUsageStatistics, String> {
    let scope = scope.unwrap_or_else(|| "current".to_string());
    let provider = provider.unwrap_or_else(|| "all".to_string());
    let date_range = date_range.unwrap_or_else(|| "7d".to_string());
    let workspace_path = workspace_path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let filter_workspace = if scope == "current" {
        workspace_path
    } else {
        None
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let cutoff_time = match date_range.as_str() {
        "7d" => now_ms - 7 * 24 * 60 * 60 * 1000,
        "30d" => now_ms - 30 * 24 * 60 * 60 * 1000,
        _ => 0,
    };
    let project_path = if scope == "all" {
        "all".to_string()
    } else if let Some(path) = filter_workspace.as_ref() {
        path.to_string_lossy().to_string()
    } else {
        "current".to_string()
    };
    let project_name = if scope == "all" {
        "全部项目".to_string()
    } else if let Some(path) = filter_workspace.as_ref() {
        path.file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("当前项目")
            .to_string()
    } else {
        "当前项目".to_string()
    };

    let sessions_roots = resolve_sessions_roots();
    let mut sessions = match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => scan_codex_session_summaries(filter_workspace.as_deref(), &sessions_roots)?,
        "claude" => scan_claude_session_summaries(filter_workspace.as_deref())?,
        "gemini" => scan_gemini_session_summaries(filter_workspace.as_deref())?,
        _ => scan_all_provider_session_summaries(filter_workspace.as_deref(), &sessions_roots)?,
    };

    if cutoff_time > 0 {
        sessions.retain(|session| session.timestamp >= cutoff_time);
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    if provider.trim().eq_ignore_ascii_case("claude") && sessions.len() > USAGE_LIMIT_SESSIONS {
        sessions.truncate(USAGE_LIMIT_SESSIONS);
    }

    Ok(build_usage_statistics(
        project_path,
        project_name,
        provider.as_str(),
        sessions,
        now_ms,
    ))
}

fn scan_all_provider_session_summaries(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let mut sessions = scan_codex_session_summaries(workspace_path, sessions_roots)?;
    sessions.extend(scan_claude_session_summaries(workspace_path)?);
    sessions.extend(scan_gemini_session_summaries(workspace_path)?);
    Ok(sessions)
}

fn build_usage_statistics(
    project_path: String,
    project_name: String,
    provider: &str,
    sessions: Vec<LocalUsageSessionSummary>,
    now_ms: i64,
) -> LocalUsageStatistics {
    let mut total_usage = LocalUsageUsageData::default();
    let mut estimated_cost = 0.0;
    let mut daily_map: HashMap<String, LocalUsageDailyUsage> = HashMap::new();
    let mut daily_code_changes_map: HashMap<String, i64> = HashMap::new();
    let mut model_map: HashMap<String, LocalUsageModelUsage> = HashMap::new();
    let mut engine_usage_map: HashMap<String, i64> = HashMap::new();
    let one_week_ago = now_ms - 7 * 24 * 60 * 60 * 1000;
    let two_weeks_ago = now_ms - 14 * 24 * 60 * 60 * 1000;
    let mut current_week = LocalUsageWeekData::default();
    let mut last_week = LocalUsageWeekData::default();
    let mut ai_code_modified_lines = 0_i64;

    for session in &sessions {
        add_usage(&mut total_usage, &session.usage);
        estimated_cost += session.cost;
        ai_code_modified_lines += session.modified_lines.max(0);

        let engine_label = infer_engine_label(provider, session);
        *engine_usage_map.entry(engine_label).or_insert(0) += 1;

        let day_key =
            day_key_for_timestamp_ms(session.timestamp).unwrap_or_else(|| "1970-01-01".to_string());
        let daily = daily_map
            .entry(day_key.clone())
            .or_insert_with(|| LocalUsageDailyUsage {
                date: day_key.clone(),
                ..LocalUsageDailyUsage::default()
            });
        daily.sessions += 1;
        daily.cost += session.cost;
        add_usage(&mut daily.usage, &session.usage);
        if session.modified_lines > 0 {
            *daily_code_changes_map.entry(day_key.clone()).or_insert(0) += session.modified_lines;
        }
        if !daily
            .models_used
            .iter()
            .any(|model| model == &session.model)
        {
            daily.models_used.push(session.model.clone());
        }

        let model_usage =
            model_map
                .entry(session.model.clone())
                .or_insert_with(|| LocalUsageModelUsage {
                    model: session.model.clone(),
                    ..LocalUsageModelUsage::default()
                });
        model_usage.session_count += 1;
        model_usage.total_cost += session.cost;
        model_usage.total_tokens += session.usage.total_tokens;
        model_usage.input_tokens += session.usage.input_tokens;
        model_usage.output_tokens += session.usage.output_tokens;
        model_usage.cache_creation_tokens += session.usage.cache_write_tokens;
        model_usage.cache_read_tokens += session.usage.cache_read_tokens;

        if session.timestamp >= one_week_ago {
            current_week.sessions += 1;
            current_week.cost += session.cost;
            current_week.tokens += session.usage.total_tokens;
        } else if session.timestamp >= two_weeks_ago {
            last_week.sessions += 1;
            last_week.cost += session.cost;
            last_week.tokens += session.usage.total_tokens;
        }
    }

    total_usage.total_tokens = total_usage.input_tokens
        + total_usage.output_tokens
        + total_usage.cache_write_tokens
        + total_usage.cache_read_tokens;

    let mut daily_usage: Vec<LocalUsageDailyUsage> = daily_map.into_values().collect();
    daily_usage.sort_by(|a, b| a.date.cmp(&b.date));
    let mut by_model: Vec<LocalUsageModelUsage> = model_map.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.total_cmp(&a.total_cost));
    let mut engine_usage: Vec<LocalUsageEngineUsage> = engine_usage_map
        .into_iter()
        .map(|(engine, count)| LocalUsageEngineUsage { engine, count })
        .collect();
    engine_usage.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.engine.cmp(&b.engine)));
    let total_engine_usage_count = engine_usage.iter().map(|item| item.count).sum();
    let mut daily_code_changes: Vec<LocalUsageDailyCodeChange> = daily_code_changes_map
        .into_iter()
        .map(|(date, modified_lines)| LocalUsageDailyCodeChange {
            date,
            modified_lines,
        })
        .collect();
    daily_code_changes.sort_by(|a, b| a.date.cmp(&b.date));

    LocalUsageStatistics {
        project_path,
        project_name,
        total_sessions: sessions.len() as i64,
        total_usage,
        estimated_cost,
        sessions,
        daily_usage,
        weekly_comparison: LocalUsageWeeklyComparison {
            current_week: current_week.clone(),
            last_week: last_week.clone(),
            trends: LocalUsageTrends {
                sessions: calculate_trend(current_week.sessions as f64, last_week.sessions as f64),
                cost: calculate_trend(current_week.cost, last_week.cost),
                tokens: calculate_trend(current_week.tokens as f64, last_week.tokens as f64),
            },
        },
        by_model,
        total_engine_usage_count,
        engine_usage,
        ai_code_modified_lines,
        daily_code_changes,
        last_updated: now_ms,
    }
}

fn calculate_trend(current: f64, last: f64) -> f64 {
    if last == 0.0 {
        return 0.0;
    }
    ((current - last) / last) * 100.0
}

fn infer_engine_label(provider: &str, session: &LocalUsageSessionSummary) -> String {
    let model_lower = session.model.to_ascii_lowercase();
    if model_lower.contains("claude") {
        return "Claude Code".to_string();
    }
    if model_lower.contains("gemini") {
        return "Gemini CLI".to_string();
    }
    if model_lower.contains("gpt") || model_lower.contains("codex") {
        return "Codex CLI".to_string();
    }

    let provider_hint = session
        .provider
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if provider_hint.contains("anthropic") || provider_hint.contains("claude") {
        return "Claude Code".to_string();
    }
    if provider_hint.contains("gemini") || provider_hint.contains("google") {
        return "Gemini CLI".to_string();
    }
    if provider_hint.contains("openai") {
        return "Codex CLI".to_string();
    }

    match provider.trim().to_ascii_lowercase().as_str() {
        "claude" => "Claude Code".to_string(),
        "gemini" => "Gemini CLI".to_string(),
        "codex" => "Codex CLI".to_string(),
        _ => "Other/Custom".to_string(),
    }
}

fn add_usage(target: &mut LocalUsageUsageData, usage: &LocalUsageUsageData) {
    target.input_tokens += usage.input_tokens;
    target.output_tokens += usage.output_tokens;
    target.cache_write_tokens += usage.cache_write_tokens;
    target.cache_read_tokens += usage.cache_read_tokens;
    target.total_tokens += usage.total_tokens;
}

fn calculate_usage_cost(usage: &LocalUsageUsageData, rates: CostRates) -> f64 {
    let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * rates.input;
    let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * rates.output;
    let cache_write_cost = (usage.cache_write_tokens as f64 / 1_000_000.0) * rates.cache_write;
    let cache_read_cost = (usage.cache_read_tokens as f64 / 1_000_000.0) * rates.cache_read;
    input_cost + output_cost + cache_write_cost + cache_read_cost
}

fn codex_cost_rates() -> CostRates {
    CostRates {
        input: 3.0,
        output: 15.0,
        cache_write: 0.0,
        cache_read: 0.30,
    }
}

fn claude_cost_rates(model: &str) -> CostRates {
    let model_lower = model.to_lowercase();
    if model_lower.contains("opus-4") || model_lower.contains("claude-opus-4") {
        return CostRates {
            input: 15.0,
            output: 75.0,
            cache_write: 18.75,
            cache_read: 1.50,
        };
    }
    if model_lower.contains("haiku-4") || model_lower.contains("claude-haiku-4") {
        return CostRates {
            input: 0.8,
            output: 4.0,
            cache_write: 1.0,
            cache_read: 0.08,
        };
    }
    CostRates {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.30,
    }
}

fn gemini_cost_rates() -> CostRates {
    CostRates::default()
}

fn scan_codex_session_summaries(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let mut files = Vec::new();
    let mut seen_files = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen_files);
    }

    let mut sessions = Vec::new();
    for file in files {
        if let Some(summary) = parse_codex_session_summary(&file, workspace_path)? {
            sessions.push(summary);
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(sessions)
}

fn collect_jsonl_files(root: &Path, output: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, output, seen);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
}

fn parse_codex_session_summary(
    path: &Path,
    workspace_path: Option<&Path>,
) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let reader = BufReader::new(file);
    let mut usage = LocalUsageUsageData::default();
    let mut summary: Option<String> = None;
    let mut model: Option<String> = None;
    let mut source: Option<String> = None;
    let mut provider: Option<String> = None;
    let mut canonical_session_id: Option<String> = None;
    let mut latest_timestamp = 0_i64;
    let mut previous_totals: Option<UsageTotals> = None;
    let mut match_known = workspace_path.is_none();
    let mut matches_workspace = workspace_path.is_none();
    let mut saw_session_signal = false;
    let mut modified_lines = 0_i64;
    let mut max_diff_stat_lines = 0_i64;
    let mut pending_apply_patch_lines: HashMap<String, i64> = HashMap::new();

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        latest_timestamp = latest_timestamp.max(read_timestamp_ms(&value).unwrap_or(0));
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if entry_type == "response_item" {
            if let Some(payload) = value.get("payload").and_then(|payload| payload.as_object()) {
                let payload_type = payload
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");

                if payload_type == "custom_tool_call" {
                    let tool_name = payload
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if tool_name == "apply_patch" {
                        let call_id = payload
                            .get("call_id")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !call_id.is_empty() {
                            let patch_input = payload
                                .get("input")
                                .and_then(|value| value.as_str())
                                .unwrap_or("");
                            pending_apply_patch_lines
                                .insert(call_id, count_apply_patch_changed_lines(patch_input));
                            saw_session_signal = true;
                        }
                    }
                } else if payload_type == "custom_tool_call_output" {
                    let call_id = payload
                        .get("call_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if let Some(pending_lines) = pending_apply_patch_lines.remove(call_id) {
                        let output = payload
                            .get("output")
                            .map(stringify_tool_output_value)
                            .unwrap_or_default();
                        if is_successful_apply_patch_output(&output) {
                            modified_lines += pending_lines.max(0);
                        }
                    }
                } else if payload_type == "function_call_output" {
                    let output = payload
                        .get("output")
                        .map(extract_tool_output_text)
                        .unwrap_or_default();
                    if let Some(lines) = parse_changed_lines_from_git_diff_stat_output(&output) {
                        max_diff_stat_lines = max_diff_stat_lines.max(lines.max(0));
                    }
                }
            }
            continue;
        }

        if entry_type == "session_meta" || entry_type == "turn_context" {
            saw_session_signal = true;
            if canonical_session_id.is_none() {
                canonical_session_id = extract_session_id_from_session_value(&value);
            }
            if let Some(cwd) = extract_cwd(&value) {
                if let Some(filter) = workspace_path {
                    matches_workspace = path_matches_workspace(&cwd, filter);
                    match_known = true;
                    if !matches_workspace {
                        break;
                    }
                }
            }
            let (detected_source, detected_provider) =
                extract_source_provider_from_session_value(&value);
            if source.is_none() {
                source = detected_source;
            }
            if provider.is_none() {
                provider = detected_provider;
            }
        }

        if entry_type == "turn_context" {
            if model.is_none() {
                model = extract_model_from_turn_context(&value);
            }
            continue;
        }

        if !matches_workspace {
            if match_known {
                break;
            }
            continue;
        }

        if workspace_path.is_some() && !match_known {
            continue;
        }

        if summary.is_none() && entry_type == "event_msg" {
            if let Some(payload) = value.get("payload").and_then(|payload| payload.as_object()) {
                let payload_type = payload
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if payload_type == "user_message" {
                    saw_session_signal = true;
                    if let Some(message) = payload.get("message").and_then(|value| value.as_str()) {
                        summary = truncate_summary(message);
                    }
                }
            }
        }

        if !(entry_type == "event_msg" || entry_type.is_empty()) {
            continue;
        }
        let payload = value.get("payload").and_then(|value| value.as_object());
        let payload_type = payload
            .and_then(|payload| payload.get("type"))
            .and_then(|value| value.as_str());
        if payload_type != Some("token_count") {
            continue;
        }
        saw_session_signal = true;

        let info = payload
            .and_then(|payload| payload.get("info"))
            .and_then(|value| value.as_object());
        let (input, cached, output, used_total) = if let Some(info) = info {
            if let Some(total) = find_usage_map(info, &["total_token_usage", "totalTokenUsage"]) {
                (
                    read_i64(total, &["input_tokens", "inputTokens"]),
                    read_i64(
                        total,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(total, &["output_tokens", "outputTokens"]),
                    true,
                )
            } else if let Some(last) = find_usage_map(info, &["last_token_usage", "lastTokenUsage"])
            {
                (
                    read_i64(last, &["input_tokens", "inputTokens"]),
                    read_i64(
                        last,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(last, &["output_tokens", "outputTokens"]),
                    false,
                )
            } else {
                continue;
            }
        } else {
            continue;
        };

        let mut delta = UsageTotals {
            input,
            cached,
            output,
        };
        if used_total {
            let prev = previous_totals.unwrap_or_default();
            delta = UsageTotals {
                input: (input - prev.input).max(0),
                cached: (cached - prev.cached).max(0),
                output: (output - prev.output).max(0),
            };
            previous_totals = Some(UsageTotals {
                input,
                cached,
                output,
            });
        } else {
            let mut next = previous_totals.unwrap_or_default();
            next.input += delta.input;
            next.cached += delta.cached;
            next.output += delta.output;
            previous_totals = Some(next);
        }

        if delta.input == 0 && delta.cached == 0 && delta.output == 0 {
            continue;
        }

        usage.input_tokens += delta.input.max(0);
        usage.output_tokens += delta.output.max(0);
        usage.cache_read_tokens += delta.cached.max(0);
        if model.is_none() {
            model = extract_model_from_token_count(&value);
        }
    }

    if workspace_path.is_some() && !matches_workspace {
        return Ok(None);
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;
    if modified_lines == 0 && max_diff_stat_lines > 0 {
        modified_lines = max_diff_stat_lines;
    }
    if !saw_session_signal {
        return Ok(None);
    }
    if summary.is_none()
        && usage.total_tokens == 0
        && modified_lines == 0
        && canonical_session_id.is_none()
        && source.is_none()
        && provider.is_none()
    {
        return Ok(None);
    }

    let file_stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let session_id = canonical_session_id.unwrap_or_else(|| file_stem.clone());
    let mut session_id_aliases = Vec::new();
    if !file_stem.is_empty() && file_stem != session_id {
        session_id_aliases.push(file_stem);
    }
    let model = model.unwrap_or_else(|| "gpt-5.1".to_string());
    let cost = calculate_usage_cost(&usage, codex_cost_rates());
    let timestamp = if latest_timestamp > 0 {
        latest_timestamp
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    };

    Ok(Some(LocalUsageSessionSummary {
        session_id,
        session_id_aliases,
        timestamp,
        model,
        usage,
        cost,
        summary,
        source,
        provider,
        file_size_bytes: fs::metadata(path).ok().map(|metadata| metadata.len()),
        modified_lines,
    }))
}

fn parse_gemini_session_summary(path: &Path) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let reader = BufReader::new(file);
    let value: Value = match serde_json::from_reader(reader) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let session_id = normalize_non_empty_string(value.get("sessionId").and_then(Value::as_str))
        .or_else(|| {
            path.file_stem()
                .and_then(|name| name.to_str())
                .map(ToString::to_string)
        });
    let Some(session_id) = session_id else {
        return Ok(None);
    };

    let messages = value.get("messages").and_then(Value::as_array);
    let mut usage = LocalUsageUsageData::default();
    let mut model = "gemini".to_string();
    let mut summary: Option<String> = None;
    let mut first_timestamp = 0_i64;
    let mut last_timestamp = 0_i64;

    for message in messages.into_iter().flatten() {
        let message_type = message
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if summary.is_none() && message_type == "user" {
            summary = extract_gemini_text_from_value(message, 0)
                .and_then(|text| truncate_summary(text.as_str()));
        }
        if matches!(message_type.as_str(), "gemini" | "assistant" | "model") {
            if let Some(candidate) = normalize_non_empty_string(
                message
                    .get("model")
                    .or_else(|| message.get("modelId"))
                    .or_else(|| message.get("modelName"))
                    .and_then(Value::as_str),
            ) {
                model = candidate;
            }
        }
        if let Some(tokens) = message.get("tokens").and_then(Value::as_object) {
            usage.input_tokens += read_i64(tokens, &["input"]);
            usage.output_tokens += read_i64(tokens, &["output"]);
            usage.cache_read_tokens += read_i64(tokens, &["cached"]);
        }
        let timestamp = message
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_gemini_timestamp_millis);
        if let Some(timestamp) = timestamp {
            if first_timestamp == 0 {
                first_timestamp = timestamp;
            }
            if timestamp > last_timestamp {
                last_timestamp = timestamp;
            }
        }
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;
    let cost = if usage.total_tokens > 0 {
        calculate_usage_cost(&usage, gemini_cost_rates())
    } else {
        0.0
    };
    let timestamp = value
        .get("lastUpdated")
        .and_then(Value::as_str)
        .and_then(parse_gemini_timestamp_millis)
        .or_else(|| {
            value
                .get("startTime")
                .and_then(Value::as_str)
                .and_then(parse_gemini_timestamp_millis)
        })
        .or_else(|| (last_timestamp > 0).then_some(last_timestamp))
        .or_else(|| (first_timestamp > 0).then_some(first_timestamp))
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64
        });

    Ok(Some(LocalUsageSessionSummary {
        session_id,
        session_id_aliases: Vec::new(),
        timestamp,
        model,
        usage,
        cost,
        summary,
        source: Some("gemini".to_string()),
        provider: Some("google".to_string()),
        file_size_bytes: fs::metadata(path).ok().map(|metadata| metadata.len()),
        modified_lines: 0,
    }))
}

fn scan_gemini_session_summaries(
    workspace_path: Option<&Path>,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let base_dir = resolve_gemini_base_dir();
    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    let mut seen = HashSet::new();
    collect_gemini_chat_files(&base_dir.join("tmp"), &mut files, &mut seen);
    collect_gemini_chat_files(&base_dir.join("history"), &mut files, &mut seen);
    let projects_map = if workspace_path.is_some() {
        load_gemini_projects_alias_map(base_dir.as_path())
    } else {
        HashMap::new()
    };

    let mut sessions = Vec::new();
    for path in files {
        if let Some(workspace_path) = workspace_path {
            let Some(alias) = gemini_project_alias_from_chat_path(&path) else {
                continue;
            };
            let Some(project_root) =
                resolve_gemini_project_root(base_dir.as_path(), alias.as_str(), &projects_map)
            else {
                continue;
            };
            if !gemini_project_matches_workspace(project_root.as_str(), workspace_path) {
                continue;
            }
        }
        if let Some(summary) = parse_gemini_session_summary(path.as_path())? {
            sessions.push(summary);
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(sessions)
}

fn claude_projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}

fn scan_claude_project_summaries(
    project_dir: &Path,
    sessions: &mut Vec<LocalUsageSessionSummary>,
) -> Result<(), String> {
    let entries = match fs::read_dir(project_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.ends_with(".jsonl") || name.starts_with("agent-") {
            continue;
        }
        if let Some(summary) = parse_claude_session_summary(&path)? {
            sessions.push(summary);
        }
    }
    Ok(())
}

fn scan_claude_session_summaries(
    workspace_path: Option<&Path>,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let projects_dir = match claude_projects_dir() {
        Some(dir) if dir.exists() => dir,
        _ => return Ok(Vec::new()),
    };
    let mut sessions = Vec::new();

    if let Some(workspace_path) = workspace_path {
        let encoded = encode_claude_project_path(&workspace_path.to_string_lossy());
        let project_dir = projects_dir.join(encoded);
        if project_dir.exists() {
            scan_claude_project_summaries(&project_dir, &mut sessions)?;
        }
        sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        return Ok(sessions);
    }

    let entries = match fs::read_dir(&projects_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_claude_project_summaries(&path, &mut sessions)?;
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(sessions)
}

fn parse_claude_session_summary(path: &Path) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let reader = BufReader::new(file);
    let mut usage = LocalUsageUsageData::default();
    let mut total_cost = 0.0;
    let mut model = "unknown".to_string();
    let mut first_timestamp = 0_i64;
    let mut summary: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }
        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if first_timestamp == 0 {
            first_timestamp = read_claude_timestamp(&value).unwrap_or(0);
        }
        let entry_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if summary.is_none() && entry_type == "summary" {
            if let Some(text) = value.get("summary").and_then(|v| v.as_str()) {
                summary = truncate_summary(text);
            }
        }
        if entry_type != "assistant" {
            continue;
        }
        let Some(message) = value.get("message").and_then(|v| v.as_object()) else {
            continue;
        };
        let message_model = message.get("model").and_then(|v| v.as_str());
        if model == "unknown" {
            if let Some(message_model) = message_model {
                model = message_model.to_string();
            }
        }
        let Some(usage_map) = message.get("usage").and_then(|v| v.as_object()) else {
            continue;
        };
        let input_tokens = read_i64(usage_map, &["input_tokens"]);
        let output_tokens = read_i64(usage_map, &["output_tokens"]);
        let cache_write_tokens = read_i64(usage_map, &["cache_creation_input_tokens"]);
        let cache_read_tokens = read_i64(usage_map, &["cache_read_input_tokens"]);
        if input_tokens == 0
            && output_tokens == 0
            && cache_write_tokens == 0
            && cache_read_tokens == 0
        {
            continue;
        }
        let message_usage = LocalUsageUsageData {
            input_tokens,
            output_tokens,
            cache_write_tokens,
            cache_read_tokens,
            total_tokens: input_tokens + output_tokens + cache_write_tokens + cache_read_tokens,
        };
        add_usage(&mut usage, &message_usage);
        let pricing_model = message_model.unwrap_or(model.as_str());
        total_cost += calculate_usage_cost(&message_usage, claude_cost_rates(pricing_model));
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;
    if usage.total_tokens == 0 {
        return Ok(None);
    }
    let session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let timestamp = if first_timestamp > 0 {
        first_timestamp
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    };
    Ok(Some(LocalUsageSessionSummary {
        session_id,
        session_id_aliases: Vec::new(),
        timestamp,
        model,
        usage,
        cost: total_cost,
        summary,
        source: Some("claude".to_string()),
        provider: Some("anthropic".to_string()),
        file_size_bytes: fs::metadata(path).ok().map(|metadata| metadata.len()),
        modified_lines: 0,
    }))
}

fn count_apply_patch_changed_lines(input: &str) -> i64 {
    let mut changed_lines = 0_i64;
    for raw_line in input.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.starts_with('+') {
            if is_unified_diff_file_header(line, "+++") {
                continue;
            }
            changed_lines += 1;
            continue;
        }
        if line.starts_with('-') {
            if is_unified_diff_file_header(line, "---") {
                continue;
            }
            changed_lines += 1;
        }
    }
    changed_lines
}

fn is_unified_diff_file_header(line: &str, marker: &str) -> bool {
    if !line.starts_with(marker) {
        return false;
    }
    line.as_bytes()
        .get(marker.len())
        .map(|next| *next == b' ' || *next == b'\t')
        .unwrap_or(false)
}

fn is_successful_apply_patch_output(raw_output: &str) -> bool {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("verification failed") {
        return false;
    }
    contains_apply_patch_success_marker(trimmed)
}

fn parse_changed_lines_from_git_diff_stat_output(output: &str) -> Option<i64> {
    let mut changed_lines_from_summary = None;
    let mut changed_lines_from_stats = 0_i64;
    let mut saw_stat_line = false;

    for line in output.lines() {
        let normalized = line.trim();
        if normalized.is_empty() {
            continue;
        }
        let normalized_lower = normalized.to_ascii_lowercase();
        if normalized_lower.contains("file changed") || normalized_lower.contains("files changed") {
            let insertions = read_number_before_keyword(normalized, "insertion").unwrap_or(0);
            let deletions = read_number_before_keyword(normalized, "deletion").unwrap_or(0);
            changed_lines_from_summary = Some(insertions + deletions);
        }
        if let Some(changed) = parse_diff_stat_line_changed_count(normalized) {
            saw_stat_line = true;
            changed_lines_from_stats += changed.max(0);
        }
    }

    changed_lines_from_summary.or_else(|| {
        if saw_stat_line {
            Some(changed_lines_from_stats)
        } else {
            None
        }
    })
}

fn parse_diff_stat_line_changed_count(line: &str) -> Option<i64> {
    let (path_segment, stats_segment) = line.split_once('|')?;
    if path_segment.trim().is_empty() {
        return None;
    }
    let numeric_prefix: String = stats_segment
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if numeric_prefix.is_empty() {
        return None;
    }
    numeric_prefix.parse::<i64>().ok()
}

fn read_number_before_keyword(line: &str, keyword: &str) -> Option<i64> {
    let lower = line.to_ascii_lowercase();
    let keyword_index = lower.find(keyword)?;
    let prefix = &line[..keyword_index];
    prefix
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .last()
        .and_then(|segment| segment.parse::<i64>().ok())
}

fn contains_apply_patch_success_marker(output: &str) -> bool {
    let lowered = output.to_ascii_lowercase();
    lowered.contains("success. updated the following files:")
        || lowered.contains("process exited with code 0")
        || lowered.contains("exit code: 0")
}

fn stringify_tool_output_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn extract_tool_output_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(extract_tool_output_text)
            .filter(|item| !item.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => {
            for key in ["output", "stdout", "stderr", "text", "message", "result"] {
                if let Some(next) = map.get(key) {
                    let nested = extract_tool_output_text(next);
                    if !nested.trim().is_empty() {
                        return nested;
                    }
                }
            }
            serde_json::to_string(value).unwrap_or_default()
        }
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn normalize_non_empty_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn extract_session_id_from_session_value(value: &Value) -> Option<String> {
    let root = value.as_object()?;
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });
    normalize_non_empty_string(
        root.get("session_id")
            .or_else(|| root.get("sessionId"))
            .or_else(|| root.get("id"))
            .and_then(Value::as_str),
    )
    .or_else(|| {
        payload.and_then(|item| read_string_from_object(item, &["id", "session_id", "sessionId"]))
    })
    .or_else(|| {
        session_meta
            .and_then(|item| read_string_from_object(item, &["id", "session_id", "sessionId"]))
    })
}

fn read_string_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(found) = normalize_non_empty_string(object.get(*key).and_then(Value::as_str)) {
            return Some(found);
        }
    }
    None
}

fn normalize_originator_source(value: Option<String>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn extract_source_provider_from_session_value(value: &Value) -> (Option<String>, Option<String>) {
    let Some(root) = value.as_object() else {
        return (None, None);
    };
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });
    let originator = normalize_originator_source(
        read_string_from_object(root, &["originator", "origin", "client", "app"])
            .or_else(|| {
                payload.and_then(|item| read_string_from_object(item, &["originator", "origin"]))
            })
            .or_else(|| {
                session_meta
                    .and_then(|item| read_string_from_object(item, &["originator", "origin"]))
            }),
    );
    let source = read_string_from_object(root, &["source", "sessionSource"])
        .or_else(|| {
            payload.and_then(|item| read_string_from_object(item, &["source", "sessionSource"]))
        })
        .or_else(|| {
            session_meta
                .and_then(|item| read_string_from_object(item, &["source", "sessionSource"]))
        });
    let source = match (source, originator) {
        (Some(source), Some(originator))
            if source.eq_ignore_ascii_case("vscode")
                && !originator.eq_ignore_ascii_case("vscode") =>
        {
            Some(originator)
        }
        (None, Some(originator)) => Some(originator),
        (source, _) => source,
    };
    let provider = read_string_from_object(
        root,
        &["provider", "providerId", "model_provider", "modelProvider"],
    )
    .or_else(|| {
        payload.and_then(|item| {
            read_string_from_object(
                item,
                &["provider", "providerId", "model_provider", "modelProvider"],
            )
        })
    })
    .or_else(|| {
        session_meta.and_then(|item| {
            read_string_from_object(
                item,
                &["provider", "providerId", "model_provider", "modelProvider"],
            )
        })
    });
    (source, provider)
}

fn truncate_summary(text: &str) -> Option<String> {
    let cleaned = text.replace('\n', " ").trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    let limit = 45;
    Some(if cleaned.chars().count() > limit {
        format!("{}...", cleaned.chars().take(limit).collect::<String>())
    } else {
        cleaned
    })
}

fn resolve_default_codex_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home));
    }
    dirs::home_dir().map(|home| home.join(".codex"))
}

fn resolve_sessions_roots() -> Vec<PathBuf> {
    let Some(home) = resolve_default_codex_home() else {
        return Vec::new();
    };
    vec![home.join("sessions"), home.join("archived_sessions")]
}

fn resolve_gemini_base_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("GEMINI_CLI_HOME").filter(|value| !value.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if let Some(expanded) = expand_home_prefixed_path(&configured_text) {
            return expanded;
        }
        return configured;
    }
    dirs::home_dir().unwrap_or_default().join(".gemini")
}

fn is_gemini_chat_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return false;
    }
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if !file_name.starts_with("session-") {
        return false;
    }
    path.parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        == Some("chats")
}

fn collect_gemini_chat_files(root: &Path, output: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_gemini_chat_files(&path, output, seen);
            continue;
        }
        if !is_gemini_chat_file(&path) {
            continue;
        }
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
}

fn parse_gemini_timestamp_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect::<String>()
}

fn extract_gemini_text_from_value(value: &Value, depth: usize) -> Option<String> {
    if depth > 6 {
        return None;
    }
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(truncate_chars(trimmed, MAX_GEMINI_TEXT_PREVIEW_CHARS))
            }
        }
        Value::Array(items) => {
            let mut parts = Vec::new();
            let mut total_chars = 0_usize;
            for item in items {
                if let Some(text) = extract_gemini_text_from_value(item, depth + 1) {
                    total_chars += text.chars().count();
                    parts.push(text);
                    if total_chars >= MAX_GEMINI_TEXT_PREVIEW_CHARS {
                        break;
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(truncate_chars(
                    parts.join("\n").as_str(),
                    MAX_GEMINI_TEXT_PREVIEW_CHARS,
                ))
            }
        }
        Value::Object(map) => {
            for key in [
                "displayContent",
                "display_content",
                "text",
                "message",
                "content",
                "output",
                "result",
                "response",
            ] {
                if let Some(text) = map
                    .get(key)
                    .and_then(|node| extract_gemini_text_from_value(node, depth + 1))
                {
                    return Some(text);
                }
            }
            for key in [
                "content", "message", "output", "result", "response", "data", "payload", "parts",
                "part", "item", "items",
            ] {
                if let Some(text) = map
                    .get(key)
                    .and_then(|node| extract_gemini_text_from_value(node, depth + 1))
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn read_gemini_project_root_file(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn load_gemini_projects_alias_map(base_dir: &Path) -> HashMap<String, String> {
    let path = base_dir.join("projects.json");
    let raw = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return HashMap::new(),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return HashMap::new(),
    };
    let mut map = HashMap::new();
    let Some(projects) = value.get("projects").and_then(Value::as_object) else {
        return map;
    };
    for (project_path, alias_value) in projects {
        let Some(alias) = alias_value.as_str().map(str::trim) else {
            continue;
        };
        if alias.is_empty() {
            continue;
        }
        map.insert(alias.to_string(), project_path.to_string());
    }
    map
}

fn gemini_project_alias_from_chat_path(path: &Path) -> Option<String> {
    path.parent()?
        .parent()?
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
}

fn resolve_gemini_project_root(
    base_dir: &Path,
    alias: &str,
    projects_map: &HashMap<String, String>,
) -> Option<String> {
    let tmp_candidate = base_dir.join("tmp").join(alias).join(".project_root");
    if let Some(path) = read_gemini_project_root_file(tmp_candidate.as_path()) {
        return Some(path);
    }
    let history_candidate = base_dir.join("history").join(alias).join(".project_root");
    if let Some(path) = read_gemini_project_root_file(history_candidate.as_path()) {
        return Some(path);
    }
    projects_map.get(alias).cloned()
}

fn expand_home_prefixed_path(path: &str) -> Option<PathBuf> {
    if path == "~" {
        return dirs::home_dir();
    }
    let relative = path
        .strip_prefix("~/")
        .or_else(|| path.strip_prefix("~\\"))
        .filter(|value| !value.is_empty())?;
    dirs::home_dir().map(|home| home.join(relative))
}

fn build_project_root_match_candidates(project_root: &str) -> Vec<PathBuf> {
    fn push_unique(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<String>, candidate: PathBuf) {
        let key = candidate.to_string_lossy().to_string();
        if !key.is_empty() && seen.insert(key) {
            candidates.push(candidate);
        }
    }
    let trimmed = project_root.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let raw = PathBuf::from(trimmed);
    push_unique(&mut candidates, &mut seen, raw.clone());
    if let Some(expanded_home) = expand_home_prefixed_path(trimmed) {
        push_unique(&mut candidates, &mut seen, expanded_home);
    }
    if let Ok(canonical) = raw.canonicalize() {
        push_unique(&mut candidates, &mut seen, canonical);
    }
    candidates
}

fn build_workspace_match_candidates(workspace_path: &Path) -> Vec<PathBuf> {
    fn push_unique_path(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
        let key = path.to_string_lossy().to_string();
        if !key.is_empty() && seen.insert(key) {
            candidates.push(path);
        }
    }
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    push_unique_path(&mut candidates, &mut seen, workspace_path.to_path_buf());
    if let Ok(canonical) = workspace_path.canonicalize() {
        push_unique_path(&mut candidates, &mut seen, canonical);
    }
    candidates
}

fn paths_match_workspace_scope(path_a: &Path, path_b: &Path) -> bool {
    let path_a_text = path_a.to_string_lossy();
    if path_matches_workspace(&path_a_text, path_b) {
        return true;
    }
    let path_b_text = path_b.to_string_lossy();
    path_matches_workspace(&path_b_text, path_a)
}

fn gemini_project_matches_workspace(project_root: &str, workspace_path: &Path) -> bool {
    let workspace_candidates = build_workspace_match_candidates(workspace_path);
    if workspace_candidates.is_empty() {
        return false;
    }
    build_project_root_match_candidates(project_root)
        .iter()
        .any(|project_candidate| {
            workspace_candidates.iter().any(|workspace_candidate| {
                paths_match_workspace_scope(project_candidate, workspace_candidate)
            })
        })
}

fn extract_model_from_turn_context(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    if let Some(model) = payload.get("model").and_then(|value| value.as_str()) {
        return Some(model.to_string());
    }
    let info = payload.get("info").and_then(|value| value.as_object())?;
    info.get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn extract_model_from_token_count(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    let info = payload.get("info").and_then(|value| value.as_object());
    let model = info
        .and_then(|info| {
            info.get("model")
                .or_else(|| info.get("model_name"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| payload.get("model").and_then(|value| value.as_str()))
        .or_else(|| value.get("model").and_then(|value| value.as_str()));
    model.map(|value| value.to_string())
}

fn find_usage_map<'a>(
    info: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    keys.iter()
        .find_map(|key| info.get(*key).and_then(|value| value.as_object()))
}

fn read_i64(map: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_f64().map(|value| value as i64))
                .or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<i64>().ok())
                })
        })
        .unwrap_or(0)
}

fn read_timestamp_ms(value: &Value) -> Option<i64> {
    let raw = value.get("timestamp")?;
    if let Some(text) = raw.as_str() {
        return DateTime::parse_from_rfc3339(text)
            .map(|value| value.timestamp_millis())
            .ok();
    }
    let numeric = raw
        .as_i64()
        .or_else(|| raw.as_f64().map(|value| value as i64))?;
    if numeric > 0 && numeric < 1_000_000_000_000 {
        return Some(numeric * 1000);
    }
    Some(numeric)
}

fn day_key_for_timestamp_ms(timestamp_ms: i64) -> Option<String> {
    let utc = Utc.timestamp_millis_opt(timestamp_ms).single()?;
    Some(utc.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

fn extract_cwd(value: &Value) -> Option<String> {
    let root = value.as_object()?;
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });
    read_string_from_object(root, &["cwd"])
        .or_else(|| payload.and_then(|item| read_string_from_object(item, &["cwd"])))
        .or_else(|| session_meta.and_then(|item| read_string_from_object(item, &["cwd"])))
}

#[cfg(windows)]
fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    let cwd_path = cwd
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let workspace = workspace_path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    if cwd_path.is_empty() || workspace.is_empty() {
        return false;
    }
    cwd_path == workspace
        || cwd_path
            .strip_prefix(&workspace)
            .map(|rest| rest.starts_with('/'))
            .unwrap_or(false)
}

#[cfg(not(windows))]
fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    let cwd_path = cwd.trim().replace('\\', "/");
    let workspace = workspace_path.to_string_lossy().replace('\\', "/");
    cwd_path == workspace || cwd_path.starts_with(&(workspace.to_string() + "/"))
}

fn read_claude_timestamp(value: &Value) -> Option<i64> {
    value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|ts| {
            DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| dt.timestamp_millis())
        })
}

fn encode_claude_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}
