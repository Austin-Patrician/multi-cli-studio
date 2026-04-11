use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    str::FromStr,
};

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
pub struct AutomationWorkflowNodeDraft {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub expected_outcome: String,
    #[serde(
        default = "default_workflow_node_execution_mode",
        alias = "executionModeOverride"
    )]
    pub execution_mode: String,
    #[serde(
        default = "default_workflow_node_permission_profile",
        alias = "permissionProfileOverride"
    )]
    pub permission_profile: String,
    #[serde(default = "default_reuse_session")]
    pub reuse_session: bool,
    #[serde(default)]
    pub layout: Option<AutomationWorkflowNodeLayout>,
    #[serde(default)]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowEdgeDraft {
    pub from_node_id: String,
    #[serde(rename = "on")]
    pub on_result: String,
    pub to_node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowDraft {
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cron_expression: Option<String>,
    #[serde(default)]
    pub email_notification_enabled: bool,
    #[serde(default = "default_workflow_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub entry_node_id: Option<String>,
    #[serde(default = "default_workflow_context_strategy")]
    pub default_context_strategy: String,
    #[serde(default = "default_execution_mode")]
    pub default_execution_mode: String,
    #[serde(default = "default_permission_profile")]
    pub default_permission_profile: String,
    pub nodes: Vec<AutomationWorkflowNodeDraft>,
    #[serde(default)]
    pub edges: Vec<AutomationWorkflowEdgeDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowNode {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub expected_outcome: String,
    #[serde(
        default = "default_workflow_node_execution_mode",
        alias = "executionModeOverride"
    )]
    pub execution_mode: String,
    #[serde(
        default = "default_workflow_node_permission_profile",
        alias = "permissionProfileOverride"
    )]
    pub permission_profile: String,
    #[serde(default = "default_reuse_session")]
    pub reuse_session: bool,
    #[serde(default)]
    pub layout: Option<AutomationWorkflowNodeLayout>,
    #[serde(default)]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowNodeLayout {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowEdge {
    pub from_node_id: String,
    #[serde(rename = "on")]
    pub on_result: String,
    pub to_node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflow {
    pub id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cron_expression: Option<String>,
    #[serde(default)]
    pub last_triggered_at: Option<String>,
    #[serde(default)]
    pub email_notification_enabled: bool,
    #[serde(default = "default_workflow_enabled")]
    pub enabled: bool,
    pub entry_node_id: String,
    #[serde(default = "default_workflow_context_strategy")]
    pub default_context_strategy: String,
    #[serde(default = "default_execution_mode")]
    pub default_execution_mode: String,
    #[serde(default = "default_permission_profile")]
    pub default_permission_profile: String,
    pub nodes: Vec<AutomationWorkflowNode>,
    #[serde(default)]
    pub edges: Vec<AutomationWorkflowEdge>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCliSessionRef {
    pub cli_id: String,
    pub kind: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationWorkflowRunRequest {
    pub workflow_id: String,
    #[serde(default)]
    pub scheduled_start_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowNodeRun {
    pub id: String,
    pub workflow_run_id: String,
    pub node_id: String,
    pub label: String,
    pub goal: String,
    #[serde(default)]
    pub automation_run_id: Option<String>,
    pub status: String,
    #[serde(default)]
    pub branch_result: Option<String>,
    #[serde(default)]
    pub used_cli: Option<String>,
    #[serde(default)]
    pub transport_session: Option<WorkflowCliSessionRef>,
    #[serde(default)]
    pub status_summary: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflowRun {
    pub id: String,
    pub workflow_id: String,
    pub workflow_name: String,
    pub trigger_source: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub status: String,
    #[serde(default)]
    pub status_summary: Option<String>,
    #[serde(default)]
    pub scheduled_start_at: Option<String>,
    pub shared_terminal_tab_id: String,
    pub entry_node_id: String,
    #[serde(default)]
    pub current_node_id: Option<String>,
    #[serde(default)]
    pub email_notification_enabled: bool,
    #[serde(default)]
    pub cli_sessions: Vec<WorkflowCliSessionRef>,
    #[serde(default)]
    pub node_runs: Vec<AutomationWorkflowNodeRun>,
    #[serde(default)]
    pub events: Vec<AutomationEvent>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
    #[serde(default)]
    pub workflow_run_id: Option<String>,
    #[serde(default)]
    pub workflow_node_id: Option<String>,
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
    let mut jobs =
        serde_json::from_str::<Vec<AutomationJob>>(&raw).map_err(|err| err.to_string())?;
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

pub fn load_workflows() -> Result<Vec<AutomationWorkflow>, String> {
    let path = automation_workflows_file()?;
    if !path.exists() {
        persist_workflows(&[])?;
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut workflows =
        serde_json::from_str::<Vec<AutomationWorkflow>>(&raw).map_err(|err| err.to_string())?;
    normalize_workflows_on_startup(&mut workflows, &[]);
    Ok(workflows)
}

pub fn persist_workflows(workflows: &[AutomationWorkflow]) -> Result<(), String> {
    let path = automation_workflows_file()?;
    let raw = serde_json::to_string_pretty(workflows).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

pub fn load_workflow_runs() -> Result<Vec<AutomationWorkflowRun>, String> {
    let path = automation_workflow_runs_file()?;
    if !path.exists() {
        persist_workflow_runs(&[])?;
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut runs =
        serde_json::from_str::<Vec<AutomationWorkflowRun>>(&raw).map_err(|err| err.to_string())?;
    normalize_workflow_runs_on_startup(&mut runs);
    Ok(runs)
}

pub fn persist_workflow_runs(runs: &[AutomationWorkflowRun]) -> Result<(), String> {
    let path = automation_workflow_runs_file()?;
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
        job.cron_expression = normalize_cron_expression(job.cron_expression.clone())
            .ok()
            .flatten();
        job.parameter_definitions = job
            .parameter_definitions
            .iter()
            .cloned()
            .map(normalize_parameter_definition)
            .collect();
    }
}

pub fn normalize_workflows_on_startup(
    workflows: &mut [AutomationWorkflow],
    jobs: &[AutomationJob],
) {
    for workflow in workflows {
        workflow.name = normalize_required_text(&workflow.name, "工作流");
        workflow.project_name = normalize_required_text(&workflow.project_name, "Workspace");
        workflow.cron_expression = normalize_cron_expression(workflow.cron_expression.clone())
            .ok()
            .flatten();
        workflow.default_context_strategy =
            normalize_workflow_context_strategy(&workflow.default_context_strategy);
        workflow.default_execution_mode =
            normalize_execution_mode(&workflow.default_execution_mode);
        workflow.default_permission_profile =
            normalize_permission_profile(&workflow.default_permission_profile);
        for (index, node) in workflow.nodes.iter_mut().enumerate() {
            let legacy_job = node
                .job_id
                .as_deref()
                .and_then(|job_id| jobs.iter().find(|job| job.id == job_id));
            if node.goal.trim().is_empty() {
                if let Some(job) = legacy_job {
                    node.goal = job.goal.clone();
                }
            }
            if node.expected_outcome.trim().is_empty() {
                if let Some(job) = legacy_job {
                    node.expected_outcome = job.expected_outcome.clone();
                }
            }
            node.label = normalize_workflow_node_label(
                Some(node.label.clone()),
                &derive_goal_title(&node.goal),
            );
            node.goal = normalize_required_text(&node.goal, "");
            node.expected_outcome = normalize_required_text(&node.expected_outcome, "");
            let normalized_node_execution_mode =
                normalize_workflow_node_execution_mode(&node.execution_mode);
            let normalized_node_permission_profile =
                normalize_workflow_node_permission_profile(&node.permission_profile);
            if matches!(normalized_node_execution_mode.as_str(), "inherit")
                && legacy_job.is_some()
                && node.goal == legacy_job.map(|job| job.goal.clone()).unwrap_or_default()
            {
                node.execution_mode = legacy_job
                    .map(|job| normalize_execution_mode(&job.default_execution_mode))
                    .unwrap_or(normalized_node_execution_mode);
            } else {
                node.execution_mode = normalized_node_execution_mode;
            }
            if matches!(normalized_node_permission_profile.as_str(), "inherit")
                && legacy_job.is_some()
                && node.expected_outcome
                    == legacy_job
                        .map(|job| job.expected_outcome.clone())
                        .unwrap_or_default()
            {
                node.permission_profile = legacy_job
                    .map(|job| normalize_permission_profile(&job.permission_profile))
                    .unwrap_or(normalized_node_permission_profile);
            } else {
                node.permission_profile = normalized_node_permission_profile;
            }
            let normalized_layout = node
                .layout
                .clone()
                .filter(|layout| layout.x.is_finite() && layout.y.is_finite())
                .unwrap_or_else(|| default_workflow_node_layout_for_index(index));
            node.layout = Some(normalized_layout);
        }
        if let Some(first_node) = workflow.nodes.first() {
            if workflow
                .nodes
                .iter()
                .all(|node| node.id != workflow.entry_node_id)
            {
                workflow.entry_node_id = first_node.id.clone();
            }
        }
    }
}

pub fn normalize_workflow_runs_on_startup(runs: &mut [AutomationWorkflowRun]) {
    let now = now_rfc3339();
    for run in runs {
        if run.status == "running" {
            run.status = "failed".to_string();
            run.status_summary =
                Some("The app restarted while this workflow was active. Re-run it from the workflow page.".to_string());
            run.completed_at = Some(now.clone());
            run.updated_at = now.clone();
            run.events.insert(
                0,
                AutomationEvent {
                    id: new_id("wf-event"),
                    run_id: run.id.clone(),
                    goal_id: run.current_node_id.clone(),
                    level: "warning".to_string(),
                    title: "Host restarted".to_string(),
                    detail: "The app restarted while this workflow was active. Re-run it from the workflow page."
                        .to_string(),
                    created_at: now.clone(),
                },
            );
        }

        for node_run in &mut run.node_runs {
            if run.status == "failed" && matches!(node_run.status.as_str(), "queued" | "running") {
                node_run.status = "failed".to_string();
                node_run.branch_result = Some("fail".to_string());
                node_run.status_summary = Some(
                    "The host restarted before this node finished. Re-run the workflow to continue."
                        .to_string(),
                );
                node_run.completed_at = Some(now.clone());
                node_run.updated_at = now.clone();
            }
        }
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
            || matches!(
                normalize_lifecycle_status(&run.lifecycle_status).as_str(),
                "running" | "validating"
            )
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
                "The app restarted while this run was active. Pending goals were re-queued.",
            );
        }

        for goal in &mut run.goals {
            goal.execution_mode = normalize_execution_mode(&goal.execution_mode);
            if goal.status == "running"
                || matches!(
                    normalize_lifecycle_status(&goal.lifecycle_status).as_str(),
                    "running" | "validating"
                )
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

pub fn update_job_from_draft(
    existing: &AutomationJob,
    draft: AutomationJobDraft,
) -> Result<AutomationJob, String> {
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

pub fn build_workflow_from_draft(
    draft: AutomationWorkflowDraft,
) -> Result<AutomationWorkflow, String> {
    let now = now_rfc3339();
    let normalized = normalize_workflow_draft(draft)?;
    Ok(AutomationWorkflow {
        id: new_id("wf"),
        workspace_id: normalized.workspace_id,
        project_root: normalized.project_root,
        project_name: normalized.project_name,
        name: normalized.name,
        description: normalized.description,
        cron_expression: normalized.cron_expression,
        last_triggered_at: None,
        email_notification_enabled: normalized.email_notification_enabled,
        enabled: normalized.enabled,
        entry_node_id: normalized.entry_node_id,
        default_context_strategy: normalized.default_context_strategy,
        default_execution_mode: normalized.default_execution_mode,
        default_permission_profile: normalized.default_permission_profile,
        nodes: normalized.nodes,
        edges: normalized.edges,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn update_workflow_from_draft(
    existing: &AutomationWorkflow,
    draft: AutomationWorkflowDraft,
) -> Result<AutomationWorkflow, String> {
    let normalized = normalize_workflow_draft(draft)?;
    let reset_last_trigger = normalized.cron_expression != existing.cron_expression;
    Ok(AutomationWorkflow {
        id: existing.id.clone(),
        workspace_id: normalized.workspace_id,
        project_root: normalized.project_root,
        project_name: normalized.project_name,
        name: normalized.name,
        description: normalized.description,
        cron_expression: normalized.cron_expression,
        last_triggered_at: if reset_last_trigger {
            None
        } else {
            existing.last_triggered_at.clone()
        },
        email_notification_enabled: normalized.email_notification_enabled,
        enabled: normalized.enabled,
        entry_node_id: normalized.entry_node_id,
        default_context_strategy: normalized.default_context_strategy,
        default_execution_mode: normalized.default_execution_mode,
        default_permission_profile: normalized.default_permission_profile,
        nodes: normalized.nodes,
        edges: normalized.edges,
        created_at: existing.created_at.clone(),
        updated_at: now_rfc3339(),
    })
}

pub fn build_workflow_run_from_workflow(
    workflow: &AutomationWorkflow,
    mut request: CreateAutomationWorkflowRunRequest,
) -> AutomationWorkflowRun {
    let now = now_rfc3339();
    request.scheduled_start_at = normalize_scheduled_start_at(request.scheduled_start_at);
    let is_scheduled = request
        .scheduled_start_at
        .as_deref()
        .and_then(parse_time)
        .map(|value| value.timestamp_millis() > Local::now().timestamp_millis() + 1000)
        .unwrap_or(false);
    let mut run = AutomationWorkflowRun {
        id: new_id("wf-run"),
        workflow_id: workflow.id.clone(),
        workflow_name: workflow.name.clone(),
        trigger_source: if is_scheduled {
            "schedule".to_string()
        } else {
            "manual".to_string()
        },
        workspace_id: workflow.workspace_id.clone(),
        project_root: workflow.project_root.clone(),
        project_name: workflow.project_name.clone(),
        status: "scheduled".to_string(),
        status_summary: Some(if is_scheduled {
            "Scheduled and waiting to start.".to_string()
        } else {
            "Queued to start immediately.".to_string()
        }),
        scheduled_start_at: request.scheduled_start_at,
        shared_terminal_tab_id: new_id("wf-tab"),
        entry_node_id: workflow.entry_node_id.clone(),
        current_node_id: Some(workflow.entry_node_id.clone()),
        email_notification_enabled: workflow.email_notification_enabled,
        cli_sessions: Vec::new(),
        node_runs: workflow
            .nodes
            .iter()
            .map(|node| AutomationWorkflowNodeRun {
                id: new_id("wf-node-run"),
                workflow_run_id: String::new(),
                node_id: node.id.clone(),
                label: node.label.clone(),
                goal: node.goal.clone(),
                automation_run_id: None,
                status: "queued".to_string(),
                branch_result: None,
                used_cli: None,
                transport_session: None,
                status_summary: Some("Waiting for dependency resolution.".to_string()),
                started_at: None,
                completed_at: None,
                updated_at: now.clone(),
            })
            .collect(),
        events: Vec::new(),
        started_at: None,
        completed_at: None,
        created_at: now.clone(),
        updated_at: now,
    };
    for node_run in &mut run.node_runs {
        node_run.workflow_run_id = run.id.clone();
        if node_run.node_id == run.entry_node_id {
            node_run.status_summary = Some("Ready to run as the entry node.".to_string());
        }
    }
    push_workflow_event(
        &mut run,
        None,
        "info",
        "Workflow run created",
        if is_scheduled {
            "The workflow run is queued and will start at the scheduled time."
        } else {
            "The workflow run is queued and will start immediately."
        },
    );
    run
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
        workflow_run_id: None,
        workflow_node_id: None,
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
        workflow_run_id: None,
        workflow_node_id: None,
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

fn default_workflow_enabled() -> bool {
    true
}

fn default_reuse_session() -> bool {
    true
}

fn default_workflow_context_strategy() -> String {
    "resume-per-cli".to_string()
}

fn default_workflow_node_execution_mode() -> String {
    "inherit".to_string()
}

fn default_workflow_node_permission_profile() -> String {
    "inherit".to_string()
}

fn default_workflow_node_layout_for_index(index: usize) -> AutomationWorkflowNodeLayout {
    AutomationWorkflowNodeLayout {
        x: 160.0 + (index as f64 % 3.0) * 320.0,
        y: 140.0 + (index / 3) as f64 * 220.0,
    }
}

fn normalize_parameter_definition(
    definition: AutomationParameterDefinition,
) -> AutomationParameterDefinition {
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
        key: if key.is_empty() { new_id("param") } else { key },
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

fn normalize_workflow_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "工作流".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_workflow_context_strategy(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "kernel-only" => "kernel-only".to_string(),
        "session-pool" => "session-pool".to_string(),
        _ => default_workflow_context_strategy(),
    }
}

fn normalize_workflow_node_execution_mode(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "codex" => "codex".to_string(),
        "claude" => "claude".to_string(),
        "gemini" => "gemini".to_string(),
        _ => default_workflow_node_execution_mode(),
    }
}

fn normalize_workflow_node_permission_profile(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "standard" => "standard".to_string(),
        "full-access" => "full-access".to_string(),
        "read-only" => "read-only".to_string(),
        _ => default_workflow_node_permission_profile(),
    }
}

fn normalize_workflow_node_label(value: Option<String>, fallback: &str) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn normalize_workflow_edge_on(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "success" => Ok("success".to_string()),
        "fail" => Ok("fail".to_string()),
        _ => Err("Workflow edges only support `success` or `fail`.".to_string()),
    }
}

struct NormalizedWorkflowDraft {
    workspace_id: String,
    project_root: String,
    project_name: String,
    name: String,
    description: Option<String>,
    cron_expression: Option<String>,
    email_notification_enabled: bool,
    enabled: bool,
    entry_node_id: String,
    default_context_strategy: String,
    default_execution_mode: String,
    default_permission_profile: String,
    nodes: Vec<AutomationWorkflowNode>,
    edges: Vec<AutomationWorkflowEdge>,
}

fn normalize_workflow_draft(
    draft: AutomationWorkflowDraft,
) -> Result<NormalizedWorkflowDraft, String> {
    if draft.nodes.is_empty() {
        return Err("At least one workflow node is required.".to_string());
    }

    let mut node_ids = BTreeSet::new();
    let nodes = draft
        .nodes
        .into_iter()
        .enumerate()
        .map(|(index, node)| {
            let node_id = node
                .id
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| new_id("wf-node"));
            if !node_ids.insert(node_id.clone()) {
                return Err("Workflow node ids must be unique.".to_string());
            }
            let fallback_label = format!("节点 {}", index + 1);
            Ok(AutomationWorkflowNode {
                id: node_id,
                job_id: node
                    .job_id
                    .and_then(|value| normalize_optional_text(Some(value))),
                label: normalize_workflow_node_label(
                    node.label,
                    &if node.goal.trim().is_empty() {
                        fallback_label.clone()
                    } else {
                        derive_goal_title(&node.goal)
                    },
                ),
                goal: normalize_required_text(&node.goal, ""),
                expected_outcome: normalize_required_text(&node.expected_outcome, ""),
                execution_mode: normalize_workflow_node_execution_mode(&node.execution_mode),
                permission_profile: normalize_workflow_node_permission_profile(
                    &node.permission_profile,
                ),
                reuse_session: node.reuse_session,
                layout: Some(
                    node.layout
                        .filter(|layout| layout.x.is_finite() && layout.y.is_finite())
                        .unwrap_or_else(|| default_workflow_node_layout_for_index(index)),
                ),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    if nodes.iter().any(|node| node.goal.trim().is_empty()) {
        return Err("Each workflow node must define a task goal.".to_string());
    }
    if nodes
        .iter()
        .any(|node| node.expected_outcome.trim().is_empty())
    {
        return Err("Each workflow node must define an expected outcome.".to_string());
    }

    let entry_node_id = draft
        .entry_node_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| nodes[0].id.clone());
    if !nodes.iter().any(|node| node.id == entry_node_id) {
        return Err("Workflow entry node is invalid.".to_string());
    }

    let mut edge_keys = BTreeSet::new();
    let edges = draft
        .edges
        .into_iter()
        .map(|edge| {
            let from_node_id = edge.from_node_id.trim().to_string();
            let to_node_id = edge.to_node_id.trim().to_string();
            if from_node_id.is_empty() || to_node_id.is_empty() {
                return Err(
                    "Workflow edges must reference both source and target nodes.".to_string(),
                );
            }
            if !nodes.iter().any(|node| node.id == from_node_id)
                || !nodes.iter().any(|node| node.id == to_node_id)
            {
                return Err("Workflow edges must reference existing nodes.".to_string());
            }
            let on_result = normalize_workflow_edge_on(&edge.on_result)?;
            if !edge_keys.insert((from_node_id.clone(), on_result.clone())) {
                return Err("Each workflow node can only have one edge per result.".to_string());
            }
            Ok(AutomationWorkflowEdge {
                from_node_id,
                on_result,
                to_node_id,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    validate_workflow_graph(&entry_node_id, &nodes, &edges)?;

    Ok(NormalizedWorkflowDraft {
        workspace_id: normalize_required_text(&draft.workspace_id, "workspace"),
        project_root: normalize_required_text(&draft.project_root, ""),
        project_name: normalize_required_text(&draft.project_name, "Workspace"),
        name: normalize_workflow_name(&draft.name),
        description: normalize_optional_text(draft.description),
        cron_expression: normalize_cron_expression(draft.cron_expression)?,
        email_notification_enabled: draft.email_notification_enabled,
        enabled: draft.enabled,
        entry_node_id,
        default_context_strategy: normalize_workflow_context_strategy(
            &draft.default_context_strategy,
        ),
        default_execution_mode: normalize_execution_mode(&draft.default_execution_mode),
        default_permission_profile: normalize_permission_profile(&draft.default_permission_profile),
        nodes,
        edges,
    })
}

fn validate_workflow_graph(
    entry_node_id: &str,
    nodes: &[AutomationWorkflowNode],
    edges: &[AutomationWorkflowEdge],
) -> Result<(), String> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    if !node_ids.contains(entry_node_id) {
        return Err("Workflow entry node is invalid.".to_string());
    }
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    for edge in edges {
        adjacency
            .entry(edge.from_node_id.clone())
            .or_default()
            .push(edge.to_node_id.clone());
    }

    fn dfs(
        node_id: &str,
        adjacency: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if !visiting.insert(node_id.to_string()) {
            return Err("Workflow loops are not supported in this version.".to_string());
        }
        if let Some(targets) = adjacency.get(node_id) {
            for target in targets {
                if !visited.contains(target) {
                    dfs(target, adjacency, visiting, visited)?;
                }
            }
        }
        visiting.remove(node_id);
        visited.insert(node_id.to_string());
        Ok(())
    }

    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    dfs(entry_node_id, &adjacency, &mut visiting, &mut visited)?;
    Ok(())
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
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn normalize_cron_expression(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = normalize_optional_text(value) else {
        return Ok(None);
    };
    Schedule::from_str(&raw).map_err(|err| format!("Invalid cron expression: {err}"))?;
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
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

fn automation_workflows_file() -> Result<PathBuf, String> {
    let base = automation_base_dir()?;
    Ok(base.join("automation-workflows.json"))
}

fn automation_workflow_runs_file() -> Result<PathBuf, String> {
    let base = automation_base_dir()?;
    Ok(base.join("automation-workflow-runs.json"))
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

pub fn push_workflow_event(
    run: &mut AutomationWorkflowRun,
    node_id: Option<&str>,
    level: &str,
    title: &str,
    detail: &str,
) {
    run.events.insert(
        0,
        AutomationEvent {
            id: new_id("wf-event"),
            run_id: run.id.clone(),
            goal_id: node_id.map(|value| value.to_string()),
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
