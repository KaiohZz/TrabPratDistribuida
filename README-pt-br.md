# 🚦 Sistema de Controle de Tráfego Distribuído

Sistema distribuído de monitoramento e controle de tráfego urbano em tempo real, onde múltiplos nós (interseções/semáforos) se comunicam para detectar congestionamentos e coordenar respostas de forma autônoma.

---

## 📌 Sobre o Projeto

Este projeto foi desenvolvido como Trabalho Prático da disciplina de **Computação Distribuída** da PUC Minas.

A proposta é implementar uma **rede de sensores distribuídos** (opção 4 do enunciado) que simula o monitoramento de tráfego urbano. Cada nó da rede representa uma interseção com semáforo inteligente de **4 vias**, capaz de:

- Detectar o volume de veículos localmente (via sensor simulado)
- Comunicar-se com nós vizinhos quando há congestionamento
- Eleger um líder/coordenador para tomada de decisões globais (Bully)
- Manter a sincronização lógica de eventos entre todos os nós (Lamport)
- Replicar e convergir o estado do cruzamento entre todas as réplicas

> ⚙️ **Nota de evolução do projeto (2ª entrega):** a camada de transporte original era baseada em **gRPC**. Devido a incompatibilidades no subsistema de resolução de nomes (DNS internal parser) do Windows, a comunicação foi migrada para uma **Malha HTTP (HTTP Mesh)** baseada em Express, trocando mensagens em JSON. A topologia distribuída, as portas lógicas e a semântica do cluster foram integralmente mantidas.

---

## 🏗️ Arquitetura do Sistema

O sistema é composto por **3 nós distribuídos** que se comunicam via **HTTP Mesh (JSON sobre Express)** e um **Dashboard Web** para visualização e interação.

```
┌─────────────┐   HTTP Mesh   ┌─────────────┐   HTTP Mesh   ┌─────────────┐
│   Nó 1      │◄─────────────►│   Nó 2      │◄─────────────►│   Nó 3      │
│  porta 50051│   (JSON)      │  porta 50052│   (JSON)      │  porta 50053│
│  (Sensor)   │               │  (Sensor)   │               │  (Sensor)   │
└──────┬──────┘               └─────────────┘               └─────────────┘
       │
       │ REST/HTTP (mesma porta 50051)
       │
┌──────▼──────┐
│  Dashboard  │
│  (React)    │
│  porta 5173 │
└─────────────┘
```

Cada nó é um processo Express isolado que escuta na sua própria porta lógica e expõe:
- **Endpoints internos** `/internal/*` → comunicação entre os nós da malha (substituem o gRPC)
- **Endpoints públicos** `/report` e `/intersection-status` → consumidos pelo dashboard

### Fluxo de Comunicação

1. **Entrada de Dados (Sensores / Painel)** → O sistema reage a dados **reais** de tráfego inseridos via dashboard, celular ou chamadas HTTP diretas (`/report`). Não há mais geração automática de números aleatórios — o estado evolui a partir das leituras reais e da vazão do cruzamento
2. **Propagação / Replicação** → Ao receber uma leitura, o nó atua como coordenador momentâneo da escrita, atualiza seu relógio de Lamport e propaga o valor em **multicast** para as réplicas dos vizinhos via `/internal/report-traffic`
3. **Análise de Carga Global** → Um laço de 1 segundo avalia continuamente as 4 vias. Se alguma ultrapassa **70 veículos/min**, o coordenador identifica a via de **maior carga real** e a prioriza (preempção)
4. **Vazão Contínua** → Enquanto uma via está **Verde**, o servidor escoa gradativamente sua carga (**−2 veículos/segundo**), simulando os carros atravessando o cruzamento
5. **Coordenação de Tempo** → O mesmo laço gerencia a contagem regressiva dos semáforos (Verde → Amarelo → Vermelho) em estilo Round-Robin, com **transição suave (Preempção Segura)** quando há prioridade
6. **Telemetria** → A cada mudança de estado, cada nó imprime no terminal uma tabela (`console.table`) com o status, o tempo restante e a carga de cada via
7. **Dashboard** → O usuário envia leituras manuais pelo painel web (porta 50051), propagadas pela malha; o painel faz polling de 1s para atualizar o cronômetro

