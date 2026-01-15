---
name: Unified Queue Design
description: Establishes a standard pattern for handling client-to-cloud interactions using the OfflineQueueService to ensure offline support, synchronization, and prevents data loss.
---

# Unified Queue Design Pattern

This skill guides the implementation of client-side network requests using the `OfflineQueueService`. This pattern is critical for the "Server-First" architecture, ensuring that user actions (like Chat, Indexing, and Sync) are preserved even when the device is offline.

## Core Concepts

1.  **Server-First Architecture**: Changes and requests should theoretically "happen on the server" first. The client merely pushes an intent to the server.
2.  **Offline-First Compatibility**: Since the client may be offline, we cannot verify the server received the request immediately.
3.  **The Queue**: An IndexedDB-backed queue (`OfflineQueueService`) acts as the "Local Outbox".

## Decision Matrix: When to use?

| Feature | Use Queue? | Reason |
| :--- | :--- | :--- |
| **Chat / Conversation** | **YES** | History must be synced across devices; Request size is small. |
| **Data Sync (Push/Pull)** | **YES** | Critical for data consistency; Must handle retries. |
| **RAG Indexing (Trigger)** | **YES** | Task management happens on server; Job tracking needed. |
| **OCR (Image Processing)** | **NO** | High bandwidth (Base64 Images); blocking the queue would stall other items. Use *Client-Side Concurrency Queue* instead. |
| **Real-time Streaming** | **NO** | Interactive latency requirements override offline storage needs. |

## Implementation Guide

### 1. Import Service
```typescript
import { offlineQueueService } from './offlineQueueService';
```

### 2. The Pattern (Check Online -> Enqueue or Direct)

Do not just `fetch`. Use this pattern:

```typescript
async function performCloudAction(payload: any) {
    // 1. Check Connectivity
    if (!offlineQueueService.isOnline()) {
        // 2. Offline: Enqueue Task
        await offlineQueueService.enqueue('TASK_TYPE_NAME', {
            endpoint: '/api/resource',
            method: 'POST',
            body: payload
        });
        console.log('[Service] Offline: Request queued.');
        return null; // Handle UI feedback (e.g., "Saved to Outbox")
    }

    // 3. Online: Send Direct (via Server Proxy)
    return await sendDirect(payload);
}
```

### 3. Registering a Processor
In your Service constructor, you must register how to handle the queued item when back online:

```typescript
class MyService {
    constructor() {
        offlineQueueService.registerProcessor('TASK_TYPE_NAME', async (payload) => {
            // This runs when network is restored
            await this.sendDirect(payload);
        });
    }

    private async sendDirect(payload: any) {
        // Standard Fetch Logic
    }
}
```

## Anti-Patterns
- **Direct Fetch without Fallback**: UI will break if user is offline.
- **Queueing Large Blobs**: Do not queue raw PDF files or large images if avoidable. Upload them first (or use direct upload), then queue the "Reference" (Metadata).
- **Silent Failure**: Always notify the user (via return value or toast) if a task was Queued vs Completed.
