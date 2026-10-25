// Native Node.js only. Checks data and a small media sample; no video relay.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, publicEncrypt, constants, createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
const pins = JSON.parse(await readFile(path.join(root, 'resolvers.json'), 'utf8'));
const md5 = value => createHash('md5').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cache = new Map();
class CheckError extends Error { constructor(code) { super(code); this.code = code; } }

async function get(url, headers = {}, body = undefined, limit = 2_000_000, sample = false) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CheckError(`http_${response.status}`);
      }
      const chunks = [];
      let bytes = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        bytes += value.length;
        if (bytes > limit) {
          await reader.cancel();
          if (!sample) throw new CheckError('response_too_large');
          break;
        }
      }
      return { data: Buffer.concat(chunks).subarray(0, limit), url: response.url };
    } catch (error) {
      // Do not retry authentication/region errors or write signed URLs to logs.
      if (error instanceof CheckError || attempt === 1) throw error instanceof CheckError ? error : new CheckError('network_error');
      await pause(1000);
    }
  }
}
async function json(url, headers, body) { return JSON.parse((await get(url, headers, body)).data.toString('utf8')); }

async function dxxw(id) {
  const classes = { 145: 11, 141: 11, 146: 11, 197: 99 };
  const classId = classes[id];
  if (!classId) throw new CheckError('unreviewed_channel');
  const key = `dxxw-${classId}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { tenant_id: '1', timestamp: ts, 'User-Agent': 'okhttp/3.12.0',
      sign: createHash('sha256').update('6ca114a836ac7d73' + ts).digest('hex'), 'Content-Type': 'application/json' };
    const base = 'https://pubmod.hntv.tv/program/getAuth/';
    const keyData = await json(base + 'util/getPublicKeyAndRandom', headers);
    const encrypted = publicEncrypt({ key: Buffer.from(keyData.publicKey, 'base64'), format: 'der', type: 'spki',
      padding: constants.RSA_PKCS1_PADDING }, Buffer.from(`classId=${classId}`));
    return json(base + 'clientlive/getClientLiveByClassId', headers,
      { version: 'version.0.0.1', random: keyData.random, data: encrypted.toString('base64') });
  })());
  const rows = await cache.get(key);
  let url = rows.find(row => Number(row.cid) === Number(id))?.video_streams?.[0];
  if (!/^https?:\/\/tvcdn\.stream3\.hndt\.com\//.test(url || '')) throw new CheckError('origin_changed');
  if (Number(id) === 197) url = url.replace(/^https:/, 'http:');
  return { url, headers: { 'User-Agent': 'okhttp/3.12.0' } };
}

async function zzbrtv(id) {
  if (![107447, 100714].includes(Number(id))) throw new CheckError('unreviewed_channel');
  const headers = { Accept: 'application/json,*/*', Referer: 'https://m.zzbrtv.cn/',
    'X-DFSX-UIVersion': '1.0', 'X-DFSX-Appid': 'huimian' };
  const rows = await json('https://api.zzbrtv.cn/cms/public/lives/' + id, headers);
  const url = rows.find(row => Number(row.id) === Number(id))?.m3u8_url;
  if (!/^https:\/\/m3u8file\.zzbrtv\.cn\/nmip-media\/channellive\//.test(url || '')) throw new CheckError('origin_changed');
  return { url, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.zzbrtv.cn/' } };
}

async function cctvnews(id) {
  const ids = { cctv1: '11200132825562653886', cctv4: '10620168294224708952', cctv13: '16265686808730585228' };
  if (!ids[id]) throw new CheckError('unreviewed_channel');
  const ts = String(Math.floor(Date.now() / 1000));
  const query = 'articleId=' + ids[id] + '&scene_type=6';
  const signInput = '&&&20000009&' + md5(query) + '&' + ts + '&emas.feed.article.live.detail&1.0.0&&&&&';
  const headers = { 'User-Agent': 'Mozilla/5.0', cookieuid: md5(ts), 'from-client': 'h5',
    Referer: 'https://m-live.cctvnews.cctv.com/', 'x-emas-gw-appkey': '20000009', 'x-emas-gw-pv': '6.1',
    'x-emas-gw-sign': createHmac('sha256', 'emasgatewayh5').update(signInput).digest('hex'),
    'x-emas-gw-t': ts, 'x-req-ts': String(Number(ts) * 1000) };
  const outer = await json('https://emas-api.cctvnews.cctv.com/h5/emas.feed.article.live.detail/1.0.0?' + query, headers);
  const data = JSON.parse(Buffer.from(outer.response, 'base64').toString('utf8')).data;
  const room = data.live_room;
  if (room?.options?.try_view_status !== 0 || data.on_off !== 1 || room.live_status !== 2 ||
      room.stop_duration_list?.length) throw new CheckError('official_playback_restricted');
  const camera = room.liveCameraList?.[0];
  if (camera?.forbidden !== 0) throw new CheckError('official_playback_restricted');
  const choices = camera.pullUrlList.filter(row => row.format?.toUpperCase() === 'HLS' && row.drm === 0 && row.def === 1);
  if (choices.length !== 1 || !data.dk) throw new CheckError('format_changed');
  const dec = createDecipheriv('aes-128-cbc', Buffer.from(data.dk.slice(0, 8) + ts.slice(-8)),
    Buffer.from(data.dk.slice(-8) + ts.slice(0, 8)));
  const url = Buffer.concat([dec.update(Buffer.from(choices[0].authResultUrl[0].authUrl, 'base64')), dec.final()]).toString('utf8');
  if (!/^https?:\/\/live-play-hls\.cctvnews\.cctv\.com\/CCTVChannel\//.test(url)) throw new CheckError('origin_changed');
  return { url, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m-live.cctvnews.cctv.com/' } };
}

async function mediaManifest(url, headers) {
  for (let depth = 0; depth < 3; depth++) {
    const response = await get(url, headers);
    const text = response.data.toString('utf8').replace(/^\uFEFF/, '');
    if (!text.startsWith('#EXTM3U')) throw new CheckError('not_hls');
    const uris = text.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
    if (!uris.length) throw new CheckError('empty_playlist');
    if (text.includes('#EXT-X-STREAM-INF')) { url = new URL(uris[0], response.url).href; continue; }
    if (text.includes('#EXT-X-ENDLIST')) throw new CheckError('not_live_playlist');
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) throw new CheckError('encrypted_media_needs_review');
    const seq = Number(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1]);
    const target = Number(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]);
    if (!Number.isSafeInteger(seq) || !target || target > 15) throw new CheckError('unexpected_manifest');
    return { url: response.url, seq, target, segment: new URL(uris[Math.max(0, uris.length - 2)], response.url).href };
  }
  throw new CheckError('nested_playlist_limit');
}

async function checkLine(line) {
  const started = Date.now();
  try {
    const resolvers = { dxxw, zzbrtv, cctvnews };
    if (!resolvers[line.resolver]) throw new CheckError('unknown_resolver');
    const media = await resolvers[line.resolver](line.id);
    const first = await mediaManifest(media.url, media.headers);
    const segment = (await get(first.segment, media.headers, undefined, 65_536, true)).data;
    const ts = segment.length >= 564 && [0, 188, 376].every(i => segment[i] === 0x47);
    if (!ts) throw new CheckError('unexpected_segment_format');
    // Some official CDNs cache a short playlist for longer than one segment.
    // Observe multiple normal reloads before classifying a genuinely stale list.
    let advanced = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await pause(Math.min(11, first.target + 1) * 1000);
      const second = await mediaManifest(first.url, media.headers);
      if (second.seq > first.seq) { advanced = true; break; }
    }
    if (!advanced) throw new CheckError('playlist_not_advancing');
    return { resolver: line.resolver, id: line.id, ok: true, checked_at: new Date().toISOString(),
      milliseconds: Date.now() - started, media_sequence_advanced: true, sample_bytes: segment.length };
  } catch (error) {
    return { resolver: line.resolver, id: line.id, ok: false, checked_at: new Date().toISOString(),
      reason: error instanceof CheckError ? error.code : 'unexpected_api_format', milliseconds: Date.now() - started };
  }
}

// Pin checks stop accidental changes to executable TV resolver files.
let codeIntegrity = true;
for (const pin of Object.values(pins.resolvers)) {
  const digest = createHash('sha256').update(await readFile(path.join(root, pin.file))).digest('hex');
  if (digest !== pin.sha256 || !/^[0-9a-f]{40}$/.test(pin.git_ref)) codeIntegrity = false;
}
const ids = catalog.channels.map(c => c.id);
const schemaValid = new Set(ids).size === ids.length && catalog.channels.every(c => c.name && c.group && c.lines?.length);
const channels = [];
// At most three live checks concurrently; never enumerate IPs or channel IDs.
const queue = catalog.channels.slice();
async function worker() {
  while (queue.length) {
    const c = queue.shift();
    const lines = codeIntegrity && schemaValid ? await Promise.all(c.lines.map(checkLine)) : [];
    channels.push({ id: c.id, name: c.name, required: c.required, lines,
      ok: lines.some(line => line.ok), all_lines_ok: !!lines.length && lines.every(line => line.ok),
      resolution: c.resolution, resolution_evidence: 'household PC decode; cloud sample does not verify resolution' });
    console.log(c.name + ': ' + (lines.some(x => x.ok) ? 'sample passed' : 'check failed'));
  }
}
await Promise.all([worker(), worker(), worker()]);
channels.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
const health = { schema_version: 1, checked_at: new Date().toISOString(), code_integrity: codeIntegrity,
  catalog_valid: schemaValid, video_checks_passed: codeIntegrity && schemaValid && channels.filter(c => c.required).every(c => c.ok),
  channels, all_checks_passed: false,
  limitations: 'Small HTTP media samples from the runner. Not television, sound, 30-minute, or household acceptance.' };
await writeFile(path.join(root, 'health.json'), JSON.stringify(health, null, 2) + '\n');
