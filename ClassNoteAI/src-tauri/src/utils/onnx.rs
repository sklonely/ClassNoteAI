use std::sync::Once;

static INIT: Once = Once::new();

/// Initialize the ONNX Runtime environment.
/// This should be called once at application startup.
/// Returns Ok(()) always since ort 2.0 init is infallible.
pub fn init_onnx() {
    INIT.call_once(|| {
        // ort 2.0 API: init().commit() returns bool
        // true = first-time initialization, false = already initialized
        let is_first = ort::init().commit();
        if is_first {
            println!("ONNX Runtime initialized successfully (first time)");
        } else {
            println!("ONNX Runtime already initialized");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_onnx() {
        // First call should succeed
        init_onnx();
        // Second call should also succeed (idempotent)
        init_onnx();
    }
}
