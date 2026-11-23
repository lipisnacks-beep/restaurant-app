#!/usr/bin/env python3
"""Generate a loud, distinct staff ringtone WAV (doorbell-style, high amplitude).

The chef ringtone (new-order.wav) is a soft chime. For staff we want something
LOUDER and more urgent-sounding (a two-tone doorbell "ding-DONG") so it cuts
through a busy dining room. We synthesize it with NumPy and normalize to near
full amplitude.
"""
import numpy as np
from scipy.io import wavfile

SR = 44100

# Two-tone doorbell: high "ding" (E6, ~1318Hz) then low "DONG" (A5, ~880Hz).
# Louder than the chef chime because a busy dining room is noisier than a kitchen.
def tone(freq, dur, sr=SR, attack=0.005, release_factor=6.0):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    # Decaying sinusoid for a bell-like timbre with harmonics for richness.
    env = np.exp(-t * release_factor)
    wave = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * 2 * freq * t)
    # Smooth attack to avoid click.
    a = int(sr * attack)
    if a > 0:
        env[:a] *= np.linspace(0, 1, a)
    return wave * env

# "DING" (higher, short) - DONG (lower, longer) - pause - repeat.
ding = tone(1318.51, 0.28, release_factor=5.0)   # E6
dong = tone(880.00, 0.55, release_factor=3.5)    # A5
pause = np.zeros(int(SR * 0.08))

one_phrase = np.concatenate([ding, pause, dong, np.zeros(int(SR * 0.35))])
# Repeat the phrase twice so the loop has a clear, urgent cadence.
wave = np.concatenate([one_phrase, one_phrase])
# Trailing silence so a player set to loop has a natural gap.
wave = np.concatenate([wave, np.zeros(int(SR * 0.4))])

# Normalize to 0.98 amplitude (loud but avoids clipping distortion).
peak = np.max(np.abs(wave))
if peak > 0:
    wave = wave * (0.98 / peak)

# Convert to 16-bit PCM.
audio = (wave * 32767).astype(np.int16)
wavfile.write('/home/z/my-project/download/restaurant-app/public/sounds/staff-order.wav', SR, audio)
print(f"staff-order.wav written: {len(audio)/SR:.2f}s, {SR}Hz, 16-bit mono")
