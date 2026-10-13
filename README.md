# 🚦 Distributed Traffic Control System

Distributed system for real-time urban traffic monitoring and control, where multiple nodes (intersections/traffic lights) communicate with each other to detect congestion and coordinate responses autonomously.

> 🇧🇷 Versão em português: [README.pt-BR.md](README.pt-BR.md)

---

## 📌 About the Project

This project was developed as the practical assignment for the **Distributed Computing** course at PUC Minas.

The goal is to implement a **distributed sensor network** (option 4 of the assignment) that simulates urban traffic monitoring. Each node in the network represents an intersection with a smart **4-way** traffic light, capable of:

- Detecting the local vehicle volume (via a simulated sensor)
- Communicating with neighboring nodes when there is congestion
- Electing a leader/coordinator for global decisions (Bully)
- Keeping the logical synchronization of events across all nodes (Lamport)
- Replicating and converging the intersection state across all replicas

> ⚙️ **Project evolution note (2nd delivery):** the original transport layer was based on **gRPC**. Due to incompatibilities in the Windows name resolution subsystem (internal DNS parser), the communication was migrated to an **HTTP Mesh** built on Express, exchanging JSON messages. The distributed topology, logical ports and cluster semantics were fully preserved.

---

## 🏗️ System Architecture

The system is made up of **3 distributed nodes** that communicate through an **HTTP Mesh (JSON over Express)** and a **Web Dashboard** for visualization and interaction.

```
┌─────────────┐   HTTP Mesh   ┌─────────────┐   HTTP Mesh   ┌─────────────┐
│   Node 1    │◄─────────────►│   Node 2    │◄─────────────►│   Node 3    │
│  port 50051 │   (JSON)      │  port 50052 │   (JSON)      │  port 50053 │
│  (Sensor)   │               │  (Sensor)   │               │  (Sensor)   │
└──────┬──────┘               └─────────────┘               └─────────────┘
       │
       │ REST/HTTP (same port 50051)
       │
┌──────▼──────┐
│  Dashboard  │
│  (React)    │
│  port 5173  │
└─────────────┘
```

Each node is an isolated Express process that listens on its own logical port and exposes:
- **Internal endpoints** `/internal/*` → communication between mesh nodes (replace gRPC)
- **Public endpoints** `/report` and `/intersection-status` → consumed by the dashboard

### Communication Flow

1. **Data Input (Sensors / Panel)** → The system reacts to **real** traffic data entered through the dashboard, a phone or direct HTTP calls (`/report`). There is no automatic random number generation anymore: the state evolves from real readings and from the intersection's throughput
2. **Propagation / Replication** → When a reading arrives, the node acts as the momentary write coordinator, updates its Lamport clock and propagates the value by **multicast** to its neighbors' replicas via `/internal/report-traffic`
3. **Global Load Analysis** → A 1-second loop continuously evaluates the 4 roads. If any exceeds **70 vehicles/min**, the coordinator identifies the road with the **highest real load** and prioritizes it (preemption)
4. **Continuous Throughput** → While a road is **Green**, the server gradually drains its load (**−2 vehicles/second**), simulating cars crossing the intersection
5. **Time Coordination** → The same loop manages the traffic light countdown (Green → Yellow → Red) in Round-Robin style, with a **smooth transition (Safe Preemption)** when there is a priority road
6. **Telemetry** → On every state change, each node prints a table (`console.table`) to the terminal with the status, remaining time and load of each road
7. **Dashboard** → The user sends manual readings through the web panel (port 50051), which are propagated through the mesh; the panel polls every 1s to update the timer

---

## ⚙️ Implemented Requirements

### 1. Node Communication — HTTP Mesh (replaces gRPC)

All communication between nodes is done over **HTTP** with JSON payloads, using the native `fetch` client and Express servers. Each node exposes three internal endpoints that reproduce the former gRPC services:

| Internal endpoint               | gRPC equivalent    | Description                                        |
|---------------------------------|--------------------|----------------------------------------------------|
| `POST /internal/report-traffic` | `ReportTraffic`    | Receives and replicates traffic data from another node |
| `POST /internal/election`       | `Election`         | Starts a leader election request                   |
| `POST /internal/set-coordinator`| `SetCoordinator`   | Notifies the nodes about the newly elected leader  |

### 2. Lamport Logical Clock

Every message exchanged in the mesh carries a `lamport_clock` field. When a message is received, the node updates its clock with the rule:

```
local_clock = max(local_clock, received_clock) + 1
```

This guarantees the **causal ordering of events** in the distributed system, even without physical clock synchronization, and ensures that the replicas converge to the same logical state.

