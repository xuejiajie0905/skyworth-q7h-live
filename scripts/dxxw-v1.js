// Version 1. Anonymous official client flow. Do not log signed media URLs.
// Protocol reviewed at wjxgzz/Any2parse commit 240a184cbae216300f8cce937f016ada5fc096e8.
// Public signing input is also present in the official anonymous H5 client.
function main(item) {
    try {
        var cid = Number(item.id);
        var classes = {145: 11, 141: 11, 146: 11, 197: 99};
        if (!classes[cid]) return {error: "未配置的频道"};
        var cacheKey = "q7h-dxxw-v1-class-" + classes[cid];
        var cached = mytv.getCache(cacheKey);
        var rows;
        if (cached) {
            rows = JSON.parse(cached);
        } else {
            var CryptoJS = require("crypto");
            var JSEncrypt = require("jsencrypt");
            var timestamp = String(Math.floor(Date.now() / 1000));
            var headers = {
                "tenant_id": "1", "timestamp": timestamp,
                "sign": CryptoJS.SHA256("6ca114a836ac7d73" + timestamp).toString(),
                "User-Agent": "okhttp/3.12.0", "Content-Type": "application/json"
            };
            var base = "https://pubmod.hntv.tv/program/getAuth/";
            var key = JSON.parse(mytv.get(base + "util/getPublicKeyAndRandom", headers));
            if (!key.publicKey || !key.random) return {error: "官方接口未返回公开握手信息"};
            var rsa = new JSEncrypt();
            rsa.setPublicKey("-----BEGIN PUBLIC KEY-----\n" +
                key.publicKey.match(/.{1,64}/g).join("\n") + "\n-----END PUBLIC KEY-----");
            var encrypted = rsa.encrypt("classId=" + classes[cid]);
            if (!encrypted) return {error: "客户端握手生成失败"};
            var body = {version: "version.0.0.1", random: key.random, data: encrypted};
            rows = JSON.parse(mytv.post(base + "clientlive/getClientLiveByClassId", headers, JSON.stringify(body)));
            if (!Array.isArray(rows)) return {error: "官方直播目录暂不可用"};
            mytv.setCache(cacheKey, JSON.stringify(rows), 60000);
        }
        var row = rows.find(function (entry) { return Number(entry.cid) === cid; });
        var url = row && row.video_streams && row.video_streams[0];
        if (!url || !/^https?:\/\/tvcdn\.stream3\.hndt\.com\//.test(url))
            return {error: "直播来源发生变化，需重新核对"};
        // The same official origin over HTTP passed the household decode test.
        // Preserve every server-issued media query parameter, including IP binding.
        if (cid === 197) url = url.replace(/^https:/, "http:");
        return {url: url, headers: {"User-Agent": "okhttp/3.12.0"}};
    } catch (error) {
        return {error: "大象客户端取流暂时失败，请稍后重试"};
    }
}
