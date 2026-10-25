"""Build a small, exact-matched XMLTV guide and publish only after validation.

Standard library only. Downloads data, never upstream executable code.
"""
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
TZ = dt.timezone(dt.timedelta(hours=8))
EPG_URL = 'https://raw.githubusercontent.com/mytv-android/myEPG/master/output/epg.gz'
RAW = 'https://raw.githubusercontent.com/xuejiajie0905/skyworth-q7h-live/'


def save_json(path, data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')


def stamp(value):
    return dt.datetime.strptime(value,'%Y%m%d%H%M%S %z')


def guide(catalog, now):
    req = Request(EPG_URL,headers={'User-Agent':'q7h-live-guide/1'})
    with urlopen(req,timeout=30) as response:
        raw = response.read(16_000_001)
    if len(raw)>16_000_000 or not raw.startswith(b'\x1f\x8b'):
        raise ValueError('epg_download_invalid')
    # Bounded decompression; protect against malformed/unexpected upstream data.
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        xml = stream.read(80_000_001)
    if len(xml)>80_000_000 or b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
        raise ValueError('epg_xml_invalid')
    upstream = ET.fromstring(xml)
    known_ids = {c.get('id') for c in upstream.findall('channel')}
    output = ET.Element('tv',{'generator-info-name':'Q7H filtered myEPG; unavailable labels are explicit',
                              'source-info-name':'mytv-android/myEPG','source-info-url':EPG_URL})
    channels = catalog['channels']
    by_upstream = {c['epg_upstream_id']:c for c in channels if c['epg_upstream_id']}
    if any(key not in known_ids for key in by_upstream):
        raise ValueError('epg_channel_mapping_changed')
    for c in channels:
        node = ET.SubElement(output,'channel',{'id':c['name']})
        ET.SubElement(node,'display-name',{'lang':'zh'}).text=c['name']
    earliest = now-dt.timedelta(days=1)
    latest = now+dt.timedelta(days=3)
    seen = set()
    counts = {c['name']:0 for c in channels}
    fresh = {c['name']:0 for c in channels if c['epg_upstream_id']}
    rejected = 0
    for programme in upstream.findall('programme'):
        c = by_upstream.get(programme.get('channel'))
        if not c:
            continue
        try:
            start,stop=stamp(programme.get('start','')),stamp(programme.get('stop',''))
        except ValueError:
            rejected+=1
            continue
        title=(programme.findtext('title') or '').strip()
        if stop<=start or not title or stop-start>dt.timedelta(hours=24):
            rejected+=1
            continue
        if stop<=earliest or start>=latest:
            continue
        key=(c['name'],start.isoformat(),stop.isoformat(),title)
        if key in seen:
            continue
        seen.add(key)
        node=ET.SubElement(output,'programme',{'channel':c['name'],
            'start':start.astimezone(TZ).strftime('%Y%m%d%H%M%S %z'),
            'stop':stop.astimezone(TZ).strftime('%Y%m%d%H%M%S %z')})
        ET.SubElement(node,'title',{'lang':'zh'}).text=title[:300]
        description=(programme.findtext('desc') or '').strip()
        if description:
            ET.SubElement(node,'desc',{'lang':'zh'}).text=description[:1500]
        counts[c['name']]+=1
        if stop>now and start<now+dt.timedelta(days=1):
            fresh[c['name']]+=1
    stale_mappings=[name for name,count in fresh.items() if count==0]
    placeholders=[]
    for c in channels:
        if c['epg_upstream_id'] and c['name'] not in stale_mappings:
            continue
        placeholders.append(c['name'])
        # Keep valid historical entries. A mapped channel whose schedule has
        # expired gets explicit no-data labels from today, never guessed shows.
        for day in range(0 if c['epg_upstream_id'] else -1,4):
            start=dt.datetime.combine(now.date()+dt.timedelta(days=day),dt.time.min,TZ)
            stop=start+dt.timedelta(days=1)
            node=ET.SubElement(output,'programme',{'channel':c['name'],
                'start':start.strftime('%Y%m%d%H%M%S %z'),'stop':stop.strftime('%Y%m%d%H%M%S %z')})
            ET.SubElement(node,'title',{'lang':'zh'}).text='暂无节目单'
            ET.SubElement(node,'desc',{'lang':'zh'}).text='未取得可靠节目单。本条仅为无数据提示，不代表实际播出节目或时段。'
    ET.indent(output,space='  ')
    data=ET.tostring(output,encoding='utf-8',xml_declaration=True)
    compressed=gzip.compress(data,mtime=0)
    # Parse our own output as an integration format gate.
    check=ET.fromstring(gzip.decompress(compressed))
    if len(check.findall('channel'))!=len(channels):
        raise ValueError('epg_output_channel_mismatch')
    return compressed,{'ok':True,'upstream':EPG_URL,'exact_match_counts':counts,
                       'explicit_no_data_channels':placeholders,
                       'stale_upstream_mapping_channels':stale_mappings,
                       'programme_data_complete':not stale_mappings,
                       'rejected_invalid_entries':rejected,
                       'sha256':hashlib.sha256(compressed).hexdigest()}


def playlist(catalog,pins,cdn=False):
    cdn_base='https://cdn.jsdelivr.net/gh/xuejiajie0905/skyworth-q7h-live@'
    epg=(cdn_base+'main/epg.xml.gz') if cdn else RAW+'main/epg.xml.gz'
    lines=['#EXTM3U x-tvg-url="'+epg+'"']
    found=set()
    for c in catalog['channels']:
        for line in c['lines']:
            if line.get('kind')=='webview':
                uri='webview://'+line['url']
            else:
                resolver=pins['resolvers'][line['resolver']]
                base=cdn_base if cdn else RAW
                uri='javascript://'+base+resolver['git_ref']+'/'+resolver['file']+'?id='+str(line['id'])
            key=(c['name'],uri)
            if key in found:
                raise ValueError('duplicate_channel_line')
            found.add(key)
            if any('"' in c[k] or '\n' in c[k] for k in ['name','group']):
                raise ValueError('invalid_playlist_label')
            lines.append(f'#EXTINF:-1 tvg-id="{c["name"]}" tvg-name="{c["name"]}" group-title="{c["group"]}",{c["name"]}')
            lines.append(uri)
    return '\n'.join(lines)+'\n'


def main():
    health_path=ROOT/'health.json'
    health=json.loads(health_path.read_text(encoding='utf-8'))
    catalog=json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))
    pins=json.loads((ROOT/'resolvers.json').read_text(encoding='utf-8'))
    now=dt.datetime.now(TZ)
    health['publication']={'updated_at':now.isoformat(),'updated':False,'kept_previous_files':True,
                           'epg_updated':False,'channel_config_kept':True}
    try:
        data,epg_status=guide(catalog,now)
        m3u=playlist(catalog,pins)
        cdn_m3u=playlist(catalog,pins,cdn=True)
        health['epg']=epg_status
        if health.get('subscription_checks_passed',health.get('video_checks_passed')):
            (ROOT/'epg.xml.gz').write_bytes(data)
            (ROOT/'channels.m3u').write_text(m3u,encoding='utf-8',newline='\n')
            (ROOT/'channels-cdn.m3u').write_text(cdn_m3u,encoding='utf-8',newline='\n')
            health['publication'].update({'updated':True,'kept_previous_files':False,
                'epg_updated':True,'channel_config_kept':False,
                'channels_sha256':hashlib.sha256(m3u.encode()).hexdigest()})
            health['all_checks_passed']=True
        else:
            health['publication']['reason']='subscription_checks_failed'
            health['all_checks_passed']=False
            # Guide data has its own validation gate. If the exact installed
            # channel configuration is unchanged, a runner's regional media
            # failure must not freeze otherwise valid future programme data.
            previous=ROOT/'channels.m3u'
            if previous.exists() and previous.read_text(encoding='utf-8')==m3u:
                (ROOT/'epg.xml.gz').write_bytes(data)
                health['publication'].update({'updated':True,'kept_previous_files':False,
                                               'epg_updated':True,'channel_config_kept':True,
                                               'reason':'subscription_checks_failed; unchanged_channels_valid_guide_refreshed'})
    except Exception as exc:
        reason=str(exc) if isinstance(exc,ValueError) and str(exc).startswith('epg_') else type(exc).__name__
        health['epg']={'ok':False,'reason':reason}
        health['all_checks_passed']=False
        health['publication']['reason']='epg_or_configuration_check_failed'
    save_json(health_path,health)
    print(json.dumps({'published':health['publication']['updated'],
                      'all_checks_passed':health['all_checks_passed'],'epg':health.get('epg')},ensure_ascii=False))


if __name__=='__main__':
    main()