### 3. Replica Control with Eventual Consistency (Chosen Requirement — Item II)

Each node keeps in local memory a **mirror of the state of the whole intersection** (`intersectionState`, with the 4 roads). When the front-end or a sensor injects data into a node, that node acts as the **momentary write coordinator**: it applies the business rule and propagates the update by **multicast** to the replicas on the other nodes. The Lamport clock orders the events to guarantee replica convergence.

### 4. Time-Based Coordination (Smart Traffic Light)

The server actively manages the traffic lights through a **coordinated countdown** (`time_left`), updated every 1 second (`coordinateSemaphoresTime`). The logic combines four mechanisms:

**a) Normal Cycle (Distributed Round-Robin)**
- The active road stays **Green for 20 seconds**
- In the last **3 seconds** it turns **Yellow** (warning stage)
- When the time runs out, it switches to **Red** and opens the next road in sequence

**b) Global Load Analysis**
- Every second the coordinator walks through the array of the 4 roads (A, B, C, D) and identifies the road with the **highest real congestion** that is above the **70 vehicles/min** threshold
- Instead of abruptly opening any road that exceeds the threshold, the system **strictly prioritizes the most loaded road** among all of them

**c) Safe Preemption (Smooth Transition)**
- When a critical road needs to pass, the currently Green road **does not switch instantly** to Red
- It is required to go through **Yellow for 3 seconds** (`isTransitioning`), allowing vehicles to clear safely, and only then closes and hands the Green to the priority road
- The Green time of the priority road is **dynamic**, calculated from the real load (`floor(load / 2.5)`), limited between **20s and 45s**: the higher the congestion, the longer the crossing time

**d) Continuous Throughput**
- While a road is Green, the server **removes 2 vehicles per second** from its load, simulating cars crossing the intersection

### 5. Fault Handling (Mandatory Requirement — 2nd delivery)

Fault handling works on three levels:

**a) Heartbeat Detection**
- Every **2 seconds** (`HEARTBEAT_INTERVAL`), each node sends `GET /internal/ping` to the current coordinator
- If the coordinator does not answer, it is considered unavailable and a re-election is triggered automatically

**b) Automatic Re-election (Bully Algorithm)**
1. When it detects that the coordinator is down (or at startup), the node calls `startElection()` and sends `POST /internal/election` to the nodes with an **ID higher** than its own
2. If no higher-ID node answers within **2.5 seconds**, it declares itself leader
3. The new leader sends `POST /internal/set-coordinator` to all the other nodes
- The node with the **highest ID among the active ones** wins, with no manual intervention. The full failover (detection + election) takes **less than 5 seconds**

**c) Graceful Degradation and State Recovery**
- Every call between nodes is wrapped in `try/catch`: if a node goes down (Ctrl+C), requests to it **fail silently** and the others keep operating
- On (re)start, the node calls `syncStateFromPeers()` → `GET /internal/state` on the first active peer and **recovers the state of the 4 roads** instead of starting from zero

### 6. Web Services (REST API + Dashboard)

The nodes expose, on their own port, the endpoints consumed by the dashboard:

- **`POST /report`** → Receives traffic data from the dashboard, updates the road and propagates it through the HTTP Mesh to the neighbors
- **`GET /intersection-status`** → Returns the current state of all roads and the Lamport clock (used in the dashboard polling)

### 7. Real-Time Telemetry and Auditing

A centralized function (`printIntersectionDashboard`) prints a **formatted table** (`console.table`) to the terminal whenever a relevant state change occurs: a Round-Robin rotation, the activation of a critical road or the arrival of new sensor data. For each of the 4 roads, the table shows the **traffic light status** (🟢 Open / 🟡 Warning / 🔴 Closed), the **remaining time** in seconds and the **current load** of vehicles:

```
============== 🚦 ESTADO DO CRUZAMENTO (Nó 1) ==============
┌─────────┬───────────────┬─────────────────┬──────────────────┬──────────────────┐
│ (index) │  Via/Direção  │ Status Semáforo │  Tempo Restante  │ Carga (Veículos) │
├─────────┼───────────────┼─────────────────┼──────────────────┼──────────────────┤
│    0    │    'Via A'    │ '🟢 [ABERTO] '  │      '18s'       │     '12 v/m'     │
│    1    │    'Via B'    │ '🔴 [FECHADO]'  │       '-'        │     '85 v/m'     │
└─────────┴───────────────┴─────────────────┴──────────────────┴──────────────────┘
==================================================================
```

