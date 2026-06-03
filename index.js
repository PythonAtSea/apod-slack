require("dotenv").config();

const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

function getApodMessage() {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "title",
          emoji: true,
        },
        level: 1,
      },
      {
        type: "image",
        image_url: "https://picsum.photos/1024",
        alt_text: "",
      },
    ],
  };
}

app.command("/apod", async ({ ack, respond }) => {
  await ack();
  await respond(getApodMessage());
});

app.event("app_mention", async ({ say }) => {
  await say(getApodMessage());
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();
