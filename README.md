# bluesky-court-bot
 Bluesky bot that converts threads into Ace Attorney Conversations

## Requirements
- Everything needed for https://github.com/LuigiDev2/objection-worker-builder

## How-To
- Clone with recursion `git clone --recursive`
  - if you already cloned without recursion enable submodules: `git submodule init && git submodule update`
- Install dependencies: `npm install`
- Build`npx tsc`
- Launch: `BLUESKY_USERNAME=xxx@bsky.social' BLUESKY_PASSWORD=yyy`
- (Optional) To install this as a systemd file use [bluesky-court-bot.service](https://github.com/LuigiDev2/bluesky-court-bot/blob/main/bluesky-court-bot.service). Just copy the file to /etc/systemd/system, adjust the user and working directories paths and the bluesky credentials.

