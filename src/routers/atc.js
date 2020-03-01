const express = require("express");
const axios = require("axios");
const _ = require("lodash");
const bitcoin = require("bitcoinjs-lib");
const etherWallet = require("ethereumjs-wallet");
const { check, body, validationResult } = require("express-validator");
const moment = require("moment");
const WebSocket = require("ws");

const apiAuth = require("../middleware/apiAuth");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");
const WalletSnapshot = require("../models/WalletSnapshot");
const DistributionHistory = require("../models/DistributionHistory");

const StellarSdk = require("stellar-sdk");
const StellarServer = new StellarSdk.Server(process.env.STELLAR_SERVER_URL);

const router = express.Router();

const formUrlEncoded = x =>
  Object.keys(x).reduce((p, c) => p + `&${c}=${encodeURIComponent(x[c])}`, "");

const ASSETUSD = 1;

router.get("/atc/price", apiAuth, async (req, res) => {
  try {
    const startOfMonth = moment.utc().startOf("month");

    const tickersResponse = await axios.get(
      "https://api-pub.bitfinex.com/v2/tickers?symbols=tBTCUSD,tETHUSD,tXLMUSD,tXLMBTC,tUSTUSD"
    );
    const tickersData = tickersResponse.data;

    const fxRatesResponse = await axios.get(
      "https://api.exchangeratesapi.io/latest"
    );
    const fxRatesData = fxRatesResponse.data;

    const BTCUSD = tickersData[0][1];
    const ETHUSD = tickersData[1][1];
    const XLMUSD = tickersData[2][1];
    const XLMBTC = tickersData[3][1];
    const USDTUSD = tickersData[4][1];

    const ASSETBTC = _.round(ASSETUSD / BTCUSD, 8);
    const ASSETETH = _.round(ASSETUSD / ETHUSD, 8);
    const ASSETXLM = _.round(ASSETUSD / XLMUSD, 5);
    const ASSETUSDT = _.round(ASSETUSD / USDTUSD, 4);
    const ASSETEUR = _.round(ASSETUSD / fxRatesData.rates.USD, 2);

    res.send({
      BTCUSD,
      ETHUSD,
      XLMUSD,
      USDTUSD,
      ASSETUSD,
      ASSETBTC,
      ASSETETH,
      ASSETUSDT,
      ASSETEUR,
      ASSETCODE: process.env.ASSET_CODE
    });
  } catch (error) {
    console.error(error);
    res.status(400).send(error);
  }
});

router.get("/atc/users/:userId/orders", apiAuth, async (req, res) => {
  const orders = await Order.find({
    userId: req.params.userId
  });

  orders.forEach(order => {
    delete order._doc.walletSecret;
  });
  res.send(orders);
});

router.get("/atc/users/:userId/wallets/:type", apiAuth, async (req, res) => {
  const _wallets = await Wallet.find({
    userId: req.params.userId,
    type: req.params.type,
    "asset.code": process.env.ASSET_CODE
  });

  let wallets = [];

  for (const _wallet of _wallets) {
    let balance = 0;
    try {
      const account = await StellarServer.loadAccount(_wallet.publicKey);
      if (account && account.balances) {
        const balancesIndex = _.findIndex(account.balances, balance => {
          return (
            balance.asset_code === process.env.ASSET_CODE &&
            balance.asset_issuer === process.env.ISSUER_ACC_PUBLIC_KEY
          );
        });

        if (balancesIndex >= 0) {
          balance = parseFloat(account.balances[balancesIndex].balance);
        }
      }
    } catch (err) {
      console.error(err);
    }
    wallets.push({
      publicKey: _wallet.publicKey,
      balance
    });
  }

  res.send({ wallets });
});

router.get(
  "/atc/users/:userId/wallets/:publicKey/snapshots",
  apiAuth,
  async (req, res) => {
    const startOfMonth = moment.utc().startOf("month");

    const snapshots = await WalletSnapshot.find({
      userId: req.params.userId,
      publicKey: req.params.publicKey,
      "asset.code": process.env.ASSET_CODE,
      createdAt: {
        $gte: startOfMonth.toDate()
      }
    }).sort({ createdAt: -1 });

    let sum = 0;
    snapshots.forEach(snapshot => {
      sum += snapshot.balance;
    });

    res.send({ snapshots, sum });
  }
);

router.get(
  "/atc/users/:userId/wallets/:publicKey/distribution-histories",
  apiAuth,
  async (req, res) => {
    const startOfMonth = moment.utc().startOf("month");

    const distributionHistories = await DistributionHistory.find({
      userId: req.params.userId,
      publicKey: req.params.publicKey,
      "asset.code": process.env.ASSET_CODE
    }).sort({ createdAt: -1 });

    res.send({ distributionHistories });
  }
);