> 💬 The terminal output and log messages are in Portuguese. They are shown here exactly as the program prints them.

---

## 🛠️ Technologies Used

| Technology       | Usage                                        |
|------------------|----------------------------------------------|
| **TypeScript**   | Main backend language                        |
| **Express.js**   | HTTP server of each node (mesh + API)        |
| **HTTP / JSON**  | Communication between the distributed nodes  |
| **fetch (Node)** | Client for the mesh calls                    |
| **CORS**         | Dashboard (and phone) access to the nodes    |
| **React + Vite** | Web visualization dashboard                  |
| **Node.js**      | Execution runtime                            |

---

## 📂 Project Structure

```
TrabPratDistribuida/
├── proto/
│   └── traffic.proto          # (gRPC legacy — kept only as reference, not used)
├── server/
│   ├── node.ts                # Main code of each node (Express + HTTP Mesh)
│   ├── package.json           # Backend dependencies
│   ├── tsconfig.json          # TypeScript configuration
│   └── dashboard/             # Web interface (React + Vite)
│       ├── src/
│       │   ├── App.tsx        # Main dashboard component
│       │   ├── App.css        # Dashboard styles
│       │   └── main.tsx       # React entry point
│       └── package.json       # Frontend dependencies
└── README.md                  # This file
```

---

## 🚀 How to Run the Application

### Prerequisites

- **Node.js** (version 18 or higher) → [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)

Check that they are installed:
```powershell
node --version
npm --version
```

---

### Step 1 — Go to the project folder

> ⚠️ **Important:** All the commands below must be run from the project root folder.

```powershell
cd c:\<ProjectPath>\TrabPratDistribuida
```

---

### Step 2 — Install the dependencies

```powershell
# Install the backend dependencies
cd c:\<ProjectPath>\TrabPratDistribuida\server
npm install

# Install the dashboard dependencies
cd c:\<ProjectPath>\TrabPratDistribuida\server\dashboard
npm install
```

---

### Step 3 — Start the Distributed Nodes

You need to open **3 separate terminals** (one for each node). In **each** terminal, paste the corresponding block:

**Terminal 1 — Node 1:**
```powershell
cd c:\<ProjectPath>\TrabPratDistribuida\server
$env:NODE_ID=1; $env:PORT=50051; npx ts-node node.ts
```

**Terminal 2 — Node 2:**
```powershell
cd c:\<ProjectPath>\TrabPratDistribuida\server
$env:NODE_ID=2; $env:PORT=50052; npx ts-node node.ts
```

**Terminal 3 — Node 3:**
```powershell
cd c:\<ProjectPath>\TrabPratDistribuida\server
$env:NODE_ID=3; $env:PORT=50053; npx ts-node node.ts
```

> **💡 Tip:** Each node exposes its own HTTP API on the same port it listens on. **Node 1 (port 50051)** is the entry point used by the dashboard. There is no separate port 3000 anymore: the old "API Bridge" was merged into the node's own port.

> **🐧 macOS / Linux:** instead of the PowerShell syntax, set the variables inline, for example `NODE_ID=1 PORT=50051 npx ts-node node.ts`.

You will see the startup confirmation:
```
===========================================================
  NÓ 1 ONLINE - Ouvindo na porta 50051
===========================================================
```

From then on, whenever there is a traffic reading or a state change, the node prints the intersection telemetry table (see the *Real-Time Telemetry and Auditing* section).

---

### Step 4 — Configure and Start the Dashboard

Before starting the panel, it is essential to make sure it points to the correct IP address of the environment running the backend.

Open the frontend file located at server/dashboard/src/App.tsx and change the SERVER_IP constant

> To run everything on the same PC: set it to 'localhost' or '127.0.0.1'.

> To test from a phone / other computers on the same network: set it to your local IPv4 address (e.g. '192.168.0.9'). Warning: do not use localhost if you will access it from outside.

Open in the browser: **https://kaiohzz.github.io/TrabPratDistribuida/**

> The hosted dashboard only shows live data while the nodes are running and reachable at the configured `SERVER_IP`.

To run it locally, open a **4th terminal** and run:

```powershell
cd c:\<ProjectPath>\TrabPratDistribuida\server\dashboard
npm run dev
```

