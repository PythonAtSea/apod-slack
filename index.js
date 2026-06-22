require("dotenv").config();

const { App } = require("@slack/bolt");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const cron = require("node-cron");
const chrono = require("chrono-node");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const dbPath = path.join(__dirname, "apod.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("error opening db", err);
  } else {
    console.log("connected to db");
    db.run(`
      CREATE TABLE IF NOT EXISTS enrolled_channels (
        channel_id TEXT UNIQUE NOT NULL PRIMARY KEY
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS dont_ask (
        user_id TEXT UNIQUE NOT NULL PRIMARY KEY
      )
    `);
  }
});

async function fetchAPOD(date = null, random = false) {
  let lastError;

  for (let attempt = 1; true; attempt += 1) {
    try {
      const response = await fetch(
        `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY}${date && !random ? `&date=${date}` : ""}${random ? "&count=1" : ""}`,
      );

      if (!response.ok) {
        throw new Error(`api request failed with status ${response.status}`);
      }

      const body = await response.text();
      return JSON.parse(body);
    } catch (error) {
      lastError = error;

      console.warn(`fetch+parse failed, retrying (${attempt}/∞)`, error);
    }
  }

  throw lastError;
}

let cachedAPOD = null;

cron.schedule("*/5 * * * *", async () => {
  try {
    cachedAPOD = fetchAPOD();
    console.log("refreshed cached apod");
  } catch (error) {
    console.error("failed to refresh cached apod", error);
  }
});

function enrollChannel(channel) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO enrolled_channels (channel_id) VALUES (?)",
      [channel],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}

function unenrollChannel(channel) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM enrolled_channels WHERE channel_id = ?",
      [channel],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}

function dontAskUser(user) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO dont_ask (user_id) VALUES (?)",
      [user],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}

function shouldAskUser(user, channel) {
  return new Promise((resolve, reject) => {
    let userBlacklisted = false;
    let channelEnrolled = false;
    db.get("SELECT * FROM dont_ask WHERE user_id = ?", [user], (err, row) => {
      if (err) {
        reject(err);
      } else {
        userBlacklisted = row !== undefined;
      }
    });
    db.get(
      "SELECT * FROM enrolled_channels WHERE channel_id = ?",
      [channel],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          channelEnrolled = !!rows;
        }
        resolve(!userBlacklisted && !channelEnrolled);
      },
    );
  });
}

function sendToAll() {
  db.all("SELECT channel_id FROM enrolled_channels", async (err, rows) => {
    if (err) {
      console.error("error fetching enrolled channels", err);
    } else {
      const channels = rows.map((row) => row.channel_id);
      await sendAPODToChannel(channels);
    }
  });
}

async function sendAPODToChannel(channels, date = null) {
  let imageUrl = "https://picsum.photos/1024";
  let hdUrl = "https://picsum.photos/1920";
  let title = "Contact @pythonatsea if you see this";
  try {
    if (date !== null) {
      APODData = await fetchAPOD(date);
      console.log("fetched apod for specific date", date);
    } else if (
      !cachedAPOD ||
      !cachedAPOD.url ||
      !cachedAPOD.hdurl ||
      !cachedAPOD.title ||
      !cachedAPOD.explanation
    ) {
      APODData = await fetchAPOD();
      console.log("cached apod was null or invalid, fetched new one");
    } else {
      APODData = cachedAPOD;
    }
    imageUrl = APODData.url;
    hdUrl = APODData.hdurl;
    title = APODData.title;
    explanation = APODData.explanation.replace(/\s+/g, " ");
    for (const channel of Array.isArray(channels) ? channels : [channels]) {
      topLevel = await app.client.chat.postMessage(
        (ChatPostMessageArguments = {
          channel: channel,
          text: title,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: title,
                emoji: true,
              },
              level: 1,
            },
            {
              type: "image",
              image_url: imageUrl,
              alt_text: "",
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  style: "primary",
                  text: {
                    type: "plain_text",
                    text: "Full HD Image :external-link:",
                    emoji: true,
                  },
                  url: hdUrl,
                  action_id: "url",
                },
              ],
            },
          ],
        }),
      );
      app.client.chat.postMessage(
        (ChatPostMessageArguments = {
          channel: channel,
          thread_ts: topLevel.ts,
          text: explanation,
        }),
      );
    }
    console.log(topLevel);
  } catch (error) {
    console.error(error);
    app.client.chat.postMessage(
      (ChatPostMessageArguments = {
        channel: channel,
        text: "Hmm, looks like something went wrong..",
      }),
    );
  }
}

async function promptToEnroll(channel, user, respond) {
  await respond(
    (ChatPostMessageArguments = {
      channel: channel,
      text: "Enroll this channel in daily astronomy pictures?",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Enroll this channel in daily astronomy pictures?",
            emoji: true,
          },
          level: 1,
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: {
                type: "plain_text",
                text: "Sure!",
                emoji: true,
              },
              action_id: "enroll_yes",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Remind me later",
                emoji: true,
              },
              action_id: "enroll_later",
            },
            {
              type: "button",
              style: "danger",
              text: {
                type: "plain_text",
                text: "Don't ask me again",
                emoji: true,
              },
              action_id: "enroll_no",
            },
          ],
        },
      ],
      user: user,
    }),
  );
}

app.command("/apod", async ({ ack, respond, command }) => {
  await ack();
  let date = null;
  if (command.text) {
    try {
      date = chrono.parseDate(command.text).toISOString().split("T")[0];
      await sendAPODToChannel(command.channel_id, date);
    } catch (error) {
      respond({
        response_type: "ephemeral",
        text: "Hmm, that doesn't look like a valid date.",
      });
      return;
    }
  } else {
    await sendAPODToChannel(command.channel_id);
  }
  if (await shouldAskUser(command.user_id, command.channel_id)) {
    await promptToEnroll(command.channel_id, command.user_id, respond);
  }
});

cron.schedule(
  "0 12 * * *",
  () => {
    sendToAll();
    console.log("sending to all channels from cron");
  },
  (timezone = "America/New_York"),
);

app.action("url", async ({ ack, respond }) => {
  await ack();
});

app.action("enroll_yes", async ({ ack, respond, body }) => {
  await ack();
  const channelId = body.channel.id;
  try {
    await enrollChannel(channelId);
    await respond({
      response_type: "ephemeral",
      text: "Ok, I'll send you pictures like this daily!",
    });
  } catch (error) {
    console.error(error);
    await respond({
      response_type: "ephemeral",
      text: "Hmm, looks like something went wrong..",
    });
  }
});

app.action("enroll_no", async ({ ack, respond, body }) => {
  await ack();
  try {
    await dontAskUser(body.user.id);
    await respond({
      response_type: "ephemeral",
      text: "Ok, I won't ask you again",
    });
  } catch (error) {
    console.error(error);
    await respond({
      response_type: "ephemeral",
      text: "Hmm, looks like something went wrong..",
    });
  }
});

app.action("enroll_later", async ({ ack, respond }) => {
  await ack();
  await respond({
    delete_original: true,
  });
});

(async () => {
  cachedAPOD = await fetchAPOD();
  console.log("fetched apod for first time");

  await app.start();
  console.log("bot is running!");
})();

process.on("SIGINT", () => {
  db.close((err) => {
    if (err) {
      console.error("error closing db", err);
    } else {
      console.log("db connection closed!");
    }
    process.exit(0);
  });
});
