// Decode a bounded sample using the runner's FFmpeg. Never retain or relay video.
import { spawn } from 'node:child_process';

export async function sampleOfficialRtmp(url) {
  if (url !== 'rtmp://tv.zzbrtv.cn:1935/channellive/dspd')
    return { ok: false, reason: 'unreviewed_rtmp_origin' };
  return await new Promise(resolve => {
    let output = '', settled = false, timedOut = false, oversized = false;
    const executable = process.env.Q7H_FFMPEG || 'ffmpeg';
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-rw_timeout', '15000000', '-i', url, '-t', '4', '-map', '0:v:0', '-map', '0:a:0',
      '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45_000);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 65_536) { oversized = true; child.kill(); }
    });
    child.on('error', error => finish({ ok: false,
      reason: error.code === 'ENOENT' ? 'ffmpeg_unavailable' : 'rtmp_decoder_start_failed' }));
    child.on('close', code => {
      const last = key => [...output.matchAll(new RegExp('^' + key + '=(.+)$', 'gm'))].at(-1)?.[1]?.trim();
      const seconds = Number(last('out_time_us')) / 1_000_000;
      const frames = Number(last('frame'));
      const ok = code === 0 && !timedOut && !oversized && Number.isFinite(seconds)
        && seconds >= 3.5 && frames > 0 && last('progress') === 'end';
      finish({ ok, ...(ok ? {} : { reason: timedOut ? 'rtmp_sample_timeout'
        : oversized ? 'rtmp_decoder_output_limit' : 'rtmp_decode_incomplete' }),
        decoded_media_seconds: Number.isFinite(seconds) ? seconds : 0,
        video_frames: Number.isFinite(frames) ? frames : 0,
        audio_and_video_required: true });
    });
  });
}
