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

Pull requests are reviewed by AI and automatically merged when the review and CI pass.

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
