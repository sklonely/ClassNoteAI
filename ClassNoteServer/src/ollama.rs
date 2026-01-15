use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct OllamaClient {
    client: Client,
    base_url: String,
}

#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    input: String,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: Message,
}

impl OllamaClient {
    pub fn new(base_url: &str) -> Self {
        OllamaClient {
            client: Client::new(),
            base_url: base_url.to_string(),
        }
    }
    
    pub async fn embed(&self, text: &str, model: &str) -> Result<Vec<f32>, String> {
        let url = format!("{}/api/embed", self.base_url);
        
        let request = EmbedRequest {
            model: model.to_string(),
            input: text.to_string(),
        };
        
        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama embed failed ({}): {}", status, body));
        }
        
        let embed_response: EmbedResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embed response: {}", e))?;
        
        embed_response
            .embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "No embeddings in response".to_string())
    }
    
    pub async fn generate(&self, prompt: &str, model: &str, system: Option<&str>, options: Option<serde_json::Value>) -> Result<String, String> {
        let url = format!("{}/api/generate", self.base_url);
        
        let request = GenerateRequest {
            model: model.to_string(),
            prompt: prompt.to_string(),
            system: system.map(|s| s.to_string()),
            stream: false,
            options,
        };
        
        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama generate failed ({}): {}", status, body));
        }
        
        let gen_response: GenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse generate response: {}", e))?;
        
        Ok(gen_response.response)
    }

    pub async fn chat(&self, messages: Vec<Message>, model: &str, options: Option<serde_json::Value>) -> Result<Message, String> {
        let url = format!("{}/api/chat", self.base_url);
        
        let request = ChatRequest {
            model: model.to_string(),
            messages,
            stream: false,
            options,
        };
        
        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama chat failed ({}): {}", status, body));
        }
        
        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse chat response: {}", e))?;
        
        Ok(chat_response.message)
    }

    pub async fn extract_keywords(&self, text: &str, model: &str) -> Result<Vec<String>, String> {
        let prompt = format!(r#"
      Analyze the following course text and extract 15-20 essential technical keywords.
      
      CRITICAL INSTRUCTIONS:
      1. EXTRACT ONLY: Domain-specific jargon, technical concepts, theories, algorithms, and acronyms.
      2. EXCLUDE: 
         - Administrative details (e.g., "office hours", "syllabus", "grading", "exams", "homework").
         - Locations and Universities (e.g., "Oregon State University", "Kelley Engineering Center").
         - Names of people (instructors, TAs).
         - Generic academic terms (e.g., "textbook", "chapter", "edition", "course").
         - Policies (e.g., "citation", "disability accommodations", "conduct").
      3. FORMAT: Return ONLY a comma-separated list of keywords. No numbering, no bullet points.

      Text:
      {}... (truncated)
    "#, &text.chars().take(4000).collect::<String>());

        let response = self.generate(&prompt, model, Some("You are a helpful assistant that extracts technical keywords from text."), None).await?;
        
        let keywords: Vec<String> = response
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
            
        Ok(keywords)
    }

    pub async fn extract_syllabus_info(&self, text: &str, model: &str) -> Result<serde_json::Value, String> {
        let prompt = format!(r#"
        Analyze the following text (which is likely a course syllabus or introduction) and extract structured information.
        
        Return the result ONLY as a valid JSON object with the following fields:
        {{
            "topic": "Course Topic/Title",
            "time": "Class Time (e.g., MWF 10:00-11:00)",
            "instructor": "Instructor Name",
            "office_hours": "Office Hours info",
            "teaching_assistants": "TA Names or info",
            "location": "Class Location",
            "grading": [
                {{ "item": "Midterm", "percentage": "30%" }},
                {{ "item": "Final", "percentage": "40%" }}
            ],
            "schedule": ["Week 1: Intro", "Week 2: Topic A"]
        }}
        
        If a field is not found, use null or an empty array. Do not invent information.
        
        Text:
        {}
        "#, &text.chars().take(6000).collect::<String>());

        let response = self.generate(&prompt, model, Some("You are a JSON extractor. Output valid JSON only."), Some(serde_json::json!({ "temperature": 0.1 }))).await?;
        
        // Try to parse JSON. Use a simpler approach than regex if possible, or simple cleanup
        let json_str = response.trim();
        let json_start = json_str.find('{').unwrap_or(0);
        let json_end = json_str.rfind('}').map(|i| i + 1).unwrap_or(json_str.len());
        
        let clean_json = &json_str[json_start..json_end];
        
        serde_json::from_str(clean_json).map_err(|e| format!("Failed to parse syllabus JSON: {} (Response: {})", e, response))
    }
}