> 📱 **Access from a phone / another machine:** the dashboard points to the main node through the `SERVER_IP` and `SERVER_PORT` constants in [App.tsx](server/dashboard/src/App.tsx#L16-L18). To access it from another device on the same network, set `SERVER_IP` to the **local network IP** of the machine running the nodes (e.g. `192.168.0.9`). For local-only use, use `localhost`.

> 🌐 **GitHub Pages hosting:** the Edge Actuator panel (React + Vite) can also be published to GitHub Pages for remote access. Vite is already configured with `base: '/TrabPratDistribuida/'` ([vite.config.ts](server/dashboard/vite.config.ts)) and the deploy is done with:
> ```powershell
> cd c:\<ProjectPath>\TrabPratDistribuida\server\dashboard
> npm run deploy   # runs the build and publishes the dist folder via gh-pages
> ```
> The hosted front-end keeps consuming the nodes' API through `SERVER_IP`/`SERVER_PORT`, demonstrating the consistency of the active replicas and the event ordering by the Lamport Clock even with simultaneous clients (PC + phone).

In the dashboard, you can:
1. Select the road (A/B/C/D) and enter the number of vehicles
2. Click **"Enviar Relatório de Tráfego"** (Send Traffic Report)
3. The data is sent to Node 1 over HTTP and propagated to the other nodes through the mesh
4. Follow the **countdown timer** and the Green → Yellow → Red transition in real time (1s polling)

---

### Step 5 — Test the features

#### ✅ Test 1: Continuous Throughput and Reaction to Real Data
There is no automatic random number generation anymore. Enter a load on a road (through the dashboard or the terminal) and watch, in the telemetry table, the **load decrease by 2 vehicles per second** while the road is Green, simulating cars crossing the intersection. When a road exceeds 70 v/m, the coordinator prioritizes the road with the **highest load** using a safe transition (3s Yellow) before opening the Green.

#### ✅ Test 2: Manual Input from the Dashboard
In the dashboard, select a road, enter a value **above 70** (e.g. 85) and click send. Watch the alert/replication messages received in the terminals of nodes 2 and 3.

#### ✅ Test 3: Manual Input from the Terminal (without the dashboard)
```powershell
# High traffic — triggers an alert and replication on the neighbors
Invoke-RestMethod -Uri http://localhost:50051/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 85, "road_id": "Via A"}'

# Normal traffic — no alert
Invoke-RestMethod -Uri http://localhost:50051/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 30, "road_id": "Via A"}'

# Get the current intersection state
Invoke-RestMethod -Uri http://localhost:50051/intersection-status -Method GET
```

#### ✅ Test 4: Fault Handling — Automatic Failover (Bully)
1. With the 3 nodes running, wait for the initial election (**Node 3**, the highest ID, becomes coordinator — see the log `[Eleição] Novo coordenador definido: Nó 3`)
2. **Close Node 3's terminal** (Ctrl+C)
3. Within ~5s, the heartbeat detects the failure and the re-election runs **on its own**. In the terminals of Nodes 1 and 2 you will see:
```
[Falha Detectada] Coordenador (Nó 3) parou de responder ao heartbeat. Iniciando reeleição...
[Eleição] Nó 2 venceu a eleição e assumiu como COORDENADOR.
```
4. **State recovery:** restart Node 3 — its log shows `[Recuperação de Estado] Estado sincronizado a partir do Nó X`, showing that it came back with the road state instead of starting from zero

#### ✅ Test 5: Lamport Clock
Every event increments the node's logical clock. Check the current value in the `lamport_clock` field of the status endpoint: it always increases with each event, guaranteeing causal ordering:
```powershell
Invoke-RestMethod -Uri http://localhost:50051/intersection-status -Method GET
```

---

## 📊 Endpoints and Ports Summary

| Component       | Port   | Protocol   | Description                         |
|-----------------|--------|------------|-------------------------------------|
| Node 1          | 50051  | HTTP/JSON  | Distributed node + dashboard API    |
| Node 2          | 50052  | HTTP/JSON  | Distributed node                    |
| Node 3          | 50053  | HTTP/JSON  | Distributed node                    |
| Dashboard       | 5173   | HTTP       | Web interface (Vite dev)            |

### Endpoints per node

| Method | Route                         | Type     | Description                                |
|--------|-------------------------------|----------|--------------------------------------------|
| POST   | `/internal/report-traffic`    | Internal | Traffic replication between nodes          |
| POST   | `/internal/election`          | Internal | Election request (Bully)                   |
| POST   | `/internal/set-coordinator`   | Internal | Announcement of the new coordinator        |
| GET    | `/internal/ping`              | Internal | Heartbeat — answers if the node is alive   |
| GET    | `/internal/state`             | Internal | Current state of the roads (recovery on reconnection) |
| POST   | `/report`                     | Public   | Submission of a reading from the dashboard |
| GET    | `/intersection-status`        | Public   | State of the 4 roads + Lamport clock       |
