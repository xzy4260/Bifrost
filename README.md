# Bifrost（个人自用修改版）

这是一个 Bifrost 的个人自用修改版本，去除企业与客户等大部分用不上的功能，预算与费用方面因维护困难因此也被删除。此版本仅作为个人使用，对于 Issues 会完全个人选择性的修复/更改，不跟随官方更新，选择性融合未来官方的更新。

> A personal fork of [Bifrost](https://github.com/maximhq/bifrost). Enterprise and customer features, along with budget and cost tracking, have been removed. This fork is maintained for personal use only: issues are addressed selectively, it does not track upstream releases, and upstream changes are merged only when they are useful here.

## 这个版本做了什么

- **精简功能面**：移除企业版、客户/团队管理、预算与费用统计等本机用不到的能力。
- **模型即删即下线**：在模型目录删除某个模型后，该模型会从路由目录中移除，带不带 provider 前缀的请求都无法再调用它；重新添加或编辑该模型即可恢复。
- **界面汉化**：模型目录的上下文窗口 / 最大输出筛选、删除确认，以及设置页的功能开关名称与描述均提供中文。
- **Warp 调整**：内置提示词改为个人版说明，去掉了官方文档、Discord 与官方仓库链接，反馈入口指向本仓库。
- **右上角入口精简**：只保留 GitHub 与反馈，版本号从 `v1.0.3` 起。

## 快速开始

### 从源码运行

```bash
# 1. 构建前端（产物会被内嵌进二进制）
cd ui
npm install
npm run build && npm run copy-build

# 2. 运行网关
cd ../transports
go run ./bifrost-http -app-dir ./data -port 8080
```

打开 <http://localhost:8080> 进入管理界面。

### 构建二进制

```bash
cd ui && npm install && npm run build && npm run copy-build
cd ../transports
CGO_ENABLED=1 go build -trimpath \
  -ldflags "-s -w -X main.Version=v1.0.3" \
  -o ../dist/bifrost-http ./bifrost-http
```

### Docker

仓库自带 [transports/Dockerfile](./transports/Dockerfile)，多阶段构建（Node 构建前端 + Go 编译）：

```bash
docker build --build-arg VERSION=1.0.3 -f transports/Dockerfile -t bifrost:1.0.3 .
docker run -p 8080:8080 -v "$PWD/data:/app/data" bifrost:1.0.3
```

> 也可以直接使用已发布镜像：`docker pull ghcr.io/xzy4260/bifrost:1.0.3`。

## 配置

运行时数据（`config.db`、`logs.db`、密钥等）都放在 `-app-dir` 指定的目录里，**不在本仓库中**，也不会随源码提交。首次启动后在界面里配置 provider 与密钥即可；也可以使用 `config.json`，但请自行保管，不要提交到任何仓库。

## 目录结构

| 目录 | 说明 |
| --- | --- |
| `core/` | 核心网关与各 provider 适配 |
| `framework/` | 配置、日志、模型目录、Warp 等框架能力 |
| `plugins/` | 内置插件（治理、日志、模型目录解析等） |
| `transports/` | HTTP 传输层与内嵌前端产物 |
| `ui/` | 管理界面（React + Vite） |
| `tests/`、`examples/` | 上游保留的测试与示例（文档站 `docs/` 已删除） |

## 上游与原作者

- 原仓库：[maximhq/bifrost](https://github.com/maximhq/bifrost)
- 原作者：Maxim AI（GitHub 组织 [maximhq](https://github.com/maximhq)）及 Bifrost 社区贡献者
- 本项目是其衍生修改版，遵循 [Apache License 2.0](./LICENSE)，原始版权归原作者所有；本仓库仅包含个人使用所需的修改。

## 发行版与镜像

- 编译产物（二进制）通过 GitHub Releases 发布：<https://github.com/xzy4260/Bifrost/releases>
- 容器镜像通过 GitHub Packages（ghcr.io）发布：`ghcr.io/xzy4260/bifrost:1.0.3`

```bash
docker pull ghcr.io/xzy4260/bifrost:1.0.3
```

> 仓库中不存放编译产物与镜像层，源码仓库只保留代码。

## Issues

不承诺响应。会按个人判断选择修复或修改，不跟随官方发布节奏，也不保证与上游行为一致。
