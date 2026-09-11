import { useState } from "react";
import { Modal } from "./ui/Modal";
import type { NotificationSettings } from "../hooks/types";
import { NotificationsSettingsTab } from "./settings/NotificationsSettingsTab";
import { AgentSettingsTab } from "./settings/AgentSettingsTab";
import { SessionsSettingsTab } from "./settings/SessionsSettingsTab";
import { AppearanceSettingsTab } from "./settings/AppearanceSettingsTab";
import { PrivacySettingsTab, DeveloperSettingsTab } from "./settings/PrivacyDeveloperSettingsTabs";
import { AboutSettingsTab } from "./settings/AboutSettingsTab";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notificationSettings?: NotificationSettings | null;
  onSaveNotificationSettings?: (s: NotificationSettings) => void;
}

type SettingsTab =
  | "agent"
  | "sessions"
  | "notifications"
  | "appearance"
  | "privacy"
  | "developer"
  | "about";

const TABS: { value: SettingsTab; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "sessions", label: "Sessions" },
  { value: "notifications", label: "Notifications" },
  { value: "appearance", label: "Appearance" },
  { value: "privacy", label: "Privacy" },
  { value: "developer", label: "Developer" },
  { value: "about", label: "About" },
];

export function SettingsModal({
  isOpen,
  onClose,
  notificationSettings,
  onSaveNotificationSettings,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("agent");

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="lg">
      <div className="flex gap-0 h-[460px]">
        <div className="w-40 shrink-0 border-r border-ov-border -ml-5 -my-5 pl-5 pt-5 sticky top-0 self-start">
          <nav className="flex flex-col gap-0.5 pr-4">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`text-left px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === tab.value
                    ? "bg-accent-muted text-accent"
                    : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0 pl-5 pr-5 overflow-y-auto">
          {activeTab === "agent" && <AgentSettingsTab key="agent" />}
          {activeTab === "sessions" && <SessionsSettingsTab key="sessions" />}
          {activeTab === "notifications" && (
            <NotificationsSettingsTab
              key="notifications"
              settings={notificationSettings ?? null}
              onSave={(s) => onSaveNotificationSettings?.(s)}
            />
          )}
          {activeTab === "appearance" && <AppearanceSettingsTab key="appearance" />}
          {activeTab === "privacy" && <PrivacySettingsTab key="privacy" />}
          {activeTab === "developer" && <DeveloperSettingsTab key="developer" />}
          {activeTab === "about" && <AboutSettingsTab key="about" />}
        </div>
      </div>
    </Modal>
  );
}
