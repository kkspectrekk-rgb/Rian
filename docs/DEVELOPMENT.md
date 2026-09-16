# 开发与仓库结构

```text
app/                  当前源码（原 V1.1.3，版本见 package.json）
  electron/           主进程与预加载桥接
  src/                界面与播放逻辑
  scripts/            测试与构建辅助
  release/            当前构建产物，忽略提交
docs/releases/        按版本归档的更新日志
artifacts/installers/ 本机历史安装包，忽略提交
V1.1.0.1/             旧便携迁移公告源码
```

本机其他旧目录不代表当前源码，不纳入本次提交。归档不删除旧安装包或历史 Release。

## 构建与测试

安装 Node.js/npm 后，在 `app/` 执行：

```powershell
npm ci
npm run dev
npm run build
node scripts/test-aura.mjs
npm run dist:win
```

安装包位于 `app/release/`。版本需同步维护 `package.json`、`package-lock.json` 及 `build.nsis.artifactName`。

播放回归需先构建，然后在 `app/` 执行：

```powershell
$rainTest = Start-Process -FilePath '.\node_modules\electron\dist\electron.exe' -ArgumentList 'scripts/smoke-playback.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
$rainTest.WaitForExit()
$rainTest.ExitCode
```

结果在系统临时目录 `rain-playback-test-*` 中的 `test-results.log`。脚本使用独立临时用户数据，不使用真实 Key 或登录会话，退出码 0 表示成功。自动检查不能替代不同 Windows/显卡环境下的视觉验收。

## 隐私与发布

- 不提交真实 Key、登录会话、`.env`、`settings.json`、Cookies、用户数据、缓存、日志。
- 不复制个人数据到测试、示例或截图；提交前审查暂存内容。
- 安装包单独上传 GitHub Release，不写入 Git 历史。
- 保留应用标识与用户数据目录，避免升级丢失设置。
