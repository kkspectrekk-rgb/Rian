# Rain

面向 Windows 的本地桌面音乐播放器。界面采用 Apple Music 式的资料库、常驻播放条和沉浸歌词布局，并根据当前封面四周的实际颜色生成动态窗口光晕。

## 功能

- ChKSz API Key 通过 Windows `safeStorage` 加密保存在当前用户目录
- 网易云音乐、QQ 音乐、酷狗音乐搜索源切换
- 网易云 `standard` 至 `jymaster`、QQ/酷狗 `128k` 至 `master` 音质切换
- LRC 原文、翻译、罗马音合并与逐行同步滚动
- 封面四边取色，驱动窗口背景及播放器边缘动态色彩
- 导入并播放本地音频文件
- 系统减少动态效果、减少透明度和高对比度辅助设置

## 开发

```powershell
pnpm install
pnpm dev
```

## 生成 Windows EXE

```powershell
pnpm dist:win
```

输出位于 `release` 文件夹，包含安装程序和免安装便携版。

> API Key 不会写入项目、日志或公开 URL。业务请求从 Electron 主进程发出，并遵循接口错误状态与请求频率限制。
