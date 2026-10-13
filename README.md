🚦 Distributed Traffic Control System

A real-time distributed system for urban traffic monitoring and control. Multiple nodes (smart intersections) communicate with each other to detect congestion and coordinate traffic lights autonomously, tolerating node failures.

Live dashboard: https://kaiohzz.github.io/TrabPratDistribuida/ (requires the nodes to be running, see Getting started)

Português: a versão original deste README está em README.pt-BR.md.

📌 About

Built as the practical assignment for the Distributed Computing course at PUC Minas. The chosen option was a distributed sensor network that simulates urban traffic monitoring. Each node represents a smart 4-way intersection and is able to:

Receive traffic volume readings (simulated sensor input) locally
Replicate its state to neighboring nodes
Elect a leader/coordinator for global decisions (Bully algorithm)
Keep a consistent ordering of events across nodes (Lamport logical clocks)
Detect failures and recover without manual intervention
🏗️ Architecture

Three distributed nodes communicate over an HTTP mesh (JSON over Express), and a React dashboard visualizes and interacts with the system.

┌─────────────┐   HTTP mesh   ┌─────────────┐   HTTP mesh   ┌─────────────┐
│   Node 1    │◄─────────────►│   Node 2    │◄─────────────►│   Node 3    │
│  port 50051 │    (JSON)     │  port 50052 │    (JSON)     │  port 50053 │
└──────┬──────┘               └─────────────┘               └─────────────┘
       │
       │ REST/HTTP (same port 50051)
       │
┌──────▼──────┐
│  Dashboard  │
│ React+Vite  │
│  port 5173  │
└─────────────┘

Each node is an isolated Express process that exposes:

