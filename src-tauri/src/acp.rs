use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpCommand {
    pub kind: String,
    pub args: Vec<String>,
    pub raw_input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpOptionDef {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpOptionCatalog {
    pub supported: bool,
    pub options: Vec<AcpOptionDef>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpCliCapabilities {
    pub cli_id: String,
    pub model: AcpOptionCatalog,
    pub permissions: AcpOptionCatalog,
    pub effort: AcpOptionCatalog,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpCommandResult {
    pub success: bool,
    pub output: String,
    pub side_effects: Vec<AcpSideEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AcpSideEffect {
    ModelChanged { cli_id: String, model: String },
    PermissionChanged { cli_id: String, mode: String },
    EffortChanged { level: String },
    PlanModeToggled { active: bool },
    HistoryCleared,
    ContextCompacted,
    ConversationRewound { removed_turns: usize },
    UiNotification { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSession {
    pub model: HashMap<String, String>,
    pub permission_mode: HashMap<String, String>,
    pub effort_level: Option<String>,
    pub plan_mode: bool,
    pub fast_mode: bool,
}

impl Default for AcpSession {
    fn default() -> Self {
        Self {
            model: HashMap::new(),
            permission_mode: HashMap::new(),
            effort_level: None,
            plan_mode: false,
            fast_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpCommandDef {
    pub kind: String,
    pub slash: String,
    pub label: String,
    pub description: String,
    pub args_hint: Option<String>,
    pub execution: String,
    pub supported_clis: Vec<String>,
}

pub fn command_registry() -> Vec<AcpCommandDef> {
    vec![
        AcpCommandDef {
            kind: "plan".into(),
            slash: "/plan".into(),
            label: "Plan Mode".into(),
            description: "Toggle planning mode".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "model".into(),
            slash: "/model".into(),
            label: "Select Model".into(),
            description: "Change the model for the active CLI".into(),
            args_hint: Some("<model-name>".into()),
            execution: "flag-inject".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "compact".into(),
            slash: "/compact".into(),
            label: "Compact Context".into(),
            description: "Trim older conversation turns to free context space".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "clear".into(),
            slash: "/clear".into(),
            label: "Clear History".into(),
            description: "Clear conversation history for all CLIs".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "rewind".into(),
            slash: "/rewind".into(),
            label: "Rewind".into(),
            description: "Remove the last conversation turn".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "diff".into(),
            slash: "/diff".into(),
            label: "Git Diff".into(),
            description: "Show uncommitted changes in the project".into(),
            args_hint: None,
            execution: "git-local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "permissions".into(),
            slash: "/permissions".into(),
            label: "Permissions".into(),
            description: "Change sandbox/permission mode".into(),
            args_hint: Some("<mode>".into()),
            execution: "flag-inject".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "cost".into(),
            slash: "/cost".into(),
            label: "Usage/Cost".into(),
            description: "Show estimated token usage".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "help".into(),
            slash: "/help".into(),
            label: "Help".into(),
            description: "Show available commands".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "export".into(),
            slash: "/export".into(),
            label: "Export".into(),
            description: "Export conversation history as markdown".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "status".into(),
            slash: "/status".into(),
            label: "Status".into(),
            description: "Show CLI version, model, and connection info".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "effort".into(),
            slash: "/effort".into(),
            label: "Effort Level".into(),
            description: "Set reasoning effort for the active CLI".into(),
            args_hint: Some("[low|medium|high|max]".into()),
            execution: "flag-inject".into(),
            supported_clis: vec!["codex".into(), "claude".into()],
        },
        AcpCommandDef {
            kind: "fast".into(),
            slash: "/fast".into(),
            label: "Fast Mode".into(),
            description: "Toggle fast output mode (Claude only)".into(),
            args_hint: None,
            execution: "flag-inject".into(),
            supported_clis: vec!["claude".into()],
        },
        AcpCommandDef {
            kind: "context".into(),
            slash: "/context".into(),
            label: "Context Usage".into(),
            description: "Show context window usage per CLI".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
        AcpCommandDef {
            kind: "memory".into(),
            slash: "/memory".into(),
            label: "Memory".into(),
            description: "View/edit project memory files".into(),
            args_hint: None,
            execution: "local".into(),
            supported_clis: vec!["codex".into(), "claude".into(), "gemini".into()],
        },
    ]
}
