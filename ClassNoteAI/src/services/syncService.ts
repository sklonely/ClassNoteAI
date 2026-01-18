import { storageService } from './storageService';
import { Course, Lecture } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { offlineQueueService } from './offlineQueueService';

export class SyncService {
    constructor() {
        this.registerProcessors();
    }

    private registerProcessors(): void {
        // Register SYNC_PUSH processor
        offlineQueueService.registerProcessor('SYNC_PUSH', async (payload) => {
            await this.pushDataDirect(payload.baseUrl, payload.username, payload.options);
        });

        // Register SYNC_PULL processor
        offlineQueueService.registerProcessor('SYNC_PULL', async (payload) => {
            await this.pullDataDirect(payload.baseUrl, payload.username);
        });

        // Register DEVICE_REGISTER processor
        offlineQueueService.registerProcessor('DEVICE_REGISTER', async (payload) => {
            await this.registerDeviceDirect(payload.baseUrl, payload.username, payload.deviceId, payload.deviceName, payload.platform);
        });

        // Register DEVICE_DELETE processor
        offlineQueueService.registerProcessor('DEVICE_DELETE', async (payload) => {
            await this.deleteDeviceDirect(payload.baseUrl, payload.id);
        });
    }

    // ========== Queue-based Public API ==========

    async pushData(baseUrl: string, username: string, options?: { skipFiles?: boolean }): Promise<void> {
        await offlineQueueService.enqueue('SYNC_PUSH', { baseUrl, username, options });
    }

    async pullData(baseUrl: string, username: string): Promise<void> {
        await offlineQueueService.enqueue('SYNC_PULL', { baseUrl, username });
    }

    async sync(baseUrl: string, username: string): Promise<void> {
        await offlineQueueService.enqueue('SYNC_PUSH', { baseUrl, username, options: { skipFiles: false } });
        await offlineQueueService.enqueue('SYNC_PULL', { baseUrl, username });
    }

    async registerDevice(baseUrl: string, username: string, deviceId: string, deviceName: string, platform: string): Promise<void> {
        await offlineQueueService.enqueue('DEVICE_REGISTER', { baseUrl, username, deviceId, deviceName, platform });
    }

    async deleteDevice(baseUrl: string, id: string): Promise<void> {
        await offlineQueueService.enqueue('DEVICE_DELETE', { baseUrl, id });
    }

    // ========== Direct Methods (used by processors) ==========

