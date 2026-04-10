/** 与 backend `tts_voice_presets.py` 同步；接口缺项或旧后端时补齐下拉。 */
export const TTS_VOICE_PRESETS_FALLBACK: { value: string; label: string }[] = [
  { value: '', label: '默认（跟随服务器）' },
  { value: 'zh_female_vv_uranus_bigtts', label: '知性灿灿（IVI 2.0）' },
  { value: 'saturn_zh_female_cancan_tob', label: '灿灿（角色扮演 · 2.0）' },
  { value: 'saturn_zh_female_keainvsheng_tob', label: '可爱女生（角色扮演 · 2.0）' },
  { value: 'saturn_zh_female_tiaopigongzhu_tob', label: '调皮公主（角色扮演 · 2.0）' },
  { value: 'saturn_zh_male_shuanglangshaonian_tob', label: '爽朗少年（角色扮演 · 2.0）' },
  { value: 'saturn_zh_male_tiancaitongzhuo_tob', label: '天才同桌（角色扮演 · 2.0）' },
  { value: 'zh_female_xiaohe_uranus_bigtts', label: '小何（通用场景 · 2.0）' },
  { value: 'zh_male_m191_uranus_bigtts', label: '云舟（通用场景 · 2.0）' },
  { value: 'zh_male_taocheng_uranus_bigtts', label: '小天（通用场景 · 2.0）' },
  { value: 'en_male_tim_uranus_bigtts', label: '通用场景 · 2.0）' },
];

export function mergeTtsVoicePresetsFromServer(
  server: { value: string; label: string }[] | undefined,
): { value: string; label: string }[] {
  const s = Array.isArray(server) ? server : [];
  const fbKeys = new Set(TTS_VOICE_PRESETS_FALLBACK.map((p) => p.value));
  const serverMap = new Map(s.map((p) => [p.value, p]));
  const merged: { value: string; label: string }[] = [];
  for (const fb of TTS_VOICE_PRESETS_FALLBACK) {
    merged.push(serverMap.get(fb.value) ?? fb);
  }
  for (const p of s) {
    if (!fbKeys.has(p.value)) merged.push(p);
  }
  return merged;
}
