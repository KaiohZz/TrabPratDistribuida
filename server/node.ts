import express from 'express';
import cors from 'cors';

// Constantes de Limiar
const TRAFFIC_THRESHOLD = 70;

// Estados de eleição (Bully)
let currentCoordinator: number | null = null;
let isElectionOngoing = false;

// Estado do Nó 
let lamportClock = 0;
const myId = parseInt(process.env.NODE_ID || '1');
const myPort = parseInt(process.env.PORT || '50051');

// Lista de portas de outros nós (peers) para comunicação interna
const peerPorts = [50051, 50052, 50053].filter(p => p !== myPort);

// Interface para a estrutura de cada via
interface ViaData {
    status: 'Verde' | 'Amarelo' | 'Vermelho';
    vehicle_count: number;
}

// Interface do temporizador
interface ViaData {
    status: 'Verde' | 'Amarelo' | 'Vermelho';
    vehicle_count: number;
    time_left: number; // Tempo restante em segundos
}

// Estado global inicializado com tempos padrão
const intersectionState: Record<'Via A' | 'Via B' | 'Via C' | 'Via D', ViaData> = {
    'Via A': { status: 'Verde', vehicle_count: 0, time_left: 20 },
    'Via B': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
    'Via C': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
    'Via D': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
};

type ViaType = 'Via A' | 'Via B' | 'Via C' | 'Via D';

// LÓGICA DE COORDENAÇÃO DE TEMPO DOS SEMÁFOROS (Sincronização Distribuída)
function coordinateSemaphoresTime() {
    const vias = Object.keys(intersectionState) as ViaType[];
    
    // Encontra qual via está aberta (Verde ou Amarelo) atualmente
    let activeVia = vias.find(via => intersectionState[via].status === 'Verde' || intersectionState[via].status === 'Amarelo');
    
    if (!activeVia) {
        // Fallback de segurança se tudo estiver fechado
        intersectionState['Via A'].status = 'Verde';
        intersectionState['Via A'].time_left = 20;
        return;
    }

    if (intersectionState[activeVia].time_left > 0) {
        // Reduz o tempo restante da via aberta
        intersectionState[activeVia].time_left--;
        
        // Se faltarem apenas 3 segundos, muda o estado interno para Amarelo
        if (intersectionState[activeVia].time_left <= 3 && intersectionState[activeVia].status === 'Verde') {
            intersectionState[activeVia].status = 'Amarelo';
            console.log(`[Coordenador] ${activeVia} entrando em estágio de AMARELO.`);
        }
    } else {
        // Rotacionar o cruzamento para a próxima via em formato Round-Robin
        console.log(`[Coordenador] Tempo esgotado para a ${activeVia}. Alternando fluxo...`);
        intersectionState[activeVia].status = 'Vermelho';
        intersectionState[activeVia].time_left = 0;
        intersectionState[activeVia].vehicle_count = 0;

        const currentIndex = vias.indexOf(activeVia);
        const nextIndex = (currentIndex + 1) % vias.length;
        const nextVia = vias[nextIndex];

        // Abre a próxima via da lista dando 20 segundos para ela
        intersectionState[nextVia].status = 'Verde';
        intersectionState[nextVia].time_left = 20;
        
        console.log(`[Coordenador] ${nextVia} aberta com sucesso por 20 segundos.`);
    }
}

// O Nó Líder/Coordenador atualiza os contadores a cada 1 segundo na malha
setInterval(coordinateSemaphoresTime, 1000);

// Lógica do Relógio de Lamport
function updateClock(receivedClock: number) {
    lamportClock = Math.max(lamportClock, receivedClock) + 1;
    console.log(`[Relógio Lamport] Sincronizado para: ${lamportClock}`);
}

// Inicialização do Servidor Express Único (Processa chamadas Internas e a API Bridge)
const app = express();
app.use(cors());
app.use(express.json());

/* INTERFACES DE COMUNICAÇÃO INTERNA (SUBSTITUINDO O gRPC) */

// Handler equivalente ao ReportTraffic do gRPC
app.post('/internal/report-traffic', (req, res) => {
    const { node_id, road_id, vehicle_count, lamport_clock } = req.body;
    
    updateClock(lamport_clock);

    console.log(`\n--- [Rede] Alerta de Tráfego Recebido ---`);
    console.log(`Origem: Nó ${node_id} | Via de Origem: ${road_id}`);
    console.log(`Volume reportado: ${vehicle_count} veículos/min`);

    if (vehicle_count > TRAFFIC_THRESHOLD) {
        console.log(`ALERTA: Congestionamento detectado no Nó ${node_id}. Ajustando réplica local do Nó ${myId}...`);
        
        // Sincronização do estado da réplica local com a decisão do líder
        (Object.keys(intersectionState) as Array<ViaType>).forEach(via => {
            if (via === road_id) {
                intersectionState[via].status = 'Verde';
            } else {
                intersectionState[via].status = 'Vermelho';
            }
            intersectionState[via].vehicle_count = via === road_id ? vehicle_count : 0;
        });
    }

    res.send({ success: true });
});

// Handler equivalente ao Election do gRPC
app.post('/internal/election', (req, res) => {
    console.log(`[Eleição Bully] Recebi pedido de eleição do Nó ${req.body.caller_id}`);
    res.send({ success: true }); // Responde OK imediatamente
    startElection();
});