    private async pushDataDirect(baseUrl: string, username: string, options?: { skipFiles?: boolean }): Promise<void> {
        try {
            const courses = await storageService.listCoursesSync();
            let lectures = await storageService.listLecturesSync();

            const updatedLectures = [...lectures];

            if (!options?.skipFiles) {
                for (let i = 0; i < updatedLectures.length; i++) {
                    const lecture = updatedLectures[i];
                    if (lecture.audio_path) {
                        try {
                            if (lecture.audio_path.startsWith('/')) {
                                const serverFilename = await this.uploadFile(baseUrl, lecture.audio_path);
                                updatedLectures[i] = {
                                    ...lecture,
                                    audio_path: serverFilename
                                };
                            }
                        } catch (e) {
                            console.warn(`[SyncService] Failed to upload audio for lecture ${lecture.id}:`, e);
                        }
                    }
                }
            }

            // Collect Notes
            const notes = [];
            for (const lecture of updatedLectures) {
                try {
                    const note = await storageService.getNote(lecture.id);
                    if (note) {
                        notes.push({
                            lecture_id: note.lecture_id,
                            title: note.title,
                            content: JSON.stringify({
                                summary: note.summary,
                                sections: note.sections,
                                qa_records: note.qa_records
                            }),
                            generated_at: note.generated_at,
                            is_deleted: note.is_deleted
                        });
                    }
                } catch (e) {
                    console.warn(`[SyncService] Failed to get note for lecture ${lecture.id}`, e);
                }
            }

            // Collect Subtitles (grouped by lecture)
            const subtitles: { lecture_id: string; items: any[] }[] = [];
            for (const lecture of updatedLectures) {
                try {
                    const subs = await storageService.getSubtitles(lecture.id);
                    subtitles.push({
                        lecture_id: lecture.id,
                        items: subs.map(s => ({
                            id: s.id,
                            lecture_id: s.lecture_id,
                            timestamp: s.timestamp,
                            text_en: s.text_en,
                            text_zh: s.text_zh,
                            sub_type: s.type,
                            confidence: s.confidence,
                            created_at: s.created_at,
                        }))
                    });
                } catch (e) {
                    console.warn(`[SyncService] Failed to get subtitles for lecture ${lecture.id}`, e);
                }
            }

            // Collect Settings (only syncable keys)
            const SYNCABLE_SETTING_KEYS = [
                'server.url', 'ollama.host', 'ollama.model', 'ollama.aiModels',
                'translation.provider', 'translation.google_api_key',
                'subtitle.font_size', 'subtitle.font_color', 'subtitle.display_mode',
                'subtitle.position', 'theme'
            ];
            const allSettings = await storageService.getAllSettings();
            const settings: { key: string; value: string; updated_at: string }[] = [];
            for (const key of SYNCABLE_SETTING_KEYS) {
                if (allSettings[key]) {
                    settings.push({
                        key,
                        value: allSettings[key],
                        updated_at: new Date().toISOString(), // Note: Settings don't have per-key updated_at currently
                    });
                }
            }

            // Collect Chat Sessions and Messages
            const chatSessionsRaw = await invoke<any[]>('get_all_chat_sessions', { userId: username }).catch(() => []);
            const chatSessions = chatSessionsRaw.map((s: any) => ({
                id: s[0],
                lecture_id: s[1],
                title: s[3],
                summary: s[4],
                created_at: s[5],
                updated_at: s[6],
                is_deleted: s[7],
            }));

            const chatMessagesRaw = await invoke<any[]>('get_all_chat_messages', { userId: username }).catch(() => []);
            const chatMessages = chatMessagesRaw.map((m: any) => ({
                id: m[0],
                session_id: m[1],
                role: m[2],
                content: m[3],
                sources: m[4],
                timestamp: m[5],
            }));

            const payload = {
                username,
                courses: courses.map(c => ({
                    ...c,
                    username: c.user_id || username,
                    syllabus_info: c.syllabus_info ? JSON.stringify(c.syllabus_info) : null,
                    is_deleted: c.is_deleted
                })),
                lectures: updatedLectures,
                notes,
                subtitles,
                settings,
                chat_sessions: chatSessions,
                chat_messages: chatMessages,
            };

            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(`${baseUrl}/api/sync/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            } as any);

            if (!response.ok) {
                throw new Error(`Sync Push failed: ${response.status} ${response.statusText}`);
            }

            console.log('Sync Push successful');
        } catch (error) {
            console.error('Sync Push error:', error);
            throw error;
        }
    }

    private async pullDataDirect(baseUrl: string, username: string): Promise<{ courses: number; lectures: number }> {
        try {
            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(`${baseUrl}/api/sync/pull?username=${encodeURIComponent(username)}`, {
                method: 'GET',
            } as any);

            if (!response.ok) {
                throw new Error(`Sync Pull failed: ${response.status} ${response.statusText}`);
            }

            const data: {
                courses: Course[];
                lectures: Lecture[];
                notes?: any[];
                subtitles?: any[];
                settings?: any[];
                chat_sessions?: any[];
                chat_messages?: any[];
            } = await response.json();

            let coursesCount = 0;
            let lecturesCount = 0;

            // 1. Sync Courses (LWW)
            for (const serverCourse of data.courses) {
                // Parse syllabus_info if string
                const parsedCourse: any = { ...serverCourse };
                if (typeof serverCourse.syllabus_info === 'string') {
                    try {
                        parsedCourse.syllabus_info = JSON.parse(serverCourse.syllabus_info);
                    } catch (e) {
                        console.warn(`[SyncService] Failed to parse syllabus_info for course ${serverCourse.id}`, e);
                        parsedCourse.syllabus_info = undefined;
                    }
                }

                // Check local state
                const localCourse = await storageService.getCourse(serverCourse.id);

                let shouldUpdate = false;
                if (!localCourse) {
                    // Local missing: Insert (even if deleted on server - strictly we should Insert as deleted to keep tombstone)
                    shouldUpdate = true;
                } else {
                    // Compare timestamps
                    const serverTime = new Date(serverCourse.updated_at || serverCourse.created_at).getTime();
                    const localTime = new Date(localCourse.updated_at || localCourse.created_at).getTime();
                    if (serverTime > localTime) {
                        shouldUpdate = true;
                    }
                }

                if (shouldUpdate) {
                    console.log(`[SyncService] Updating course ${serverCourse.id} (Server newer)`);
                    await storageService.saveCourse(parsedCourse);
                    coursesCount++;
                }
            }

            // 2. Sync Lectures (LWW)
            const audioDir = await invoke<string>('get_audio_dir');

            for (const serverLecture of data.lectures) {
                const localLecture = await storageService.getLecture(serverLecture.id);

                let shouldUpdate = false;
                if (!localLecture) {
                    shouldUpdate = true;
                } else {
                    const serverTime = new Date(serverLecture.updated_at).getTime();
                    const localTime = new Date(localLecture.updated_at || localLecture.created_at).getTime();
                    if (serverTime > localTime) {
                        shouldUpdate = true;
                    }
                }

                if (shouldUpdate) {
                    console.log(`[SyncService] Updating lecture ${serverLecture.id} (Server newer)`);

                    // Handle Audio Download ONLY if active (not deleted)
                    // If deleted, we don't need audio, but we need tombstone record.
                    if (!serverLecture.is_deleted && serverLecture.audio_path && !serverLecture.audio_path.startsWith('/')) {
                        const sep = navigator.userAgent.includes('Win') ? '\\' : '/';
                        const localPath = `${audioDir}${audioDir.endsWith(sep) ? '' : sep}${serverLecture.audio_path}`;

                        try {
                            const downloadUrl = `${baseUrl.replace(/\/$/, '')}/api/files/download/${serverLecture.audio_path}`;
                            // Check if file exists locally? downloadFile overwrites usually.
                            await this.downloadFile(downloadUrl, localPath);
                            serverLecture.audio_path = localPath;
                        } catch (e) {
                            console.error(`[SyncService] Failed to download audio for ${serverLecture.id}:`, e);
                            // Keep server path if download fails? Or clear it? 
                            // Better keep it to allow retry later, or fallback.
                        }
                    }

                    await storageService.saveLecture(serverLecture);
                    lecturesCount++;
                }
            }

            // 3. Sync Notes (LWW)
            let notesCount = 0;
            if (data.notes) {
                for (const serverNote of data.notes) {
                    // Check local note
                    // storageService.getNote returns Note | null. 
                    // Assuming getNote returns deleted notes too (it generally should by ID).
                    const localNote = await storageService.getNote(serverNote.lecture_id);

                    let shouldUpdate = false;
                    if (!localNote) {
                        shouldUpdate = true;
                    } else {
                        const serverTime = new Date(serverNote.generated_at).getTime();
                        const localTime = new Date(localNote.generated_at).getTime(); // Note uses generated_at as primary timestamp?
                        // Note: generated_at might not technically be "updated_at", but it's what we have.
                        // Ideally we should add updated_at to Note table. 
                        // But if generated_at changes on each save (which it seemingly does in save_note), it acts as updated_at.

                        if (serverTime > localTime) {
                            shouldUpdate = true;
                        }
                    }

                    if (shouldUpdate) {
                        try {
                            let parsedContent: any;
                            try {
                                parsedContent = typeof serverNote.content === 'string' ? JSON.parse(serverNote.content) : serverNote.content;
                            } catch (e) {
                                console.warn(`[SyncService] Failed to parse note content for ${serverNote.lecture_id}`, e);
                                parsedContent = { sections: [], qa_records: [] };
                            }

                            const noteObj: any = {
                                lecture_id: serverNote.lecture_id,
                                title: serverNote.title,
                                generated_at: serverNote.generated_at,
                                summary: parsedContent.summary,
                                sections: parsedContent.sections || [],
                                qa_records: parsedContent.qa_records || [],
                                is_deleted: serverNote.is_deleted // Now valid boolean
                            };

                            console.log(`[SyncService] Updating note for ${serverNote.lecture_id} (Server newer)`);
                            await storageService.saveNote(noteObj);
                            notesCount++;
                        } catch (e) {
                            console.error(`[SyncService] Failed to save synced note for ${serverNote.lecture_id}:`, e);
                        }
                    }
                }
            }

            // 4. Sync Subtitles (Lecture-level full replacement)
            // Track which lectures were updated (Server newer)
            const updatedLectureIds = new Set<string>();
            for (const serverLecture of data.lectures) {
                const localLecture = await storageService.getLecture(serverLecture.id);
                if (!localLecture) {
                    updatedLectureIds.add(serverLecture.id);
                } else {
                    const serverTime = new Date(serverLecture.updated_at).getTime();
                    const localTime = new Date(localLecture.updated_at || localLecture.created_at).getTime();
                    if (serverTime > localTime) {
                        updatedLectureIds.add(serverLecture.id);
                    }
                }
            }

            let subtitlesCount = 0;
            if (data.subtitles && data.subtitles.length > 0) {
                // Group subtitles by lecture_id
                const subtitlesByLecture: Record<string, any[]> = {};
                for (const sub of data.subtitles) {
                    if (!subtitlesByLecture[sub.lecture_id]) {
                        subtitlesByLecture[sub.lecture_id] = [];
                    }
                    subtitlesByLecture[sub.lecture_id].push(sub);
                }

                for (const [lectureId, subs] of Object.entries(subtitlesByLecture)) {
                    if (updatedLectureIds.has(lectureId)) {
                        try {
                            // Delete existing subtitles
                            await invoke('delete_subtitles_by_lecture', { lectureId });
                            // Save new subtitles
                            const subtitlesToSave = subs.map((s: any) => ({
                                id: s.id,
                                lecture_id: s.lecture_id,
                                timestamp: s.timestamp,
                                text_en: s.text_en,
                                text_zh: s.text_zh,
                                type: s.sub_type, // Convert back to 'type'
                                confidence: s.confidence,
                                created_at: s.created_at,
                            }));
                            await storageService.saveSubtitles(subtitlesToSave);
                            subtitlesCount += subtitlesToSave.length;
                            console.log(`[SyncService] Updated ${subtitlesToSave.length} subtitles for lecture ${lectureId}`);
                        } catch (e) {
                            console.error(`[SyncService] Failed to sync subtitles for ${lectureId}:`, e);
                        }
                    }
                }
            }

            // 5. Sync Settings (LWW per key)
            let settingsCount = 0;
            if (data.settings && data.settings.length > 0) {
                for (const serverSetting of data.settings) {
                    try {
                        // For now, always apply server settings (no local updated_at tracking)
                        // In a more complete implementation, we'd compare updated_at
                        await storageService.saveSetting(serverSetting.key, serverSetting.value);
                        settingsCount++;
                    } catch (e) {
                        console.error(`[SyncService] Failed to sync setting ${serverSetting.key}:`, e);
                    }
                }
                console.log(`[SyncService] Synced ${settingsCount} settings`);
            }

            // 6. Sync Chat Sessions and Messages (LWW by session)
            let chatSessionsCount = 0;
            let chatMessagesCount = 0;
            if (data.chat_sessions && data.chat_sessions.length > 0) {
                for (const serverSession of data.chat_sessions) {
                    try {
                        await invoke('save_chat_session', {
                            id: serverSession.id,
                            lectureId: serverSession.lecture_id,
                            userId: username,
                            title: serverSession.title,
                            summary: serverSession.summary,
                            createdAt: serverSession.created_at,
                            updatedAt: serverSession.updated_at,
                            isDeleted: serverSession.is_deleted ?? false,
                        });
                        chatSessionsCount++;
                    } catch (e) {
                        console.error(`[SyncService] Failed to sync chat session ${serverSession.id}:`, e);
                    }
                }
            }

            if (data.chat_messages && data.chat_messages.length > 0) {
                // Group by session and replace
                const messagesBySession: Record<string, any[]> = {};
                for (const msg of data.chat_messages) {
                    if (!messagesBySession[msg.session_id]) {
                        messagesBySession[msg.session_id] = [];
                    }
                    messagesBySession[msg.session_id].push(msg);
                }

                for (const [sessionId, msgs] of Object.entries(messagesBySession)) {
                    try {
                        await invoke('delete_chat_messages_by_session', { sessionId });
                        for (const msg of msgs) {
                            await invoke('save_chat_message', {
                                id: msg.id,
                                sessionId: msg.session_id,
                                role: msg.role,
                                content: msg.content,
                                sources: msg.sources,
                                timestamp: msg.timestamp,
                            });
                            chatMessagesCount++;
                        }
                    } catch (e) {
                        console.error(`[SyncService] Failed to sync chat messages for session ${sessionId}:`, e);
                    }
                }
            }

            console.log(`Sync Pull successful: ${coursesCount} courses, ${lecturesCount} lectures, ${notesCount} notes, ${subtitlesCount} subtitles, ${settingsCount} settings, ${chatSessionsCount} chat sessions, ${chatMessagesCount} chat messages synced`);
            return { courses: coursesCount, lectures: lecturesCount };
        } catch (error) {
            console.error('Sync Pull error:', error);
            throw error;
        }
    }

    async uploadFile(baseUrl: string, filePath: string): Promise<string> {
        try {
            console.log(`[SyncService] Uploading file: ${filePath} to ${baseUrl}`);
            const filename = await invoke<string>('upload_file', {
                serverUrl: baseUrl.replace(/\/$/, ''),
                filePath
            });
            console.log(`[SyncService] Upload successful, server filename: ${filename}`);
            return filename;
        } catch (error) {
            console.error('[SyncService] Upload failed:', error);
            throw error;
        }
    }

    async downloadFile(downloadUrl: string, savePath: string): Promise<void> {
        try {
            console.log(`[SyncService] Downloading file: ${downloadUrl} to ${savePath}`);
            await invoke('download_file', { url: downloadUrl, savePath });
            console.log('[SyncService] Download successful');
        } catch (error) {
            console.error('[SyncService] Download failed:', error);
            throw error;
        }
    }

    // ========== Device Management (Direct) ==========

    private async registerDeviceDirect(baseUrl: string, username: string, deviceId: string, deviceName: string, platform: string): Promise<void> {
        try {
            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(`${baseUrl.replace(/\/$/, '')}/api/devices/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deviceId, username, name: deviceName, platform }),
            } as any);
            if (!response.ok) throw new Error(`Register failed: ${response.status}`);
        } catch (error) {
            console.error('[SyncService] Register device failed:', error);
            throw error;
        }
    }

    async getDevices(baseUrl: string, username: string): Promise<any[]> {
        try {
            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(`${baseUrl.replace(/\/$/, '')}/api/devices?username=${encodeURIComponent(username)}`);
            if (!response.ok) throw new Error(`Get devices failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('[SyncService] Get devices failed:', error);
            throw error;
        }
    }

    private async deleteDeviceDirect(baseUrl: string, id: string): Promise<void> {
        try {
            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(`${baseUrl.replace(/\/$/, '')}/api/devices/${id}`, {
                method: 'DELETE',
            } as any);
            if (!response.ok) throw new Error(`Delete device failed: ${response.status}`);
        } catch (error) {
            console.error('[SyncService] Delete device failed:', error);
            throw error;
        }
    }
}

export const syncService = new SyncService();
