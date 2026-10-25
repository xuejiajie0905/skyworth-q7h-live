// Version 2. Raw-string compatibility for older player releases. Resolve only the two publicly identified official TV records.
function main(item) {
    try {
        var value = item && item.id;
        if (!value) {
            var raw = String(item && item.raw != null ? item.raw : item);
            var match = /(?:^|[?&])id=([^&]*)/.exec(raw);
            value = match ? decodeURIComponent(match[1]) : "";
        }
        var id = Number(value);
        if (id !== 107447 && id !== 100714) return {error: "未配置的郑州频道"};
        var headers = {"Accept": "application/json,*/*", "Referer": "https://m.zzbrtv.cn/",
                       "X-DFSX-UIVersion": "1.0", "X-DFSX-Appid": "huimian"};
        var rows = JSON.parse(mytv.get("https://api.zzbrtv.cn/cms/public/lives/" + id, headers));
        var record = rows.find(function (entry) { return Number(entry.id) === id; });
        var url = record && record.m3u8_url;
        if (!url || !/^https:\/\/m3u8file\.zzbrtv\.cn\/nmip-media\/channellive\//.test(url))
            return {error: "郑州官方媒体入口发生变化，需重新核对"};
        return {url: url, headers: {"User-Agent": "Mozilla/5.0", "Referer": "https://m.zzbrtv.cn/"}};
    } catch (error) {
        return {error: "郑州官方取流暂时失败，请稍后重试"};
    }
}
