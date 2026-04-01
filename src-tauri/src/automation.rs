use std::{fs, path::PathBuf};

use chrono::Local;
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const DEFAULT_RULE_PROFILE_ID: &str = "safe-autonomy-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationGoalDraft {
    pub title: Option<String>,
    pub goal: String,
    pub expected_outcome: String,
    #[serde(default)]
    pub rule_config: Option<AutomationGoalRuleConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationRunRequest {
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub scheduled_start_at: Option<String>,
    #[serde(default)]
    pub rule_profile_id: Option<String>,
    pub goals: Vec<AutomationGoalDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub rule_profile_id: String,
    pub status: String,
    pub scheduled_start_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub goals: Vec<AutomationGoal>,
    #[serde(default)]
    pub events: Vec<AutomationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationGoal {
    pub id: String,
    pub run_id: String,
    pub title: String,
    pub goal: String,
    pub expected_outcome: String,
    pub status: String,
    pub position: usize,
    #[serde(default)]
    pub round_count: usize,
    #[serde(default)]
    pub consecutive_failure_count: usize,
    #[serde(default)]
    pub no_progress_rounds: usize,
    #[serde(default = "default_goal_rule_config")]
    pub rule_config: AutomationGoalRuleConfig,
    pub last_owner_cli: Option<String>,
    pub result_summary: Option<String>,
    #[serde(default)]
    pub latest_progress_summary: Option<String>,
    #[serde(default)]
    pub next_instruction: Option<String>,
    pub requires_attention_reason: Option<String>,
    pub relevant_files: Vec<String>,
    pub synthetic_terminal_tab_id: String,
    pub last_exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationEvent {
    pub id: String,
    pub run_id: String,
    pub goal_id: Option<String>,
    pub level: String,
    pub title: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRuleProfile {
    pub id: String,
    pub label: String,
    pub allow_auto_select_strategy: bool,
    pub allow_safe_workspace_edits: bool,
    pub allow_safe_checks: bool,
    pub pause_on_credentials: bool,
    pub pause_on_external_installs: bool,
    pub pause_on_destructive_commands: bool,
    pub pause_on_git_push: bool,
    pub max_rounds_per_goal: usize,
    pub max_consecutive_failures: usize,
    pub max_no_progress_rounds: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationGoalRuleConfig {
    pub allow_auto_select_strategy: bool,
    pub allow_safe_workspace_edits: bool,
    pub allow_safe_checks: bool,
    pub pause_on_credentials: bool,
    pub pause_on_external_installs: bool,
    pub pause_on_destructive_commands: bool,
    pub pause_on_git_push: bool,
    pub max_rounds_per_goal: usize,
    pub max_consecutive_failures: usize,
    pub max_no_progress_rounds: usize,
}

pub fn load_runs() -> Result<Vec<AutomationRun>, String> {
    let path = automation_file()?;
    if !path.exists() {
        persist_runs(&[])?;
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<AutomationRun>>(&raw).map_err(|err| err.to_string())
}

pub fn persist_runs(runs: &[AutomationRun]) -> Result<(), String> {
    let path = automation_file()?;
    let raw = serde_json::to_string_pretty(runs).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

pub fn default_rule_profile() -> AutomationRuleProfile {
    AutomationRuleProfile {
        id: DEFAULT_RULE_PROFILE_ID.to_string(),
        label: "Safe Autonomy".to_string(),
        allow_auto_select_strategy: true,
        allow_safe_workspace_edits: true,
        allow_safe_checks: true,
        pause_on_credentials: true,
        pause_on_external_installs: true,
        pause_on_destructive_commands: true,
        pause_on_git_push: true,
        max_rounds_per_goal: 3,
        max_consecutive_failures: 2,
        max_no_progress_rounds: 1,
    }
}

pub fn default_goal_rule_config() -> AutomationGoalRuleConfig {
    let profile = default_rule_profile();
    AutomationGoalRuleConfig {
        allow_auto_select_strategy: profile.allow_auto_select_strategy,
        allow_safe_workspace_edits: profile.allow_safe_workspace_edits,
        allow_safe_checks: profile.allow_safe_checks,
        pause_on_credentials: profile.pause_on_credentials,
        pause_on_external_installs: profile.pause_on_external_installs,
        pause_on_destructive_commands: profile.pause_on_destructive_commands,
        pause_on_git_push: profile.pause_on_git_push,
        max_rounds_per_goal: profile.max_rounds_per_goal,
        max_consecutive_failures: profile.max_consecutive_failures,
        max_no_progress_rounds: profile.max_no_progress_rounds,
    }
}

pub fn normalize_goal_rule_config(config: AutomationGoalRuleConfig) -> AutomationGoalRuleConfig {
    AutomationGoalRuleConfig {
        allow_auto_select_strategy: config.allow_auto_select_strategy,
        allow_safe_workspace_edits: config.allow_safe_workspace_edits,
        allow_safe_checks: config.allow_safe_checks,
        pause_on_credentials: config.pause_on_credentials,
        pause_on_external_installs: config.pause_on_external_installs,
        pause_on_destructive_commands: config.pause_on_destructive_commands,
        pause_on_git_push: config.pause_on_git_push,
        max_rounds_per_goal: config.max_rounds_per_goal.max(1).min(8),
        max_consecutive_failures: config.max_consecutive_failures.max(1).min(5),
        max_no_progress_rounds: config.max_no_progress_rounds.min(5),
    }
}

pub fn normalize_rule_profile(profile: AutomationRuleProfile) -> AutomationRuleProfile {
    let defaults = default_rule_profile();
    AutomationRuleProfile {
        id: if profile.id.trim().is_empty() {
            defaults.id
        } else {
            profile.id
        },
        label: if profile.label.trim().is_empty() {
            defaults.label
        } else {
            profile.label
        },
        allow_auto_select_strategy: profile.allow_auto_select_strategy,
        allow_safe_workspace_edits: profile.allow_safe_workspace_edits,
        allow_safe_checks: profile.allow_safe_checks,
        pause_on_credentials: profile.pause_on_credentials,
        pause_on_external_installs: profile.pause_on_external_installs,
        pause_on_destructive_commands: profile.pause_on_destructive_commands,
        pause_on_git_push: profile.pause_on_git_push,
        max_rounds_per_goal: profile.max_rounds_per_goal.max(1).min(8),
        max_consecutive_failures: profile.max_consecutive_failures.max(1).min(5),
        max_no_progress_rounds: profile.max_no_progress_rounds.min(5),
    }
}

pub fn load_rule_profile() -> Result<AutomationRuleProfile, String> {
    let path = automation_rules_file()?;
    if !path.exists() {
        let profile = default_rule_profile();
        persist_rule_profile(&profile)?;
        return Ok(profile);
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        let profile = default_rule_profile();
        persist_rule_profile(&profile)?;
        return Ok(profile);
    }
    let parsed =
        serde_json::from_str::<AutomationRuleProfile>(&raw).map_err(|err| err.to_string())?;
    let normalized = normalize_rule_profile(parsed);
    persist_rule_profile(&normalized)?;
    Ok(normalized)
}

pub fn persist_rule_profile(profile: &AutomationRuleProfile) -> Result<(), String> {
    let path = automation_rules_file()?;
    let raw = serde_json::to_string_pretty(profile).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

pub fn normalize_runs_on_startup(runs: &mut [AutomationRun]) {
    let now = now_rfc3339();
    for run in runs {
        if run.status == "running" {
            run.status = "scheduled".to_string();
            if run.scheduled_start_at.is_none() {
                run.scheduled_start_at = Some(now.clone());
            }
            run.updated_at = now.clone();
            push_event(
                run,
                None,
                "warning",
                "Host restarted",
                "The app restarted while this run was active. Pending goals were re-queued."
            );
        }

        for goal in &mut run.goals {
            if goal.status == "running" {
                goal.status = "queued".to_string();
                goal.updated_at = now.clone();
            }
        }
    }
}

pub fn build_run_from_request(request: CreateAutomationRunRequest) -> AutomationRun {
    let now = now_rfc3339();
    let run_id = new_id("auto-run");
    let status = if request.scheduled_start_at.is_some() {
        "scheduled"
    } else {
        "draft"
    };

    let goals = request
        .goals
        .into_iter()
        .enumerate()
        .map(|(index, goal)| AutomationGoal {
            id: new_id("auto-goal"),
            run_id: run_id.clone(),
            title: goal
                .title
                .as_deref()
                .map(derive_goal_title)
                .unwrap_or_else(|| derive_goal_title(&goal.goal)),
            goal: goal.goal,
            expected_outcome: goal.expected_outcome,
            status: "queued".to_string(),
            position: index,
            round_count: 0,
            consecutive_failure_count: 0,
            no_progress_rounds: 0,
            rule_config: goal
                .rule_config
                .map(normalize_goal_rule_config)
                .unwrap_or_else(default_goal_rule_config),
            last_owner_cli: None,
            result_summary: None,
            latest_progress_summary: None,
            next_instruction: None,
            requires_attention_reason: None,
            relevant_files: Vec::new(),
            synthetic_terminal_tab_id: new_id("auto-tab"),
            last_exit_code: None,
            started_at: None,
            completed_at: None,
            updated_at: now.clone(),
        })
        .collect();

    let mut run = AutomationRun {
        id: run_id,
        workspace_id: request.workspace_id,
        project_root: request.project_root,
        project_name: request.project_name,
        rule_profile_id: request
            .rule_profile_id
            .unwrap_or_else(|| DEFAULT_RULE_PROFILE_ID.to_string()),
        status: status.to_string(),
        scheduled_start_at: request.scheduled_start_at,
        started_at: None,
        completed_at: None,
        summary: None,
        created_at: now.clone(),
        updated_at: now,
        goals,
        events: Vec::new(),
    };
    push_event(
        &mut run,
        None,
        "info",
        "Run created",
        if status == "scheduled" {
            "The automation run is queued and will start at the scheduled time."
        } else {
            "The automation run is saved as a draft and can be started manually."
        },
    );
    run
}

pub fn push_event(
    run: &mut AutomationRun,
    goal_id: Option<&str>,
    level: &str,
    title: &str,
    detail: &str,
) {
    run.events.insert(
        0,
        AutomationEvent {
            id: new_id("auto-event"),
            run_id: run.id.clone(),
            goal_id: goal_id.map(|value| value.to_string()),
            level: level.to_string(),
            title: title.to_string(),
            detail: detail.to_string(),
            created_at: now_rfc3339(),
        },
    );
    if run.events.len() > 200 {
        run.events.truncate(200);
    }
}

pub fn derive_goal_title(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Untitled goal".to_string();
    }

    let compact = trimmed.replace('\n', " ");
    if compact.chars().count() <= 64 {
        compact
    } else {
        let shortened = compact.chars().take(64).collect::<String>();
        format!("{}…", shortened.trim_end())
    }
}

fn automation_file() -> Result<PathBuf, String> {
    let base = data_local_dir()
        .ok_or_else(|| "Unable to locate local application data directory".to_string())?
        .join("multi-cli-studio");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base.join("automation-runs.json"))
}

fn automation_rules_file() -> Result<PathBuf, String> {
    let base = data_local_dir()
        .ok_or_else(|| "Unable to locate local application data directory".to_string())?
        .join("multi-cli-studio");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base.join("automation-rules.json"))
}

fn new_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}
