import {
  isValidVendorModelId,
  type VendorCustomModel,
  type VendorTab,
  VENDOR_MODEL_STORAGE_KEYS,
} from "../../../lib/vendorModels";

export { isValidVendorModelId, VENDOR_MODEL_STORAGE_KEYS };
export type { VendorCustomModel, VendorTab };

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
