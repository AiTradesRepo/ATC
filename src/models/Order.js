const StellarSdk = require("stellar-sdk");
const StellarServer = new StellarSdk.Server(process.env.STELLAR_SERVER_URL);
const Wallet = require("./Wallet");
const Transaction = require("./Transaction");
const _ = require("lodash");
const moment = require("moment");
const Web3 = require("web3");
const axios = require("axios");

const web3Http = new Web3(
  new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/SECRET_KEY")
);

const orderSchema = new Schema(
  {
    pair: {
      type: String,
      required: true
    },
    ASSETUSD: {
      type: Number,
      required: true
    },
    acceptableCurrencyUSD: {
      type: Number,
      required: true
    },
    pairPrice: {
      type: Number,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    totalPrice: {
      type: Number,
      required: true
    },
    acceptableCurrency: {
      type: String,
      required: true
    },
    walletAddress: {
      type: String,
      required: true,
      unique: true
    },
    walletSecret: {
      type: String,
      required: true
    },
    apiUser: {
      type: "ObjectId",
      ref: "ApiUser",
      required: true
    },
    assetTransaction: {
      type: "ObjectId",
      ref: "Transaction"
    },
    userId: {
      type: String,
      required: true
    },

    status: {
      type: String,
      required: true
    },
    expirationDate: {
      type: Date,
      required: true
    },
    confirmationsNeeded: {
      type: Number,
      required: true,
      default: 10
    },
    confirmations: {
      type: Number,
      required: true,
      default: 0
    },
    transaction: {
      type: Object
    },
    transactionReceivedAt: {
      type: Date
    },
    transactionConfirimedAt: {
      type: Date
    },
    expiredAt: {
      type: Date
    },
    didAt: {
      type: Date
    },
    asset: {
      code: {
        type: String
      },
      issuer: {
        type: String
      }
    }
  },
  {
    toJSON: {
      getters: true
    },
    toObject: {
      getters: true
    },
    timestamps: {}
  }
);

orderSchema.pre("save", async function(next) {
  const order = this;
  order.updatedAt = Date.now();
  next();
});

orderSchema.statics.getPublicObject = async function(order) {
  const obj = { ...order._doc };
  delete obj.walletSecret;
  delete obj.apiUser;
  delete obj.transaction;
  obj.expirationDateLondon = moment(obj.expirationDate)
    .tz("Europe/London")
    .format();
  return obj;
};

orderSchema.virtual("expirationDateLondon").get(function() {
  return moment(this.expirationDate)
    .tz("Europe/London")
    .format();
});

orderSchema.methods.updateBTCConfirmations = async function(
  currentBlockHeight
) {
  const order = this;
  if (
    order.acceptableCurrency === "BTC" &&
    order.transaction &&
    order.transaction.block_height &&
    currentBlockHeight >= order.transaction.block_height
  ) {
    const confirmations =
      currentBlockHeight - order.transaction.block_height + 1;
    order.confirmations = confirmations;
    if (order.confirmations >= order.confirmationsNeeded) {
      order.status = "confirmed";
      order.transactionConfirimedAt = Date.now();
    }
    await order.save();
    if (order.status === "confirmed") {
      order.transferAsset();
    }
  }
  return order;
};

orderSchema.methods.checkETHPaymentTransaction = async function() {
  const order = this;
  if (order.acceptableCurrency === "ETH") {
    const startTime = new Date().getTime();

    const interval = setInterval(async () => {
      if (new Date().getTime() - startTime > 3600000) {
        clearInterval(interval);
        return;
      }
      try {
        const eth_getBalanceResponse = await axios.post(
          "https://mainnet.infura.io/v3/SECRET_KEY",
          {
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [order.walletAddress, "latest"],
            id: 1
          },
          {
            withCredentials: true,
            headers: {
              "Content-Type": "application/json"
            },
            auth: {
              username: "",
              password: "PASSWORD"
            }
          }
        );

        const balance = eth_getBalanceResponse.data.result;

        const eth = parseFloat(Web3.utils.fromWei(balance));
        console.log("eth balance", eth, `Order Id: ${order._id}`);
        if (eth >= order.totalPrice) {
          console.log("check transaction");

          axios
            .get(
              `http://api.etherscan.io/api?module=account&action=txlist&address=${order.walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=API_KEY`
            )
            .then(response => {
              if (response.data.result) {
                response.data.result.forEach(async etherTransaction => {
                  console.log(
                    etherTransaction.hash,
                    parseFloat(Web3.utils.fromWei(etherTransaction.value))
                  );
                  if (
                    parseFloat(Web3.utils.fromWei(etherTransaction.value)) >=
                    order.totalPrice
                  ) {
                    console.log("waiting_for_confirmation");
                    order.status = "waiting_for_confirmation";
                    order.transaction = etherTransaction;
                    order.transactionReceivedAt = Date.now();
                    order.confirmations = parseInt(
                      etherTransaction.confirmations
                    );
                    await order.save();
                    order.checkETHConfirmations();
                    clearInterval(interval);
                  }
                });
              }
            })
            .catch(error => {
              console.error(error);
            });
        }
      } catch (error) {
        console.error(error);
      }
    }, 15 * 1000);
  }
};

orderSchema.methods.checkUSDTPaymentTransaction = async function() {
  try {
    const order = this;
    if (order.acceptableCurrency === "USDT") {
      const startTime = new Date().getTime();

      const interval = setInterval(async () => {
        if (new Date().getTime() - startTime > 3600000) {
          clearInterval(interval);
          return;
        }
        try {
          let minABI = [
            {
              constant: true,
              inputs: [{ name: "_owner", type: "address" }],
              name: "balanceOf",
              outputs: [{ name: "balance", type: "uint256" }],
              type: "function"
            },
            {
              constant: true,
              inputs: [],
              name: "decimals",
              outputs: [{ name: "", type: "uint8" }],
              type: "function"
            }
          ];

          let contract = new web3Http.eth.Contract(
            minABI,
            process.env.USDT_CONTRACT_ADDRESS
          );

          let balance = await contract.methods
            .balanceOf(order.walletAddress)
            .call();

          const decimals = await contract.methods.decimals().call();

          balance = balance / 10 ** decimals;

          console.log("usdt balance", balance, `Order Id: ${order._id}`);
          if (balance >= order.totalPrice) {
            console.log("check usdt transaction");

            axios
              .get(
                `http://api.etherscan.io/api?module=account&action=tokentx&address=${order.walletAddress}&contractaddress=${process.env.USDT_CONTRACT_ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey=API_KEY`
              )
              .then(response => {
                if (response.data.result) {
                  response.data.result.forEach(async usdtTransaction => {
                    const transactionValue =
                      parseFloat(usdtTransaction.value) / 10 ** decimals;
                    console.log(usdtTransaction.hash, transactionValue);
                    if (transactionValue >= order.totalPrice) {
                      console.log("waiting_for_confirmation");
                      order.status = "waiting_for_confirmation";
                      order.transaction = usdtTransaction;
                      order.transactionReceivedAt = Date.now();
                      order.confirmations = parseInt(
                        usdtTransaction.confirmations
                      );
                      await order.save();
                      order.checkUSDTConfirmations();
                      clearInterval(interval);
                    }
                  });
                }
              })
              .catch(error => {
                console.error(error);
              });
          }
        } catch (error) {
          console.error(error);
        }
      }, 15 * 1000);
    }
  } catch (e) {
    console.error(error);
  }
};

orderSchema.methods.checkETHConfirmations = async function() {
  const order = this;
  if (
    order.acceptableCurrency === "ETH" &&
    order.status === "waiting_for_confirmation"
  ) {
    const startTime = new Date().getTime();
    const interval = setInterval(async () => {
      if (new Date().getTime() - startTime > 3600000) {
        clearInterval(interval);
        return;
      }
      if (order.status === "waiting_for_confirmation") {
        axios
          .get(
            `http://api.etherscan.io/api?module=account&action=txlist&address=${order.walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=API_KEY`
          )
          .then(response => {
            if (response.data.result) {
              response.data.result.forEach(async etherTransaction => {
                if (etherTransaction.hash === order.transaction.hash) {
                  console.log(etherTransaction);
                  order.transaction = etherTransaction;
                  order.confirmations = parseInt(
                    etherTransaction.confirmations
                  );
                  if (order.confirmations >= order.confirmationsNeeded) {
                    order.status = "confirmed";
                    order.transactionConfirimedAt = Date.now();
                  }
                  await order.save();
                  if (order.status === "confirmed") {
                    order.transferAsset();
                    clearInterval(interval);
                  }
                }
              });
            }
          })
          .catch(error => {
            console.error(error);
          });
      } else {
        clearInterval(interval);
        return;
      }
    }, 40 * 1000);
  }
};

orderSchema.methods.checkUSDTConfirmations = async function() {
  const order = this;
  if (
    order.acceptableCurrency === "USDT" &&
    order.status === "waiting_for_confirmation"
  ) {
    const startTime = new Date().getTime();
    const interval = setInterval(async () => {
      if (new Date().getTime() - startTime > 3600000) {
        clearInterval(interval);
        return;
      }
      if (order.status === "waiting_for_confirmation") {
        axios
          .get(
            `http://api.etherscan.io/api?module=account&action=tokentx&address=${order.walletAddress}&contractaddress=${process.env.USDT_CONTRACT_ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey=API_KEY`
          )
          .then(response => {
            if (response.data.result) {
              response.data.result.forEach(async usdtTransaction => {
                if (usdtTransaction.hash === order.transaction.hash) {
                  console.log(usdtTransaction);
                  order.transaction = usdtTransaction;
                  order.confirmations = parseInt(usdtTransaction.confirmations);
                  if (order.confirmations >= order.confirmationsNeeded) {
                    order.status = "confirmed";
                    order.transactionConfirimedAt = Date.now();
                  }
                  await order.save();
                  if (order.status === "confirmed") {
                    order.transferAsset();
                    clearInterval(interval);
                  }
                }
              });
            }
          })
          .catch(error => {
            console.error(error);
          });
      } else {
        clearInterval(interval);
        return;
      }
    }, 40 * 1000);
  }
};

orderSchema.methods.transferAsset = async function() {
  const order = this;
  try {
    if (order.status === "confirmed") {
      let wallet = await Wallet.findOne({
        userId: order.userId,
        type: "staking",
        "asset.code": process.env.ASSET_CODE
      });
      if (!wallet) {
        wallet = await Wallet.generate(order.userId, "staking");
      }

      const fee = await StellarServer.fetchBaseFee();

      const sourceKeyPair = StellarSdk.Keypair.fromSecret(
        process.env.DISTRIBUTOR_ACC_SECRET
      );

      const sourceAccount = await StellarServer.loadAccount(
        sourceKeyPair.publicKey()
      );

      const issuerAccount = await StellarServer.loadAccount(
        process.env.ISSUER_ACC_PUBLIC_KEY
      );

      const issuerAccountId = issuerAccount.accountId();

      const asset = new StellarSdk.Asset(
        process.env.ASSET_CODE,
        issuerAccountId
      );

      const paymentTransaction = new StellarSdk.TransactionBuilder(
        sourceAccount,
        {
          fee,
          networkPassphrase: StellarSdk.Networks.PUBLIC
        }
      )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: wallet.publicKey,
            asset: asset,
            amount: order.amount.toString()
          })
        )
        .setTimeout()
        .build();

      paymentTransaction.sign(sourceKeyPair);

      const paymentTransactionResult = await StellarServer.submitTransaction(
        paymentTransaction
      );

      const transaction = new Transaction({
        userId: order.userId,
        type: "StakingBuy",
        order: order._id,
        extra: {
          transactionResult: paymentTransactionResult,
          wallet: wallet.publicKey
        }
      });

      await transaction.save();

      order.assetTransaction = transaction._id;
      order.status = "done";
      order.didAt = Date.now();
      await order.save();

      console.log("ASSET TERANSFERED", order.amount, order._id);
    }
  } catch (error) {
    console.error(
      error,
      order._id,
      error.response.data.extras,
      error.response.data.extras.result_codes
    );
  }
};

const Order = new Model("Order", orderSchema);

module.exports = Order;
