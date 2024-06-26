import * as anchor from '@coral-xyz/anchor';
import {
    Program,
    AnchorProvider,
    Wallet as AnchorWallet,
} from '@coral-xyz/anchor';
import { Moai } from '../../target/types/moai';
import {
    PublicKey,
    Keypair,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Connection,
    LAMPORTS_PER_SOL,
    Transaction,
    sendAndConfirmTransaction,
    AccountMeta,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    transferChecked,
    createAccount,
} from '@solana/spl-token';
import { assert } from 'chai';
import BN from 'bn.js';
import {
    getMoaiAddress,
    getMemeAddress,
    getVoteAddress,
    getUserInfoAddress,
} from './util';
import Irys from '@irys/sdk';
import path from 'path';
import { createHash } from 'crypto';
import { sleep } from '@irys/sdk/build/cjs/common/utils';

const hashValue = (name: string): Promise<string> =>
    new Promise(resolve =>
        setTimeout(
            () => resolve(createHash('sha256').update(name).digest('hex')),
            0,
        ),
    );

// const TEST_PROVIDER_URL =
//     'https://solana-devnet-archive.allthatnode.com/Ez7eqjgszCRYxMTozvryy4B5Y8qvR5Q7/';
const TEST_PROVIDER_URL = 'http://localhost:8899';
const TEST_WALLET_SECRET = [
    76, 58, 227, 140, 84, 35, 34, 94, 210, 40, 248, 31, 56, 113, 4, 213, 195,
    67, 134, 52, 40, 117, 58, 13, 205, 25, 19, 0, 0, 97, 168, 144, 243, 234,
    176, 5, 119, 211, 100, 106, 160, 142, 58, 48, 144, 91, 203, 77, 198, 67,
    187, 148, 139, 159, 53, 68, 93, 59, 150, 69, 24, 221, 84, 37,
];

const getIrys = async () => {
    const token = 'solana';
    const providerUrl = TEST_PROVIDER_URL;

    const irys = new Irys({
        network: 'devnet',
        token, // Token used for payment
        key: TEST_WALLET_SECRET,
        config: { providerUrl }, // Optional provider URL, only required when using Devnet
    });
    return irys;
};

const SOL = {
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    decimals: 9,
};

const SPL_MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

