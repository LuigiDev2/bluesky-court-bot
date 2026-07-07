import { $Typed, Agent, CredentialSession } from "@atproto/api";
import { CursorManager } from "./cursor-manager.js";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  AppBskyNotificationListNotifications,
  AppBskyFeedDefs,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedImages,
} from "@atproto/api";
import { work } from "objection-worker-builder/build/index.js";
import { ConcurrencyCounter } from "./semaphore.js";
import { wait } from "objection-worker-builder/build/utils.js";
import { Comments } from "objection-worker-builder";

// Create a Bluesky Agent
// const agent = new BskyAgent({
//   service: "https://bsky.social",
// });
const session = new CredentialSession(new URL("https://bsky.social"));
let agent: Agent;

async function init() {
  await session.login({
    identifier: process.env.BLUESKY_USERNAME!,
    password: process.env.BLUESKY_PASSWORD!,
  });

  agent = new Agent(session);
}

async function mainLoop() {
  while (true) {
    console.debug("Starting loop");
    const cursor = CursorManager.getCursor();
    CursorManager.saveCursor();
    const notis = await agent.listNotifications({
      reasons: ["mention"],
      limit: 100,
    });

    if (!notis.success) {
      await wait(10000);
    }

    console.log("Notifications sucess");

    const tmpBase = os.tmpdir();
    const tmpDir = tmpBase.concat("/", randomUUID());
    await fs.mkdir(tmpDir);

    // test value for cursor 1783186948495
    const neededNotifications = notis.data.notifications.filter(
      (not) => new Date(not.indexedAt).getTime() > cursor,
    );

    console.debug("%d needed notifications", neededNotifications.length);

    for (const notification of neededNotifications) {
      await ConcurrencyCounter.acquireCounter();
      // This way processes are launched in paralel so we don't need to wait for each single one of them
      handleThread(agent, notification, tmpDir)
        .then(() => {})
        .catch(console.error)
        .finally(() => ConcurrencyCounter.releaseCounter());
    }

    if (!neededNotifications.length) {
      await wait(30000);
    }
  }
}

async function handleThread(
  agent: Agent,
  notification: AppBskyNotificationListNotifications.Notification,
  tmpDir: string,
) {
  console.debug("Processng notification for", notification.author.handle);
  const thread = await agent.getPostThread({
    uri: notification.uri,
    depth: 0,
    parentHeight: 1000,
  });
  if (thread.success) {
    const unrolledThread: Comments[] = [];
    let currentPost = (thread.data.thread as any)
      .parent as typeof thread.data.thread;
    let lastPost = currentPost;
    while (currentPost != null) {
      if (currentPost.$type === "app.bsky.feed.defs#threadViewPost") {
        const typedPost = currentPost as AppBskyFeedDefs.ThreadViewPost;
        let evidence: string | undefined = undefined;
        if (
          "embed" in typedPost.post.record &&
          (typedPost.post.record.embed as any).$type === "app.bsky.embed.images"
        ) {
          console.debug("Evidence detected");
          const imageRef = (
            (typedPost.post.record.embed as any)
              ?.images?.[0] as AppBskyEmbedImages.Image
          )?.image.ref;
          let imgArr: ArrayBufferLike | null = null;
          try {
            const imageBlobResponse = await fetch(
              `https://cdn.bsky.app/img/feed_fullsize/plain/${typedPost.post.author.did}/${imageRef.toString()}@png`,
            );
            imgArr = await imageBlobResponse.arrayBuffer();
          } catch (e) {
            console.error("AAAA");
          }
          if (imgArr) {
            try {
              const imageName = tmpDir.concat(
                "/",
                imageRef.code.toString(),
                ".png",
              );
              await fs.writeFile(imageName, Buffer.from(imgArr));
              evidence = imageName;
            } catch (e) {}
          }
        }
        unrolledThread.unshift({
          user: {
            displayName: typedPost.post.author.displayName,
            id: typedPost.post.author.did,
          },
          text: (typedPost.post.record as { text: string }).text,
          evidence,
        });
      }
      if ((currentPost as any).post) {
        lastPost = currentPost;
      }
      currentPost = (currentPost as any).parent as typeof currentPost;
    }
    if (!(lastPost as any).post) {
      console.error("NO LAST POST");
    } else {
      console.debug("Gotta Render!");
      const videoPath = await work({
        comments: unrolledThread,
        tmpDir: tmpDir,
        forceCodec: { codec: "libx264", extension: "mp4" },
      });
      const video = await fs.readFile(videoPath);
      console.debug("Gotta Upload!");
      const { data } = await agent.uploadBlob(video);
      await wait(10000);
      console.debug("Gotta Post!");
      // nested try catches because bluesky's API refuses to actually give out any meaningful errors
      try {
        await post(agent, data, notification, lastPost);
      } catch (e) {
        await wait(3000);
        try {
          await post(agent, data, notification, lastPost);
        } catch (e) {
          await wait(5000);
          try {
            await post(agent, data, notification, lastPost);
          } catch(e) {
            console.error(e);
          }
        }
      }
    }
  }
}

init().then(() => {
  mainLoop().then();
});
async function post(
  agent: Agent,
  data: Awaited<ReturnType<Agent["uploadBlob"]>>["data"],
  notification: AppBskyNotificationListNotifications.Notification,
  lastPost:
    | $Typed<AppBskyFeedDefs.ThreadViewPost>
    | $Typed<AppBskyFeedDefs.NotFoundPost>
    | $Typed<AppBskyFeedDefs.BlockedPost>
    | { $type: string },
) {
  await agent.post({
    text: `Hey! Here's your video. Please note that this bot is an very early stage. Errors are bound to happen. Things may not properly work. Please DM me for any issue you may have.`,
    embed: {
      $type: "app.bsky.embed.video",
      video: data.blob,
    },
    createdAt: new Date().toISOString(),
    reply: {
      parent: { cid: notification.cid, uri: notification.uri },
      root: {
        uri: (lastPost as any).post.uri,
        cid: (lastPost as any).post.cid,
      },
    },
  });
}
