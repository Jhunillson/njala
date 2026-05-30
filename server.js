const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors'); // 👈 1. Importa o módulo CORS

const app = express();
const server = http.createServer(app); 

// 👈 2. CONFIGURAÇÃO DO CORS NO SOCKET.IO (Essencial para a Vercel conectar)
const io = new Server(server, {
    cors: {
        origin: "*", // Em produção, podes trocar "*" pela URL da tua Vercel para maior segurança
        methods: ["GET", "POST"]
    }
});         

const PORT = process.env.PORT || 3000;

// 👈 3. ATIVA O CORS PARA AS ROTAS HTTP (Permite que o fetch/axios da Vercel funcione)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🐘 CONFIGURAÇÃO DO POSTGRESQL PREPARADA PARA O RAILWAY
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'postgres',
    password: process.env.PGPASSWORD || '',
    port: process.env.PGPORT || 5432,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Função para criar a tabela automaticamente
const criarTabelaAutomatica = async () => {
    const sqlCriarTabela = `
        CREATE TABLE IF NOT EXISTS logs_dispositivo (
            id SERIAL PRIMARY KEY,
            tipo VARCHAR(50) NOT NULL,
            origem VARCHAR(100) NOT NULL,
            mensagem TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(sqlCriarTabela);
        console.log('📊 Tabela "logs_dispositivo" verificada/criada com sucesso!');
    } catch (err) {
        console.error('❌ Erro crítico ao criar a tabela no banco:', err);
    }
};

pool.connect(async (err, client, release) => {
    if (err) {
        return console.error('❌ Erro ao conectar ao PostgreSQL:', err.stack);
    }
    console.log('🐘 Conectado com sucesso ao banco PostgreSQL!');
    release();
    await criarTabelaAutomatica();
});

// Rota GET para o Dashboard buscar o histórico inicial de logs
app.get('/api/logs', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM logs_dispositivo ORDER BY criado_em DESC LIMIT 50');
        res.json(resultado.rows);
    } catch (erro) {
        console.error('Erro ao buscar logs:', erro);
        res.status(500).send('Erro no servidor');
    }
});

// Rota POST para receber os logs do Android e transmitir via WebSocket
app.post('/api/logs', async (req, res) => {
    const { origem, message, mensagem, tipo } = req.body;
    const textoFinal = mensagem || message || "";

    console.log(`\n📥 Recebido: [${tipo || "WHATSAPP_CONVERSA"}] de [${origem}] - Processando...`);

    const queryText = `
        INSERT INTO logs_dispositivo (tipo, origem, mensagem) 
        VALUES ($1, $2, $3) 
        RETURNING id, criado_em
    `;
    const values = [tipo || "WHATSAPP_CONVERSA", origem, textoFinal];

    try {
        const resultado = await pool.query(queryText, values);
        const logId = resultado.rows[0].id;
        const criadoEm = resultado.rows[0].criado_em;

        const novoLog = {
            id: logId,
            tipo: tipo || "WHATSAPP_CONVERSA",
            origem: origem,
            mensagem: textoFinal,
            criado_em: criadoEm
        };

        console.log(`✅ Salvo no Postgres e transmitido via WebSocket. ID: ${logId}`);
        io.emit('novo-log', novoLog);

        res.status(200).send("O SERVIDOR RECEBEU COM SUCESSO!");
    } catch (erro) {
        console.error('❌ Erro ao processar log:', erro);
        res.status(500).send("Erro interno");
    }
});

io.on('connection', (socket) => {
    console.log('💻 Novo painel de monitoring conectado via WebSocket!');
});

// Inicialização estável do servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor e WebApp rodando na porta ${PORT}`);
});