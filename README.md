<div align="center">
  <img src="./V1.0.8/src/assets/rain-icon.png" width="112" height="112" alt="Rain 图标">

  # Rain

  **一款拥有 Apple Music 式沉浸体验的 Windows 桌面音乐播放器**

  搜索、播放、逐字歌词与封面动态色彩，都集中在一个安静而流畅的界面中。

  ![Version](https://img.shields.io/badge/version-1.0.8-18181b?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows11&logoColor=white)
  ![Electron](https://img.shields.io/badge/Electron-34-47848F?style=flat-square&logo=electron&logoColor=white)
  ![React](https://img.shields.io/badge/React-18-20232A?style=flat-square&logo=react&logoColor=61DAFB)

  [![Download Rain](https://img.shields.io/badge/Download-Rain%201.0.8-ffffff?style=for-the-badge&logo=github&logoColor=black)](https://github.com/kkspectrekk-rgb/Rian/releases/latest)
</div>

---

## 关于 Rain

Rain 是一款运行在 Windows 上的本地桌面音乐播放器，使用 Electron、React 和 Vite 构建。

界面以 Apple Music 的沉浸式播放体验为设计方向：播放器会读取歌曲封面边缘的颜色，将其转化为窗口背景与播放器边缘的动态光晕；歌词会跟随歌曲进度滚动，并支持逐字点亮、翻译和罗马音显示。

Rain 不是网页播放器。它以独立 Windows 桌面程序运行，API 请求、媒体缓存和用户设置均由本机处理。

## 功能亮点

- **多音乐源搜索**：支持网易云音乐、QQ 音乐和酷狗音乐，并可在搜索框中直接切换来源。
- **沉浸式歌词**：支持 LRC 歌词、翻译、罗马音和逐字时间轴。
- **逐字演唱效果**：当前字词随歌曲进度变亮并轻微上浮，唱过后自然回落。
- **多档音质**：根据不同音乐源提供标准、高品质、无损、Hi-Res 等可用音质。
- **动态封面色彩**：从封面四周提取颜色，同步生成窗口背景和播放器边缘光晕。
- **播放模式**：支持顺序播放、随机播放和单曲循环，并显示当前模式。
- **喜欢的音乐**：点击爱心即可收藏歌曲，并在独立页面中管理。
- **最近播放**：从底部播放栏向上展开，可快速重新播放听过的歌曲。
- **本地缓存**：缓存搜索结果、歌曲资料、封面和已成功下载的音频，减少重复 API 调用。
- **本地音乐**：支持导入 MP3、FLAC、WAV 等本地音频文件。
- **分类搜索**：一次搜索生成综合、单曲、歌手、专辑结果，分类切换不会重复消耗 API 次数。
- **完整资料库**：新增歌手、专辑、本地歌曲和我的歌单页面，搜索结果可直接收藏歌手与专辑。
- **歌单分享链接**：支持识别网易云、QQ 音乐和酷狗歌单长链接；网易云可用一次 API 调用补全整张歌单。
- **听歌统计**：头像面板显示累计与今日听歌数据，并提供日、周、月趋势。
- **可靠启动与单实例**：重复双击会唤醒已有窗口，不会创建多个 Rain 主实例；便携版使用独立临时目录避免并发启动卡死。
- **托盘与关闭偏好**：关闭窗口时可选择退出或最小化到系统托盘，也可记住选择并在设置中随时更改。
- **系统辅助设置**：兼容 Windows 减少动态效果、减少透明度和高对比度偏好。
- **可自定义快捷键**：默认使用空格播放/暂停，Alt+方向键切歌与调节音量；设置页支持录制组合键并在松键后保存。

## V1.0.8 更新

- 新增空格播放/暂停、Alt+←/→ 上一首/下一首、Alt+↑/↓ 调节音量。
- 设置页新增快捷键管理，可录制 Ctrl、Alt、Shift、Win 与普通按键的组合。
- 组合键在全部按键松开后保存，并提供冲突检测、Alt+F4 保护与一键恢复默认。
- 输入文字、操作下拉菜单或弹窗时自动停用播放快捷键，避免误触。
- 快捷键仅在 Rain 前台窗口生效，并保存在本机用户数据中。
- 继续沿用原用户数据目录，保留加密 API Key、登录会话、收藏、缓存和其他设置。

完整内容请查看 [更新日志 v1.0.8](./V1.0.8/更新日志v1.0.8.txt)。

## 下载 Rain

[**前往 GitHub Releases 下载 Rain 1.0.8 →**](https://github.com/kkspectrekk-rgb/Rian/releases/latest)

在最新版发行页面的 **Assets** 区域选择 `Rain.1.0.8.exe`。这是 Windows x64 免安装便携版，下载后双击即可启动，文件约 299 MB。

也可以使用 [Rain 1.0.8.exe 直接下载链接](https://github.com/kkspectrekk-rgb/Rian/releases/download/v1.0.8/Rain.1.0.8.exe)。

> 当前程序未进行代码签名，Windows 首次运行时可能显示“未知发布者”提示。文件 SHA-256：`FAE456C0138BD20136FD8FC262B55153736FB5C8DA74B7DB2A04093482D4443C`

## 快速开始

### 环境要求

- Windows 10 或 Windows 11（x64）
- Node.js 20 或更高版本
- pnpm

### 从源码运行

```powershell
git clone https://github.com/kkspectrekk-rgb/Rian.git
cd Rian\V1.0.8
pnpm install
pnpm dev
```

### 构建便携版

```powershell
cd V1.0.8
pnpm install
pnpm dist:win
```

构建完成后，免安装程序会生成在：

```text
V1.0.8\release\Rain 1.0.8.exe
```

双击即可启动，不需要安装。仓库不提交 `node_modules`、构建目录或 EXE 文件，避免存储重复依赖和大体积二进制文件。

## 配置音乐 API

Rain 使用 ChKSz API 提供在线搜索、歌曲解析和歌词读取能力。

1. 启动 Rain，打开左下角的“设置”。
2. 前往 [ChKSz API](https://api.chksz.com/) 获取自己的 API Key。
3. 将以 `chksz_` 开头的 Key 填入设置页面并保存。
4. 返回搜索页面，选择音乐源并开始搜索。

API Key 通过 Electron 主进程调用 Windows `safeStorage` 加密后保存在当前设备，不会写入项目源码、界面日志或公开 URL。

搜索页面还会显示 API 免费剩余次数、兑换剩余次数和速率限制。Rain 每 30 秒同步一次账户状态；如果登录失效，会显示“未连接”并允许重新打开账户页面。

## 本地数据与缓存

为了保留旧版本设置，Rain 当前继续使用以下用户数据目录：

```text
%APPDATA%\Aurora Music
```

其中包括：

- 加密后的 API Key
- ChKSz API 登录会话
- 喜欢的音乐和最近播放记录
- 搜索、歌曲资料、封面和音频缓存

缓存目录：

```text
%APPDATA%\Aurora Music\rain-media-cache
```

## 项目结构

```text
Rian/
├─ README.md                    # 仓库主页说明
├─ V1.0.8/
│  ├─ electron/                # Electron 主进程、窗口与本地缓存
│  ├─ src/                     # React 界面、API 适配与歌词解析
│  ├─ build/                   # Rain 应用图标
│  ├─ scripts/                 # 图标生成脚本
│  ├─ package.json             # 依赖与便携版构建配置
│  └─ 更新日志v1.0.8.txt
└─ .gitignore
```

## 技术栈

| 技术 | 用途 |
| --- | --- |
| Electron | Windows 桌面窗口、本地存储、媒体缓存与安全 API 请求 |
| React | 播放器界面和状态管理 |
| Vite | 开发服务器与前端构建 |
| Lucide React | 界面图标 |
| electron-builder | 生成 Windows 免安装便携版 |

## 版本管理

Git 仓库从 **V1.0.3** 开始记录。后续每次新增或修改功能都会在根目录创建新的版本文件夹，例如 `V1.0.7`、`V1.0.8`，并在对应目录中附带同版本更新日志。

---

<div align="center">
  <strong>Rain</strong><br>
  让音乐像雨一样，安静地填满整个窗口。
</div>
