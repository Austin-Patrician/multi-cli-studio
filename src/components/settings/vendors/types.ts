import type { AgentId } from "../../../lib/models";

export type VendorTab = AgentId;

export interface VendorCustomModel {
  id: string;
  label: string;
  description?: string;
}

export const VENDOR_MODEL_STORAGE_KEYS = {
  claude: "claude-custom-models",
  codex: "codex-custom-models",
  gemini: "gemini-custom-models",
} as const satisfies Record<VendorTab, string>;

export type GeminiAuthMode =
  | "custom"
  | "login_google"
  | "gemini_api_key"
  | "vertex_adc"
  | "vertex_service_account"
  | "vertex_api_key";

export interface GeminiVendorDraft {
  enabled: boolean;
  envText: string;
  authMode: GeminiAuthMode;
  apiBaseUrl: string;
  geminiApiKey: string;
  googleApiKey: string;
  googleCloudProject: string;
  googleCloudLocation: string;
  googleApplicationCredentials: string;
  model: string;
}

export interface GeminiPreflightCheck {
  id: string;
  label: string;
  message: string;
  status: "pass" | "fail";
}

export const GEMINI_AUTH_MODES: GeminiAuthMode[] = [
  "custom",
  "login_google",
  "gemini_api_key",
  "vertex_adc",
  "vertex_service_account",
  "vertex_api_key",
];

export function isValidVendorModelId(id: string) {
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 256;
}
