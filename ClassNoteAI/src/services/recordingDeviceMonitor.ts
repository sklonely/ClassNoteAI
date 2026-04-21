export interface RecordingInputSnapshot {
  label: string;
  sampleRate?: number;
}

export interface DeviceChangeWarning {
  message: string;
  detail: string;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isBluetoothLike(label: string): boolean {
  return /(airpods|bluetooth|headset|hands-free|buds|earbuds|headphones)/i.test(label);
}

export function buildDeviceChangeWarning(
  previous: RecordingInputSnapshot | null,
  current: RecordingInputSnapshot | null,
): DeviceChangeWarning | null {
  if (!previous || !current) return null;
  if (!previous.label || !current.label) return null;
  if (normalizeLabel(previous.label) === normalizeLabel(current.label)) return null;

  const warnings: string[] = [
    `輸入裝置已從「${previous.label}」切換成「${current.label}」。`,
  ];

  if (typeof current.sampleRate === 'number' && current.sampleRate <= 16_000) {
    warnings.push(`目前取樣率只有 ${Math.round(current.sampleRate / 1000)}kHz，轉錄品質可能明顯下降。`);
  } else if (isBluetoothLike(current.label)) {
    warnings.push('藍牙耳機麥克風常會切到低頻寬模式，字幕品質可能變差。');
  }

  warnings.push('建議確認系統輸入來源是否仍是你原本想用的麥克風。');

  return {
    message: '錄音麥克風可能被切換了',
    detail: warnings.join(' '),
  };
}
