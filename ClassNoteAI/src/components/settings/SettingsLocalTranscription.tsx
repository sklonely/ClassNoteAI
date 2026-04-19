import { Mic } from "lucide-react";
import WhisperModelManager from "../WhisperModelManager";
import { Card } from "./shared";
import LocalModelExperimentalSettings from "./LocalModelExperimentalSettings";

export default function SettingsLocalTranscription() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="本地轉錄模型（Whisper）"
        icon={<Mic className="w-5 h-5 text-blue-500" />}
        subtitle="全程離線、無額外費用。模型檔案只下載一次。"
      >
        <div className="space-y-4">
          <WhisperModelManager />
          <LocalModelExperimentalSettings />
        </div>
      </Card>
    </div>
  );
}
