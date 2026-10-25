# 创维 Q7H 直播配置

自用电视直播配置与检查工具。视频由播放器直接请求频道官方服务；此仓库不存储或转播视频。

## 当前进度

2026-10-25：五个本地频道已通过电脑端候选可行性检查；电视实播验收进行中，尚未完成整体验收。播放器为 MyTV 官方正式版 V2.2.0.219。河南卫视已有用户画面、声音确认；其余电视连续播放、跨日和原功能回归仍待记录。

目前本地源的实际解码结果：河南卫视、河南都市、河南民生、郑州新闻综合主线为 1920×1080；郑州都市生活为 1280×720。电视面板支持 4K 不代表这些源为 4K。郑州新闻综合另有官方 720p 备用，其他本地频道暂只有一个已部署入口。都市生活的电脑测试曾遇到连接中断，启用常规网络重试后完成 380 秒解码，电视长期稳定性仍待验收。

## 数据与代码

- `scripts/dxxw-v1.js`：大象新闻公开匿名客户端流程，电视本地获取临时地址。
- `scripts/zzbrtv-v1.js`：郑州广电会面公开直播接口。
- `scripts/cctvnews-v1.js`：央视新闻公开 H5 正常直播流程；拒绝试看、禁播和 DRM 媒体。

脚本使用播放器内置 QuickJS 和官方文档的 `mytv` API。订阅、节目单、状态文件及使用说明在完成检查后发布。后续维护不自动下载安装播放器 APK，不自动接收第三方脚本变化。

## 来源与使用边界

- 大象：[官方电视入口](https://static.hntv.tv/kds/)、[已知郑州页面](https://static.hntv.tv/total/television/?id=197)。网页试看入口与本仓库使用的匿名客户端目录不同。
- 郑州广电：[官方手机站](https://m.zzbrtv.cn/)，公开接口域名 `api.zzbrtv.cn`。
- 央视新闻：[官方频道分享页](https://m-live.cctvnews.cctv.com/live/landscape.html?liveRoomNumber=11200132825562653886)。遵守正常播放状态和地域/节目版权限制。
- 播放器：[官方 Release](https://github.com/mytv-android/mytv-android/releases/tag/V2.2.0.219)、[使用文档](https://mytv-android.github.io/mytv-doc/)。
- 协议审阅参考：[Any2parse 固定版本](https://github.com/wjxgzz/Any2parse/blob/240a184cbae216300f8cce937f016ada5fc096e8/dxxw.php)、[mytvJS 固定版本](https://github.com/mytv-android/mytvJS/tree/26102f6f8ac5dea32e6e8d8410f80e2f45950808)。没有自动执行这些上游代码。

免费服务可能改版、限时或停播。缓存无法延续已经失效的视频服务。不得把公网地址可访问理解为转播授权。

本仓库不收集家庭地址、电视标识、账号或 Cookie；服务器临时签名仅留在请求进程中。家庭部署记录和安装包不在此仓库。
