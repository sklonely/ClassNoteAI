#!/usr/bin/env python3
"""
Convert Helsinki-NLP/opus-mt-en-zh to CTranslate2 format

This script downloads the English-to-Chinese translation model from Hugging Face
and converts it to CTranslate2 format for efficient inference.

Requirements:
    pip install ctranslate2 transformers sentencepiece

Usage:
    python convert_opus_mt_to_ct2.py [--output-dir OUTPUT_DIR] [--quantization INT8]
"""

import argparse
import os
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Convert opus-mt-en-zh to CTranslate2 format')
    parser.add_argument('--model', default='Helsinki-NLP/opus-mt-en-zh',
                        help='Hugging Face model name (default: Helsinki-NLP/opus-mt-en-zh)')
    parser.add_argument('--output-dir', default='./opus-mt-en-zh-ct2',
                        help='Output directory for converted model')
    parser.add_argument('--quantization', default='int8', choices=['float32', 'float16', 'int8', 'int8_float16'],
                        help='Quantization type (default: int8 for smaller size)')
    parser.add_argument('--force', action='store_true',
                        help='Overwrite existing output directory')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    
    # Check if output already exists
    if output_dir.exists() and not args.force:
        print(f"Error: Output directory '{output_dir}' already exists. Use --force to overwrite.")
        sys.exit(1)
    
    print(f"Converting model: {args.model}")
    print(f"Output directory: {output_dir}")
    print(f"Quantization: {args.quantization}")
    print()

    try:
        import ctranslate2
    except ImportError:
        print("Error: ctranslate2 not installed. Run: pip install ctranslate2")
        sys.exit(1)

    try:
        from transformers import AutoTokenizer
    except ImportError:
        print("Error: transformers not installed. Run: pip install transformers sentencepiece")
        sys.exit(1)

    print("Step 1/3: Downloading model from Hugging Face...")
    
    # Convert the model
    print("Step 2/3: Converting to CTranslate2 format...")
    try:
        ct2_converter = ctranslate2.converters.TransformersConverter(args.model)
        ct2_converter.convert(
            str(output_dir),
            quantization=args.quantization,
            force=args.force
        )
        print(f"  ✓ Model converted successfully")
    except Exception as e:
        print(f"Error during conversion: {e}")
        sys.exit(1)

    # Copy tokenizer files
    print("Step 3/3: Copying tokenizer files...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(args.model)
        tokenizer.save_pretrained(str(output_dir))
        print(f"  ✓ Tokenizer saved")
    except Exception as e:
        print(f"Warning: Could not save tokenizer: {e}")
        print("  The model may still work with built-in tokenization")

    # Show model size
    total_size = sum(f.stat().st_size for f in output_dir.rglob('*') if f.is_file())
    size_mb = total_size / (1024 * 1024)
    
    print()
    print("=" * 50)
    print("Conversion complete!")
    print(f"Output: {output_dir.absolute()}")
    print(f"Size: {size_mb:.1f} MB")
    print()
    print("Files created:")
    for f in sorted(output_dir.iterdir()):
        file_size = f.stat().st_size / 1024
        print(f"  - {f.name} ({file_size:.1f} KB)")
    print()
    print("To test the model:")
    print("  python -c \"import ctranslate2; t = ctranslate2.Translator('./opus-mt-en-zh-ct2'); print(t.translate_batch([['Hello', 'world']]))")
    print()
    print("To use in ClassNoteAI:")
    print(f"  1. Copy '{output_dir.name}' to ~/Library/Application Support/com.classnoteai/models/ct2/")
    print("  2. Or zip and upload to GitHub Releases")

if __name__ == '__main__':
    main()