// Handler equivalente ao SetCoordinator do gRPC
app.post('/internal/set-coordinator', (req, res) => {
    currentCoordinator = req.body.leader_id;
    isElectionOngoing = false;
    console.log(`[Eleição Bully] Coordenador Consensual Definido -> Nó ${currentCoordinator}`);
    res.send({ success: true });
});


/* API BRIDGE (COMUNICAÇÃO COM O FRONT-END / CELULARES) */

// Rota que retorna o estado atualizado de todas as vias (Polling do dashboard)
app.get('/intersection-status', (req, res) => {
    res.send({ 
        lamport_clock: lamportClock,
        vias: intersectionState 
    });
});

// Rota onde o Dashboard envia os dados do formulário/sensor manual
app.post('/report', async (req, res) => {
    const { vehicle_count, road_id } = req.body;
    const targetRoad = (road_id || 'Via A') as ViaType;
    
    if (intersectionState[targetRoad]) {
        intersectionState[targetRoad].vehicle_count = vehicle_count;
    }

    // Algoritmo Distribuidor de Decisão Decentralizada
    if (vehicle_count > TRAFFIC_THRESHOLD) {
        (Object.keys(intersectionState) as Array<ViaType>).forEach(via => {
            if (via === targetRoad) {
                intersectionState[via].status = 'Verde';
                intersectionState[via].time_left = 25; // Dá 25 segundos extras para escoar o tráfego crítico
            } else {
                intersectionState[via].status = 'Vermelho';
                intersectionState[via].time_left = 0;
            }
        });
    }

    // Propaga a alteração para os outros nós da rede simulando o gRPC original
    lamportClock++;
    peerPorts.forEach(port => {
        sendDataToPeer(port, vehicle_count, targetRoad);
    });
    
    console.log(`[Cruzamento] Input recebido na ${targetRoad}: ${vehicle_count} carros. Sincronizando cluster...`);

    res.send({ 
        status: `Sincronizado via HTTP Mesh. Lamport: ${lamportClock}`,
        vias: intersectionState
    });
});


/* FUNÇÕES DE CLIENTE E ALGORITMOS DISTRIBUÍDOS */

async function sendDataToPeer(port: number, trafficVolume: number, roadId: string) {
    try {
        await fetch(`http://127.0.0.1:${port}/internal/report-traffic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_id: myId,
                road_id: roadId,
                vehicle_count: trafficVolume,
                lamport_clock: lamportClock
            })
        });
        console.log(`[Mesh] Replicação enviada com sucesso para o Nó na porta ${port}`);
    } catch (err) {
        // Tolerância a falhas silenciosa para nós caídos
    }
}

function simulateTrafficSensor() {
    const currentTraffic = Math.floor(Math.random() * 100);
    console.log(`[Sensor Local] Tráfego monitorado na zona do Nó ${myId}: ${currentTraffic} v/m`);

    if (currentTraffic > TRAFFIC_THRESHOLD) {
        console.log(`![ALERTA CRÍTICO] Estouro de capacidade! Propagando nas réplicas...`);
        peerPorts.forEach(port => sendDataToPeer(port, currentTraffic, `Via ${String.fromCharCode(64 + myId)}`));
    }
}

// Executa simulação automática a cada 12 segundos
setInterval(simulateTrafficSensor, 12000);

/* ALGORITMO DE ELEIÇÃO DE BULLY */

function getIDFromPort(port: number): number {
    if (port === 50051) return 1;
    if (port === 50052) return 2;
    if (port === 50053) return 3;
    return 0;
}

async function startElection() {
    if (isElectionOngoing) return;
    isElectionOngoing = true;
    console.log(`[Eleição Bully] Detectada instabilidade ou falta de líder. Iniciando votação...`);

    let higherNodesFound = false;

    // Dispara requisições apenas para quem tem ID maior que o meu
    for (const port of peerPorts) {
        const peerId = getIDFromPort(port);
        if (peerId > myId) {
            try {
                await fetch(`http://127.0.0.1:${port}/internal/election`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ caller_id: myId })
                });
                higherNodesFound = true;
            } catch (err) {
                console.log(`[Falha] Nó superior na porta ${port} não respondeu. Está offline.`);
            }
        }
    }

    // Se nenhum nó de maior ID respondeu em 2.5 segundos, eu assumo o controle do cluster
    setTimeout(() => {
        if (!higherNodesFound) {
            announceVictory();
        }
    }, 2500);
}

async function announceVictory() {
    console.log(`\n==================================================`);
    console.log(`[Eleição Bully] (Nó ${myId}) assume como novo Coordenador.`);
    console.log(`==================================================\n`);
    currentCoordinator = myId;
    isElectionOngoing = false;

    for (const port of peerPorts) {
        try {
            await fetch(`http://127.0.0.1:${port}/internal/set-coordinator`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leader_id: myId })
            });
        } catch (err) {
            // Ignora nós que falharam durante o anúncio
        }
    }
}

/* INICIALIZAÇÃO DO PROCESSO */
app.listen(myPort, '0.0.0.0', () => {
    console.log(`===========================================================`);
    console.log(`  NÓ ${myId} ONLINE - Ouvindo na porta ${myPort}`);
    console.log(`  Mapeamento de endpoints e logs ativado com sucesso.`);
    console.log(`===========================================================`);
});