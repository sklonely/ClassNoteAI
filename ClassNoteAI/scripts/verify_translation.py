import ctranslate2
import sentencepiece as spm
import os

# Paths
model_dir = "../src-tauri/models/m2m100-418M-ct2-int8"
spm_model = os.path.join(model_dir, "sentencepiece.bpe.model")

print(f"Loading model from {model_dir}")
print(f"Loading tokenizer from {spm_model}")

# Load Tokenizer
sp = spm.SentencePieceProcessor()
sp.load(spm_model)

# Load Translator
translator = ctranslate2.Translator(model_dir)

# Test sentences
texts = [
    "Hello world",
    "This is a test sentence.",
    "Machine learning is fascinating.",
    "How are you doing today?"
]

# Target language token
target_lang = "__zh__"
target_prefix = [target_lang]

print("\n--- Python Translation Results ---")

print(f"Translating {len(texts)} sentences...")

for i, text in enumerate(texts):
    try:
        print(f"Processing {i+1}: {text}")
        # Tokenize
        source_tokens = sp.encode(text, out_type=str)
        print(f"  Tokens: {source_tokens}")
        
        # Translate
        results = translator.translate_batch([source_tokens], target_prefix=[target_prefix])
        target_tokens = results[0].hypotheses[0]
        print(f"  Raw output: {target_tokens}")
        
        # Detokenize
        # Remove the target language token if present in output (usually it's the first token)
        if target_tokens and target_tokens[0] == target_lang:
            target_tokens = target_tokens[1:]
            
        translation = sp.decode(target_tokens)
        
        print(f"Source: {text}")
        print(f"Target: {translation}")
        print("-" * 30)
    except Exception as e:
        print(f"Error processing '{text}': {e}")