Internal endpoints (/internal/*) for node-to-node communication
Public endpoints (/report, /intersection-status) consumed by the dashboard
Data flow
Input: traffic readings come from the dashboard, a phone, or direct HTTP calls to /report. The state evolves from real readings, not random numbers.
Replication: the receiving node acts as the temporary write coordinator, updates its Lamport clock and multicasts the value to the other nodes' replicas via /internal/report-traffic.
Global load analysis: a 1-second loop evaluates the 4 roads. If any exceeds 70 vehicles/min, the coordinator prioritizes the road with the highest real load.
Continuous throughput: while a road is green, its load drops by 2 vehicles/second, simulating cars crossing.
Timing coordination: the same loop runs the green → yellow → red countdown in a round-robin fashion, with a safe transition when a road is prioritized.
Telemetry: on every relevant state change each node prints a table (console.table) with each road's light status, remaining time and load.
⚙️ Distributed systems features
1. Node communication: HTTP mesh

All communication uses HTTP with JSON payloads (native fetch client and Express servers).

Internal endpoint	Description
POST /internal/report-traffic	Receives and replicates traffic data from another node
POST /internal/election	Starts a leader election request
POST /internal/set-coordinator	Announces the newly elected leader
GET /internal/ping	Heartbeat: answers if the node is alive
GET /internal/state	Returns the current road state (used for recovery)
2. Lamport logical clock

Every message carries a lamport_clock field. On receiving a message, a node updates its clock with:

local_clock = max(local_clock, received_clock) + 1

This gives a causal ordering of events without synchronized physical clocks and helps replicas converge.

3. Replication with eventual consistency

Each node keeps an in-memory mirror of the whole intersection (intersectionState, with the 4 roads). A node that receives a write applies the business rules and propagates it by multicast. Lamport clocks order the events so replicas converge.

4. Time-based coordination (smart traffic light)

The server runs a coordinated countdown (time_left) updated every second:

Normal cycle (distributed round-robin): the active road stays green for 20 s, turns yellow for the last 3 s, then red, and the next road opens.
Global load analysis: among the roads above the 70 vehicles/min threshold, the one with the highest load is strictly prioritized.
Safe preemption: the currently green road does not switch to red instantly. It goes through a mandatory 3 s yellow phase (isTransitioning) before yielding to the priority road.
Dynamic green time: the priority road's green time is floor(load / 2.5), clamped between 20 s and 45 s.
5. Fault tolerance
Heartbeat detection: every 2 s each node pings the current coordinator (GET /internal/ping). If it does not answer, a re-election is triggered automatically.
Automatic re-election (Bully algorithm): the node sends POST /internal/election to all nodes with a higher ID. If none answers within 2.5 s, it declares itself leader and notifies the others via POST /internal/set-coordinator. The highest-ID live node wins, and the full failover (detection + election) takes under 5 seconds.
Graceful degradation and state recovery: every inter-node call is wrapped in try/catch, so surviving nodes keep working when one goes down. A restarted node calls syncStateFromPeers() and recovers the state of the 4 roads from the first live peer instead of starting empty.
6. REST API and dashboard
POST /report: receives traffic data from the dashboard, updates the road and propagates it through the mesh
GET /intersection-status: returns the state of all roads and the Lamport clock (the dashboard polls it every second)
🛠️ Tech stack
Technology	Usage
TypeScript	Backend language
Node.js	Runtime
Express.js	HTTP server of each node (mesh + API)
HTTP / JSON	Communication between nodes
React + Vite	Web dashboard
CORS	Dashboard (and phone) access to the nodes
📂 Project structure
TrabPratDistribuida/
├── proto/
│   └── traffic.proto          # Legacy gRPC definition, kept only as reference
├── server/
│   ├── node.ts                # Main code of each node (Express + HTTP mesh)
│   ├── package.json
│   ├── tsconfig.json
│   └── dashboard/             # Web interface (React + Vite)
│       └── src/
│           ├── App.tsx
│           ├── App.css
│           └── main.tsx
└── README.md
🚀 Getting started
Prerequisites
Node.js 18 or later
npm
1. Install dependencies
bash
cd server
npm install

cd dashboard
npm install
2. Start the three nodes

Open three terminals and run one node in each, from the server folder.

Windows (PowerShell):

powershell
$env:NODE_ID=1; $env:PORT=50051; npx ts-node node.ts   # terminal 1
$env:NODE_ID=2; $env:PORT=50052; npx ts-node node.ts   # terminal 2
$env:NODE_ID=3; $env:PORT=50053; npx ts-node node.ts   # terminal 3

macOS / Linux:

bash
NODE_ID=1 PORT=50051 npx ts-node node.ts   # terminal 1
NODE_ID=2 PORT=50052 npx ts-node node.ts   # terminal 2
NODE_ID=3 PORT=50053 npx ts-node node.ts   # terminal 3

Each node prints a confirmation like NODE 1 ONLINE - Listening on port 50051. Node 1 (port 50051) is the entry point used by the dashboard.

3. Configure and start the dashboard

Open server/dashboard/src/App.tsx and set the SERVER_IP constant:

Everything on the same machine: localhost or 127.0.0.1
Access from a phone or another computer on the same network: your local IPv4 address (for example 192.168.0.9). Do not use localhost in this case.

Then, in a fourth terminal:

bash
cd server/dashboard
npm run dev

In the dashboard you can select a road (A/B/C/D), enter a vehicle count and send a traffic report. The data goes to Node 1 over HTTP, is replicated through the mesh, and you can follow the countdown and the green → yellow → red transitions in real time.

Deploying the dashboard to GitHub Pages: Vite is configured with base: '/TrabPratDistribuida/'. From server/dashboard, run npm run deploy to build and publish dist with gh-pages. The hosted dashboard still calls the nodes through SERVER_IP and SERVER_PORT.

🧪 Test scenarios

1. Continuous throughput and reaction to real data. Send a load to a road and watch it drop by 2 vehicles/second in the telemetry table while the road is green. When a road goes above 70 vehicles/min, the coordinator prioritizes the busiest one after a 3 s yellow transition.

2. Manual input from the dashboard. Send a value above 70 (for example 85) and watch the replication messages in the terminals of nodes 2 and 3.

3. Manual input from the terminal (PowerShell shown; use curl on macOS/Linux):

powershell
# High traffic: triggers alert and replication
Invoke-RestMethod -Uri http://localhost:50051/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 85, "road_id": "Via A"}'

# Current intersection state
Invoke-RestMethod -Uri http://localhost:50051/intersection-status -Method GET

4. Failover (Bully algorithm).

With the 3 nodes running, wait for the initial election (Node 3, the highest ID, becomes coordinator).
Stop Node 3 (Ctrl+C).
Within about 5 seconds, the heartbeat detects the failure and a re-election runs automatically. Nodes 1 and 2 log the detected failure and the new coordinator.
Restart Node 3. It logs a state synchronization from a peer and comes back with the road state instead of an empty one.

5. Lamport clock. Query /intersection-status repeatedly: the lamport_clock value increases with every event.

📊 Ports and endpoints
Component	Port	Protocol	Description
Node 1	50051	HTTP/JSON	Distributed node and dashboard API
Node 2	50052	HTTP/JSON	Distributed node
Node 3	50053	HTTP/JSON	Distributed node
Dashboard	5173	HTTP	Web interface (Vite dev server)
📝 Design notes

The first version used gRPC for transport. Because of incompatibilities in the Windows DNS name resolution subsystem, the communication layer was migrated to an HTTP mesh (Express + JSON). The distributed topology, logical ports and cluster semantics were fully preserved, and proto/traffic.proto remains in the repository as a reference of the original design.
