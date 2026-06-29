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

// Intervalo do heartbeat: de quanto em quanto tempo o coordenador é verificado (ms)
const HEARTBEAT_INTERVAL = 2000;

// Estado de controle de transição forçada por prioridade
let isTransitioning = false;
let pendingTargetVia: ViaType | null = null;

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

// Informações do cruzamento no terminal
function printIntersectionDashboard() {
    const vias = Object.keys(intersectionState) as ViaType[];
    
    console.log(`\n============== 🚦 ESTADO DO CRUZAMENTO (Nó ${myId}) ==============`);
    console.table(
        vias.map(via => {
            const info = intersectionState[via];
            let icon = '🔴 [FECHADO]';
            if (info.status === 'Verde') icon = '🟢 [ABERTO] ';
            if (info.status === 'Amarelo') icon = '🟡 [ATENÇÃO]';

            return {
                'Via/Direção': via,
                'Status Semáforo': icon,
                'Tempo Restante': info.time_left > 0 ? `${info.time_left}s` : '-',
                'Carga (Veículos)': `${info.vehicle_count} v/m`
            };
        })
    );
    console.log(`==================================================================\n`);
}

// LÓGICA DE COORDENAÇÃO DE TEMPO DOS SEMÁFOROS (Sincronização Distribuída)
function coordinateSemaphoresTime() {
    const vias = Object.keys(intersectionState) as ViaType[];
    
    // Encontra a via que está atualmente aberta (Verde ou Amarelo)
    let activeVia = vias.find(via => intersectionState[via].status === 'Verde' || intersectionState[via].status === 'Amarelo');

    // Escoamento de Tráfego: Se a via está verde, diminui os carros dela gradativamente
    if (activeVia && intersectionState[activeVia].status === 'Verde' && intersectionState[activeVia].vehicle_count > 0) {
        // Simula a vazão de 2 veículos por segundo enquanto o sinal estiver verde
        intersectionState[activeVia].vehicle_count = Math.max(0, intersectionState[activeVia].vehicle_count - 2);
    }

    // Análise de Carga Global: Encontra qual via está em situação mais crítica (maior volume)
    let highestLoadVia: ViaType | null = null; 
    let maxVehicles = TRAFFIC_THRESHOLD;

    vias.forEach(via => {
        if (intersectionState[via].vehicle_count > maxVehicles) {
            maxVehicles = intersectionState[via].vehicle_count;
            highestLoadVia = via;
        }
    });

    // Mecanismo de Preempção Suave (Transição Segura para Via Crítica)
    if (highestLoadVia !== null && highestLoadVia !== activeVia && !isTransitioning) {
        const targetVia = highestLoadVia as ViaType; // Typecast seguro para o escopo interno
        
        console.log(`\n[Coordenador - ALERTA] Via de maior carga detectada: ${targetVia} (${intersectionState[targetVia].vehicle_count} carros).`);
        
        if (activeVia && intersectionState[activeVia].status === 'Verde') {
            console.log(`[Coordenador] Colocando a via atual ${activeVia} em AMARELO para transição segura.`);
            isTransitioning = true;
            pendingTargetVia = targetVia;
            intersectionState[activeVia].status = 'Amarelo';
            intersectionState[activeVia].time_left = 3; 
            printIntersectionDashboard();
        } else if (!activeVia) {
            intersectionState[targetVia].status = 'Verde';
            intersectionState[targetVia].time_left = 25;
        }
        return;
    }

    // Se uma transição forçada estava em andamento e o amarelo acabou
    if (isTransitioning && activeVia && intersectionState[activeVia].time_left <= 0) {
        console.log(`[Coordenador] Transição concluída. Fechando ${activeVia} e abrindo a via prioritária ${pendingTargetVia}.`);
        
        intersectionState[activeVia].status = 'Vermelho';
        intersectionState[activeVia].time_left = 0;

        if (pendingTargetVia) {
            // Calcula tempo baseado na carga real (mínimo 20s, máximo 45s)
            const calculatedTime = Math.min(45, Math.max(20, Math.floor(intersectionState[pendingTargetVia].vehicle_count / 2.5)));
            intersectionState[pendingTargetVia].status = 'Verde';
            intersectionState[pendingTargetVia].time_left = calculatedTime;
        }

        isTransitioning = false;
        pendingTargetVia = null;
        printIntersectionDashboard();
        return;
    }

    // Ciclo de Funcionamento Normal (Round-Robin)
    if (!activeVia) {
        intersectionState['Via A'].status = 'Verde';
        intersectionState['Via A'].time_left = 20;
        return;
    }

    if (intersectionState[activeVia].time_left > 0) {
        intersectionState[activeVia].time_left--;
        
        // Ativação do Amarelo convencional no ciclo normal
        if (intersectionState[activeVia].time_left <= 3 && intersectionState[activeVia].status === 'Verde') {
            intersectionState[activeVia].status = 'Amarelo';
        }
    } else {
        // Rotatividade padrão quando o tempo acaba sozinho
        intersectionState[activeVia].status = 'Vermelho';
        intersectionState[activeVia].time_left = 0;
        //intersectionState[activeVia].vehicle_count = 0; 

        const currentIndex = vias.indexOf(activeVia);
        const nextIndex = (currentIndex + 1) % vias.length;
        const nextVia = vias[nextIndex];

        intersectionState[nextVia].status = 'Verde';
        intersectionState[nextVia].time_left = 20;
        printIntersectionDashboard();
    }
}

// O Nó Líder/Coordenador atualiza os contadores a cada 1 segundo na malha
setInterval(coordinateSemaphoresTime, 1000);

