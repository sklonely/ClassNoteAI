---
trigger: model_decision
description: Tauri UI/UX 規範：原生 Dialog 使用、PDF Buffer 處理與 Async/Await 風格指南。
---

UI/UX Guidelines
Dialogs & Confirmations
Avoid window.confirm / window.alert: These native browser APIs can block the renderer process, look inconsistent with the OS, and provide a poor user experience in a desktop application context.
Use Tauri Native Dialogs: Always use @tauri-apps/plugin-dialog for confirmations and alerts. This ensures a native look and feel and avoids freezing the UI.
Example Pattern:
import { confirm } from '@tauri-apps/plugin-dialog';
// Inside an async handler
const result = await confirm('Are you sure?', {
  title: 'Confirmation',
  kind: 'warning',
  okLabel: 'Yes',
  cancelLabel: 'No'
});
if (result) {
  // Proceed
}
PDF Handling
Buffer Detachment: When passing ArrayBuffer data to workers or external services (like pdfjs-dist), always pass a copy (buffer.slice(0)) if you need to retain access to the original buffer in the main thread. Workers often transfer ownership of the buffer, leaving the original detached and unusable.
Code Style
Async/Await: Prefer async/await over .then() chains for better readability, especially when dealing with Tauri commands and dialogs.