describe('moai-test', () => {
    const connection = new Connection(TEST_PROVIDER_URL);
    const testWallet = Keypair.fromSecretKey(
        new Uint8Array(TEST_WALLET_SECRET),
    );
    const program = anchor.workspace.Moai as Program<Moai>;
    const provider = new AnchorProvider(
        connection,
        new AnchorWallet(testWallet),
        { commitment: 'confirmed' },
    );

    const wallet = provider.wallet;

    const user = Keypair.generate();

    const rockMint = Keypair.generate();
    const moaiMint = Keypair.generate();
    const moai = getMoaiAddress(wallet.publicKey);

    const escrowAccount = getAssociatedTokenAddressSync(SOL.mint, moai, true);

    console.log('rockMint: ', rockMint.publicKey.toBase58());
    console.log('moaiMint: ', moaiMint.publicKey.toBase58());
    console.log('escrowAccount: ', escrowAccount.toBase58());
    console.log('moai: ', moai.toBase58());

    describe('initialize moai', () => {
        it('initialize moai', async () => {
            await connection.getLatestBlockhash().then(blockhash => {
                console.log(blockhash);
            });
            const ix = await program.methods
                .initializeMoai()
                .accounts({
                    authority: wallet.publicKey,
                    moai,
                    escrowAccount,
                    wsolMint: SOL.mint,
                    moaiMint: moaiMint.publicKey,
                    rockMint: rockMint.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .instruction();

            const tx = new Transaction().add(ix);

            const signature = await sendAndConfirmTransaction(
                connection,
                tx,
                [testWallet, rockMint, moaiMint],
                { skipPreflight: true },
            );

            console.log('initialize moai signature: ', signature);
        });
    });

    describe('user action', () => {
        const receiver = Keypair.generate();

        const userSpending = Keypair.generate();
        const userRockAccount = getAssociatedTokenAddressSync(
            rockMint.publicKey,
            user.publicKey,
        );
        const userMoaiAccount = getAssociatedTokenAddressSync(
            moaiMint.publicKey,
            user.publicKey,
        );

        let receiverRockAccount: PublicKey;

        before(async () => {
            await (async () => {
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: testWallet.publicKey,
                        toPubkey: user.publicKey,
                        lamports: LAMPORTS_PER_SOL * 10,
                    }),
                );

                await sendAndConfirmTransaction(connection, transaction, [
                    testWallet,
                ]);
            })();
        });

        before(async () => {
            receiverRockAccount = await createAccount(
                provider.connection,
                testWallet,
                rockMint.publicKey,
                receiver.publicKey,
            );
        });

        it('deposit sol and mint rock', async () => {
            const signature = await program.methods
                .mintRock(new BN('1'))
                .accounts({
                    user: user.publicKey,
                    userSpending: userSpending.publicKey,
                    moai,
                    rockMint: rockMint.publicKey,
                    moaiMint: moaiMint.publicKey,
                    userRockAccount,
                    userMoaiAccount,
                    escrowAccount,
                    userInfo: getUserInfoAddress(userSpending.publicKey, moai),
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    memoProgram: SPL_MEMO,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .signers([user, userSpending])
                .rpc({ skipPreflight: true });
            console.log('mint rock signature: ', signature);
        });

        // it('check approve', async () => {
        //     const signature = await transferChecked(
        //         provider.connection,
        //         userSpending,
        //         userRockAccount,
        //         rockMint.publicKey,
        //         receiverRockAccount,
        //         userSpending,
        //         1,
        //         0,
        //         undefined,
        //         { skipPreflight: true },
        //     );
        //     console.log('approve check signature: ', signature);
        // });

        it('create meme', async () => {
            const name = 'my crypto meme';
            const symbol = 'MCM';
            const description =
                'my crypto knowledge dumb but meme? I nailed it';

            const index = await (await hashValue(name)).slice(0, 32);

            const meme = getMemeAddress(index);
            console.log(meme.toBase58());
            const irys = await getIrys();
            // Your file
            const fileToUpload = './images/meme.png';
            const filePath = path.join(__dirname, fileToUpload);

            let uri = '';

            // Add a custom tag that tells the gateway how to serve this file to a browser
            const tags = [{ name: 'Content-Type', value: 'image/png' }];

            try {
                const response = await irys.uploadFile(filePath, { tags });
                console.log(
                    `File uploaded ==> https://gateway.irys.xyz/${response.id}`,
                );
                //TODO : add metadata json with metaplex standard and re send irys to get uris and test create meme
                const metadata = {
                    name,
                    symbol,
                    description,
                    image: `https://gateway.irys.xyz/${response.id}`,
                };
                uri = `https://gateway.irys.xyz/${response.id}`;
            } catch (e) {
                console.log('Error uploading file ', e);

                uri = 'failed to upload image';
            }

            const moai = getMoaiAddress(wallet.publicKey);
            console.log(
                'user Spending Vote : ',
                getVoteAddress(userSpending.publicKey, meme).toBase58(),
            );

            const signature = await program.methods
                .createMeme(index, name, uri)
                .accounts({
                    userSpending: userSpending.publicKey,
                    meme,
                    moai,
                    rockMint: rockMint.publicKey,
                    moaiMint: moaiMint.publicKey,
                    userRockAccount: getAssociatedTokenAddressSync(
                        rockMint.publicKey,
                        user.publicKey,
                    ),
                    userMoaiAccount: getAssociatedTokenAddressSync(
                        moaiMint.publicKey,
                        user.publicKey,
                    ),
                    memeRockAccount: getAssociatedTokenAddressSync(
                        rockMint.publicKey,
                        meme,
                        true,
                    ),
                    userSpendingVote: getVoteAddress(
                        userSpending.publicKey,
                        meme,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    memoProgram: SPL_MEMO,
                    systemProgram: SystemProgram.programId,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .signers([userSpending])
                .rpc({ skipPreflight: true, commitment: 'finalized' });

            console.log('create meme signature: ', signature);
        });

        it('create meme2', async () => {
            sleep(1000);
            const name = 'my crypto meme2';
            const symbol = 'MCM';
            const description =
                'my crypto knowledge dumb but meme? I nailed it';

            const index = await (await hashValue(name)).slice(0, 32);

            const meme = getMemeAddress(index);
            console.log(meme.toBase58());
            const irys = await getIrys();
            // Your file
            const fileToUpload = './images/meme.png';
            const filePath = path.join(__dirname, fileToUpload);

            let uri = '';

            // Add a custom tag that tells the gateway how to serve this file to a browser
            const tags = [{ name: 'Content-Type', value: 'image/png' }];

            try {
                const response = await irys.uploadFile(filePath, { tags });
                console.log(
                    `File uploaded ==> https://gateway.irys.xyz/${response.id}`,
                );
                //TODO : add metadata json with metaplex standard and re send irys to get uris and test create meme
                const metadata = {
                    name,
                    symbol,
                    description,
                    image: `https://gateway.irys.xyz/${response.id}`,
                };
                uri = `https://gateway.irys.xyz/${response.id}`;
            } catch (e) {
                console.log('Error uploading file ', e);

                uri = 'failed to upload image';
            }

            const moai = getMoaiAddress(wallet.publicKey);

            let topVote: null | undefined | PublicKey = null;

            while (topVote === null) {
                topVote = await program.account.moai
                    .fetch(moai)
                    .then(moai => {
                        console.log(moai);
                        return moai.currentTopVote;
                    })
                    .catch(e => {
                        console.log(e);
                        return null;
                    });
                console.log('passed');
                console.log('topVote : ', topVote && topVote.toBase58());
            }

            const signature = await program.methods
                .createMeme(index, name, uri)
                .accounts({
                    userSpending: userSpending.publicKey,
                    meme,
                    moai,
                    rockMint: rockMint.publicKey,
                    moaiMint: moaiMint.publicKey,
                    userRockAccount: getAssociatedTokenAddressSync(
                        rockMint.publicKey,
                        user.publicKey,
                    ),
                    userMoaiAccount: getAssociatedTokenAddressSync(
                        moaiMint.publicKey,
                        user.publicKey,
                    ),
                    memeRockAccount: getAssociatedTokenAddressSync(
                        rockMint.publicKey,
                        meme,
                        true,
                    ),
                    userSpendingVote: getVoteAddress(
                        userSpending.publicKey,
                        meme,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    memoProgram: SPL_MEMO,
                    systemProgram: SystemProgram.programId,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .remainingAccounts(
                    topVote != undefined
                        ? [
                              {
                                  pubkey: topVote,
                                  isSigner: false,
                                  isWritable: false,
                              },
                          ]
                        : [],
                )
                .signers([userSpending])
                .rpc({ skipPreflight: true });

            console.log('create meme signature: ', signature);
        });
    });
});
