use std::{collections::BTreeMap, fs, path::PathBuf, str::FromStr};

use chrono::{DateTime, Local};
use cron::Schedule;
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const DEFAULT_RULE_PROFILE_ID: &str = "safe-autonomy-v1";
pub const DEFAULT_PERMISSION_PROFILE: &str = "standard";
pub const DEFAULT_LIFECYCLE_STATUS: &str = "queued";
pub const DEFAULT_OUTCOME_STATUS: &str = "unknown";
pub const DEFAULT_ATTENTION_STATUS: &str = "none";
pub const DEFAULT_RESOLUTION_CODE: &str = "not_evaluated";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationGoalDraft {
    pub title: Option<String>,
    pub goal: String,
    pub expected_outcome: String,
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
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
pub struct AutomationParameterDefinition {
    pub id: String,
    pub key: String,
    pub label: String,
    #[serde(default = "default_parameter_kind")]
    pub kind: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub default_value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationJobDraft {
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub goal: String,
    pub expected_outcome: String,
    #[serde(default = "default_execution_mode")]
    pub default_execution_mode: String,
    #[serde(default = "default_permission_profile")]
    pub permission_profile: String,
    #[serde(default = "default_goal_rule_config")]
    pub rule_config: AutomationGoalRuleConfig,
    #[serde(default)]
    pub parameter_definitions: Vec<AutomationParameterDefinition>,
    #[serde(default)]
    pub default_parameter_values: BTreeMap<String, Value>,
    #[serde(default)]
    pub cron_expression: Option<String>,
    #[serde(default)]
    pub email_notification_enabled: bool,
    #[serde(default = "default_job_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationJob {
    pub id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub goal: String,
    pub expected_outcome: String,
    #[serde(default = "default_execution_mode")]
    pub default_execution_mode: String,
    #[serde(default = "default_permission_profile")]
    pub permission_profile: String,
    #[serde(default = "default_goal_rule_config")]
    pub rule_config: AutomationGoalRuleConfig,
    #[serde(default)]
    pub parameter_definitions: Vec<AutomationParameterDefinition>,
    #[serde(default)]
    pub default_parameter_values: BTreeMap<String, Value>,
    #[serde(default)]
    pub cron_expression: Option<String>,
    #[serde(default)]
    pub last_triggered_at: Option<String>,
    #[serde(default)]
    pub email_notification_enabled: bool,
    #[serde(default = "default_job_enabled")]
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationRunFromJobRequest {
    pub job_id: String,
    #[serde(default)]
    pub scheduled_start_at: Option<String>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    #[serde(default)]
    pub parameter_values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub job_name: Option<String>,
    #[serde(default)]
    pub trigger_source: Option<String>,
    #[serde(default)]
    pub run_number: Option<usize>,
    #[serde(default = "default_permission_profile")]
    pub permission_profile: String,
    #[serde(default)]
    pub parameter_values: BTreeMap<String, Value>,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub rule_profile_id: String,
    #[serde(default = "default_lifecycle_status")]
    pub lifecycle_status: String,
    #[serde(default = "default_outcome_status")]
    pub outcome_status: String,
    #[serde(default = "default_attention_status")]
    pub attention_status: String,
    #[serde(default = "default_resolution_code")]
    pub resolution_code: String,
    #[serde(default)]
    pub status_summary: Option<String>,
    #[serde(default)]
    pub objective_signals: AutomationObjectiveSignals,
    #[serde(default)]
    pub judge_assessment: AutomationJudgeAssessment,
    #[serde(default)]
    pub validation_result: AutomationValidationResult,
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
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
    #[serde(default = "default_lifecycle_status")]
    pub lifecycle_status: String,
    #[serde(default = "default_outcome_status")]
    pub outcome_status: String,
    #[serde(default = "default_attention_status")]
    pub attention_status: String,
    #[serde(default = "default_resolution_code")]
    pub resolution_code: String,
    #[serde(default)]
    pub status_summary: Option<String>,
    #[serde(default)]
    pub objective_signals: AutomationObjectiveSignals,
    #[serde(default)]
    pub judge_assessment: AutomationJudgeAssessment,
    #[serde(default)]
    pub validation_result: AutomationValidationResult,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomationObjectiveSignals {
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub checks_passed: bool,
    #[serde(default)]
    pub checks_failed: bool,
    #[serde(default)]
    pub artifacts_produced: bool,
    #[serde(default)]
    pub files_changed: usize,
    #[serde(default)]
    pub policy_blocks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomationJudgeAssessment {
    #[serde(default)]
    pub made_progress: bool,
    #[serde(default)]
    pub expected_outcome_met: bool,
    #[serde(default)]
    pub suggested_decision: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomationValidationResult {
    #[serde(default)]
    pub decision: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub feedback: Option<String>,
    #[serde(default)]
    pub evidence_summary: Option<String>,
    #[serde(default)]
    pub missing_checks: Vec<String>,
    #[serde(default)]
    pub verification_steps: Vec<String>,
    #[serde(default)]
    pub made_progress: bool,
    #[serde(default)]
    pub expected_outcome_met: bool,
}

pub fn load_jobs() -> Result<Vec<AutomationJob>, String> {
    let path = automation_jobs_file()?;
    if !path.exists() {
        persist_jobs(&[])?;
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut jobs = serde_json::from_str::<Vec<AutomationJob>>(&raw).map_err(|err| err.to_string())?;
    normalize_jobs_on_startup(&mut jobs);
    Ok(jobs)
}

pub fn persist_jobs(jobs: &[AutomationJob]) -> Result<(), String> {
    let path = automation_jobs_file()?;
    let raw = serde_json::to_string_pretty(jobs).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

pub fn load_runs() -> Result<Vec<AutomationRun>, String> {
    let path = automation_runs_file()?;
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
    let path = automation_runs_file()?;
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

pub fn normalize_jobs_on_startup(jobs: &mut [AutomationJob]) {
    for job in jobs {
        job.name = normalize_job_name(&job.name, &job.goal);
        job.project_name = normalize_required_text(&job.project_name, "Workspace");
        job.default_execution_mode = normalize_execution_mode(&job.default_execution_mode);
        job.permission_profile = normalize_permission_profile(&job.permission_profile);
        job.rule_config = normalize_goal_rule_config(job.rule_config.clone());
        job.cron_expression = normalize_cron_expression(job.cron_expression.clone()).ok().flatten();
        job.parameter_definitions = job
            .parameter_definitions
            .iter()
            .cloned()
            .map(normalize_parameter_definition)
            .collect();
    }
}

pub fn sync_goal_status_fields(goal: &mut AutomationGoal) {
    goal.lifecycle_status = normalize_lifecycle_status(&goal.lifecycle_status);
    goal.outcome_status = normalize_outcome_status(&goal.outcome_status);
    goal.attention_status = normalize_attention_status(&goal.attention_status);
    goal.resolution_code = normalize_resolution_code(Some(goal.resolution_code.clone()));
    goal.status = derive_legacy_goal_status(
        &goal.lifecycle_status,
        &goal.outcome_status,
        &goal.attention_status,
    );
}

pub fn sync_run_status_fields(run: &mut AutomationRun) {
    run.lifecycle_status = normalize_lifecycle_status(&run.lifecycle_status);
    run.outcome_status = normalize_outcome_status(&run.outcome_status);
    run.attention_status = normalize_attention_status(&run.attention_status);
    run.resolution_code = normalize_resolution_code(Some(run.resolution_code.clone()));
    run.status = derive_legacy_run_status(
        &run.lifecycle_status,
        &run.outcome_status,
        &run.attention_status,
    );
}

pub fn normalize_runs_on_startup(runs: &mut [AutomationRun]) {
    let now = now_rfc3339();
    for run in runs {
        if run.status == "running"
            || matches!(normalize_lifecycle_status(&run.lifecycle_status).as_str(), "running" | "validating")
        {
            run.status = "scheduled".to_string();
            run.lifecycle_status = "queued".to_string();
            run.outcome_status = "unknown".to_string();
            run.attention_status = "none".to_string();
            run.resolution_code = "scheduled".to_string();
            run.status_summary = Some("Re-queued after app restart.".to_string());
            if run.scheduled_start_at.is_none() {
                run.scheduled_start_at = Some(now.clone());
            } else {
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
            goal.execution_mode = normalize_execution_mode(&goal.execution_mode);
            if goal.status == "running"
                || matches!(normalize_lifecycle_status(&goal.lifecycle_status).as_str(), "running" | "validating")
            {
                goal.status = "queued".to_string();
                goal.lifecycle_status = "queued".to_string();
                goal.outcome_status = "unknown".to_string();
                goal.attention_status = "none".to_string();
                goal.resolution_code = "scheduled".to_string();
                goal.status_summary = Some("Re-queued after app restart.".to_string());
                goal.requires_attention_reason = None;
                goal.updated_at = now.clone();
            }
            if goal.lifecycle_status == DEFAULT_LIFECYCLE_STATUS
                && goal.outcome_status == DEFAULT_OUTCOME_STATUS
                && goal.attention_status == DEFAULT_ATTENTION_STATUS
            {
                match goal.status.as_str() {
                    "running" => goal.lifecycle_status = "running".to_string(),
                    "completed" => {
                        goal.lifecycle_status = "finished".to_string();
                        goal.outcome_status = "success".to_string();
                        goal.resolution_code = "objective_checks_passed".to_string();
                    }
                    "failed" => {
                        goal.lifecycle_status = "finished".to_string();
                        goal.outcome_status = "failed".to_string();
                        goal.resolution_code = "runtime_error".to_string();
                    }
                    "paused" => {
                        goal.lifecycle_status = "stopped".to_string();
                        goal.attention_status = "waiting_human".to_string();
                        goal.resolution_code = "manual_pause_requested".to_string();
                    }
                    "cancelled" => {
                        goal.lifecycle_status = "stopped".to_string();
                        goal.resolution_code = "cancelled".to_string();
                    }
                    _ => {}
                }
            }
            sync_goal_status_fields(goal);
        }
        if run.lifecycle_status == DEFAULT_LIFECYCLE_STATUS
            && run.outcome_status == DEFAULT_OUTCOME_STATUS
            && run.attention_status == DEFAULT_ATTENTION_STATUS
        {
            match run.status.as_str() {
                "running" => run.lifecycle_status = "running".to_string(),
                "completed" => {
                    run.lifecycle_status = "finished".to_string();
                    run.outcome_status = "success".to_string();
                    run.resolution_code = "objective_checks_passed".to_string();
                }
                "failed" => {
                    run.lifecycle_status = "finished".to_string();
                    run.outcome_status = "failed".to_string();
                    run.resolution_code = "runtime_error".to_string();
                }
                "paused" => {
                    run.lifecycle_status = "stopped".to_string();
                    run.attention_status = "waiting_human".to_string();
                    run.resolution_code = "manual_pause_requested".to_string();
                }
                "cancelled" => {
                    run.lifecycle_status = "stopped".to_string();
                    run.resolution_code = "cancelled".to_string();
                }
                _ => {}
            }
        }
        sync_run_status_fields(run);
    }
}

pub fn build_job_from_draft(draft: AutomationJobDraft) -> Result<AutomationJob, String> {
    let now = now_rfc3339();
    Ok(AutomationJob {
        id: new_id("auto-job"),
        workspace_id: normalize_required_text(&draft.workspace_id, "workspace"),
        project_root: normalize_required_text(&draft.project_root, ""),
        project_name: normalize_required_text(&draft.project_name, "Workspace"),
        name: normalize_job_name(&draft.name, &draft.goal),
        description: normalize_optional_text(draft.description),
        goal: normalize_required_text(&draft.goal, ""),
        expected_outcome: normalize_required_text(&draft.expected_outcome, ""),
        default_execution_mode: normalize_execution_mode(&draft.default_execution_mode),
        permission_profile: normalize_permission_profile(&draft.permission_profile),
        rule_config: normalize_goal_rule_config(draft.rule_config),
        parameter_definitions: draft
            .parameter_definitions
            .into_iter()
            .map(normalize_parameter_definition)
            .collect(),
        default_parameter_values: normalize_parameter_values(draft.default_parameter_values),
        cron_expression: normalize_cron_expression(draft.cron_expression)?,
        email_notification_enabled: draft.email_notification_enabled,
        last_triggered_at: None,
        enabled: draft.enabled,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn update_job_from_draft(existing: &AutomationJob, draft: AutomationJobDraft) -> Result<AutomationJob, String> {
    let normalized_cron = normalize_cron_expression(draft.cron_expression)?;
    let reset_last_trigger = normalized_cron != existing.cron_expression;
    Ok(AutomationJob {
        id: existing.id.clone(),
        workspace_id: normalize_required_text(&draft.workspace_id, "workspace"),
        project_root: normalize_required_text(&draft.project_root, ""),
        project_name: normalize_required_text(&draft.project_name, "Workspace"),
        name: normalize_job_name(&draft.name, &draft.goal),
        description: normalize_optional_text(draft.description),
        goal: normalize_required_text(&draft.goal, ""),
        expected_outcome: normalize_required_text(&draft.expected_outcome, ""),
        default_execution_mode: normalize_execution_mode(&draft.default_execution_mode),
        permission_profile: normalize_permission_profile(&draft.permission_profile),
        rule_config: normalize_goal_rule_config(draft.rule_config),
        parameter_definitions: draft
            .parameter_definitions
            .into_iter()
            .map(normalize_parameter_definition)
            .collect(),
        default_parameter_values: normalize_parameter_values(draft.default_parameter_values),
        cron_expression: normalized_cron,
        email_notification_enabled: draft.email_notification_enabled,
        last_triggered_at: if reset_last_trigger {
            None
        } else {
            existing.last_triggered_at.clone()
        },
        enabled: draft.enabled,
        created_at: existing.created_at.clone(),
        updated_at: now_rfc3339(),
    })
}

pub fn build_run_from_job(
    job: &AutomationJob,
    request: CreateAutomationRunFromJobRequest,
    run_number: usize,
) -> AutomationRun {
    let now = now_rfc3339();
    let run_id = new_id("auto-run");
    let merged_parameters = merge_parameter_values(
        &job.default_parameter_values,
        &normalize_parameter_values(request.parameter_values),
    );
    let selected_execution_mode = normalize_execution_mode(
        request
            .execution_mode
            .as_deref()
            .unwrap_or(job.default_execution_mode.as_str()),
    );
    let scheduled_start_at = normalize_scheduled_start_at(request.scheduled_start_at.clone())
        .or_else(|| Some(now.clone()));
    let is_scheduled = scheduled_start_at
        .as_deref()
        .and_then(parse_time)
        .map(|value| value.timestamp_millis() > Local::now().timestamp_millis() + 1000)
        .unwrap_or(false);

    let goal = AutomationGoal {
        id: new_id("auto-goal"),
        run_id: run_id.clone(),
        title: job.name.clone(),
        goal: job.goal.clone(),
        expected_outcome: job.expected_outcome.clone(),
        execution_mode: selected_execution_mode,
        lifecycle_status: "queued".to_string(),
        outcome_status: "unknown".to_string(),
        attention_status: "none".to_string(),
        resolution_code: "queued".to_string(),
        status_summary: Some("Waiting to start.".to_string()),
        objective_signals: AutomationObjectiveSignals::default(),
        judge_assessment: AutomationJudgeAssessment::default(),
        validation_result: AutomationValidationResult::default(),
        status: "queued".to_string(),
        position: 0,
        round_count: 0,
        consecutive_failure_count: 0,
        no_progress_rounds: 0,
        rule_config: normalize_goal_rule_config(job.rule_config.clone()),
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
    };

    let mut run = AutomationRun {
        id: run_id,
        job_id: Some(job.id.clone()),
        job_name: Some(job.name.clone()),
        trigger_source: Some(if is_scheduled {
            "schedule".to_string()
        } else {
            "manual".to_string()
        }),
        run_number: Some(run_number),
        permission_profile: normalize_permission_profile(&job.permission_profile),
        parameter_values: merged_parameters,
        workspace_id: job.workspace_id.clone(),
        project_root: job.project_root.clone(),
        project_name: job.project_name.clone(),
        rule_profile_id: DEFAULT_RULE_PROFILE_ID.to_string(),
        lifecycle_status: "queued".to_string(),
        outcome_status: "unknown".to_string(),
        attention_status: "none".to_string(),
        resolution_code: if is_scheduled {
            "scheduled".to_string()
        } else {
            "queued".to_string()
        },
        status_summary: Some(if is_scheduled {
            "Scheduled and waiting to start.".to_string()
        } else {
            "Queued to start immediately.".to_string()
        }),
        objective_signals: AutomationObjectiveSignals::default(),
        judge_assessment: AutomationJudgeAssessment::default(),
        validation_result: AutomationValidationResult::default(),
        status: "scheduled".to_string(),
        scheduled_start_at,
        started_at: None,
        completed_at: None,
        summary: None,
        created_at: now.clone(),
        updated_at: now,
        goals: vec![goal],
        events: Vec::new(),
    };
    push_event(
        &mut run,
        None,
        "info",
        "Run created",
        if is_scheduled {
            "The CLI automation run is queued and will start at the scheduled time."
        } else {
            "The CLI automation run is queued and will start immediately."
        },
    );
    if let Some(goal) = run.goals.get_mut(0) {
        sync_goal_status_fields(goal);
    }
    sync_run_status_fields(&mut run);
    run
}

pub fn build_run_from_request(request: CreateAutomationRunRequest) -> AutomationRun {
    let now = now_rfc3339();
    let run_id = new_id("auto-run");
    let scheduled_start_at = normalize_scheduled_start_at(request.scheduled_start_at.clone());
    let status = if scheduled_start_at.is_some() {
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
            execution_mode: normalize_execution_mode(&goal.execution_mode),
            lifecycle_status: "queued".to_string(),
            outcome_status: "unknown".to_string(),
            attention_status: "none".to_string(),
            resolution_code: "queued".to_string(),
            status_summary: Some("Waiting to start.".to_string()),
            objective_signals: AutomationObjectiveSignals::default(),
            judge_assessment: AutomationJudgeAssessment::default(),
            validation_result: AutomationValidationResult::default(),
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
        job_id: None,
        job_name: None,
        trigger_source: None,
        run_number: None,
        permission_profile: default_permission_profile(),
        parameter_values: BTreeMap::new(),
        workspace_id: request.workspace_id,
        project_root: request.project_root,
        project_name: request.project_name,
        rule_profile_id: request
            .rule_profile_id
            .unwrap_or_else(|| DEFAULT_RULE_PROFILE_ID.to_string()),
        lifecycle_status: if status == "scheduled" {
            "queued".to_string()
        } else {
            "stopped".to_string()
        },
        outcome_status: "unknown".to_string(),
        attention_status: "none".to_string(),
        resolution_code: if status == "scheduled" {
            "scheduled".to_string()
        } else {
            "draft".to_string()
        },
        status_summary: Some(if status == "scheduled" {
            "Scheduled and waiting to start.".to_string()
        } else {
            "Saved as draft.".to_string()
        }),
        objective_signals: AutomationObjectiveSignals::default(),
        judge_assessment: AutomationJudgeAssessment::default(),
        validation_result: AutomationValidationResult::default(),
        status: status.to_string(),
        scheduled_start_at,
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
    for goal in &mut run.goals {
        sync_goal_status_fields(goal);
    }
    sync_run_status_fields(&mut run);
    run
}

pub fn default_execution_mode() -> String {
    "auto".to_string()
}

pub fn default_permission_profile() -> String {
    DEFAULT_PERMISSION_PROFILE.to_string()
}

pub fn default_lifecycle_status() -> String {
    DEFAULT_LIFECYCLE_STATUS.to_string()
}

pub fn default_outcome_status() -> String {
    DEFAULT_OUTCOME_STATUS.to_string()
}

pub fn default_attention_status() -> String {
    DEFAULT_ATTENTION_STATUS.to_string()
}

pub fn default_resolution_code() -> String {
    DEFAULT_RESOLUTION_CODE.to_string()
}

pub fn normalize_execution_mode(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "codex" => "codex".to_string(),
        "claude" => "claude".to_string(),
        "gemini" => "gemini".to_string(),
        _ => "auto".to_string(),
    }
}

pub fn normalize_permission_profile(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "full-access" => "full-access".to_string(),
        "read-only" => "read-only".to_string(),
        _ => default_permission_profile(),
    }
}

pub fn normalize_lifecycle_status(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "running" => "running".to_string(),
        "validating" => "validating".to_string(),
        "stopped" => "stopped".to_string(),
        "finished" => "finished".to_string(),
        _ => "queued".to_string(),
    }
}

pub fn normalize_outcome_status(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "success" => "success".to_string(),
        "failed" => "failed".to_string(),
        "partial" => "partial".to_string(),
        _ => "unknown".to_string(),
    }
}

pub fn normalize_attention_status(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "waiting_human" => "waiting_human".to_string(),
        "blocked_by_policy" => "blocked_by_policy".to_string(),
        "blocked_by_environment" => "blocked_by_environment".to_string(),
        _ => "none".to_string(),
    }
}

pub fn normalize_resolution_code(value: Option<String>) -> String {
    value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(default_resolution_code)
}

pub fn derive_legacy_goal_status(
    lifecycle_status: &str,
    outcome_status: &str,
    attention_status: &str,
) -> String {
    match normalize_lifecycle_status(lifecycle_status).as_str() {
        "queued" => "queued".to_string(),
        "validating" => "running".to_string(),
        "running" => "running".to_string(),
        "finished" => match normalize_outcome_status(outcome_status).as_str() {
            "success" => "completed".to_string(),
            "failed" => "failed".to_string(),
            _ => {
                if normalize_attention_status(attention_status) == "none" {
                    "completed".to_string()
                } else {
                    "paused".to_string()
                }
            }
        },
        _ => {
            if normalize_attention_status(attention_status) == "none" {
                "cancelled".to_string()
            } else {
                "paused".to_string()
            }
        }
    }
}

pub fn derive_legacy_run_status(
    lifecycle_status: &str,
    outcome_status: &str,
    attention_status: &str,
) -> String {
    match normalize_lifecycle_status(lifecycle_status).as_str() {
        "queued" => "scheduled".to_string(),
        "validating" => "running".to_string(),
        "running" => "running".to_string(),
        "finished" => match normalize_outcome_status(outcome_status).as_str() {
            "success" => "completed".to_string(),
            "failed" => "failed".to_string(),
            _ => {
                if normalize_attention_status(attention_status) == "none" {
                    "completed".to_string()
                } else {
                    "paused".to_string()
                }
            }
        },
        _ => {
            if normalize_attention_status(attention_status) == "none" {
                "cancelled".to_string()
            } else {
                "paused".to_string()
            }
        }
    }
}

pub fn display_status_from_dimensions(
    lifecycle_status: &str,
    outcome_status: &str,
    attention_status: &str,
) -> String {
    let lifecycle = normalize_lifecycle_status(lifecycle_status);
    let outcome = normalize_outcome_status(outcome_status);
    let attention = normalize_attention_status(attention_status);
    match (lifecycle.as_str(), outcome.as_str(), attention.as_str()) {
        ("validating", _, _) => "validating".to_string(),
        ("running", _, _) => "running".to_string(),
        ("queued", _, _) => "scheduled".to_string(),
        ("finished", "success", _) => "completed".to_string(),
        ("finished", "failed", _) => "failed".to_string(),
        (_, _, "waiting_human") => "blocked".to_string(),
        (_, _, "blocked_by_policy") => "blocked".to_string(),
        (_, _, "blocked_by_environment") => "blocked".to_string(),
        ("stopped", _, "none") => "cancelled".to_string(),
        ("finished", "partial", _) => "failed".to_string(),
        _ => "unknown".to_string(),
    }
}

pub fn display_parameter_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => {
            if *flag {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
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

fn default_parameter_kind() -> String {
    "string".to_string()
}

fn default_job_enabled() -> bool {
    true
}

fn normalize_parameter_definition(definition: AutomationParameterDefinition) -> AutomationParameterDefinition {
    let kind = match definition.kind.trim().to_ascii_lowercase().as_str() {
        "boolean" => "boolean",
        "enum" => "enum",
        _ => "string",
    }
    .to_string();
    let key = slugify_key(if definition.key.trim().is_empty() {
        &definition.label
    } else {
        &definition.key
    });
    let label = normalize_required_text(&definition.label, &key);
    let options = if kind == "enum" {
        definition
            .options
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect()
    } else {
        Vec::new()
    };

    AutomationParameterDefinition {
        id: if definition.id.trim().is_empty() {
            new_id("auto-param")
        } else {
            definition.id
        },
        key: if key.is_empty() {
            new_id("param")
        } else {
            key
        },
        label,
        kind,
        description: normalize_optional_text(definition.description),
        required: definition.required,
        options,
        default_value: definition.default_value,
    }
}

fn normalize_job_name(value: &str, goal: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        derive_goal_title(goal)
    } else {
        trimmed.to_string()
    }
}

fn normalize_required_text(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.map(|entry| entry.trim().to_string()).filter(|entry| !entry.is_empty())
}

fn normalize_cron_expression(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = normalize_optional_text(value) else {
        return Ok(None);
    };
    Schedule::from_str(&raw)
        .map_err(|err| format!("Invalid cron expression: {err}"))?;
    Ok(Some(raw))
}

fn normalize_parameter_values(values: BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    values
        .into_iter()
        .filter_map(|(key, value)| {
            let normalized_key = slugify_key(&key);
            if normalized_key.is_empty() {
                None
            } else {
                Some((normalized_key, value))
            }
        })
        .collect()
}

fn merge_parameter_values(
    defaults: &BTreeMap<String, Value>,
    overrides: &BTreeMap<String, Value>,
) -> BTreeMap<String, Value> {
    let mut next = defaults.clone();
    for (key, value) in overrides {
        next.insert(key.clone(), value.clone());
    }
    next
}

fn slugify_key(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn automation_jobs_file() -> Result<PathBuf, String> {
    let base = automation_base_dir()?;
    Ok(base.join("automation-jobs.json"))
}

fn automation_runs_file() -> Result<PathBuf, String> {
    let base = automation_base_dir()?;
    Ok(base.join("automation-runs.json"))
}

fn automation_rules_file() -> Result<PathBuf, String> {
    let base = automation_base_dir()?;
    Ok(base.join("automation-rules.json"))
}

fn automation_base_dir() -> Result<PathBuf, String> {
    let base = data_local_dir()
        .ok_or_else(|| "Unable to locate local application data directory".to_string())?
        .join("multi-cli-studio");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base)
}

fn parse_time(value: &str) -> Option<DateTime<chrono::FixedOffset>> {
    DateTime::parse_from_rfc3339(value).ok()
}

pub fn normalize_scheduled_start_at(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .and_then(|item| parse_time(&item).map(|parsed| parsed.to_rfc3339()))
}

fn new_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}
