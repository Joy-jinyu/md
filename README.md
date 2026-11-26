# Pairdown

Pairdown is a WYSIWYG Markdown editor for the web and macOS. It keeps your documents as Markdown and offers optional sync through private GitHub Gists.

- Write with tables, footnotes, formulas, and Mermaid diagrams, or switch to source mode.
- Import Markdown files, browse local version history, and save as Markdown or export to HTML.
- Store documents in your browser or a local file library. GitHub sync is optional and covers Markdown text.

## Use Pairdown

The editor defaults to English. To switch the interface to Simplified Chinese, open **Settings → Language**. Pairdown saves the preference on this device.

Open the [web app](https://markdown.pairwise.site/). It saves documents in your browser by default. To work with a local folder of Markdown files from the web app, set up the [local gateway](gateway/README.md).

To run the macOS app from this repository, follow the development setup below and use `make dev`. Use `make build-mac` to create `dist/macos/Pairdown.app`. The macOS app stores its document library in `~/Documents/Pairdown` by default.

## Develop locally

Install nsh v0.7.0 using the version pinned in the [CI workflow](.github/workflows/deploy.yml), then add its web component. Make runs the development commands, and Node.js 24 matches CI for the gateway and sign-in Worker tests.

```sh
nsh component add web
make dev-web      # Run the editor in the browser
make dev-landing  # Preview the landing page at http://127.0.0.1:8813/lp/
make dev          # Run in a macOS window
make verify       # Type check and run app, gateway, and Worker tests
make build-web    # Package the static site in dist/web/Pairdown/
make build-mac    # Package the macOS app in dist/macos/Pairdown.app
```

See [Contributing](CONTRIBUTING.md) for code and review conventions, [Execution Rules](EXECUTION.md) for the verification workflow, and [Development Context](CLAUDE.md) for the architecture. The [gateway](gateway/README.md) and [sign-in Worker](worker/README.md) have their own setup guides.
