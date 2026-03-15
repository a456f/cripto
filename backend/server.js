const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config({ path: __dirname + '/../.env' });
const { Anthropic } = require('@anthropic-ai/sdk');
const BotEngine = require('./botEngine');

const BOT_VERSION = "2.3";

const app = express();
app.use(express.json());
app.use(cors());

if (!process.env.CLAUDE_API_KEY) {
    console.error("⚠️ CRÍTICO: CLAUDE_API_KEY no encontrada en el archivo .env");
}

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY,
});

// Inicializar el Bot Engine (Singleton)
const bot = new BotEngine(
    process.env.BITGET_API_KEY,
    process.env.BITGET_SECRET_KEY,
    process.env.BITGET_PASSPHRASE
);

const TRADES_FILE = './trades.json';
const POSITIONS_FILE = './positions.json';
const LOGS_DIR = './logs';
let botHeartbeat = { lastSeen: null, status: 'OFFLINE', currentPrice: 0, symbol: '' };

app.post('/api/trades', (req, res) => {
    const trade = req.body;
    let trades = [];
    if (fs.existsSync(TRADES_FILE)) {
        try { 
            const data = fs.readFileSync(TRADES_FILE, 'utf8');
            trades = data ? JSON.parse(data) : []; 
        } catch (e) { 
            console.error("Error leyendo trades.json, reiniciando lista.");
            trades = []; 
        }
    }
    trades.push({ ...trade, serverTimestamp: new Date().toISOString() });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
    console.log(`📝 Operación guardada: ${trade.side} a ${trade.price}`);
    res.status(201).send({ message: 'Trade guardado correctamente' });
});

app.get('/api/trades', (req, res) => {
    if (fs.existsSync(TRADES_FILE)) {
        const trades = JSON.parse(fs.readFileSync(TRADES_FILE));
        res.send(trades);
    } else { res.send([]); }
});
app.get('/api/bitget-assets', async (req, res) => {
  try {

    const timestamp = Date.now().toString()
    const path = '/api/v2/spot/account/assets'
    const method = 'GET'

    const crypto = require('crypto')

    const sign = crypto
      .createHmac('sha256', process.env.BITGET_SECRET_KEY)
      .update(timestamp + method + path)
      .digest('base64')

    const response = await fetch(`https://api.bitget.com${path}`, {
      method: 'GET',
      headers: {
        'ACCESS-KEY': process.env.BITGET_API_KEY,
        'ACCESS-SIGN': sign,
        'ACCESS-PASSPHRASE': process.env.BITGET_PASSPHRASE,
        'ACCESS-TIMESTAMP': timestamp,
        'Content-Type': 'application/json'
      }
    })

    const data = await response.json()

    res.json(data)

  } catch (err) {

    console.error("Bitget error:", err.message)

    res.status(500).json({ error: err.message })

  }
})

app.get('/api/historical-candles', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', granularity = '1m', limit = '200' } = req.query;

    // La granularidad ahora se espera en el formato correcto desde el llamador (botEngine).
    const apiUrl = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol.toUpperCase()}&granularity=${granularity}&limit=${limit}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Bitget API error: ${response.statusText}`);
    }
    
    const data = await response.json();

    if (data.code !== '00000') {
        return res.status(400).json({ error: `Bitget API error: ${data.msg}` });
    }

    // The candle data is in the 'data' property, and it's newest first.
    // The frontend can handle reversing if needed.
    res.json(data.data);
  } catch (err) {
    console.error("Historical candles error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/place-order', async (req, res) => {
    try {
        const { side, size } = req.body;
        const timestamp = Date.now().toString();
        const method = 'POST';
        const path = '/api/v2/spot/trade/place-order';
        
        // Configuración para orden de mercado en BTCUSDT
        const bodyObj = {
            symbol: 'BTCUSDT',
            side: side,
            orderType: 'market',
            size: size,
            force: 'gtc'
        };
        const body = JSON.stringify(bodyObj);

        const crypto = require('crypto');
        const sign = crypto.createHmac('sha256', process.env.BITGET_SECRET_KEY)
            .update(timestamp + method + path + body)
            .digest('base64');

        const response = await fetch(`https://api.bitget.com${path}`, {
            method: method,
            headers: {
                'ACCESS-KEY': process.env.BITGET_API_KEY,
                'ACCESS-SIGN': sign,
                'ACCESS-PASSPHRASE': process.env.BITGET_PASSPHRASE,
                'ACCESS-TIMESTAMP': timestamp,
                'Content-Type': 'application/json'
            },
            body: body
        });

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error("Bitget order error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GESTIÓN DE POSICIONES ABIERTAS (TAREAS) ---
app.post('/api/positions', (req, res) => {
    // Se asume que solo hay una tarea activa a la vez desde esta UI.
    // Al iniciar, se crea una nueva tarea que representa el estado "ANALYZING".
    const position = {
        id: `TASK-${Date.now()}`,
        startTime: new Date().toISOString(),
        status: 'ANALYZING',
        logs: [`[${new Date().toLocaleTimeString()}] Tarea de análisis iniciada.`]
    };

    let positions = [];
    // Sobrescribimos cualquier tarea anterior para asegurar que solo haya una activa.
    positions = [position];
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
    res.status(201).send(position);
});

app.get('/api/positions', (req, res) => {
    if (fs.existsSync(POSITIONS_FILE)) {
        res.send(JSON.parse(fs.readFileSync(POSITIONS_FILE)));
    } else { res.send([]); }
});

app.get('/api/positions/active', (req, res) => {
    if (fs.existsSync(POSITIONS_FILE)) {
        const positions = JSON.parse(fs.readFileSync(POSITIONS_FILE));
        // Filtramos para devolver solo las que están realmente abiertas
        res.send(positions.filter(p => p.id)); 
    } else { res.send([]); }
});

app.patch('/api/positions/:id/logs', (req, res) => {
    const { id } = req.params;
    const { log } = req.body;
    if (!fs.existsSync(POSITIONS_FILE)) return res.status(404).send();
    
    let positions = JSON.parse(fs.readFileSync(POSITIONS_FILE));
    const index = positions.findIndex(p => p.id === id);
    if (index !== -1) {
        positions[index].logs.push(log); // El frontend ya envía el log con timestamp
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
        return res.send(positions[index]);
    }
    res.status(404).send();
});

app.patch('/api/positions/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    if (!fs.existsSync(POSITIONS_FILE)) return res.status(404).send();
    
    let positions = JSON.parse(fs.readFileSync(POSITIONS_FILE));
    const index = positions.findIndex(p => p.id === id);
    if (index !== -1) {
        // Merge updates into the existing position
        positions[index] = { ...positions[index], ...updates };
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
        console.log(`🔄 Tarea ${id} actualizada con estado: ${updates.status || positions[index].status}`);
        return res.send(positions[index]);
    }
    res.status(404).send();
});