---

## ⚙️ Requisitos Implementados

### 1. Comunicação entre Nós — HTTP Mesh (substitui o gRPC)

Toda a comunicação entre os nós é feita via **HTTP** com payloads JSON, usando o cliente `fetch` nativo e servidores Express. Cada nó expõe três endpoints internos que reproduzem os antigos serviços gRPC:

| Endpoint interno               | Equivalente gRPC   | Descrição                                          |
|--------------------------------|--------------------|----------------------------------------------------|
| `POST /internal/report-traffic`| `ReportTraffic`    | Recebe e replica dados de tráfego de outro nó      |
| `POST /internal/election`      | `Election`         | Inicia um pedido de eleição de líder               |
| `POST /internal/set-coordinator`| `SetCoordinator`  | Notifica os nós sobre o novo líder eleito          |

### 2. Relógio Lógico de Lamport

Cada mensagem trocada na malha carrega um campo `lamport_clock`. Ao receber uma mensagem, o nó atualiza seu relógio com a regra:

```
relógio_local = max(relógio_local, relógio_recebido) + 1
```

Isso garante a **ordenação causal dos eventos** no sistema distribuído, mesmo sem sincronização de relógios físicos, e assegura que as réplicas convirjam para o mesmo estado lógico.

### 3. Controle de Réplicas com Consistência Eventual (Requisito Escolhido — Item II)

Cada nó mantém em memória local um **espelho do estado de todo o cruzamento** (`intersectionState`, com as 4 vias). Quando o front-end ou um sensor injeta um dado em um nó, este atua como **coordenador momentâneo da escrita**: processa a regra de negócio e propaga a atualização em **multicast** para as réplicas dos demais nós. O relógio de Lamport ordena os eventos para garantir a convergência das réplicas.

### 4. Coordenação Baseada em Tempo (Semáforo Inteligente)

O servidor gerencia ativamente os semáforos por uma **contagem regressiva coordenada** (`time_left`), atualizada a cada 1 segundo (`coordinateSemaphoresTime`). A lógica combina quatro mecanismos:

**a) Ciclo Normal (Round-Robin distribuído)**
- A via ativa permanece **Verde por 20 segundos**
- Nos últimos **3 segundos** ela passa para **Amarelo** (estágio de atenção)
- Ao esgotar o tempo, alterna para **Vermelho** e abre sequencialmente a próxima via

**b) Análise de Carga Global**
- A cada segundo o coordenador percorre o vetor das 4 vias (A, B, C, D) e identifica a via de **maior congestionamento real** que esteja acima do limiar de **70 veículos/min**
- Em vez de abrir abruptamente qualquer via que estoure o limiar, o sistema **prioriza estritamente a via mais carregada** entre todas

**c) Preempção Segura (Transição Suave)**
- Quando uma via crítica precisa de passagem, a via atualmente Verde **não chaveia instantaneamente** para Vermelho
- Ela entra obrigatoriamente em **Amarelo por 3 segundos** (`isTransitioning`), permitindo o escoamento seguro dos veículos, e só então fecha e cede o Verde à via prioritária
- O tempo de Verde da via prioritária é **dinâmico**, calculado pela carga real (`floor(carga / 2.5)`), limitado entre **20s e 45s** — quanto maior o congestionamento, maior o tempo de passagem

**d) Vazão Contínua**
- Enquanto uma via está Verde, o servidor **reduz 2 veículos por segundo** da sua carga, simulando os carros atravessando o cruzamento

### 5. Tratamento de Falhas (Requisito Obrigatório — 2ª entrega)

O tratamento de falhas é feito em três níveis:

**a) Detecção por Heartbeat**
- A cada **2 segundos** (`HEARTBEAT_INTERVAL`), cada nó faz `GET /internal/ping` no coordenador atual
- Se o coordenador não responde, ele é considerado indisponível e a reeleição é disparada automaticamente

