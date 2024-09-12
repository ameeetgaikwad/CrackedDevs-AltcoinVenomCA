const { Network, Alchemy, Utils } = require("alchemy-sdk");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Optional Config object, but defaults to demo api-key and eth-mainnet.
const settings = {
  apiKey: process.env.ALCHEMY_API_KEY, // Replace with your Alchemy API Key.
  network: Network.ETH_MAINNET, // Replace with your network.
};

const alchemy = new Alchemy(settings);
const token = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(token, { polling: true });

const userSubscriptions = new Map();
const userChatId_messageThreadId = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bot.onText(/\/start(.+)?/, async (msg, match) => {
  const chatId = msg.chat.id;
  console.log("---------------------------------");
  console.log("msg:", msg);
  const ethValue = match[1] ? Number(match[1].trim()) : 0.9;

  if (!userSubscriptions.has(chatId)) {
    userSubscriptions.set(chatId, new Set());
  }
  userSubscriptions.get(chatId).add(Number(ethValue));
  if (msg.message_thread_id) {
    if (!userChatId_messageThreadId.has(chatId)) {
      userChatId_messageThreadId.set(chatId, new Set());
    }
    userChatId_messageThreadId.get(chatId).add(msg.message_thread_id);
  }
  // test();
  bot.sendMessage(
    chatId,
    `Welcome ${msg.from.first_name}! You are now subscribed to the bot. You will be notified when a token with a balance of ${ethValue} ETH or more is detected.`,
    {
      message_thread_id: msg.message_thread_id,
    }
  );
  console.log("msg.message_thread_id:", msg.message_thread_id);
  console.log("chatId:", chatId);
});

bot.onText(/\/stop (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;
  const ethValue = Number(match[1].trim());

  if (userSubscriptions.has(chatId)) {
    userSubscriptions.get(chatId).delete(ethValue);
    if (userChatId_messageThreadId.has(chatId)) {
      bot.sendMessage(
        chatId,
        `You have unsubscribed from notifications for ${ethValue} ETH.`,
        {
          message_thread_id: messageThreadId,
        }
      );
    } else {
      bot.sendMessage(
        chatId,
        `You have unsubscribed from notifications for ${ethValue} ETH.`
      );
    }
  } else {
    if (messageThreadId) {
      bot.sendMessage(chatId, "You don't have any active subscriptions.", {
        message_thread_id: messageThreadId,
      });
    } else {
      bot.sendMessage(chatId, "You don't have any active subscriptions.");
    }
  }
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  if (userSubscriptions.has(chatId) && userSubscriptions.get(chatId).size > 0) {
    const subscriptions = Array.from(userSubscriptions.get(chatId)).join(", ");
    if (userChatId_messageThreadId.has(chatId)) {
      bot.sendMessage(
        chatId,
        `Your active subscriptions: ${subscriptions} ETH`,
        { message_thread_id: messageThreadId }
      );
    } else {
      bot.sendMessage(
        chatId,
        `Your active subscriptions: ${subscriptions} ETH`
      );
    }
  } else {
    if (messageThreadId) {
      bot.sendMessage(chatId, "You don't have any active subscriptions.", {
        message_thread_id: messageThreadId,
      });
    } else {
      bot.sendMessage(chatId, "You don't have any active subscriptions.");
    }
  }
});

async function processBlock(blockNumber) {
  console.log("Processing block:", blockNumber);
  await delay(3000);

  console.log("Fetching transactions...");

  // let { transactions } = await alchemy.core.getBlock(blockNumber);
  let { receipts } = await alchemy.core.getTransactionReceipts({
    blockNumber: blockNumber.toString(),
  });

  for (let response of receipts) {
    try {
      if (response.contractAddress) {
        console.log("contract address", response.contractAddress);

        let tokenData = await alchemy.core.getTokenMetadata(
          response.contractAddress
        );
        if (tokenData.decimals > 0) {
          console.log("got erc20 token", tokenData);
          let balance = await alchemy.core.getBalance(
            response.contractAddress,
            "latest"
          );
          let formatedBalance = Utils.formatUnits(balance.toString(), "ether");

          let { deployerAddress } = await alchemy.core.findContractDeployer(
            response.contractAddress
          );

          for (let [chatId, subscriptions] of userSubscriptions.entries()) {
            for (let ethValue of subscriptions) {
              if (formatedBalance >= Number(ethValue)) {
                console.log("sending to chatId", chatId);
                if (userChatId_messageThreadId.has(chatId)) {
                  for (let messageThreadId of userChatId_messageThreadId.get(
                    chatId
                  )) {
                    bot.sendMessage(
                      chatId,
                      `https://etherscan.io/address/${response.contractAddress} \n - Contract Address: ${response.contractAddress} \n - Deployer Address: ${deployerAddress} \n - Current Balance: ${formatedBalance} ETH \n - Token Name: ${tokenData.name} \n - Token Symbol: ${tokenData.symbol}`,
                      {
                        message_thread_id: messageThreadId,
                      }
                    );
                  }
                } else {
                  bot.sendMessage(
                    chatId,
                    `https://etherscan.io/address/${response.contractAddress} \n - Contract Address: ${response.contractAddress} \n - Deployer Address: ${deployerAddress} \n - Current Balance: ${formatedBalance} ETH \n - Token Name: ${tokenData.name} \n - Token Symbol: ${tokenData.symbol}`
                  );
                }

                console.log(
                  "we got the required address",
                  response.contractAddress
                );
              }
            }
          }
        }

        console.log(tokenData);
      }
    } catch (e) {
      console.log("error in b1", e);
    }
  }
}

async function main() {
  alchemy.ws.on("block", async (blockNumber) => {
    try {
      await processBlock(blockNumber);
    } catch (e) {
      console.log("error in b2", e);
    }
  });
}

main();
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
