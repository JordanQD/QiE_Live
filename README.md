# QiE_Live

企鹅体育（qie.tv）的 LiveParse 插件订阅源。

## 添加订阅源

仓库公开后，在 Live 软件中添加以下订阅地址：

```text
https://raw.githubusercontent.com/JordanQD/QiE_Live/main/qie.json
```

插件目前支持：

- 无需登录获取直播
- 分类、房间详情和直播状态
- FLV 播放地址及过期刷新
- 搜索房间号或 qie.tv 房间链接添加直播间
- 房间号和 qie.tv 分享链接解析
- 企鹅体育官网平台图标和主播头像

通用关键词搜索、房间列表和弹幕尚未实现。

## 文件

- `qie.json`：Live 插件订阅源
- `plugin/qie-1.0.2/`：当前插件源码与图标资源
- `dist/qie-1.0.2.zip`：当前可安装插件包的仓库副本
