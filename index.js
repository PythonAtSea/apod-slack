require("dotenv").config();

const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

async function getApodMessage() {
  let imageUrl = "https://picsum.photos/1024";
  let hdUrl = "https://picsum.photos/1920";
  let title = "Contact @pythonatsea if you see this";
  try {
    const response = await fetch(
      `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY}`,
    );
    const data = await response.json();
    imageUrl = data.url;
    hdUrl = data.hdurl;
    title = data.title;
  } catch (error) {
    return {
      blocks: [{ type: "text", text: error }],
    };
  }
  return {
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
  };
}

app.command("/apod", async ({ ack, respond }) => {
  await ack();
  await respond(await getApodMessage());
});

app.event("app_mention", async ({ say }) => {
  await say(await getApodMessage());
});

app.action("url", async ({ ack, respond }) => {
  await ack();
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();
