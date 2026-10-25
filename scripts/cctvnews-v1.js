// Version 1. Official anonymous H5 flow; URL metadata decoding, no media DRM.
// Reference reviewed: mytv-android/mytvJS 26102f6f8ac5dea32e6e8d8410f80e2f45950808.
// Confirmed against cdnlive.cctvnews.cctv.com/live/landscape/0.64.0/index.js.
function main(item) {
    try {
        var ids = {cctv1:"11200132825562653886",cctv4:"10620168294224708952",
                   cctv13:"16265686808730585228"};
        var aid = ids[item.id];
        if (!aid) return {error:"未配置的央视频道"};
        var C = require("crypto");
        var ts = String(Math.floor(Date.now()/1000));
        var query = "articleId="+aid+"&scene_type=6";
        var digest = C.MD5(query).toString();
        var signInput = "&&&20000009&"+digest+"&"+ts+"&emas.feed.article.live.detail&1.0.0&&&&&";
        var headers = {"User-Agent":"Mozilla/5.0","cookieuid":C.MD5(ts).toString(),
            "from-client":"h5","Referer":"https://m-live.cctvnews.cctv.com/",
            "x-emas-gw-appkey":"20000009","x-emas-gw-pv":"6.1",
            "x-emas-gw-sign":C.HmacSHA256(signInput,"emasgatewayh5").toString(),
            "x-emas-gw-t":ts,"x-req-ts":String(Number(ts)*1000)};
        var outer = JSON.parse(mytv.get("https://emas-api.cctvnews.cctv.com/h5/emas.feed.article.live.detail/1.0.0?"+query,headers));
        var payload = C.enc.Base64.parse(outer.response).toString(C.enc.Utf8);
        var data = JSON.parse(payload).data;
        var room = data.live_room;
        // Official H5 enum: NORMAL=0, PREVIEW=1, FORBIDDEN=2. Respect it.
        if (!room || !room.options || room.options.try_view_status !== 0 ||
            data.on_off !== 1 || room.live_status !== 2 ||
            (room.stop_duration_list && room.stop_duration_list.length))
            return {error:"官方当前未提供正常直播，请稍后再试"};
        var camera = room.liveCameraList && room.liveCameraList[0];
        if (!camera || camera.forbidden !== 0) return {error:"官方当前限制该频道播放"};
        var choices = camera.pullUrlList.filter(function(row) {
            return String(row.format).toUpperCase()==="HLS" && row.drm===0 && row.def===1;
        });
        if (choices.length!==1 || !data.dk) return {error:"官方播放格式发生变化，需重新核对"};
        var row = choices[0];
        var encrypted = row.authResultUrl[0].authUrl;
        var dk = data.dk;
        var key = C.enc.Utf8.parse(dk.slice(0,8)+ts.slice(-8));
        var iv = C.enc.Utf8.parse(dk.slice(-8)+ts.slice(0,8));
        var params = C.lib.CipherParams.create({ciphertext:C.enc.Base64.parse(encrypted)});
        var url = C.AES.decrypt(params,key,{iv:iv,mode:C.mode.CBC,padding:C.pad.Pkcs7}).toString(C.enc.Utf8);
        if (!/^https?:\/\/live-play-hls\.cctvnews\.cctv\.com\/CCTVChannel\//.test(url))
            return {error:"央视媒体来源发生变化，需重新核对"};
        return {url:url,headers:{"User-Agent":"Mozilla/5.0","Referer":"https://m-live.cctvnews.cctv.com/"}};
    } catch (error) {
        return {error:"央视新闻取流暂时失败，请稍后重试"};
    }
}
