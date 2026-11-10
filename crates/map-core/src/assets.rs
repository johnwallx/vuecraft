//! Node attachments: references (URLs, local files) and embedded images.
//!
//! References are stored, never resolved or opened by the engine. Images are
//! embedded deliberately (Insert Image), validated by content, size-limited and
//! content-addressed by SHA-256, so documents stay portable without reading
//! arbitrary paths on load.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::rich::is_safe_url;
use crate::{Error, Result};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_RESOURCES: usize = 20;
const MAX_PATH_LEN: usize = 1_024;
const MAX_TITLE_LEN: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Url,
    File,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resource {
    pub kind: ResourceKind,
    /// An http/https/mailto URL, or an absolute local path.
    pub target: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
}

/// An embedded image. `data` is base64; the map key is the SHA-256 of the bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asset {
    pub mime: String,
    pub data: String,
}

fn bad(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

/// Windows drive or UNC path, or a POSIX absolute path.
fn is_absolute_path(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/')
        || p.starts_with("\\\\")
        || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

/// UNC or device path. Touching one (even checking it exists) can contact a remote
/// server, so it is only ever done when the user asks.
pub fn is_network_path(p: &str) -> bool {
    p.starts_with("\\\\") || p.starts_with("//")
}

impl Resource {
    pub(crate) fn check(&self) -> Result<()> {
        if self.title.len() > MAX_TITLE_LEN || self.title.chars().any(char::is_control) {
            return Err(bad("attachment titles must be short single-line text"));
        }
        let ok = match self.kind {
            ResourceKind::Url => is_safe_url(&self.target),
            ResourceKind::File => {
                self.target.len() <= MAX_PATH_LEN
                    && !self.target.chars().any(char::is_control)
                    && is_absolute_path(&self.target)
            }
        };
        if !ok {
            return Err(bad(match self.kind {
                ResourceKind::Url => format!("{:?} is not an http, https or mailto address", self.target),
                ResourceKind::File => format!("{:?} is not an absolute file path", self.target),
            }));
        }
        Ok(())
    }
}

pub(crate) fn check_resources(resources: &[Resource]) -> Result<()> {
    if resources.len() > MAX_RESOURCES {
        return Err(bad(format!("a node can have at most {MAX_RESOURCES} attachments")));
    }
    resources.iter().try_for_each(Resource::check)
}

/// Image type from the leading bytes; the file name is never trusted.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub fn asset_id(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

impl Asset {
    /// Validates image bytes and returns the content id and the asset.
    pub fn image(bytes: &[u8]) -> Result<(String, Asset)> {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(bad(format!("images can be at most {} MB", MAX_IMAGE_BYTES >> 20)));
        }
        let mime = sniff_image(bytes).ok_or_else(|| bad("not a PNG, JPEG, GIF or WebP image"))?;
        Ok((
            asset_id(bytes),
            Asset {
                mime: mime.into(),
                data: STANDARD.encode(bytes),
            },
        ))
    }

    /// Decodes and re-verifies type, size and content id.
    pub(crate) fn check(&self, id: &str) -> Result<()> {
        if self.data.len() > MAX_IMAGE_BYTES / 3 * 4 + 4 {
            return Err(bad(format!("embedded image {id} is too large")));
        }
        let bytes = STANDARD
            .decode(&self.data)
            .map_err(|_| bad(format!("embedded image {id} is not valid base64")))?;
        if sniff_image(&bytes) != Some(self.mime.as_str()) {
            return Err(bad(format!(
                "embedded image {id} is not the {} it claims to be",
                self.mime
            )));
        }
        if asset_id(&bytes) != id {
            return Err(bad(format!("embedded image {id} does not match its checksum")));
        }
        Ok(())
    }

    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.mime, self.data)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A valid 1x1 PNG.
    pub const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF,
        0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn images_are_identified_by_content_and_verified() {
        let (id, asset) = Asset::image(PNG).unwrap();
        assert_eq!(asset.mime, "image/png");
        assert_eq!(id.len(), 64);
        asset.check(&id).unwrap();
        assert!(asset.data_url().starts_with("data:image/png;base64,iVBOR"));
        // Wrong id, wrong claimed type, not an image, too big.
        assert!(asset.check(&"0".repeat(64)).is_err());
        assert!(
            Asset {
                mime: "image/gif".into(),
                ..asset.clone()
            }
            .check(&id)
            .is_err()
        );
        assert!(Asset::image(b"<svg onload=alert(1)>").is_err());
        assert!(Asset::image(&vec![0x89; MAX_IMAGE_BYTES + 1]).is_err());
    }

    #[test]
    fn resource_rules() {
        let r = |kind, target: &str| Resource {
            kind,
            target: target.into(),
            title: String::new(),
        };
        for ok in [
            r(ResourceKind::Url, "https://example.org"),
            r(ResourceKind::File, "C:\\data\\paper.pdf"),
            r(ResourceKind::File, "/srv/a/b.txt"),
            r(ResourceKind::File, "\\\\server\\share\\x"),
        ] {
            ok.check().unwrap();
        }
        for no in [
            r(ResourceKind::Url, "javascript:alert(1)"),
            r(ResourceKind::Url, "file:///c:/x"),
            r(ResourceKind::File, "relative\\path.txt"),
            r(ResourceKind::File, "C:\\a\nb"),
        ] {
            assert!(no.check().is_err(), "{no:?}");
        }
        assert!(check_resources(&vec![r(ResourceKind::Url, "https://a.b"); MAX_RESOURCES + 1]).is_err());
        assert!(is_network_path(r"\\server\share") && is_network_path("//server/share"));
        assert!(!is_network_path(r"C:\data") && !is_network_path("/srv/a"));
    }
}