// Lógica do Relógio de Lamport
function updateClock(receivedClock: number) {
    lamportClock = Math.max(lamportClock, receivedClock) + 1;
}

// Inicialização do Servidor Express
const app = express();
app.use(cors());
app.use(express.json());

/* INTERFACES DE COMUNICAÇÃO INTERNA */

app.post('/internal/report-traffic', (req, res) => {
    const { road_id, vehicle_count, lamport_clock } = req.body;
    updateClock(lamport_clock);

    const targetRoad = road_id as ViaType;
    if (intersectionState[targetRoad]) {
        // Sincroniza o valor do sensor enviado pelo nó parceiro
        intersectionState[targetRoad].vehicle_count = vehicle_count;
    }
    res.send({ success: true });
});

app.post('/internal/election', (req, res) => {
    res.send({ success: true });
    startElection();
});

app.post('/internal/set-coordinator', (req, res) => {
    currentCoordinator = req.body.leader_id;
    isElectionOngoing = false;
    console.log(`[Eleição] Novo coordenador definido: Nó ${currentCoordinator}.`);
    res.send({ success: true });
});

// Heartbeat: responde que está vivo. Usado pelos outros nós para detectar falhas.
app.get('/internal/ping', (req, res) => {
    res.send({ alive: true, node_id: myId });
});

// Recuperação de estado: devolve o estado atual das vias para um nó que está retornando ao cluster.
app.get('/internal/state', (req, res) => {
    res.send({ lamport_clock: lamportClock, vias: intersectionState });
});

/* API BRIDGE (COMUNICAÇÃO COM O FRONT-END) */

app.get('/intersection-status', (req, res) => {
    res.send({ 
        lamport_clock: lamportClock,
        vias: intersectionState 
    });
});

app.post('/report', async (req, res) => {
    const { vehicle_count, road_id } = req.body;
    const targetRoad = (road_id || 'Via A') as ViaType;
    
    if (intersectionState[targetRoad]) {
        intersectionState[targetRoad].vehicle_count += vehicle_count;
    }

    console.log(`[Sensor] Recebido relatório para ${targetRoad}: ${vehicle_count} carros.`);

    // Propaga o valor real do tráfego para os outros nós
    lamportClock++;
    peerPorts.forEach(port => {
        sendDataToPeer(port, vehicle_count, targetRoad);
    });

    printIntersectionDashboard();
    
    res.send({ 
        status: `Métricas registradas. Lamport: ${lamportClock}`,
        vias: intersectionState
    });
});

/* FUNÇÕES DE CLIENTE */

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
    } catch (err) {
        // Falha tratada silenciosamente
    }
}

/* ALGORITMO DE ELEIÇÃO DE BULLY */

function getIDFromPort(port: number): number {
    if (port === 50051) return 1;
    if (port === 50052) return 2;
    if (port === 50053) return 3;
    return 0;
}

function getPortFromId(id: number): number {
    if (id === 1) return 50051;
    if (id === 2) return 50052;
    if (id === 3) return 50053;
    return 0;
}

async function startElection() {
    if (isElectionOngoing) return;
    isElectionOngoing = true;

    let higherNodesFound = false;

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
                // Nó offline
            }
        }
    }

    setTimeout(() => {
        if (!higherNodesFound) {
            announceVictory();
        }
    }, 2500);
}

async function announceVictory() {
    currentCoordinator = myId;
    isElectionOngoing = false;
    console.log(`[Eleição] Nó ${myId} venceu a eleição e assumiu como COORDENADOR.`);

    for (const port of peerPorts) {
        try {
            await fetch(`http://127.0.0.1:${port}/internal/set-coordinator`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leader_id: myId })
            });
        } catch (err) { }
    }
}

/* DETECÇÃO DE FALHAS (HEARTBEAT) E RECUPERAÇÃO DE ESTADO */

// Pinga um nó e retorna se ele está vivo
async function pingPeer(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/internal/ping`);
        return res.ok;
    } catch (err) {
        return false;
    }
}

// A cada ciclo de heartbeat verifica se o coordenador continua respondendo.
// Se não responder (ou se não houver coordenador), dispara a reeleição automaticamente.
async function checkCoordinator() {
    if (isElectionOngoing) return;

    if (currentCoordinator === null) {
        startElection();
        return;
    }

    // Sou o coordenador: não preciso verificar a mim mesmo
    if (currentCoordinator === myId) return;

    const alive = await pingPeer(getPortFromId(currentCoordinator));
    if (!alive) {
        console.log(`\n[Falha Detectada] Coordenador (Nó ${currentCoordinator}) parou de responder ao heartbeat. Iniciando reeleição...`);
        currentCoordinator = null;
        startElection();
    }
}

setInterval(checkCoordinator, HEARTBEAT_INTERVAL);

// Ao entrar (ou retornar) ao cluster, busca o estado atual em algum peer ativo
async function syncStateFromPeers() {
    for (const port of peerPorts) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/internal/state`);
            const data: any = await res.json();
            if (data && data.vias) {
                Object.assign(intersectionState, data.vias);
                updateClock(data.lamport_clock || 0);
                console.log(`[Recuperação de Estado] Estado sincronizado a partir do Nó ${getIDFromPort(port)}.`);
                return;
            }
        } catch (err) {
            // Peer offline, tenta o próximo
        }
    }
}

app.listen(myPort, '0.0.0.0', () => {
    console.log(`===========================================================`);
    console.log(`  NÓ ${myId} ONLINE - Ouvindo na porta ${myPort}`);
    console.log(`===========================================================`);

    // Recupera o estado de quem já estiver no ar e dispara a eleição inicial
    syncStateFromPeers();
    setTimeout(startElection, 1500);
});