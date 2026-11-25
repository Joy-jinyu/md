# mermaid（打包进应用，不从 CDN 加载）

| 项 | 值 |
|---|---|
| 版本 | 12.3.0 |
| 来源 | npm 包 `mermaid@12.3.0` 的 `dist/mermaid.min.js`（https://registry.npmjs.org/mermaid/-/mermaid-12.3.0.tgz），原样拷贝，没改过 |
| 包校验 | `sha512-4113TdXeLAsMruJ79OpFL5O8+LTFXhQqZ260rF3tgUmiNAtRm4Uume04I+65PRN6yZ69J4f8rVYWW8zRk65UYw==`（和 registry 的 `dist.integrity` 一致） |
| 文件 SHA-256 | `336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3` |
| 许可证 | MIT，见同目录 `LICENSE` |

谁用它：`src/features/editor/mermaid.tsx`，在一个藏起来的 WebView 里加载（文档里有 Mermaid 图时才加载）。

升级：换掉 `mermaid.min.js`，改上表的版本、校验和，再在浏览器和 macOS 窗口里各看一遍流程图、时序图、甘特图和恶意输入（`DESIGN.md`「Mermaid」、`.claude/rules/security.md`）。
