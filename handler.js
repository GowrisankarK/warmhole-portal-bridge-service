'use strict';
const { NodeHttpTransport } = require("@improbable-eng/grpc-web-node-http-transport");
const { attestFromEth, parseSequenceFromLogEth, CHAIN_ID_ETH, createWrappedOnSolana } = require("@certusone/wormhole-sdk");
const {Keypair, clusterApiUrl, Connection} = require("@solana/web3.js");
const {ethers} = require("ethers");

// mainet constant
const ETH_TOKEN_BRIDGE_ADDRESS = '0x3ee18B2214AFF97000D974cf647E7C347E8fa585';
const ETH_WARMHOLE_CORE_BRIDGE_ADDRESS = '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B';
const SOL_TOKEN_BRIDGE_ADDRESS = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb";
const SOL_WARMHOLE_CORE_BRIDGE_ADDRESS = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth";

module.exports.attest = async (event) => {
  // provider is the wallet provider.
  // signer is the object which is used to sign the transaction.
  // tokenAddress for which we need to create a wrapped token.
  // Example:
  // const provider = new ethers.providers.Web3Provider(window.ethereum)
  // const signer = provider.getSigner()
  const {signer, tokenAddress} = JSON.parse(event?.body);
  const signerAddress = await signer.getAddress();
  console.log('signerAddress', signerAddress);
  // attest the test token
  const receipt = await attestFromEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    signer,
    tokenAddress
  );
  // get the sequence from the logs (needed to fetch the vaa)
  const sequence = parseSequenceFromLogEth(
    receipt,
    ETH_WARMHOLE_CORE_BRIDGE_ADDRESS
  );
  const emitterAddress = getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS);
  // poll until the guardian(s) witness and sign the vaa
  const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
    [
      "https://wormhole-v2-mainnet-api.certus.one",
      "https://wormhole.inotel.ro",
      "https://wormhole-v2-mainnet-api.mcf.rocks",
      "https://wormhole-v2-mainnet-api.chainlayer.network",
      "https://wormhole-v2-mainnet-api.staking.fund",
      "https://wormhole-v2-mainnet.01node.com",
    ],
    CHAIN_ID_ETH,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );

  //connection object for Solana
  let keypair = Keypair.generate();
  const payerAddress = keypair.publicKey.toString();

  let connection = new Connection(clusterApiUrl('mainnet-beta'));
  await postVaaSolana(
    connection,
    async (transaction) => {
      transaction.partialSign(keypair);
      return transaction;
    },
    SOL_WARMHOLE_CORE_BRIDGE_ADDRESS,
    payerAddress,
    Buffer.from(signedVAA)
  );

  // create wormhole wrapped token (mint and metadata) on solana
  const transaction = await createWrappedOnSolana(
    connection,
    SOL_TOKEN_BRIDGE_ADDRESS,
    SOL_WARMHOLE_CORE_BRIDGE_ADDRESS,
    payerAddress,
    signedVAA
  );

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'Eth to solana attestation',
        transaction: transaction,
      },
      null,
      2
    ),
  };

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};
