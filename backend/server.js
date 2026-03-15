require('dotenv').config({ path: __dirname + '/../.env' });
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(cors());

if (!process.env.CLAUDE_API_KEY) {
    console.error("⚠️ CRÍTICO: CLAUDE_API_KEY no encontrada en el archivo .env");
}

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY,
});

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
// --- GESTIÓN DE POSICIONES ABIERTAS (TAREAS) ---
app.post('/api/positions', (req, res) => {
    const { strategy, amount } = req.body;
    const position = {
        ...req.body,
        id: `TASK-${Date.now()}`,
        startTime: new Date().toISOString(),
        status: 'ANALYZING_MARKET',
        logs: [`[${new Date().toLocaleTimeString()}] Tarea iniciada con estrategia ${strategy} y monto ${amount} USDT.`]
    };

    // Aquí iniciarías la lógica de trading en el backend para esta tarea específica.
    let positions = [];
    if (fs.existsSync(POSITIONS_FILE)) {
        try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE)); } catch (e) { positions = []; }
    }
    positions.push(position);
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

app.listen(3001, () => console.log('🚀 Servidor de persistencia corriendo en http://localhost:3001'));