router.post(
  "/atc/users/:userId/wallets/:publicKey/withdraw",
  apiAuth,
  [
    check("amount").isFloat({ min: 1 }),
    check("destination")
      .not()
      .isEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const assetFee = 0.5;

      const sourceWallet = await Wallet.findOne({
        userId: req.params.userId,
        publicKey: req.params.publicKey,
        "asset.code": process.env.ASSET_CODE
      });

      if (!sourceWallet) {
        return res.status(400).json({
          message: "source wallet not found"
        });
      }

      const sourceAccKeypair = StellarSdk.Keypair.fromSecret(
        sourceWallet.secret
      );

      let sourceAcc = await StellarServer.loadAccount(
        sourceAccKeypair.publicKey()
      );

      let sourceAccAssetBalance = 0;

      const balancesIndex = _.findIndex(sourceAcc.balances, balance => {
        return (
          balance.asset_code === process.env.ASSET_CODE &&
          balance.asset_issuer === process.env.ISSUER_ACC_PUBLIC_KEY
        );
      });

      if (balancesIndex >= 0) {
        sourceAccAssetBalance = parseFloat(
          sourceAcc.balances[balancesIndex].balance
        );
      }

      if (sourceAccAssetBalance < req.body.amount + assetFee) {
        return res.status(400).json({
          message: "Your account balance is not enough",
          accAssetBalance: sourceAccAssetBalance
        });
      }

      const asset = new StellarSdk.Asset(
        process.env.ASSET_CODE,
        process.env.ISSUER_ACC_PUBLIC_KEY
      );

      const fundingAccKeyPair = StellarSdk.Keypair.fromSecret(
        process.env.FUNDING_ACC_SECRET
      );

      let fundingAcc = await StellarServer.loadAccount(
        fundingAccKeyPair.publicKey()
      );

      const baseFee = await StellarServer.fetchBaseFee();

      const paymentTransaction = new StellarSdk.TransactionBuilder(fundingAcc, {
        fee: baseFee,
        networkPassphrase: StellarSdk.Networks.PUBLIC
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: req.body.destination,
            asset: asset,
            amount: req.body.amount.toString(),
            source: sourceAccKeypair.publicKey()
          })
        )
        .setTimeout()
        .build();

      paymentTransaction.sign(fundingAccKeyPair);
      paymentTransaction.sign(sourceAccKeypair);

      const paymentTransactionResult = await StellarServer.submitTransaction(
        paymentTransaction
      );

      fundingAcc = await StellarServer.loadAccount(
        fundingAccKeyPair.publicKey()
      );

      const feePaymentTransaction = new StellarSdk.TransactionBuilder(
        fundingAcc,
        {
          fee: baseFee,
          networkPassphrase: StellarSdk.Networks.PUBLIC
        }
      )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: fundingAccKeyPair.publicKey(),
            asset: asset,
            amount: assetFee.toString(),
            source: sourceAccKeypair.publicKey()
          })
        )
        .setTimeout()
        .build();

      feePaymentTransaction.sign(fundingAccKeyPair);
      feePaymentTransaction.sign(sourceAccKeypair);

      await StellarServer.submitTransaction(feePaymentTransaction);

      const localTransaction = new Transaction({
        userId: req.params.userId,
        type: "withdraw",
        extra: {
          transaction: paymentTransactionResult,
          asset: {
            code: process.env.ASSET_CODE,
            issuer: process.env.ISSUER_ACC_PUBLIC_KEY
          },
          amount: req.body.amount,
          fee: assetFee,
          totalAmount: req.body.amount + assetFee,
          sourceWallet: req.params.publicKey,
          destinationWallet: req.body.destination
        }
      });
      localTransaction.save();

      return res.send({ transaction: paymentTransactionResult });
    } catch (error) {
      console.error(error);
      if (error.response && error.response.data) {
        console.error(error.response.data.extras.result_codes);
        res.status(400).json({
          message: error.message,
          extra: error.response.data.extras.result_codes
        });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

router.get(
  "/atc/users/:userId/wallets/:publicKey/withdraw/history",
  apiAuth,
  async (req, res) => {
    const data = await Transaction.find({
      userId: req.params.userId,
      type: "withdraw",
      "extra.sourceWallet": req.params.publicKey
    });
    res.send({ data });
  }
);

router.get(
  "/atc/users/:userId/wallets/:publicKey/deposit/history",
  apiAuth,
  async (req, res) => {
    const sourceWallet = await Wallet.findOne({
      userId: req.params.userId,
      publicKey: req.params.publicKey,
      "asset.code": process.env.ASSET_CODE
    });

    if (!sourceWallet) {
      return res.status(400).json({
        message: "source wallet not found"
      });
    }

    const data = [];
    StellarServer.payments()
      .forAccount(sourceWallet.publicKey)
      .limit(200)
      .order("desc")
      .join("transactions")
      .call()
      .then(function(accountResult) {
        accountResult.records.forEach(record => {
          if (
            record.asset_code === process.env.ASSET_CODE &&
            record.asset_issuer === process.env.ISSUER_ACC_PUBLIC_KEY &&
            record.to === sourceWallet.publicKey
          ) {
            data.push({
              _id: record.id,
              userId: sourceWallet.userId,
              type: "deposit",
              extra: {
                transaction: record.transaction_attr,
                amount: parseFloat(record.amount),
                totalAmount: parseFloat(record.amount),
                sourceWallet: record.from,
                destinationWallet: record.to
              },
              createdAt: record.created_at,
              updatedAt: record.created_at
            });
          }
        });

        res.send({ data });
      })
      .catch(function(err) {
        console.error(err);
        res.send({ err });
      });
  }
);

router.post(
  "/atc/order",
  apiAuth,
  [
    check("pair").isIn([
      `${process.env.ASSET_CODE}BTC`,
      `${process.env.ASSET_CODE}ETH`,
      `${process.env.ASSET_CODE}USDT`
    ]),
    check("amount").isInt({ min: 5, max: 10000 }),
    check("userId")
      .trim()
      .escape()
      .isLength({ min: 1 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const pair = req.body.pair;

      let ticker;
      let acceptableCurrency;
      let walletAddress;
      let walletSecret;
      let confirmationsNeeded;
      let priceMultiplier;
      let pairPricePrecision;

      if (pair === `${process.env.ASSET_CODE}BTC`) {
        ticker = "BTCUSD";
        acceptableCurrency = "BTC";
        confirmationsNeeded = 2;
        priceMultiplier = 0.995;
        pairPricePrecision = 8;
        const BitcointKeyPair = bitcoin.ECPair.makeRandom();
        walletAddress = bitcoin.payments.p2pkh({
          pubkey: BitcointKeyPair.publicKey
        }).address;
        walletSecret = BitcointKeyPair.toWIF();
      } else if (pair === `${process.env.ASSET_CODE}ETH`) {
        ticker = "ETHUSD";
        acceptableCurrency = "ETH";
        confirmationsNeeded = 6;
        priceMultiplier = 0.995;
        pairPricePrecision = 8;
        const paymentEtherWallet = etherWallet.generate();
        walletAddress = paymentEtherWallet.getAddressString();
        walletSecret = paymentEtherWallet.getPrivateKeyString();
      } else {
        ticker = "USTUSD";
        acceptableCurrency = "USDT";
        confirmationsNeeded = 6;
        priceMultiplier = 1;
        pairPricePrecision = 4;
        const paymentUstWallet = etherWallet.generate();
        walletAddress = paymentUstWallet.getAddressString();
        walletSecret = paymentUstWallet.getPrivateKeyString();
      }

      const tickerResponse = await axios.get(
        `https://api-pub.bitfinex.com/v2/ticker/t${ticker}`
      );
      const tickerData = tickerResponse.data;

      const acceptableCurrencyUSD = tickerData[0] * priceMultiplier;

      const pairPrice = _.round(
        ASSETUSD / acceptableCurrencyUSD,
        pairPricePrecision
      );

      const amount = req.body.amount;

      const totalPrice = _.round(amount * pairPrice, 8);

      const expirationDate = moment(moment()).add(1, "hours");

      const order = new Order({
        pair,
        ASSETUSD,
        acceptableCurrency,
        acceptableCurrencyUSD,
        amount,
        pairPrice,
        totalPrice,
        walletAddress,
        walletSecret,
        apiUser: req.user._id,
        userId: req.body.userId,
        status: "waiting_for_payment",
        expirationDate,
        confirmationsNeeded,
        asset: {
          code: process.env.ASSET_CODE,
          issuer: process.env.ISSUER_ACC_PUBLIC_KEY
        }
      });

      await order.save();

      const puclicOrder = await Order.getPublicObject(order);

      if (acceptableCurrency === "BTC") {
        const blockchainConn = new WebSocket("wss://ws.blockchain.info/inv");
        blockchainConn.onopen = () => {
          blockchainConn.send(`{"op":"addr_sub", "addr": "${walletAddress}"}`);
          console.log("addr_sub", walletAddress);
        };
        blockchainConn.onerror = error => {
          console.log(`WebSocket error: ${error}`);
        };
        blockchainConn.onmessage = e => {
          const data = JSON.parse(e.data);
          console.log(
            "payment message",
            data,
            order.status,
            "order expired? ",
            order.expirationDate >= Date.now() ? false : true
          );
          data.x.out.forEach(out => {
            console.log("out", out);
            if (
              out.value / 100000000 >= order.totalPrice &&
              out.addr === order.walletAddress &&
              order.status == "waiting_for_payment" &&
              order.expirationDate >= Date.now()
            ) {
              blockchainConn.send(
                `{"op":"addr_unsub", "addr": "${walletAddress}"}`
              );
              blockchainConn.close();
              order.status = "waiting_for_confirmation";
              order.transaction = data.x;
              order.transactionReceivedAt = Date.now();
              order.save();
            }
          });
        };
      } else if (acceptableCurrency === "ETH") {
        order.checkETHPaymentTransaction();
      } else if (acceptableCurrency === "USDT") {
        order.checkUSDTPaymentTransaction();
      }

      res.send(puclicOrder);
    } catch (error) {
      console.error(error);
      res.status(400).send(error);
    }
  }
);

module.exports = router;
