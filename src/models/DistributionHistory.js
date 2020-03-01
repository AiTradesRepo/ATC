const StellarSdk = require("stellar-sdk");
const StellarServer = new StellarSdk.Server(process.env.STELLAR_SERVER_URL);

const distributionHistorySchema = new Schema(
  {
    publicKey: {
      type: String,
      required: true
    },
    asset: {
      code: {
        type: String,
        required: true
      },
      issuer: {
        type: String,
        required: true
      }
    },
    serverUrl: {
      type: String,
      required: true
    },
    userId: {
      type: String
    },
    monthProfitPercentage: {
      type: Number,
      required: true,
      default: 0
    },
    profitAmount: {
      type: Number,
      required: true,
      default: 0
    },
    paid: {
      type: Boolean,
      required: true,
      default: false
    },
    paidAt: {
      type: Date
    },
    transaction: {
      type: "Mixed"
    },
    fromDate: {
      type: Date,
      required: true
    },
    toDate: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: {}
  }
);

distributionHistorySchema.methods.payProfit = async function() {
  try {
    const distributionHistory = this;

    if (!distributionHistory.paid && distributionHistory.profitAmount > 0) {
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
            destination: distributionHistory.publicKey,
            asset: asset,
            amount: distributionHistory.profitAmount.toString()
          })
        )
        .setTimeout()
        .build();

      paymentTransaction.sign(sourceKeyPair);

      const paymentTransactionResult = await StellarServer.submitTransaction(
        paymentTransaction
      );

      distributionHistory.paid = true;
      distributionHistory.paidAt = Date.now();
      distributionHistory.transaction = paymentTransactionResult;

      await distributionHistory.save();

      console.log(
        "PROFIT PAID",
        distributionHistory.profitAmount,
        distributionHistory.publicKey,
        distributionHistory._id
      );
    }
  } catch (error) {
    console.error(error, error.message);
    if (error.response && error.response.data) {
      console.error(
        error.response.data.extras,
        error.response.data.extras.result_codes
      );
    }
  }
};

const DistributionHistory = new Model(
  "DistributionHistory",
  distributionHistorySchema
);

module.exports = DistributionHistory;
