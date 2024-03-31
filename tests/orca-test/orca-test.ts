import * as anchor from '@coral-xyz/anchor';
import {
    Program,
    AnchorProvider,
    Wallet as AnchorWallet,
} from '@coral-xyz/anchor';
import { OrcaTest } from '../../target/types/orca_test';
import {
    PublicKey,
    Keypair,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Connection,
} from '@solana/web3.js';
import {
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    PDAUtil,
    PriceMath,
    WhirlpoolContext,
    buildWhirlpoolClient,
    PoolUtil,
    TickUtil,
} from '@orca-so/whirlpools-sdk';
import { createMint } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
    TransactionBuilder,
    Wallet,
    TransactionBuilderOptions,
} from '@orca-so/common-sdk';
import { assert } from 'chai';
import BN from 'bn.js';
import Decimal from 'decimal.js';

const SOL = {
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    decimals: 9,
};
const TEST_PROVIDER_URL = 'http://localhost:8899';
const TEST_WALLET_SECRET = [
    76, 58, 227, 140, 84, 35, 34, 94, 210, 40, 248, 31, 56, 113, 4, 213, 195,
    67, 134, 52, 40, 117, 58, 13, 205, 25, 19, 0, 0, 97, 168, 144, 243, 234,
    176, 5, 119, 211, 100, 106, 160, 142, 58, 48, 144, 91, 203, 77, 198, 67,
    187, 148, 139, 159, 53, 68, 93, 59, 150, 69, 24, 221, 84, 37,
];

