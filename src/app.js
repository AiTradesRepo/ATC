require("dotenv").config();
const express = require("express");
var path = require("path");
const WebSocket = require("ws");
const StellarSdk = require("stellar-sdk");
const Web3 = require("web3");
const axios = require("axios");
const schedule = require("node-schedule");
const moment = require("moment");
var cors = require("cors");
const _ = require("lodash");
const port = process.env.PORT;
const apiUserRouter = require("./routers/apiUser");
const atcRouter = require("./routers/atc");
const Order = require("./models/Order");
const Wallet = require("./models/Wallet");
const WalletSnapshot = require("./models/WalletSnapshot");
const DistributionHistory = require("./models/DistributionHistory");
require("./db/db");

const StellarServer = new StellarSdk.Server(process.env.STELLAR_SERVER_URL);

const app = express();

app.use(express.json());
app.use(cors());

app.use(apiUserRouter);
app.use(atcRouter);

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);

  DistributionHistory.find({ paid: false, profitAmount: { $gt: 0 } }).then(
    async distributionHistories => {
      for (let i = 0; i < distributionHistories.length; i++) {
        await distributionHistories[i].payProfit();
      }
    }
  );

  // const endOfMonth = moment.utc().endOf("month");
  // const startOfMonth = moment.utc().startOf("month");
  // const daysInMonth = moment.utc().daysInMonth();
  //
  // Wallet.find({ type: "staking" }).then(wallets => {
  //   wallets.forEach(async wallet => {
  //     WalletSnapshot.find({
  //       userId: wallet.userId,
  //       createdAt: {
  //         $gte: startOfMonth.toDate(),
  //         $lt: endOfMonth.toDate()
  //       }
  //     }).then(async snapshots => {
  //       let hasLessThan100 = false;
  //       let total = 0;
  //       for (let i = 0; i < snapshots.length; i++) {
  //         if (snapshots[i].balance < 100) {
  //           hasLessThan100 = true;
  //         }
  //         total += snapshots[i].balance;
  //       }
  //       const average = total / daysInMonth;
  //
  //       let monthProfitPercentage = hasLessThan100
  //         ? 0
  //         : wallet.calculateMonthProfit();
  //       let profit =
  //         Math.round(((average * monthProfitPercentage) / 100) * 100) / 100;
  //
  //       console.log("PROFIT", average, monthProfitPercentage, profit);
  //       const distributionHistory = new DistributionHistory({
  //         publicKey: wallet.publicKey,
  //         asset: wallet.asset,
  //         serverUrl: wallet.serverUrl,
  //         userId: wallet.userId,
  //         monthProfitPercentage,
  //         profitAmount: profit,
  //         fromDate: startOfMonth.isAfter(wallet.createdAt)
  //           ? startOfMonth.toDate()
  //           : wallet.createdAt,
  //         toDate: endOfMonth
  //       });
  //
  //       await distributionHistory.save();
  //     });
  //   });
  // });

  const blockchainConn = new WebSocket("wss://ws.blockchain.info/inv");
  blockchainConn.onopen = () => {
    console.log("blockchainConn.onopen");
    blockchainConn.send(`{"op":"blocks_sub"}`);
  };
  blockchainConn.onerror = error => {
    console.log(`WebSocket error: ${error}`);
  };
  blockchainConn.onmessage = function(e) {
    const json = JSON.parse(e.data);
    if (json.op === "block") {
      console.log("BLOCK", json.x.height);
      const blockHeight = json.x.height;
      Order.find({
        acceptableCurrency: "BTC",
        status: "waiting_for_confirmation"
      }).then(orders => {
        orders.forEach(order => {
          if (order.transaction.block_height === undefined) {
            axios
              .get(`https://blockchain.info/rawtx/${order.transaction.hash}`)
              .then(response => {
                const transactionJson = response.data;
                if (transactionJson.block_height) {
                  let transaction = order.transaction;
                  transaction = {
                    ...transaction,
                    block_height: transactionJson.block_height
                  };
                  order.transaction = transaction;
                  order.updateBTCConfirmations(blockHeight);
                }
              })
              .catch(e => {
                console.error(e);
              });
          } else {
            order.updateBTCConfirmations(blockHeight);
          }
        });
      });
    }
  };

  Order.find({
    status: "confirmed"
  }).then(orders => {
    orders.forEach(order => {
      order.transferAsset();
    });
  });

  Order.find({
    acceptableCurrency: "ETH",
    status: "waiting_for_payment",
    expirationDate: {
      $gt: Date.now()
    }
  }).then(orders => {
    orders.forEach(order => {
      order.checkETHPaymentTransaction();
    });
  });

  Order.find({
    acceptableCurrency: "ETH",
    status: "waiting_for_confirmation",
    expirationDate: {
      $gt: Date.now()
    }
  }).then(orders => {
    orders.forEach(order => {
      order.checkETHConfirmations();
    });
  });

  Order.find({
    acceptableCurrency: "USDT",
    status: "waiting_for_payment",
    expirationDate: {
      $gt: Date.now()
    }
  }).then(orders => {
    orders.forEach(order => {
      order.checkUSDTPaymentTransaction();
    });
  });

  Order.find({
    acceptableCurrency: "USDT",
    status: "waiting_for_confirmation",
    expirationDate: {
      $gt: Date.now()
    }
  }).then(orders => {
    orders.forEach(order => {
      order.checkUSDTConfirmations();
    });
  });

  schedule.scheduleJob("*/10 * * * *", () => {
    console.log("expire check");
    Order.find({
      expirationDate: {
        $lt: Date.now()
      },
      status: "waiting_for_payment"
    }).then(orders => {
      orders.forEach(order => {
        order.status = "expired";
        order.expiredAt = Date.now();
        if (!order.userId) {
          order.userId = 0;
        }
        order.save();
      });
    });
  });

  const currentDateTime = moment.utc();
  currentDateTime.hour("23");
  currentDateTime.minutes("59");
  currentDateTime.local();

  schedule.scheduleJob(
    `${currentDateTime.minutes()} ${currentDateTime.hour()} * * *`,
    function() {
      let now = moment.utc();
      now.hour("23");
      now.minutes("59");
      now.local();
      console.log("WALLETS SNAPSHOT", now.toString());
      Wallet.find({
        "asset.code": process.env.ASSET_CODE,
        "asset.issuer": process.env.ISSUER_ACC_PUBLIC_KEY,
        type: "staking"
      }).then(wallets => {
        wallets.forEach(async wallet => {
          await wallet.takeSnapshot(now);
        });
      });
    }
  );
});
