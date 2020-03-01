const StellarSdk = require("stellar-sdk");
const StellarServer = new StellarSdk.Server(process.env.STELLAR_SERVER_URL);
const WalletSnapshot = require("./WalletSnapshot");

const _ = require("lodash");

const walletSchema = new Schema(
  {
    publicKey: {
      type: String,
      required: true,
      unique: true
    },
    startingBalance: {
      type: Number,
      default: 0
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
    fundingAccountId: {
      type: String
    },
    serverUrl: {
      type: String,
      required: true,
      default: process.env.STELLAR_SERVER_URL
    },
    type: {
      type: String,
      required: true
    },
    userId: {
      type: String
    }
  },
  {
    timestamps: {}
  }
);

walletSchema.statics.generate = async function(userId, type) {
  const newKeyPair = StellarSdk.Keypair.random();

  const newSecret = newKeyPair.secret();
  const newPublicKey = newKeyPair.publicKey();

  const fee = await StellarServer.fetchBaseFee();

  const sourceKeyPair = StellarSdk.Keypair.fromSecret(
    process.env.FUNDING_ACC_SECRET
  );

  const sourceAccount = await StellarServer.loadAccount(
    sourceKeyPair.publicKey()
  );

  const createAccountTransaction = new StellarSdk.TransactionBuilder(
    sourceAccount,
    {
      fee,
      networkPassphrase: StellarSdk.Networks.PUBLIC
    }
  )
    .addOperation(
      StellarSdk.Operation.createAccount({
        destination: newPublicKey,
        startingBalance: process.env.NEW_ACC_STARTING_BALANCE
      })
    )
    .setTimeout()
    .build();

  createAccountTransaction.sign(sourceKeyPair);

  const createAccountTransactionResult = await StellarServer.submitTransaction(
    createAccountTransaction
  );

  const issuerAccount = await StellarServer.loadAccount(
    process.env.ISSUER_ACC_PUBLIC_KEY
  );

  const issuerAccountId = issuerAccount.accountId();

  const asset = new StellarSdk.Asset(process.env.ASSET_CODE, issuerAccountId);

  const createdAccount = await StellarServer.loadAccount(newPublicKey);

  const changeTrustTransaction = new StellarSdk.TransactionBuilder(
    sourceAccount,
    {
      fee,
      networkPassphrase: StellarSdk.Networks.PUBLIC
    }
  )
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: asset,
        source: newPublicKey
      })
    )
    .setTimeout()
    .build();
  changeTrustTransaction.sign(newKeyPair, sourceKeyPair);

  const changeTrustTransactionResult = await StellarServer.submitTransaction(
    changeTrustTransaction
  );

  const wallet = new Wallet({
    asset,
    secret: newSecret,
    publicKey: newPublicKey,
    startingBalance: process.env.NEW_ACC_STARTING_BALANCE,
    fundingAccountId: sourceAccount.accountId(),
    userId,
    type
  });

  await wallet.save();

  return wallet;
};

walletSchema.methods.takeSnapshot = async function(currentDateTime) {
  const wallet = this;
  try {
    const account = await StellarServer.loadAccount(wallet.publicKey);
    let balance = 0;

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
    const snapshotData = {
      publicKey: wallet.publicKey,
      asset: wallet.asset,
      serverUrl: wallet.serverUrl,
      type: wallet.type,
      userId: wallet.userId,
      createdAt: currentDateTime,
      updatedAt: currentDateTime,
      balance
    };
    console.log("takeSnapshot", wallet.publicKey);
    const walletSnapshot = new WalletSnapshot(snapshotData);
    await walletSnapshot.save();
  } catch (err) {
    console.error(err);
  }
};

const Wallet = new Model("Wallet", walletSchema);

module.exports = Wallet;
