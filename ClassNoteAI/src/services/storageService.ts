import { invoke } from '@tauri-apps/api/core';
import type { Course, Lecture, Subtitle, Note, AppSettings } from '../types';
import { save, open } from '@tauri-apps/plugin-dialog';

/**
 * 數據存儲服務
 * 封裝所有與數據庫相關的 Tauri Commands
 */
class StorageService {
  /**
   * 保存科目
   */
  async saveCourse(course: Course): Promise<void> {
    await invoke('save_course', { course });
  }

  /**
   * 獲取科目
   */
  async getCourse(id: string): Promise<Course | null> {
    return await invoke<Course | null>('get_course', { id });
  }

  /**
   * 列出所有科目
   */
  async listCourses(): Promise<Course[]> {
    return await invoke<Course[]>('list_courses');
  }

  /**
   * 刪除科目
   */
  async deleteCourse(id: string): Promise<void> {
    await invoke('delete_course', { id });
  }

  /**
   * 列出特定科目的所有課堂
   */
  async listLecturesByCourse(courseId: string): Promise<Lecture[]> {
    return await invoke<Lecture[]>('list_lectures_by_course', { courseId });
  }

  /**
   * 保存課程
   */
  async saveLecture(lecture: Lecture): Promise<void> {
    await invoke('save_lecture', { lecture });
  }

  /**
   * 獲取課程
   */
  async getLecture(id: string): Promise<Lecture | null> {
    return await invoke<Lecture | null>('get_lecture', { id });
  }

  /**
   * 列出所有課程
   */
  async listLectures(): Promise<Lecture[]> {
    return await invoke<Lecture[]>('list_lectures');
  }

  /**
   * 刪除課程
   */
  async deleteLecture(id: string): Promise<void> {
    await invoke('delete_lecture', { id });
  }

  /**
   * 更新課程狀態
   */
  async updateLectureStatus(id: string, status: 'recording' | 'completed'): Promise<void> {
    await invoke('update_lecture_status', { id, status });
  }

  /**
   * 保存字幕
   */
  async saveSubtitle(subtitle: Subtitle): Promise<void> {
    await invoke('save_subtitle', { subtitle });
  }

  /**
   * 批量保存字幕
   */
  async saveSubtitles(subtitles: Subtitle[]): Promise<void> {
    await invoke('save_subtitles', { subtitles });
  }

  /**
   * 獲取課程的所有字幕
   */
  async getSubtitles(lectureId: string): Promise<Subtitle[]> {
    return await invoke<Subtitle[]>('get_subtitles', { lectureId });
  }

  /**
   * 刪除單條字幕
   */
  async deleteSubtitle(id: string): Promise<void> {
    await invoke('delete_subtitle', { id });
  }

  /**
   * 保存設置
   */
  async saveSetting(key: string, value: string): Promise<void> {
    await invoke('save_setting', { key, value });
  }

  /**
   * 獲取設置
   */
  async getSetting(key: string): Promise<string | null> {
    return await invoke<string | null>('get_setting', { key });
  }

