use crate::db::Database;
use crate::ollama::OllamaClient;
use tokio::time::{sleep, Duration};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use crate::events::TaskEvent;
use tokio::sync::broadcast;

#[derive(Serialize, Deserialize, Debug)]
pub struct IndexingPayload {
    pub lecture_id: String,
    pub pages: Vec<PageData>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PageData {
    pub page_number: i32,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SummaryPayload {
    pub lecture_id: String,
    pub language: String,
    pub pdf_context: Option<String>,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SyllabusPayload {
    pub course_id: String,
    pub title: String,
    pub description: Option<String>,
    pub target_language: Option<String>,
}

pub async fn run_worker(db_instance: Database, ollama_url: String, tx: broadcast::Sender<TaskEvent>) {
    tracing::info!("Worker started, polling for tasks...");
    
    let db = Arc::new(Mutex::new(db_instance));
    let client = OllamaClient::new(&ollama_url);
    
    loop {
        // Scope the lock to just getting the task
        let task_opt = {
            let db_lock = db.lock().unwrap();
            match db_lock.get_next_pending_task() {
                Ok(res) => res,
                Err(e) => {
                    tracing::error!("Failed to fetch pending task: {}", e);
                    None // Treat error as no task (will sleep)
                }
            }
        };

        match task_opt {
            Some((id, task_type, payload)) => {
                tracing::info!("Processing task {} ({})", id, task_type);
                
                {
                    let db_lock = db.lock().unwrap();
                    if let Err(e) = db_lock.mark_task_processing(&id) {
                        tracing::error!("Failed to mark task as processing: {}", e);
                        continue;
                    }
                }
                
                // Broadcast processing event
                let _ = tx.send(TaskEvent {
                    task_id: id.clone(),
                    task_type: task_type.clone(),
                    status: "processing".to_string(),
                    result: None,
                    user_id: None, // TODO: Add user_id to payload in future
                });
                
                let result = match task_type.as_str() {
                    "indexing" => process_indexing(db.clone(), &client, &payload).await,
                    "summary" => process_summary(db.clone(), &client, &payload).await,
                    "syllabus" => process_syllabus(db.clone(), &client, &payload).await,
                    "keyword_extract" => process_keyword_extract(db.clone(), &client, &payload).await,
                    "chat" => process_chat(db.clone(), &client, &payload).await,
                    "embedding" => process_embedding(&client, &payload).await,
                    "extraction" => process_extraction(&client, &payload).await,
                    "graph" => process_graph(&client, &payload).await,
                    _ => Err(format!("Unknown task type: {}", task_type)),
                };
                
                let db_lock = db.lock().unwrap();
                match result {
                    Ok(result) => {
                        if let Err(e) = db_lock.mark_task_completed(&id, &result) {
                            tracing::error!("Failed to mark task as completed: {}", e);
                        } else {
                            tracing::info!("Task {} completed successfully", id);
                            
                            // Broadcast completed event
                            let _ = tx.send(TaskEvent {
                                task_id: id.clone(),
                                task_type: task_type.clone(),
                                status: "completed".to_string(),
                                result: Some(result),
                                user_id: None,
                            });
                        }
                    }
                    Err(error) => {
                        tracing::error!("Task {} failed: {}", id, error);
                        let _ = db_lock.mark_task_failed(&id, &error);
                        
                        // Broadcast failed event
                        let _ = tx.send(TaskEvent {
                            task_id: id.clone(),
                            task_type: task_type.clone(),
                            status: "failed".to_string(),
                            result: Some(serde_json::json!({ "error": error })),
                            user_id: None,
                        });
                    }
                }
            }
            None => {
                sleep(Duration::from_millis(1000)).await;
            }
        }
    }
}

async fn process_indexing(
    db: Arc<Mutex<Database>>,
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: IndexingPayload = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let mut success_count = 0;
    let total_pages = payload.pages.len();

    for page in payload.pages {
        if page.text.trim().is_empty() {
            continue;
        }

        let embedding = client.embed(&page.text, "nomic-embed-text").await?;
        
        // Critical: Lock only for the synchronous DB operation
        {
            let db_lock = db.lock().unwrap();
            db_lock.insert_page_embedding(&payload.lecture_id, page.page_number, &page.text, &embedding)
                .map_err(|e| format!("DB Insert failed: {}", e))?;
        }
            
        success_count += 1;
    }

    Ok(serde_json::json!({
        "status": "completed",
        "indexed_pages": success_count,
        "total_pages": total_pages
    }))
}

async fn process_summary(
    db: Arc<Mutex<Database>>,
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: SummaryPayload = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let system_prompt = if payload.language == "zh" {
        "你是一個專業的課程助教。請根據提供的課程內容生成一份詳細的總結。如果提供了 PDF 課件內容，請以其為結構骨架，並結合錄音內容進行補充和解釋。請確保術語準確，邏輯清晰。使用 Markdown 格式。請用繁體中文回答。"
    } else {
        "You are a professional teaching assistant. Please generate a detailed summary based on the provided course content. If PDF slides content is provided, use it as the structural backbone and supplement it with the lecture recording for explanation. Ensure accurate terminology and clear logic. Use Markdown format."
    };

    let full_prompt = if let Some(ref pdf_ctx) = payload.pdf_context {
        format!(
            "Please synthesize the following sources into a comprehensive course summary:\n\nSOURCE 1: Course Slides (Structure & Key Terms)\n{}\n\nSOURCE 2: Lecture Transcript (Explanation & Details)\n{}\n\nInstructions:\n1. Use the Slides to determine the main topics and structure.\n2. Use the Transcript to provide detailed explanations and examples for each topic.\n3. Correct any potential transcription errors using terms found in the Slides.",
            pdf_ctx,
            payload.content
        )
    } else {
        format!("Please summarize the following course content:\n\n{}", payload.content)
    };
    
    let options = serde_json::json!({
        "temperature": 0.7,
        "num_ctx": 32000
    });

    let summary = client.generate(&full_prompt, "qwen3:235b-a22b", Some(system_prompt), Some(options)).await?;

    // Persist to DB
    {
        // We need a title for the note. In reality, we might fetch lecture title or use "Course Summary".
        // For simplicity, we use "Course Summary" or try to fetch lecture?
        // upsert_note requires (lecture_id, title, content).
        // The content format in DB (Client expects) is JSON string with { summary, sections, qa_records }.
        // We only have summary here.
        // If we overwrite, we might lose existing sections?
        // Strategy: Get existing note if any, update summary field, or create new.
        
        // However, worker shouldn't block too long.
        // Let's create a minimal valid note structure.
        let db_lock = db.lock().unwrap();
        
        let existing_note = db_lock.get_note(&payload.lecture_id).unwrap_or(None);
        
        let mut note_obj = if let Some((_, _, content, _, _)) = existing_note {
             serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({ "sections": [], "qa_records": [] }))
        } else {
             serde_json::json!({ "sections": [], "qa_records": [] })
        };
        
        // Update summary field
        if let Some(obj) = note_obj.as_object_mut() {
            obj.insert("summary".to_string(), serde_json::json!(summary));
        }

        db_lock.upsert_note(
            &payload.lecture_id, 
            "Course Summary", // TODO: Fetch real title if possible, or Client updates it
            &note_obj.to_string(),
            false
        ).map_err(|e| format!("DB Insert Note failed: {}", e))?;
    }

    Ok(serde_json::json!({ "summary": summary }))
}

async fn process_embedding(
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let text = payload.get("text")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'text' field in payload")?;
    
    let model = payload.get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("nomic-embed-text");
    
    let embedding = client.embed(text, model).await?;
    
    Ok(serde_json::json!({
        "embedding": embedding,
        "model": model,
        "text_length": text.len()
    }))
}

async fn process_extraction(
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let text = payload.get("text")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'text' field in payload")?;
    
    let model = payload.get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("qwen3:latest");
    
    let prompt = format!(r#"
Analyze this lecture content and extract key information:

{}

Output as JSON:
{{
  "nodes": [{{ "id": "...", "label": "...", "type": "concept|definition|example" }}],
  "edges": [{{ "source": "...", "target": "...", "relation": "..." }}]
}}
"#, text);
    
    let response = client.generate(&prompt, model, None, None).await?;
    
    match serde_json::from_str::<serde_json::Value>(&response) {
        Ok(json) => Ok(json),
        Err(_) => Ok(serde_json::json!({
            "raw_response": response
        }))
    }
}

async fn process_graph(
    _client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    Ok(serde_json::json!({
        "status": "graph_processing_not_implemented",
        "input": payload
    }))
}

async fn process_syllabus(
    db: Arc<Mutex<Database>>,
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: SyllabusPayload = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let target_lang = payload.target_language.unwrap_or_else(|| "zh-TW".to_string());
    
    let prompt = format!(
        r#"Generate a structured university course syllabus for a course titled "{title}".
Description: {description}

The syllabus should be suitable for a semester-long course.
Output MUST be valid JSON with the following structure:
{{
  "topic": "Course Topic (e.g. Introduction to ...)",
  "time": "Class Time (e.g. Mon/Wed 10:00-11:30)",
  "instructor": "Instructor Name",
  "office_hours": "Office Hours",
  "teaching_assistants": "TA info",
  "location": "Classroom Location",
  "grading": [
    {{ "item": "Midterm", "percentage": "30%" }},
    {{ "item": "Final", "percentage": "40%" }}
  ],
  "schedule": [
    "Week 1: Introduction",
    "Week 2: Basic Concepts",
    ...
  ]
}}

CRITICAL INSTRUCTION:
Translate ALL content values into the target language: {target_lang}.
Ensure the JSON keys remain exactly as specified in English (topic, time, etc.), but the values are in {target_lang}.
Return ONLY the JSON. No preamble."#,
        title = payload.title,
        description = payload.description.unwrap_or_default(),
        target_lang = target_lang
    );

    let options = serde_json::json!({
        "temperature": 0.7,
    });
    // Use a smart model for this. qwen3:8b might be okay, but larger is better if available.
    // Fallback to "qwen3:235b-a22b" (heavy) or standard? Let's use standard or heavy.
    // Assuming 'client' uses hardcoded model for now, but we should make it configurable or use "standard".
    // worker.rs lines 153 uses "qwen3:235b-a22b". Let's stick with that for quality.
    let response = client.generate(&prompt, "qwen3:235b-a22b", None, Some(options)).await?;

    // Validate JSON
    // Often LLMs include ```json ... ``` blocks. Clean it.
    let clean_json = response.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    
    // Try to parse to ensure validity
    let syllabus_obj: serde_json::Value = serde_json::from_str(clean_json)
        .or_else(|_| serde_json::from_str(&response)) // Try original if clean failed
        .map_err(|e| format!("Failed to parse LLM JSON: {}. Response: {}", e, response))?;

    // Save to DB (update course)
    // We update the Course's `syllabus_info` field.
    // Note: The Syllabus Task updates the Course directly.
    {
        let db_lock = db.lock().unwrap();
        // Convert syllabus_obj to string for storage
        db_lock.update_course_syllabus(&payload.course_id, &syllabus_obj.to_string())
            .map_err(|e| format!("DB Update Course Syllabus failed: {}", e))?;
    }

    Ok(syllabus_obj)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct KeywordExtractPayload {
    pub course_id: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatPayload {
    pub lecture_id: String,
    pub messages: Vec<crate::ollama::Message>,
}

async fn process_keyword_extract(
    db: Arc<Mutex<Database>>,
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: KeywordExtractPayload = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    tracing::info!("Extracting keywords for course {}", payload.course_id);

    // Use a lighter model or standard
    let keywords = client.extract_keywords(&payload.text, "qwen3:8b").await?;
    let keywords_str = keywords.join(", ");

    // Update DB
    {
        let db_lock = db.lock().unwrap();
        db_lock.update_course_keywords(&payload.course_id, &keywords_str)
            .map_err(|e| format!("Failed to update course keywords: {}", e))?;
    }

    Ok(serde_json::json!({ "keywords": keywords }))
}

async fn process_chat(
    _db: Arc<Mutex<Database>>,
    client: &OllamaClient,
    payload_str: &str,
) -> Result<serde_json::Value, String> {
    let payload: ChatPayload = serde_json::from_str(payload_str)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    tracing::info!("Processing chat for lecture {}", payload.lecture_id);

    // Use standard model for chat
    let response_message = client.chat(payload.messages, "qwen3:8b", None).await?;

    Ok(serde_json::to_value(response_message).unwrap())
}
