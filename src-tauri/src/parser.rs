use std::fs;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionSnapshot {
  pub scenario_name: String,
  pub scenario_path: String,
  pub playlist_in_progress: bool,
}

pub fn parse_session_file(path: &Path) -> Result<SessionSnapshot, String> {
  let bytes = fs::read(path)
    .map_err(|error| format!("failed to read session file at {}: {error}", path.display()))?;
  parse_session_bytes(&bytes)
}

pub fn parse_session_bytes(bytes: &[u8]) -> Result<SessionSnapshot, String> {
  let scenario_name = extract_string_after_key(bytes, b"ScenarioName")
    .ok_or_else(|| "ScenarioName not found in session save".to_string())?;
  let scenario_path = extract_string_after_key(bytes, b"FullScenarioPath")
    .or_else(|| {
      extract_string_after_key(bytes, b"MapName")
        .map(|map_name| format!("{map_name}::{scenario_name}"))
    })
    .unwrap_or_else(|| scenario_name.clone());
  let playlist_in_progress = extract_bool_after_key(bytes, b"PlaylistInProgress").unwrap_or(false);

  if scenario_name.is_empty() || scenario_path.is_empty() {
    return Err("session save did not contain an active scenario".to_string());
  }

  Ok(SessionSnapshot {
    scenario_name,
    scenario_path,
    playlist_in_progress,
  })
}

fn extract_string_after_key(bytes: &[u8], key: &[u8]) -> Option<String> {
  let start = find_key_payload_start(bytes, key)?;
  let end = (start + 320).min(bytes.len());
  let window = &bytes[start..end];

  for offset in 0..window.len().saturating_sub(8) {
    let raw_len = i32::from_le_bytes([
      window[offset],
      window[offset + 1],
      window[offset + 2],
      window[offset + 3],
    ]);
    if raw_len <= 1 || raw_len > 300 {
      continue;
    }

    let str_len = raw_len as usize;
    let content_start = offset + 4;
    let content_end = content_start + str_len;
    if content_end > window.len() {
      continue;
    }

    let raw = &window[content_start..content_end];
    if raw.last().copied() != Some(0) {
      continue;
    }

    let text = String::from_utf8_lossy(&raw[..raw.len() - 1]).trim().to_string();
    if text.is_empty() {
      continue;
    }

    let lowered = text.to_ascii_lowercase();
    if lowered == "strproperty"
      || lowered == "none"
      || lowered == "boolproperty"
      || lowered == "arrayproperty"
      || lowered == "intproperty"
      || lowered == "floatproperty"
      || lowered.starts_with("/script/")
    {
      continue;
    }

    if text.chars().all(is_supported_char) {
      return Some(text);
    }
  }

  None
}

fn extract_bool_after_key(bytes: &[u8], key: &[u8]) -> Option<bool> {
  let start = find_key_payload_start(bytes, key)?;
  let end = (start + 200).min(bytes.len());
  let window = &bytes[start..end];
  let bool_property = b"BoolProperty\0";
  let bool_idx = find_subslice(window, bool_property)?;
  let tail = &window[bool_idx + bool_property.len()..];

  // Unreal stores the next property key length immediately after the bool value,
  // sometimes with an extra zero byte of padding in between.
  for len_start in 0..tail.len().saturating_sub(6) {
    let next_len = u32::from_le_bytes([
      tail[len_start],
      tail[len_start + 1],
      tail[len_start + 2],
      tail[len_start + 3],
    ]) as usize;
    if next_len < 2 || next_len > 120 {
      continue;
    }

    let key_start = len_start + 4;
    let key_end = key_start + next_len;
    if key_end > tail.len() {
      continue;
    }

    let maybe_key = &tail[key_start..key_end];
    if maybe_key.last().copied() != Some(0) {
      continue;
    }

    let key_name = String::from_utf8_lossy(&maybe_key[..maybe_key.len() - 1]);
    if !key_name.chars().all(|ch| ch.is_ascii_alphanumeric()) {
      continue;
    }

    if len_start >= 2 && tail[len_start - 1] == 0 {
      let padded_value = tail[len_start - 2];
      if padded_value == 0 || padded_value == 1 {
        return Some(padded_value == 1);
      }
    }

    if len_start >= 1 {
      let direct_value = tail[len_start - 1];
      if direct_value == 0 || direct_value == 1 {
        return Some(direct_value == 1);
      }
    }
  }

  None
}

fn is_supported_char(ch: char) -> bool {
  ch == ' ' || ch.is_ascii_graphic()
}

fn find_key_payload_start(bytes: &[u8], key: &[u8]) -> Option<usize> {
  let mut key_with_null = Vec::with_capacity(key.len() + 1);
  key_with_null.extend_from_slice(key);
  key_with_null.push(0);

  find_subslice(bytes, &key_with_null).map(|idx| idx + key_with_null.len())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  if needle.is_empty() || needle.len() > haystack.len() {
    return None;
  }

  haystack.windows(needle.len()).position(|window| window == needle)
}

