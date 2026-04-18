import { Brain } from "lucide-react";
import AIProviderSettings from "../AIProviderSettings";
import { Card } from "./shared";
import UsageSummary from "./UsageSummary";
import OcrSettings from "./OcrSettings";

export default function SettingsCloudAI() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="雲端 AI 助理"
        icon={<Brain className="w-5 h-5 text-indigo-500" />}
        subtitle="供摘要、Q&A、關鍵字、PDF OCR 使用。選一個服務即可 — 其他服務的設定會自動隱藏。"
      >
        <div className="space-y-4">
          <AIProviderSettings />
          <OcrSettings />
          <UsageSummary />
        </div>
      </Card>
    </div>
  );
}
