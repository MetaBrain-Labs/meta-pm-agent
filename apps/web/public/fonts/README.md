# 本地字体

字体原样复制自 `E:\realProject\EchoWave\apps\mobile\assets\fonts`，由 Web 应用自行提供，不依赖在线字体服务。

| 文件 | 用途 | 官方来源 |
| --- | --- | --- |
| SourceHanSansCN-Regular.otf | 常规界面文字 | [Adobe Source Han Sans](https://github.com/adobe-fonts/source-han-sans) |
| SourceHanSansCN-Bold.otf | 加粗界面文字 | [Adobe Source Han Sans](https://github.com/adobe-fonts/source-han-sans) |
| LXGWWenKaiLite-Regular.ttf | 助手回答与 PRD 正文 | [LXGW WenKai Lite](https://github.com/lxgw/LxgwWenKai-Lite) |

字体采用 SIL Open Font License 1.1。重新分发时保留 `licenses/` 中的版权声明与许可证。

全局样式负责字体别名、字重、系统回退和 `font-display: swap`；按使用需求加载，不预加载全部字体。三份原始字体合计约 29.4 MiB。