app.delete('/api/positions/:id', (req, res) => {
    if (!fs.existsSync(POSITIONS_FILE)) return res.status(404).send();
    let positions = JSON.parse(fs.readFileSync(POSITIONS_FILE));
    const position = positions.find(p => p.id === req.params.id);
    
    if (position) {
        // --- EXPORTACIÓN A ARCHIVO DE TEXTO ---
        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${LOGS_DIR}/tarea_${position.id}_${timestamp}.txt`;
        const content = `ID TAREA: ${position.id}\nSIMBOLO: ${position.symbol || 'BTCUSDT'}\nINICIO: ${position.startTime}\nFIN: ${new Date().toISOString()}\n\nLOGS DE EJECUCIÓN:\n------------------\n${position.logs.join('\n')}`;
        
        fs.writeFileSync(fileName, content);
        console.log(`✅ Tarea finalizada. Log exportado: ${fileName}`);

        positions = positions.filter(p => p.id !== req.params.id);
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
        return res.send({ message: 'Tarea finalizada y exportada a TXT' });
    }
    res.status(404).send({ message: 'Tarea no encontrada' });
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { summary } = req.body;
        const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6", // Modelo rápido, económico y compatible
            max_tokens: 150,
            messages: [{
                role: "user",
                content: `Act as a quantitative trader. Analyze this 1-minute BTC market data stream: ${summary}. 
                Evaluate: 1. HH/HL structure. 2. Volume confirmation. 3. Market phase (Accumulation, Trend, Distribution). 4. Continuation probability.
                Respond STRICTLY in JSON: {"decision": "BUY" | "WAIT", "confidence": 0-100, "phase": "ACCUMULATION" | "TREND" | "DISTRIBUTION", "reason": "short technical analysis"}`
            }]
        });
        
        // Limpieza robusta: Claude a veces envuelve el JSON en bloques de markdown
        let textResponse = msg.content[0].text;
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        const aiResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textResponse);

        res.send(aiResponse);
    } catch (error) {
        console.error("Error en Claude AI:", error.message);
        res.status(500).send({ decision: "WAIT", reason: `IA Error: ${error.message}`, confidence: 0, phase: 'UNKNOWN' });
    }
});

app.get('/api/verify-claude', async (req, res) => {
    try {
        await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 10,
            messages: [{ role: "user", content: "Ping" }]
        });
        res.send({ status: 'ok' });
    } catch (e) {
        res.status(401).send({ status: 'error', message: e.message });
    }
});

app.post('/api/heartbeat', (req, res) => {
    botHeartbeat = {
        lastSeen: Date.now(),
        status: req.body.status,
        currentPrice: req.body.currentPrice,
        symbol: req.body.symbol
    };
    res.send({ status: 'ok' });
});

app.get('/api/status', (req, res) => {
    const isAlive = botHeartbeat.lastSeen && (Date.now() - botHeartbeat.lastSeen < 15000); 
    res.send({ ...botHeartbeat, isAlive });
});

// --- NUEVOS ENDPOINTS PARA CONTROLAR EL BOT DEL BACKEND ---

app.post('/api/bot/start', async (req, res) => {
    const { tradeMode } = req.body;
    try {
        console.log(`🤖 Iniciando BOT ENGINE v${BOT_VERSION}`);
        console.log("Cargando datos históricos para el bot...");
        // El motor del bot se inicia y se le pasa el modo de trading.
        // El motor es responsable de cargar los datos históricos si es necesario.
        await bot.start({ tradeMode });

        res.send({ message: 'Bot iniciado en el servidor', version: BOT_VERSION });
    } catch (e) {
        console.error("Error iniciando bot:", e);
        res.status(500).send({ error: e.message });
    }
});

app.post('/api/bot/stop', (req, res) => {
    const stopped = bot.stop();
    if (stopped) res.send({ message: 'Bot detenido' });
    else res.status(400).send({ message: 'No se pudo detener (¿Posición abierta?)' });
});

app.get('/api/bot/status', (req, res) => {
    res.send(bot.getStatus());
});

// Asegúrate de que el bot se detenga si cierras el servidor
process.on('SIGINT', () => {
    bot.stop();
    process.exit();
});

app.listen(3001, () => {
    console.log(`🚀 Servidor y Bot Engine corriendo en http://localhost:3001`);
    console.log(`🤖 BOT VERSION: v${BOT_VERSION}`);
});