**b) Reeleição Automática (Algoritmo do Valentão / Bully)**
1. Ao detectar a queda do coordenador (ou na inicialização), o nó chama `startElection()` e envia `POST /internal/election` aos nós com **ID maior** que o seu
2. Se nenhum nó com ID maior responder em **2,5 segundos**, ele se declara líder
3. O novo líder envia `POST /internal/set-coordinator` para todos os outros nós
- O nó de **maior ID entre os ativos** vence — sem intervenção manual. O failover completo (detecção + eleição) fica **abaixo de 5 segundos**

**c) Degradação Graciosa e Recuperação de Estado**
- Toda chamada entre nós está em `try/catch`: se um nó cai (Ctrl+C), as requisições para ele **falham silenciosamente** e os demais continuam operando
- Ao (re)iniciar, o nó chama `syncStateFromPeers()` → `GET /internal/state` no primeiro peer ativo e **recupera o estado das 4 vias** em vez de começar zerado

### 6. Web Services (API REST + Dashboard)

Os nós expõem, na própria porta, os endpoints consumidos pelo dashboard:

- **`POST /report`** → Recebe dados de tráfego do dashboard, atualiza a via e propaga via HTTP Mesh para os vizinhos
- **`GET /intersection-status`** → Retorna o estado atual de todas as vias e o relógio de Lamport (usado no polling do dashboard)

### 6. Web Services (API REST + Dashboard)

Os nós expõem, na própria porta, os endpoints consumidos pelo dashboard:

- **`POST /report`** → Recebe dados de tráfego do dashboard, atualiza a via e propaga via HTTP Mesh para os vizinhos
- **`GET /intersection-status`** → Retorna o estado atual de todas as vias e o relógio de Lamport (usado no polling do dashboard)

### 7. Telemetria e Auditoria em Tempo Real

Uma função centralizada (`printIntersectionDashboard`) imprime no terminal uma **tabela formatada** (`console.table`) sempre que ocorre uma mudança de estado relevante — rotação do Round-Robin, ativação de via crítica ou chegada de um novo dado de sensor. A tabela mostra, para cada uma das 4 vias, o **status do semáforo** (🟢 Aberto / 🟡 Atenção / 🔴 Fechado), o **tempo restante** em segundos e a **carga atual** de veículos:

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

---

## 🛠️ Tecnologias Utilizadas

| Tecnologia       | Uso                                          |
|------------------|----------------------------------------------|
| **TypeScript**   | Linguagem principal do backend               |
| **Express.js**   | Servidor HTTP de cada nó (malha + API)       |
| **HTTP / JSON**  | Comunicação entre os nós distribuídos        |
| **fetch (Node)** | Cliente para as chamadas da malha            |
| **CORS**         | Acesso do dashboard (e celulares) aos nós    |
| **React + Vite** | Dashboard web de visualização                |
| **Node.js**      | Runtime de execução                          |

---

## 📂 Estrutura do Projeto

```
TrabPratDistribuida/
├── proto/
│   └── traffic.proto          # (Legado gRPC — mantido apenas como referência, não usado)
├── server/
│   ├── node.ts                # Código principal de cada nó (Express + HTTP Mesh)
│   ├── package.json           # Dependências do backend
│   ├── tsconfig.json          # Configuração do TypeScript
│   └── dashboard/             # Interface web (React + Vite)
│       ├── src/
│       │   ├── App.tsx        # Componente principal do dashboard
│       │   ├── App.css        # Estilos do dashboard
│       │   └── main.tsx       # Ponto de entrada React
│       └── package.json       # Dependências do frontend
└── README.md                  # Este arquivo
```

---

## 🚀 Como Rodar a Aplicação

### Pré-requisitos

