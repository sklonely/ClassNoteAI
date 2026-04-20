# Release 煙霧測試 SOP

驗證 GitHub Actions build 出的 installer 在真實使用者環境下的端到端行為。
每次推 pre-release tag（`v*-alpha.*` / `v*-rc.*`）後跑一次；stable tag（`v*`）
推之前必跑一次。

## 目的

把以下一串手動步驟沉澱成照表操課，避免每次都重新回想 CDP 怎麼接、課程怎麼建、import 怎麼觸發。

## 前置條件

| 項目 | 狀態 |
|---|---|
| Windows 10/11 x64 + NVIDIA GPU driver ≥ 555 | ✓ 檢查 `nvidia-smi` 顯示 Driver ≥ 555 |
| 已下載 `ClassNoteAI_{ver}_x64-cuda-setup.exe` 並完成安裝 | ✓ `%LOCALAPPDATA%\ClassNoteAI\classnoteai.exe` 存在 |
| 測試影片（30–90 min，MP4/MKV/WebM） | 範例：`C:/Users/{user}/我的影片.mp4` |
| Node.js + `ws` package（repo 目錄下 `npm i` 過） | 為了跑 `scripts/cdp.cjs` |

## 1. 啟動 release，同時開 CDP port

Release 預設不開遠端偵錯 port（production 安全性考量），需要用專用 launcher
帶 env var 啟動：

```cmd
cd path\to\repo\ClassNoteAI\src-tauri
scripts\launch-cuda-release.bat
```

> 若 9222 被占，`set CNAI_DEV_CDP_PORT=9333` 再跑 bat。

驗證：

```bash
netstat -ano | grep LISTENING | grep ":9222"
# 應該看到一行 TCP 127.0.0.1:9222 ... LISTENING
```

## 2. 透過 CDP 確認 build variant + GPU 可用

從 repo 根目錄：

```bash
node scripts/cdp.cjs eval \
  "(async()=>{const i=window.__TAURI_INTERNALS__.invoke;
    return {variant:await i('get_build_variant'),
            det:await i('detect_gpu_backends',{preference:null})};})()"
```

預期：

```json
{
  "variant": "cuda",
  "det": {
    "cuda": {"gpu_name": "...", "driver_version": "596.21"},
    "effective": "cuda",
    "driver_hint": null
  }
}
```

若 `driver_hint` 不是 `null`，代表 driver < 555.85（Windows）/ 555.42（Linux）
→ 先更新 driver 再測。

> Release 跟 dev 最大差別：`window.__TAURI_INTERNALS__.invoke` 直接存取；dev
> 模式還有 Vite dev server 所以可以 `import /node_modules/.vite/deps/...`。

## 3. 確認模型都在位

```bash
ls -la "$USERPROFILE/AppData/Roaming/com.classnoteai/models/whisper/"      # 至少 ggml-base.bin
ls -la "$USERPROFILE/AppData/Roaming/com.classnoteai/models/translation/m2m100-418M-ct2-int8/model.bin"
ls -la "$USERPROFILE/AppData/Roaming/com.classnoteai/models/embedding/bge-small-en-v1.5/model.safetensors"
```

如果 translation 的 `model.bin` 顯示在 `m2m100-418M-ct2-int8/m2m100-418M-ct2-int8/`
（雙層）而不是外層，`load_translation_model_by_name` 現在會自動 flatten
（v0.6.0-alpha.1+）。若沒有 self-heal 邏輯的舊版，就 `mv inner/* .. && rmdir inner`。

## 4. 建立測試課程 + lecture

CDP 一行：

```bash
node scripts/cdp.cjs eval "$(cat <<'EOF'
(async()=>{
  const i=window.__TAURI_INTERNALS__.invoke;
  const now=new Date().toISOString();
  const userId = 'sk'; // 或你登入的 username
  const courseId=`smoke-${Date.now()}`;
  const lectureId=`lec-${Date.now()}`;
  await i('save_course',{course:{id:courseId,user_id:userId,title:'Smoke Test',description:null,keywords:null,syllabus_info:null,is_deleted:false,created_at:now,updated_at:now},userId});
  await i('save_lecture',{lecture:{id:lectureId,course_id:courseId,title:'video import 測試',date:now,duration:0,pdf_path:null,audio_path:null,video_path:null,status:'pending',is_deleted:false,created_at:now,updated_at:now},userId});
  return {courseId,lectureId};
})()
EOF
)"
```

