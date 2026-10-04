# pi-organize-footer

## Overview

Organize Pi's footer and toggle extension status items.

## Requirements

Requires Pi TUI mode for the interactive picker. It replaces Pi's footer while loaded and stores hidden status keys in `~/.pi/agent/footer-organizer.json`.

## Installation

```sh
pi install npm:@yukikisaku/pi-organize-footer
```

## Usage

Run `/footer` to toggle status items. Run `/footer reset` to show all items again.

## Configuration

The hidden-key list is persisted in `~/.pi/agent/footer-organizer.json`.

## Uninstallation

```sh
pi uninstall npm:@yukikisaku/pi-organize-footer
```

Remove any package-specific configuration described above if you no longer need it.

## Pull requests

This repository includes a policy for automatic AI review and merge of incoming pull requests. It becomes active when the CI and merge workflows are on `main` and the maintainer's GitHub event automation is enabled; a draft setup PR does not activate it.

Once active, AI reviews each non-draft PR and it is merged automatically only when the review has no findings, required CI succeeds, and there are no conflicts or unresolved review threads. New commits require a new review. Changes to the automation itself require manual merge. See [AI review and merge operations](docs/ai-review-operations.md).

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
