require("dotenv").config();

const { App } = require("@slack/bolt");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

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

async function fetchAPOD() {
  let lastError;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(
        `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY}`,
      );

      if (!response.ok) {
        throw new Error(`api request failed with status ${response.status}`);
      }

      const body = await response.text();
      return JSON.parse(body);
    } catch (error) {
      lastError = error;

      if (attempt < 5) {
        console.warn(`fetch+parse failed, retrying (${attempt}/5})`, error);
      }
    }
  }

  throw lastError;
}

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

async function sendAPODToChannel(channel) {
  let imageUrl = "https://picsum.photos/1024";
  let hdUrl = "https://picsum.photos/1920";
  let title = "Contact @pythonatsea if you see this";
  try {
    const data = await fetchAPOD();
    imageUrl = data.url;
    hdUrl = data.hdurl;
    title = data.title;
    explanation = data.explanation.replace(/\s+/g, " ");
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
  await sendAPODToChannel(command.channel_id);
  if (await shouldAskUser(command.user_id, command.channel_id)) {
    await promptToEnroll(command.channel_id, command.user_id, respond);
  }
});

app.event("app_mention", async ({ event }) => {
  await sendAPODToChannel(event.channel);
});

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