記下回傳的 `lectureId`——下一步會用。

## 5. 啟動 import pipeline（背景跑）

```bash
node scripts/cdp.cjs eval "$(cat <<'EOF'
(async()=>{
  const i=window.__TAURI_INTERNALS__.invoke;
  const LECTURE='{{貼上 lectureId}}';
  const VIDEO='C:/Users/{user}/我的影片.mp4';  // 正斜線
  window.__smoke={startedAt:Date.now(),progress:[],done:null,err:null};
  // Release build 的 Vite 模組路徑不可用 — 先把 videoImportService 的
  // 關鍵 invoke 鏈在這裡手寫，或改回呼叫 Rust side command 直接觸發。
  // 開發 mode 建議：用 videoImportService；release 建議:invoke 個別 Rust command。
  return {launched:true};
})()
EOF
)"
```

實際上 release build 沒有 HMR/Vite，上面 `videoImportService` 動態 import 會失敗。
**Release 端只能透過 UI 操作**：
1. 打開 app 的主視窗
2. 進「課程」→ 選「Smoke Test」→ 點該 lecture
3. 點「匯入影片」或拖拉 `.mp4` 進 Review mode

> **例外**：如果你只要測 Rust 後端行為，直接 invoke 個別 command（`import_video_for_lecture`, `extract_video_pcm_to_temp`, `transcribe_pcm_file_slice`…）在 CDP 是 OK 的，但不會走 videoImportService 的 orchestration、status 欄位等狀態管理。

## 6. 觀察進度

透過 CDP 讀 window 狀態：

```bash
node scripts/cdp.cjs eval \
  "(()=>{const p=window.__smoke||{};return {el:Math.round((Date.now()-p.startedAt)/1000),
                                            done:!!p.done,err:p.err,
                                            last:p.progress[p.progress.length-1]};})()"
```

若在 UI 操作，改看 DOM：

```bash
node scripts/cdp.cjs text --grep "進度\|轉錄\|翻譯"
```

## 7. 驗收清單

- [ ] `extracting_audio` → 數秒（ffmpeg PCM 抽取）
- [ ] `transcribing` → 平均 **~1 秒/chunk**（GPU）；若 > 5 秒/chunk 代表 GPU 沒吃到
- [ ] `translating` → 跟 transcribing pipeline，多半不成 bottleneck
- [ ] `indexing` → BGE embedding。**若 Windows CI 版本 candle-cuda 已停用**，預期 CPU ~3 分鐘/70-min 影片；若 GPU ~10 秒
- [ ] Note Review mode 開啟後每個 section 有 **3 條 bullet**（Layer 1）
- [ ] Section header 的投影片範圍欄位（若 lecture 有 PDF）
- [ ] 進「設定 → 雲端 AI 助理」能看到 refine intensity 三檔 + provider 下拉
- [ ] Settings → 本地轉錄模型 → GPU 偵測面板顯示 cuda ✓，driver_hint = null

## 8. 常見失敗 + 對應

| 症狀 | 可能原因 | 修法 |
|---|---|---|
| `CT2 模型文件不存在` | 巢狀目錄（歷史遺留） | 0.6.0-alpha.1+ 自動 heal；更早版本手動 `mv inner/*` |
| `ggml_cuda_init: failed... driver insufficient` | NVIDIA driver < 555 | 更新 driver（自動提示 banner 會顯示下載連結） |
| Transcribe 很慢（>5s/chunk） | GPU 沒吃到 | 檢查 `detect_gpu_backends.effective`，若是 cpu → 看 driver/CUDA runtime |
| UI 停在 `indexing...` 幾分鐘 | CPU BGE（預期，candle-cuda 在 CI 暫時關） | 等完或縮短測試影片長度 |
| `連接被拒 127.0.0.1:9222` | Release 沒用 launcher 啟動 | 用 `launch-cuda-release.bat`（不是開始選單） |

## 9. 收尾

關掉 app 前建議保留 CDP session（不 kill）讓下次迭代重接。
刪除測試資料：

```bash
node scripts/cdp.cjs eval \
  "(async()=>{const i=window.__TAURI_INTERNALS__.invoke;
    await i('delete_lecture',{id:'<lectureId>'});
    return 'deleted';})()"
```

或直接保留，下個 release 再看 migration 行為是否正常。
