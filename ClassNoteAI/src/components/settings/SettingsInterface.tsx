import { Monitor } from "lucide-react";
import { Card } from "./shared";
import AiTutorDisplaySettings from "./AiTutorDisplaySettings";
import VideoLayoutSettings from "./VideoLayoutSettings";

/**
 * v0.6.1: 介面與顯示 tab — houses layout / panel-arrangement settings
 * that aren't tied to a specific data-source category. Previously
 * these (AI-tutor display mode, video+PDF layout) were crammed into
 * the 雲端 AI 助理 card even though only one of them is cloud-related.
 * Split out into its own tab under 其他 so each tab's subject matter
 * matches its content.
 *
 * Content belongs here when the toggle is purely about "where on screen"
 * or "which layout"; user-visible behaviour that hits a specific
 * subsystem (local Whisper, cloud LLM, translation) lives in that
 * subsystem's own tab.
 */
export default function SettingsInterface() {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <Card
                title="介面與顯示"
                icon={<Monitor className="w-5 h-5 text-slate-500" />}
                subtitle="視窗、面板與輔助介面的排版方式。"
            >
                <div className="space-y-4">
                    <AiTutorDisplaySettings />
                    <VideoLayoutSettings />
                </div>
            </Card>
        </div>
    );
}