#[cfg(test)]
mod tests {
  use super::parse_session_bytes;

  fn push_string_property(bytes: &mut Vec<u8>, key: &[u8], value: &[u8]) {
    bytes.extend_from_slice(key);
    bytes.push(0);
    bytes.extend_from_slice(&12_i32.to_le_bytes());
    bytes.extend_from_slice(b"StrProperty\0");
    bytes.extend_from_slice(&(value.len() as i32 + 1).to_le_bytes());
    bytes.extend_from_slice(&[0u8; 8]);
    bytes.extend_from_slice(&(value.len() as i32 + 1).to_le_bytes());
    bytes.extend_from_slice(value);
    bytes.push(0);
  }

  fn push_bool_property(bytes: &mut Vec<u8>, key: &[u8], value: bool) {
    bytes.extend_from_slice(key);
    bytes.push(0);
    bytes.extend_from_slice(&13_i32.to_le_bytes());
    bytes.extend_from_slice(b"BoolProperty\0");
    bytes.extend_from_slice(&[0u8; 8]);
    bytes.push(if value { 1 } else { 0 });
    bytes.extend_from_slice(&5_i32.to_le_bytes());
    bytes.extend_from_slice(b"None\0");
  }

  fn push_bool_property_with_padding(bytes: &mut Vec<u8>, key: &[u8], value: bool) {
    bytes.extend_from_slice(key);
    bytes.push(0);
    bytes.extend_from_slice(&13_i32.to_le_bytes());
    bytes.extend_from_slice(b"BoolProperty\0");
    bytes.extend_from_slice(&[0u8; 8]);
    bytes.push(if value { 1 } else { 0 });
    bytes.push(0);
    bytes.extend_from_slice(&5_i32.to_le_bytes());
    bytes.extend_from_slice(b"None\0");
  }

  fn sample_session_bytes() -> Vec<u8> {
    let mut bytes = vec![0u8; 24];
    push_string_property(&mut bytes, b"ScenarioName", b"VT Pasu Novice S5");
    push_string_property(
      &mut bytes,
      b"FullScenarioPath",
      b"C:\\Program Files\\Steam\\workshop\\content\\824270\\1234",
    );
    push_bool_property(&mut bytes, b"PlaylistInProgress", true);
    bytes
  }

  fn sample_session_bytes_without_full_path() -> Vec<u8> {
    let mut bytes = vec![0u8; 24];
    push_string_property(&mut bytes, b"ScenarioName", b"voxTargetSwitch Click");
    push_string_property(&mut bytes, b"MapName", b"voxbox.map");
    push_bool_property(&mut bytes, b"PlaylistInProgress", true);
    bytes
  }

  #[test]
  fn parses_valid_session_blob() {
    let parsed = parse_session_bytes(&sample_session_bytes()).expect("should parse session bytes");
    assert_eq!(parsed.scenario_name, "VT Pasu Novice S5");
    assert_eq!(
      parsed.scenario_path,
      "C:\\Program Files\\Steam\\workshop\\content\\824270\\1234"
    );
    assert!(parsed.playlist_in_progress);
  }

  #[test]
  fn falls_back_to_map_name_when_full_path_is_missing() {
    let parsed =
      parse_session_bytes(&sample_session_bytes_without_full_path()).expect("map fallback should parse");
    assert_eq!(parsed.scenario_name, "voxTargetSwitch Click");
    assert_eq!(parsed.scenario_path, "voxbox.map::voxTargetSwitch Click");
    assert!(parsed.playlist_in_progress);
  }

  #[test]
  fn falls_back_to_scenario_name_when_only_name_is_available() {
    let mut bytes = vec![0u8; 24];
    push_string_property(&mut bytes, b"ScenarioName", b"Test Scenario");
    let parsed = parse_session_bytes(&bytes).expect("scenario name fallback should parse");
    assert_eq!(parsed.scenario_name, "Test Scenario");
    assert_eq!(parsed.scenario_path, "Test Scenario");
  }

  #[test]
  fn fails_for_corrupted_payload() {
    let bytes = vec![0, 159, 12, 44, 88, 1, 2, 3, 4];
    let error = parse_session_bytes(&bytes).expect_err("corrupted bytes should fail");
    assert!(error.contains("ScenarioName"));
  }

  #[test]
  fn parses_playlist_bool_with_padding_byte() {
    let mut bytes = vec![0u8; 24];
    push_string_property(&mut bytes, b"ScenarioName", b"VT Pasu Novice S5");
    push_bool_property_with_padding(&mut bytes, b"PlaylistInProgress", true);
    let parsed = parse_session_bytes(&bytes).expect("bool with padding should parse");
    assert!(parsed.playlist_in_progress);
  }
}