- **Node.js** (versão 18 ou superior) → [Baixar aqui](https://nodejs.org/)
- **npm** (já vem com o Node.js)

Verifique se estão instalados:
```powershell
node --version
npm --version
```

---

### Passo 1 — Navegar até a pasta do projeto

> ⚠️ **Importante:** Todos os comandos abaixo devem ser executados a partir da pasta raiz do projeto.

```powershell
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida
```

---

### Passo 2 — Instalar as dependências

```powershell
# Instalar dependências do backend
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server
npm install

# Instalar dependências do dashboard
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server\dashboard
npm install
```

---

### Passo 3 — Iniciar os Nós Distribuídos

Você precisa abrir **3 terminais separados** (um para cada nó). Em **cada** terminal, cole o bloco correspondente:

**Terminal 1 — Nó 1:**
```powershell
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server
$env:NODE_ID=1; $env:PORT=50051; npx ts-node node.ts
```

**Terminal 2 — Nó 2:**
```powershell
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server
$env:NODE_ID=2; $env:PORT=50052; npx ts-node node.ts
```

**Terminal 3 — Nó 3:**
```powershell
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server
$env:NODE_ID=3; $env:PORT=50053; npx ts-node node.ts
```

> **💡 Dica:** Cada nó expõe sua própria API HTTP na mesma porta em que escuta. O **Nó 1 (porta 50051)** é o ponto de entrada usado pelo dashboard. Não há mais uma porta 3000 separada — a antiga "API Bridge" foi unificada na porta do próprio nó.

Você verá a confirmação de inicialização:
```
===========================================================
  NÓ 1 ONLINE - Ouvindo na porta 50051
===========================================================
```

A partir daí, sempre que houver uma leitura de tráfego ou mudança de estado, o nó imprime a tabela de telemetria do cruzamento (ver seção *Telemetria e Auditoria em Tempo Real*).

---

### Passo 4 — Configurar e Iniciar o Dashboard

Antes de levantar o painel, é fundamental certificar-se de que ele está apontando para o endereço IP correto do seu ambiente rodando o backend.

Abra o arquivo do frontend localizado em server/dashboard/src/App.tsx e altere a constante SERVER_IP

> Para rodar tudo no mesmo PC: configure como 'localhost' ou '127.0.0.1'.

> Para testar via celular / outros computadores na mesma rede: configure com o seu endereço IPv4 local (ex: '192.168.0.9'). Atenção: Não use localhost se for acessar externamente.

Acesse no navegador: **https://kaiohzz.github.io/TrabPratDistribuida/**

Para rodar localmente, abra um **4º terminal** e execute:

```powershell
cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server\dashboard
npm run dev
```

> 📱 **Acesso pelo celular / outra máquina:** o dashboard aponta para o nó principal através das constantes `SERVER_IP` e `SERVER_PORT` em [App.tsx](server/dashboard/src/App.tsx#L16-L18). Para acessar de outro dispositivo na mesma rede, ajuste `SERVER_IP` para o **IP de rede local** da máquina que roda os nós (ex.: `192.168.0.9`). Para uso apenas local, use `localhost`.

> 🌐 **Hospedagem no GitHub Pages:** o painel do Atuador de Borda (React + Vite) também pode ser publicado no GitHub Pages para acesso remoto. O Vite já está configurado com `base: '/TrabPratDistribuida/'` ([vite.config.ts](server/dashboard/vite.config.ts)) e o deploy é feito com:
> ```powershell
> cd c:\<CaminhoDoProjeto>\TrabPratDistribuida\server\dashboard
> npm run deploy   # roda o build e publica a pasta dist via gh-pages
> ```
> O front-end hospedado continua consumindo a API dos nós via `SERVER_IP`/`SERVER_PORT`, comprovando a consistência das réplicas ativas e o ordenamento de eventos pelo Relógio de Lamport mesmo com clientes simultâneos (PC + celular).

No dashboard, você pode:
1. Selecionar a via (A/B/C/D) e digitar o número de veículos
2. Clicar em **"Enviar Relatório de Tráfego"**
3. O dado é enviado ao Nó 1 via HTTP e propagado para os outros nós pela malha
4. Acompanhar o **cronômetro regressivo** e a transição Verde → Amarelo → Vermelho em tempo real (polling de 1s)

---

### Passo 5 — Testar as funcionalidades

#### ✅ Teste 1: Vazão Contínua e Reação a Dados Reais
Não há mais geração automática de números aleatórios. Insira uma carga em uma via (pelo dashboard ou via terminal) e observe, na tabela de telemetria, a **carga diminuir 2 veículos por segundo** enquanto a via estiver Verde, simulando os carros atravessando o cruzamento. Quando uma via ultrapassa 70 v/m, o coordenador prioriza a via de **maior carga** com uma transição segura (Amarelo de 3s) antes de abrir o Verde.

#### ✅ Teste 2: Envio Manual pelo Dashboard
No dashboard, selecione uma via, insira um valor **acima de 70** (ex: 85) e clique em enviar. Observe nos terminais dos nós 2 e 3 as mensagens de alerta/replicação recebidas.

#### ✅ Teste 3: Envio Manual via Terminal (sem dashboard)
```powershell
# Tráfego alto — dispara alerta e replicação nos vizinhos
Invoke-RestMethod -Uri http://localhost:50051/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 85, "road_id": "Via A"}'

# Tráfego normal — sem alerta
Invoke-RestMethod -Uri http://localhost:50051/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 30, "road_id": "Via A"}'

# Consultar o estado atual do cruzamento
Invoke-RestMethod -Uri http://localhost:50051/intersection-status -Method GET
```

#### ✅ Teste 4: Tratamento de Falhas — Failover Automático (Bully)
1. Com os 3 nós rodando, aguarde a eleição inicial (o **Nó 3**, maior ID, vira coordenador — veja o log `[Eleição] Novo coordenador definido: Nó 3`)
2. **Feche o terminal do Nó 3** (Ctrl+C)
3. Em até ~5s, o heartbeat detecta a queda e a reeleição roda **sozinha**. Nos terminais dos Nós 1 e 2 aparecem:
```
[Falha Detectada] Coordenador (Nó 3) parou de responder ao heartbeat. Iniciando reeleição...
[Eleição] Nó 2 venceu a eleição e assumiu como COORDENADOR.
```
4. **Recuperação de estado:** reinicie o Nó 3 — no log dele aparece `[Recuperação de Estado] Estado sincronizado a partir do Nó X`, mostrando que ele voltou com o estado das vias em vez de zerado

#### ✅ Teste 5: Relógio de Lamport
Cada evento incrementa o relógio lógico do nó. Consulte o valor atual no campo `lamport_clock` do endpoint de status — ele sempre aumenta a cada evento, garantindo a ordenação causal:
```powershell
Invoke-RestMethod -Uri http://localhost:50051/intersection-status -Method GET
```

---

## 📊 Resumo dos Endpoints e Portas

| Componente      | Porta  | Protocolo  | Descrição                           |
|-----------------|--------|------------|-------------------------------------|
| Nó 1            | 50051  | HTTP/JSON  | Nó distribuído + API do dashboard   |
| Nó 2            | 50052  | HTTP/JSON  | Nó distribuído                      |
| Nó 3            | 50053  | HTTP/JSON  | Nó distribuído                      |
| Dashboard       | 5173   | HTTP       | Interface web (Vite dev)            |

### Endpoints por nó

| Método | Rota                          | Tipo     | Descrição                                  |
|--------|-------------------------------|----------|--------------------------------------------|
| POST   | `/internal/report-traffic`    | Interno  | Replicação de tráfego entre nós            |
| POST   | `/internal/election`          | Interno  | Pedido de eleição (Bully)                  |
| POST   | `/internal/set-coordinator`   | Interno  | Anúncio do novo coordenador                |
| GET    | `/internal/ping`              | Interno  | Heartbeat — responde se o nó está vivo     |
| GET    | `/internal/state`             | Interno  | Estado atual das vias (recuperação na reconexão) |
| POST   | `/report`                     | Público  | Envio de leitura pelo dashboard            |
| GET    | `/intersection-status`        | Público  | Estado das 4 vias + relógio de Lamport     |
