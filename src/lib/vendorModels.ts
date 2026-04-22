import { useCallback, useEffect, useState } from "react";
import type { AgentId } from "./models";

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

const LEGACY_STORAGE_KEY_ALIASES: Record<string, string[]> = {
  "claude-custom-models": [
    "mossx-claude-custom-models",
    "codemoss-claude-custom-models",
  ],
  "codex-custom-models": [
    "mossx-codex-custom-models",
    "codemoss-codex-custom-models",
  ],
  "gemini-custom-models": [
    "mossx-gemini-custom-models",
    "codemoss-gemini-custom-models",
  ],
};

export function isValidVendorModelId(id: string) {
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 256;
}

function parseVendorModels(value: string | null): VendorCustomModel[] {
  if (!value) {
    return [];
  }
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) {
      return [];
    }
    const models: VendorCustomModel[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<VendorCustomModel>;
      if (typeof candidate.id !== "string" || !isValidVendorModelId(candidate.id)) {
        continue;
      }
      const id = candidate.id.trim();
      const label =
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : id;
      const description =
        typeof candidate.description === "string" && candidate.description.trim()
          ? candidate.description.trim()
          : undefined;
      models.push({ id, label, description });
    }
    return models;
  } catch {
    return [];
  }
}

export function readVendorModels(storageKey: string): VendorCustomModel[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const canonicalRaw = window.localStorage.getItem(storageKey);
  const canonical = parseVendorModels(canonicalRaw);
  if (canonicalRaw !== null) {
    return canonical;
  }

  const legacyKeys = LEGACY_STORAGE_KEY_ALIASES[storageKey] ?? [];
  for (const legacyKey of legacyKeys) {
    const legacyModels = parseVendorModels(window.localStorage.getItem(legacyKey));
    if (legacyModels.length === 0) {
      continue;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(legacyModels));
      window.dispatchEvent(
        new CustomEvent("localStorageChange", { detail: { key: storageKey } }),
      );
    } catch {
      // ignore migration write failures
    }
    return legacyModels;
  }

  return [];
}

export function writeVendorModels(storageKey: string, models: VendorCustomModel[]) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(models));
    window.dispatchEvent(
      new CustomEvent("localStorageChange", { detail: { key: storageKey } }),
    );
  } catch {
    // ignore localStorage write failures
  }
}

export function useVendorModels(storageKey: string) {
  const [models, setModels] = useState<VendorCustomModel[]>(() =>
    readVendorModels(storageKey),
  );

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setModels(readVendorModels(storageKey));
      }
    };
    const handleCustomChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === storageKey) {
        setModels(readVendorModels(storageKey));
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageChange", handleCustomChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomChange);
    };
  }, [storageKey]);

  const updateModels = useCallback(
    (nextModels: VendorCustomModel[]) => {
      setModels(nextModels);
      writeVendorModels(storageKey, nextModels);
    },
    [storageKey],
  );

  return {
    models,
    updateModels,
  };
}
