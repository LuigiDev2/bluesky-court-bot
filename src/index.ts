import { CursorManager } from "./cursor-manager.js";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { work } from "objection-worker-builder/build/index.js";
import { ConcurrencyCounter } from "./semaphore.js";
import { wait } from "objection-worker-builder/build/utils.js";
import { Comments } from "objection-worker-builder";
import { Bot, Post } from "@skyware/bot";

// Create a Bluesky Agent
// const agent = new BskyAgent({
//   service: "https://bsky.social",
// });
const bot = new Bot({ emitChatEvents: true });

async function init() {
  await bot.login({
    identifier: process.env.BLUESKY_USERNAME!,
    password: process.env.BLUESKY_PASSWORD!,
  });
  bot.on("mention", async (post) => {
    await ConcurrencyCounter.acquireCounter();
    const tmpDir = await getTmpDir();
    // This way processes are launched in paralel so we don't need to wait for each single one of them
    replyToMention(post, tmpDir)
      .then(() => {})
      .catch(console.error)
      .finally(() => {
        fs.rm(tmpDir, { force: true, maxRetries: 3, recursive: true })
          .then(() => {})
          .catch(console.error);
        ConcurrencyCounter.releaseCounter();
      });
  });

  bot.on("message", async (msg) => {
    console.log("Got the message!");
    if (msg.embed?.uri) {
      const post = await bot.getPost(msg.embed.uri, {
        parentHeight: 100,
        skipCache: true,
      });
      const conversation = await msg.getConversation();
      if (post.author.did === bot.profile.did) {
        console.log("Deletion Request!");
        let currentPost = post.parent;
        const authUsers = new Set<string>();
        while (currentPost) {
          authUsers.add(currentPost.author.did);
          currentPost = currentPost.parent;
        }
        if (authUsers.has(msg.senderDid)) {
          await post.delete();
          if (conversation) {
            await conversation.sendMessage({
              text: "The post has been removed!",
            });
          }
        } else if (conversation) {
          await conversation.sendMessage({
            text: "You can't ask for the removal of a post you're not featured in",
          });
        }
      } else if (process.env.STATICS_PATH && process.env.EXTERNAL_URL_PATTERN) {
        //TODO: Private Renders!
      }
    }
  });
}

async function getTmpDir() {
  const tmpBase = os.tmpdir();
  const tmpDir = tmpBase.concat("/bluesky-court-bot/", randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function replyToMention(ogPost: Post, tmpDir: string) {
  const videoPath = await processThreadAndGetVideoPath(ogPost, tmpDir);
  const video = await fs.readFile(videoPath);
  console.debug("Gotta Post!");
  try {
    ogPost.reply({
      text: `Hey! Here's your video. Please note that this bot is an very early stage. Errors are bound to happen. Things may not properly work. Please DM me for any issue you may have.\n\nIf any person featured in this video wants it removed just DM me this very same post`,
      video: { data: new Blob([video.buffer], { type: "video/mp4" }) },
    });
  } catch (e) {
    console.error(e);
  }
}

async function processThreadAndGetVideoPath(ogPost: Post, tmpDir: string) {
  console.debug("Processng notification for", ogPost.author.handle);
  const unrolledThread: Comments[] = [];
  let currentPost: Post | undefined | null = await ogPost.fetchParent({
    parentHeight: 100,
    force: true,
  });
  // let currentPost: Post | undefined = ogPost.parent;
  while (currentPost != null) {
    if (true) {
      // Used to be use for checking removed posts, we'll see how it plays out now
      let evidence: Comments["evidence"] | undefined = undefined;
      if (currentPost.embed?.isImages()) {
        console.debug("Evidence detected");
        const image = currentPost.embed.images[0];
        if (image.url) {
          let imgArr: ArrayBufferLike | null = null;
          try {
            const imageBlobResponse = await fetch(image.url + "@png");
            imgArr = await imageBlobResponse.arrayBuffer();
          } catch (e) {
            console.error("AAAA");
          }
          if (imgArr) {
            try {
              const imageName = tmpDir.concat("/", image.cid, ".png");
              await fs.writeFile(imageName, Buffer.from(imgArr));
              evidence = {
                path: imageName,
                title: `${currentPost.author.displayName}'s evidence`,
                alt: image.alt?.replaceAll('"', "''"),
              };
            } catch (e) {}
          }
        }
      }
      unrolledThread.unshift({
        user: {
          displayName: currentPost.author.displayName,
          id: currentPost.author.did,
        },
        text: currentPost.text,
        evidence,
      });
    }
    currentPost = currentPost?.parent;
  }
  console.debug("Gotta Render!");
  const videoPath = await work({
    comments: unrolledThread,
    tmpDir: tmpDir,
    forceCodec: { codec: "libx264", extension: "mp4", volume: "0.1" },
  });
  return videoPath;
}

init().then(() => {});