  /**
   * 獲取所有設置
   */
  async getAllSettings(): Promise<Record<string, string>> {
    const settings = await invoke<Array<{ key: string; value: string }>>('get_all_settings');
    const result: Record<string, string> = {};
    settings.forEach(({ key, value }) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * 保存應用設置（將整個設置對象序列化保存）
   */
  async saveAppSettings(settings: AppSettings): Promise<void> {
    const settingsJson = JSON.stringify(settings);
    await this.saveSetting('app_settings', settingsJson);
  }

  /**
   * 獲取應用設置
   */
  async getAppSettings(): Promise<AppSettings | null> {
    const settingsJson = await this.getSetting('app_settings');
    if (!settingsJson) {
      return null;
    }
    try {
      return JSON.parse(settingsJson) as AppSettings;
    } catch (e) {
      console.error('解析設置失敗:', e);
      return null;
    }
  }

  /**
   * 保存單個設置項（便捷方法）
   */
  async saveSettingValue<T>(key: string, value: T): Promise<void> {
    const valueJson = JSON.stringify(value);
    await this.saveSetting(key, valueJson);
  }

  /**
   * 獲取單個設置項（便捷方法）
   */
  async getSettingValue<T>(key: string): Promise<T | null> {
    const valueJson = await this.getSetting(key);
    if (!valueJson) {
      return null;
    }
    try {
      return JSON.parse(valueJson) as T;
    } catch (e) {
      console.error(`解析設置 ${key} 失敗:`, e);
      return null;
    }
  }

  /**
   * 導出所有數據（JSON 格式）
   */
  async exportAllData(): Promise<string> {
    try {
      const lectures = await this.listLectures();

      // 為每個課程獲取字幕和筆記
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        lectures: await Promise.all(
          lectures.map(async (lecture) => {
            const subtitles = await this.getSubtitles(lecture.id);
            const note = await this.getNote(lecture.id);
            return {
              ...lecture,
              subtitles,
              note: note || undefined,
            };
          })
        ),
        settings: await this.getAllSettings(),
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('導出數據失敗:', error);
      throw new Error('導出數據失敗');
    }
  }

  /**
   * 導入數據（JSON 格式）
   */
  async importData(jsonData: string): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    try {
      const data = JSON.parse(jsonData);

      // 驗證數據格式
      if (!data.lectures || !Array.isArray(data.lectures)) {
        throw new Error('無效的數據格式：缺少 lectures 數組');
      }

      // 導入課程
      for (const lecture of data.lectures) {
        try {
          // 確保所有必需字段都存在
          const now = new Date().toISOString();
          const lectureToSave: Lecture = {
            id: lecture.id || crypto.randomUUID(),
            course_id: lecture.course_id || 'default-course', // 暫時使用默認值，實際遷移時會處理
            title: lecture.title || '未命名課程',
            date: lecture.date || now,
            duration: lecture.duration || 0,
            pdf_path: lecture.pdf_path,
            status: lecture.status || 'completed',
            created_at: lecture.created_at || now, // 如果沒有，使用當前時間
            updated_at: lecture.updated_at || now, // 如果沒有，使用當前時間
            // subtitles 和 notes 不需要包含在保存對象中，會單獨保存
          };

          // 保存課程
          await this.saveLecture(lectureToSave);

          // 保存字幕
          if (lecture.subtitles && Array.isArray(lecture.subtitles)) {
            await this.saveSubtitles(lecture.subtitles);
          }

          // 保存筆記
          if (lecture.note) {
            // Note 類型在數據庫中存儲為 JSON 字符串（content 字段）
            // 如果導入的數據中 note 是對象，需要轉換為 JSON
            let noteContent: string;
            let noteTitle: string;
            let noteGeneratedAt: string;

            if (typeof lecture.note === 'object') {
              // 如果是完整的 Note 對象
              if ('sections' in lecture.note || 'qa_records' in lecture.note) {
                // 標準 Note 格式
                noteContent = JSON.stringify({
                  summary: (lecture.note as Note).summary,
                  sections: (lecture.note as Note).sections || [],
                  qa_records: (lecture.note as Note).qa_records || [],
                });
                noteTitle = (lecture.note as Note).title || lecture.title;
                noteGeneratedAt = (lecture.note as Note).generated_at || new Date().toISOString();
              } else if ('content' in lecture.note) {
                // 數據庫格式的 Note（content 是 JSON 字符串）
                noteContent = typeof (lecture.note as any).content === 'string'
                  ? (lecture.note as any).content
                  : JSON.stringify((lecture.note as any).content);
                noteTitle = (lecture.note as any).title || lecture.title;
                noteGeneratedAt = (lecture.note as any).generated_at || new Date().toISOString();
              } else {
                // 其他格式，嘗試序列化
                noteContent = JSON.stringify(lecture.note);
                noteTitle = lecture.title;
                noteGeneratedAt = new Date().toISOString();
              }
            } else if (typeof lecture.note === 'string') {
              // 如果已經是 JSON 字符串（不太可能，但處理一下）
              noteContent = lecture.note;
              noteTitle = lecture.title;
              noteGeneratedAt = new Date().toISOString();
            } else {
              // 其他情況
              noteContent = JSON.stringify(lecture.note);
              noteTitle = lecture.title;
              noteGeneratedAt = new Date().toISOString();
            }

            // 使用數據庫格式的 Note（content 是 JSON 字符串）
            const noteToSave = {
              lecture_id: lecture.id,
              title: noteTitle,
              content: noteContent,
              generated_at: noteGeneratedAt,
            };
            await this.saveNote(noteToSave as any);
          }

          imported++;
        } catch (error) {
          const errorMsg = `導入課程 ${lecture.id} 失敗: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      // 導入設置（可選）
      if (data.settings && typeof data.settings === 'object') {
        for (const [key, value] of Object.entries(data.settings) as [string, string][]) {
          try {
            await this.saveSetting(key, String(value));
          } catch (error) {
            const errorMsg = `導入設置 ${key} 失敗: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(errorMsg);
          }
        }
      }

      return { imported, errors };
    } catch (error) {
      throw new Error(`導入數據失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 保存筆記
   * 注意：前端 Note 使用 sections/qa_records/summary，需要轉換為數據庫格式 (content JSON 字符串)
   */
  async saveNote(note: Note): Promise<void> {
    console.log('[StorageService] Attempting to save note for lecture:', note.lecture_id);

    // ===== FIX: Pre-check that lecture exists to prevent FK constraint errors =====
    const lectureExists = await this.getLecture(note.lecture_id);
    console.log('[StorageService] Lecture exists check result:', !!lectureExists, lectureExists?.id, lectureExists?.course_id);

    if (!lectureExists) {
      console.error('[StorageService] Cannot save note - lecture does not exist:', note.lecture_id);
      throw new Error(`無法保存筆記：講座不存在 (${note.lecture_id})`);
    }
    // =============================================================================

    // 將前端格式轉換為數據庫格式
    const dbNote = {
      lecture_id: note.lecture_id,
      title: note.title,
      content: JSON.stringify({
        summary: note.summary,
        sections: note.sections,
        qa_records: note.qa_records,
      }),
      generated_at: note.generated_at,
    };

    try {
      await invoke('save_note', { note: dbNote });
      console.log('[StorageService] Note saved successfully');
    } catch (error) {
      console.error('[StorageService] Rust save_note failed:', error);
      throw new Error(`保存筆記失敗: ${error}`);
    }
  }

  /**
   * 獲取筆記
   * 注意：數據庫返回的 Note 的 content 是 JSON 字符串，需要轉換為前端格式
   */
  async getNote(lectureId: string): Promise<Note | null> {
    const dbNote = await invoke<{ lecture_id: string; title: string; content: string; generated_at: string } | null>('get_note', { lectureId });
    if (!dbNote) {
      return null;
    }

    // 將 content JSON 字符串轉換為 Note 格式
    try {
      const content = JSON.parse(dbNote.content);
      return {
        lecture_id: dbNote.lecture_id,
        title: dbNote.title,
        summary: content.summary,
        sections: content.sections || [],
        qa_records: content.qa_records || [],
        generated_at: dbNote.generated_at,
      };
    } catch (e) {
      console.error('解析筆記內容失敗:', e);
      return {
        lecture_id: dbNote.lecture_id,
        title: dbNote.title,
        sections: [],
        qa_records: [],
        generated_at: dbNote.generated_at,
      };
    }
  }

  /**
   * 保存對話歷史
   * 使用 settings 表儲存，key 為 chat_history_{lectureId}
   */
  async saveChatHistory(lectureId: string, messages: Array<{ id: string; role: string; content: string; timestamp: string }>): Promise<void> {
    const key = `chat_history_${lectureId}`;
    await this.saveSetting(key, JSON.stringify(messages));
  }

  /**
   * 獲取對話歷史
   */
  async getChatHistory(lectureId: string): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string }>> {
    const key = `chat_history_${lectureId}`;
    const data = await this.getSetting(key);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('解析對話歷史失敗:', e);
      return [];
    }
  }

  /**
   * 導出數據到文件
   */
  async exportDataToFile(): Promise<void> {
    try {
      const jsonData = await this.exportAllData();

      const filePath = await save({
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        defaultPath: `classnoteai-export-${new Date().toISOString().split('T')[0]}.json`,
        title: '導出數據',
      });

      if (filePath) {
        // 使用 Tauri Command 寫入文件
        await invoke('write_text_file', { path: filePath, contents: jsonData });
      }
    } catch (error) {
      console.error('導出文件失敗:', error);
      throw new Error('導出文件失敗');
    }
  }

  /**
   * 從文件導入數據
   */
  async importDataFromFile(): Promise<{ imported: number; errors: string[] }> {
    try {
      const filePath = await open({
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        title: '選擇導入文件',
      });

      if (!filePath || typeof filePath !== 'string') {
        throw new Error('未選擇文件');
      }

      // 使用 Tauri Command 讀取文件
      const jsonData = await invoke<string>('read_text_file', { path: filePath });
      return await this.importData(jsonData);
    } catch (error) {
      console.error('導入文件失敗:', error);
      throw new Error(`導入文件失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * 保存 OCR 結果
   * key: ocr_result_{lectureId}_{pageNumber}
   */
  async saveOCRResult(lectureId: string, pageNumber: number, text: string): Promise<void> {
    const key = `ocr_result_${lectureId}_${pageNumber}`;
    await this.saveSetting(key, text);
  }

  /**
   * 獲取 OCR 結果
   */
  async getOCRResult(lectureId: string, pageNumber: number): Promise<string | null> {
    const key = `ocr_result_${lectureId}_${pageNumber}`;
    return await this.getSetting(key);
  }
}

export const storageService = new StorageService();

