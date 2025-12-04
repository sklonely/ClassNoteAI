/**
 * Downloads Module
 * 
 * Unified download management for all models and files.
 * Consolidates download logic from setup/installer.rs and translation/download.rs.
 */

mod downloader;
mod model_manager;

pub use downloader::*;
pub use model_manager::*;