describe('orca-test', () => {
    const connection = new Connection(TEST_PROVIDER_URL, 'confirmed');
    const testWallet = Keypair.fromSecretKey(
        new Uint8Array(TEST_WALLET_SECRET),
    );
    const program = anchor.workspace.OrcaTest as Program<OrcaTest>;
    const provider = new AnchorProvider(
        connection,
        new AnchorWallet(testWallet),
        { commitment: 'confirmed' },
    );

    const wallet = provider.wallet as Wallet;

    const whirlpool_ctx = WhirlpoolContext.withProvider(
        provider,
        ORCA_WHIRLPOOL_PROGRAM_ID,
    );
    const fetcher = whirlpool_ctx.fetcher;

    const transaction_builder_opts: TransactionBuilderOptions = {
        defaultBuildOption: {
            maxSupportedTransactionVersion: 'legacy',
            blockhashCommitment: 'confirmed',
        },
        defaultConfirmationCommitment: 'confirmed',
        defaultSendOption: {
            skipPreflight: true,
        },
    };

    it('execute proxy initialize_pool and initialize_tick_array', async () => {
        let NEW_SAMO_MINT: PublicKey;
        let count: number = 0;
        while (!NEW_SAMO_MINT) {
            const mint = await createMint(
                connection,
                testWallet,
                wallet.publicKey,
                wallet.publicKey,
                9,
            );

            const [mint_a, mint_b] = PoolUtil.orderMints(mint, SOL.mint);
            console.log(
                `${count++} : \n \t mint : ${mint.toBase58()} \n \t mint_a : ${mint_a.toString()} \n \t mint_b : ${mint_b.toString()}`,
            );
            if (mint_a.toString() === mint.toString()) {
                NEW_SAMO_MINT = mint;
            }
        }

        const tick_spacing = 128;

        const fee_tier_128_pubkey = PDAUtil.getFeeTier(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            ORCA_WHIRLPOOLS_CONFIG,
            tick_spacing,
        ).publicKey;

        const new_samo_usdc_whirlpool_ts_128_pubkey = PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            ORCA_WHIRLPOOLS_CONFIG,
            NEW_SAMO_MINT,
            SOL.mint,
            tick_spacing,
        ).publicKey;

        // token price new / sol
        const desiredMarketPrice = new Decimal(2);
        // Shift by 64 bits
        const initial_sqrt_price = PriceMath.priceToSqrtPriceX64(
            desiredMarketPrice,
            9,
            9,
        );

        const new_samo_vault_keypair = Keypair.generate();
        const usdc_vault_keypair = Keypair.generate();

        const initialize_pool = await program.methods
            .proxyInitializePool(tick_spacing, initial_sqrt_price)
            .accounts({
                whirlpoolProgram: ORCA_WHIRLPOOL_PROGRAM_ID,
                whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG,
                tokenMintA: NEW_SAMO_MINT,
                tokenMintB: SOL.mint,
                funder: wallet.publicKey,
                whirlpool: new_samo_usdc_whirlpool_ts_128_pubkey,
                tokenVaultA: new_samo_vault_keypair.publicKey,
                tokenVaultB: usdc_vault_keypair.publicKey,
                feeTier: fee_tier_128_pubkey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .signers([new_samo_vault_keypair, usdc_vault_keypair])
            .rpc()
            .then(res => res);
        // .catch(err => console.log(JSON.stringify(err)));
        // .instruction();
        console.log(initialize_pool);

        const initial_tick_current_index =
            PriceMath.sqrtPriceX64ToTickIndex(initial_sqrt_price);
        const start_tick_indexes = [
            TickUtil.getStartTickIndex(
                initial_tick_current_index,
                tick_spacing,
                -2,
            ),
            TickUtil.getStartTickIndex(
                initial_tick_current_index,
                tick_spacing,
                -1,
            ),
            TickUtil.getStartTickIndex(
                initial_tick_current_index,
                tick_spacing,
                0,
            ),
            TickUtil.getStartTickIndex(
                initial_tick_current_index,
                tick_spacing,
                +1,
            ),
            TickUtil.getStartTickIndex(
                initial_tick_current_index,
                tick_spacing,
                +2,
            ),
        ];

        // const initialize_tick_arrays = await Promise.all(
        //     start_tick_indexes.map(start_tick_index => {
        //         return program.methods
        //             .proxyInitializeTickArray(start_tick_index)
        //             .accounts({
        //                 whirlpoolProgram: ORCA_WHIRLPOOL_PROGRAM_ID,
        //                 whirlpool: new_samo_usdc_whirlpool_ts_128_pubkey,
        //                 funder: wallet.publicKey,
        //                 tickArray: PDAUtil.getTickArray(
        //                     ORCA_WHIRLPOOL_PROGRAM_ID,
        //                     new_samo_usdc_whirlpool_ts_128_pubkey,
        //                     start_tick_index,
        //                 ).publicKey,
        //                 systemProgram: SystemProgram.programId,
        //             })
        //             .instruction();
        //     }),
        // );

        // const transaction = new TransactionBuilder(
        //     connection,
        //     wallet,
        //     transaction_builder_opts,
        // )
        //     .addInstruction({
        //         instructions: [initialize_pool],
        //         cleanupInstructions: [],
        //         signers: [new_samo_vault_keypair, usdc_vault_keypair],
        //     })
        //     .addInstruction({
        //         instructions: initialize_tick_arrays,
        //         cleanupInstructions: [],
        //         signers: [],
        //     });

        // const signature = await transaction.buildAndExecute();
        // await connection.confirmTransaction(signature);

        // // verification
        // const new_samo_usdc_whirlpool_ts_128 = await fetcher.getPool(
        //     new_samo_usdc_whirlpool_ts_128_pubkey,
        // );
        // assert(new_samo_usdc_whirlpool_ts_128.tokenMintA.equals(NEW_SAMO_MINT));
        // assert(new_samo_usdc_whirlpool_ts_128.tokenMintB.equals(USDC.mint));
        // assert(new_samo_usdc_whirlpool_ts_128.tickSpacing === tick_spacing);
        // assert(new_samo_usdc_whirlpool_ts_128.sqrtPrice.eq(initial_sqrt_price));

        // const tickarray_pubkeys = start_tick_indexes.map(start_tick_index => {
        //     return PDAUtil.getTickArray(
        //         ORCA_WHIRLPOOL_PROGRAM_ID,
        //         new_samo_usdc_whirlpool_ts_128_pubkey,
        //         start_tick_index,
        //     ).publicKey;
        // });
        // const tickarrays = await Promise.all(
        //     tickarray_pubkeys.map(tickarray_pubkey => {
        //         return fetcher.getTickArray(tickarray_pubkey);
        //     }),
        // );
        // tickarrays.forEach((tickarray, i) => {
        //     assert(
        //         tickarray.whirlpool.equals(
        //             new_samo_usdc_whirlpool_ts_128_pubkey,
        //         ),
        //     );
        //     assert(tickarray.startTickIndex === start_tick_indexes[i]);
        // });
    });
});