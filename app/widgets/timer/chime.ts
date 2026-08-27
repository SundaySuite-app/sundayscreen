// The finish chime — SYNTHESIZED with WebAudio: no bundled sound file, no
// codec matrix (WKWebView has no ogg), no license file, and offline by
// construction. Two soft tones, A5 → D6.

let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    ctx ??= new AudioContext();
    // An AudioContext created without a user gesture may start suspended.
    void ctx.resume().catch(() => {});
    const tone = (freq: number, at: number) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx!.currentTime + at;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    };
    tone(880, 0);
    tone(1174.66, 0.22);
    tone(880, 0.44);
  } catch {
    // No audio device / no AudioContext — a silent finish is fine.
  }
}
