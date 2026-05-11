import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import express from 'express';
import cors from 'cors';

// Constantes de Limiar
const TRAFFIC_THRESHOLD = 70;

// Estados de eleição
let currentCoordinator: number | null = null;
let isElectionOngoing = false;


// Carregar o Protobuf
const PROTO_PATH = path.resolve(__dirname, '..', 'proto', 'traffic.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const trafficProto = (grpc.loadPackageDefinition(packageDefinition) as any).traffic;

// Estado do Nó
let lamportClock = 0;
const myId = parseInt(process.env.NODE_ID || '1');
const myPort = process.env.PORT || '50051';
// Lista de portas de outros nós (peers) para comunicação
const peerPorts = ['50051', '50052', '50053'].filter(p => p !== myPort);

// Lógica do Relógio de Lamport
function updateClock(receivedClock: number) {
    lamportClock = Math.max(lamportClock, receivedClock) + 1;
    console.log(`[Relógio] Novo tempo de Lamport: ${lamportClock}`);
}

// Métodos de trânsito e eleição
const trafficServiceHandlers = {
    ReportTraffic: (call: any, callback: any) => {
        const { node_id, road_id, vehicle_count, lamport_clock } = call.request;
        
        updateClock(lamport_clock);

        console.log(`\n--- Alerta de Tráfego ---`);
        console.log(`Origem: Nó ${node_id} | Via: ${road_id}`);
        console.log(`Volume: ${vehicle_count} veículos/min`);

        if (vehicle_count > TRAFFIC_THRESHOLD) {
            console.log(`ALERTA: Congestionamento detectado no Nó ${node_id}. Ajustando semáforos locais no Nó ${myId}...`);
        } else {
            console.log(`Fluxo normal no Nó ${node_id}.`);
        }

        callback(null, { success: true });
    },
    Election: (call: any, callback: any) => {
        console.log(`[Eleição] Recebi pedido de eleição do Nó ${call.request.caller_id}`);
        // Se recebi de alguém menor, eu respondo OK e começo minha própria eleição para desafiar
        callback(null, { success: true });
        startElection();
    },
    SetCoordinator: (call: any, callback: any) => {
        currentCoordinator = call.request.leader_id;
        isElectionOngoing = false;
        console.log(`[Eleição] Novo Coordenador definido: Nó ${currentCoordinator}`);
        callback(null, { success: true });
    },
};

function simulateTrafficSensor() {
    // Gera um valor aleatório de tráfego
    const currentTraffic = Math.floor(Math.random() * 100);
    
    console.log(`[Sensor Local] Tráfego atual na minha zona: ${currentTraffic}`);

    // Se o tráfego estiver alto, "avisamos" os vizinhos (Sistemas Distribuídos!)
    if (currentTraffic > TRAFFIC_THRESHOLD) {
        console.log(`![CRÍTICO] Tráfego alto! Notificando vizinhos...`);
        peerPorts.forEach(port => sendDataToPeer(port, currentTraffic));
    }
}

// Comunicação entre os nós
function sendDataToPeer(port: string, trafficVolume: number) {
    const client = new trafficProto.TrafficService(
        `localhost:${port}`,
        grpc.credentials.createInsecure()
    );

    lamportClock++; 
    client.ReportTraffic({
        node_id: myId.toString(),
        road_id: "Via Expressa " + myId,
        vehicle_count: trafficVolume,
        lamport_clock: lamportClock
    }, (err: any, response: any) => {
        // Ignorar erros de conexão para nós offline
        if (!err) console.log(`Notificação enviada para porta ${port}`);
    });
}

// Inicia simulação a cada 10 segundos
setInterval(simulateTrafficSensor, 10000)

// Funções de eleição
function startElection() {
    if (isElectionOngoing) return;
    isElectionOngoing = true;
    console.log(`[Eleição] Iniciando eleição por falta de líder...`);

    let higherNodesFound = false;

    // Tenta avisar nós com ID maior que o meu
    peerPorts.forEach(port => {
        const peerId = getIDFromPort(port); // Função auxiliar
        if (peerId > myId) {
            const client = new trafficProto.TrafficService(`localhost:${port}`, grpc.credentials.createInsecure());
            client.Election({ caller_id: myId }, (err: any) => {
                if (!err) higherNodesFound = true;
            });
        }
    });

    // Se ninguém maior respondeu em 2 segundos, eu sou o líder
    setTimeout(() => {
        if (!higherNodesFound) {
            announceVictory();
        }
    }, 2000);
}

function announceVictory() {
    console.log(`[Eleição] Eu (Nó ${myId}) sou o novo Coordenador!`);
    currentCoordinator = myId;
    isElectionOngoing = false;

    peerPorts.forEach(port => {
        const client = new trafficProto.TrafficService(`localhost:${port}`, grpc.credentials.createInsecure());
        client.SetCoordinator({ leader_id: myId }, (err: any) => {});
    });
}

function getIDFromPort(port: string): number {
    if (port === '50051') return 1;
    if (port === '50052') return 2;
    if (port === '50053') return 3;
    return 0;
}

// Bridge para comunicação
function startBridgeAPI() {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.post('/report', (req, res) => {
        const { vehicle_count } = req.body;
        
        // Propaga para a rede gRPC
        console.log(`\n╔══════════════════════════════════════════════╗`);
        console.log(`║  📡 TRÁFEGO RECEBIDO VIA DASHBOARD           ║`);
        console.log(`║  Volume: ${String(vehicle_count).padEnd(4)} veículos/min              ║`);
        console.log(`║  Origem: Dashboard Web (http://localhost:3000)║`);
        console.log(`║  Destino: Nós ${peerPorts.join(', ')}              ║`);
        console.log(`║  Relógio de Lamport: ${lamportClock}${' '.repeat(Math.max(0, 24 - String(lamportClock).length))}║`);
        console.log(`╚══════════════════════════════════════════════╝`);
        peerPorts.forEach(port => sendDataToPeer(port, vehicle_count));
        
        res.send({ status: `Sincronizado. Lamport: ${lamportClock}` });
    });

    app.listen(3000, () => {
        console.log(`API Bridge disponível em http://localhost:3000`);
    });
}

// Inicialização do Servidor
function main() {
    const server = new grpc.Server();
    server.addService(trafficProto.TrafficService.service, trafficServiceHandlers);
    server.bindAsync(`0.0.0.0:${myPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) return console.error(err);
        console.log(`Nó ${myId} rodando na porta ${port}`);
        server.start();
    });
    startBridgeAPI();
}

main();