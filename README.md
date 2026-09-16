<div align="center">
  <img src="./app/src/assets/rain-icon.png" width="112" height="112" alt="Rain 图标">
  <h1>Rain</h1>
  <p>Windows 桌面音乐播放器 · 多源搜索 · 沉浸歌词 · 本地音乐</p>
  <a href="https://github.com/kkspectrekk-rgb/Rian/releases/latest"><img src="https://img.shields.io/badge/下载-Windows_安装包-ef365c?style=for-the-badge&logo=windows" alt="下载 Windows 安装包"></a>
</div>

## 当前版本：1.1.6 液态玻璃试用版

[前往下载页面](https://github.com/kkspectrekk-rgb/Rian/releases/tag/v1.1.6)，选择 `Rain.1.1.6-liquid-setup.exe`（Windows x64 安装版）。当前程序未签名，Windows 可能提示未知发布者。

源码统一放在 `app/`，不再按版本号重复创建源码目录。1.1.4、1.1.5 和 1.1.6 是连续迭代，详细区别见[版本记录](./CHANGELOG.md)。

## 功能亮点

- 网易云、QQ 音乐、酷狗多源搜索，歌曲、歌手和专辑分类浏览。
- 我的歌单、收藏、当前播放列表和最近播放；网易云、QQ 分享歌单导入与刷新。
- 本地音乐导入、筛选、批量管理、封面与歌词读取。
- 全窗口歌词页、翻译显示记忆、分平台音质与十段均衡器。
- 网易云每日推荐登录入口、登录状态和推荐列表缓存。
- 悬浮返回、页面前进/后退、正在播放歌曲定位。
- 根据实际音频强弱和封面四边颜色变化的光晕律动。
- 真正透出桌面的窗口背景、透明度与高光调节、实时预览，可恢复不透明外观。
- 听歌统计、可自定义快捷键、单实例启动、托盘与关闭偏好。

液态玻璃为风格模拟，不是 iOS 原生光学折射。透明效果受系统和显卡影响，Windows 11 支持时可启用 Acrylic。在线内容和音质取决于平台、账户权限及所配置服务。

## 配置与数据

在线搜索使用 ChKSz API，在软件设置中填写自己的 Key。Key 和登录信息仅在本机使用，不应提交至仓库或公开在截图中。

为兼容旧版，用户数据继续保存在 `%APPDATA%\Aurora Music`。安装版默认缓存位于安装目录的 `RainCache`，可在设置中更改或清理；本地封面与账户设置独立保存。升级时保留用户数据目录，重要数据建议备份。

旧便携版用户请查看 [v1.1.0.1 迁移公告](https://github.com/kkspectrekk-rgb/Rian/releases/tag/v1.1.0.1)。

## 开发

```powershell
cd app
npm ci
npm run dev
```

使用 Electron、React、Vite 和 electron-builder。构建与测试见[开发文档](./docs/DEVELOPMENT.md)。请仅在拥有相应权限的情况下使用音乐服务与内容。
