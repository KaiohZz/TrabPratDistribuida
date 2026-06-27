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

> ⚙️ **Nota de evolução do projeto (2ª entrega):** a camada de transporte original era baseada em **gRPC**. Devido a incompatibilidades no subsistema de resolução de nomes (DNS internal parser) do Windows, a comunicação foi migrada para uma **Malha HTTP (HTTP Mesh)** baseada em Express, trocando mensagens em JSON. A topologia distribuída, as portas lógicas e a semântica do cluster foram integralmente mantidas. Os artefatos `proto/traffic.proto` e as dependências `@grpc/*` permanecem no repositório apenas como referência histórica e **não são mais utilizados**.

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

1. **Sensor Local** → Cada nó gera leituras de tráfego aleatórias a cada **12 segundos** (0 a 100 veículos/min)
2. **Detecção de Congestionamento** → Se o volume ultrapassa **70 veículos/min**, o nó propaga alertas em **multicast** aos vizinhos via HTTP
3. **Propagação / Replicação** → Os vizinhos recebem o alerta no endpoint `/internal/report-traffic`, atualizam seu relógio de Lamport e sincronizam a réplica local do estado do cruzamento
4. **Coordenação de Tempo** → Um laço de 1 segundo gerencia a contagem regressiva dos semáforos (Verde → Amarelo → Vermelho) em estilo Round-Robin
5. **Dashboard** → O usuário envia leituras manuais pelo painel web (porta 50051), que são propagadas pela malha

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

O servidor gerencia ativamente os semáforos por uma **contagem regressiva coordenada** (`time_left`), atualizada a cada 1 segundo:

- A via ativa permanece **Verde por 20 segundos**
- Nos últimos **3 segundos** ela passa para **Amarelo** (estágio de atenção)
- Ao esgotar o tempo, alterna para **Vermelho** e abre sequencialmente a próxima via (**Round-Robin distribuído**)
- Se for detectado **fluxo crítico (> 70 veículos/min)**, o ciclo padrão é interrompido para priorizar a via congestionada por **25 segundos**, recalculando o estado global

### 5. Eleição de Líder (Algoritmo do Valentão / Bully)

Quando um nó detecta instabilidade ou ausência de líder, ele inicia uma eleição:

1. Envia `POST /internal/election` para todos os nós com **ID maior** que o seu
2. Se nenhum nó com ID maior responder em **2,5 segundos**, ele se declara líder
3. O novo líder envia `POST /internal/set-coordinator` para todos os outros nós

Toda a comunicação interna é encapsulada em blocos `try/catch`: se um nó cai (Ctrl+C), as requisições para ele **falham silenciosamente** na camada de transporte, permitindo que os nós remanescentes continuem operando em **degradação graciosa**.

### 6. Web Services (API REST + Dashboard)

Os nós expõem, na própria porta, os endpoints consumidos pelo dashboard:

- **`POST /report`** → Recebe dados de tráfego do dashboard, atualiza a via e propaga via HTTP Mesh para os vizinhos
- **`GET /intersection-status`** → Retorna o estado atual de todas as vias e o relógio de Lamport (usado no polling do dashboard)

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
├── TP-Instrucoes.pdf          # Enunciado do trabalho
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
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida
```

---

### Passo 2 — Instalar as dependências

```powershell
# Instalar dependências do backend
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server
npm install

# Instalar dependências do dashboard
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server\dashboard
npm install
```

---

### Passo 3 — Iniciar os Nós Distribuídos

Você precisa abrir **3 terminais separados** (um para cada nó). Em **cada** terminal, cole o bloco correspondente:

**Terminal 1 — Nó 1:**
```powershell
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server
$env:NODE_ID=1; $env:PORT=50051; npx ts-node node.ts
```

**Terminal 2 — Nó 2:**
```powershell
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server
$env:NODE_ID=2; $env:PORT=50052; npx ts-node node.ts
```

**Terminal 3 — Nó 3:**
```powershell
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server
$env:NODE_ID=3; $env:PORT=50053; npx ts-node node.ts
```

> **💡 Dica:** Cada nó expõe sua própria API HTTP na mesma porta em que escuta. O **Nó 1 (porta 50051)** é o ponto de entrada usado pelo dashboard. Não há mais uma porta 3000 separada — a antiga "API Bridge" foi unificada na porta do próprio nó.

Você verá mensagens como:
```
===========================================================
  NÓ 1 ONLINE - Ouvindo na porta 50051
===========================================================
[Sensor Local] Tráfego monitorado na zona do Nó 1: 42 v/m
```

---

### Passo 4 — Iniciar o Dashboard

Abra um **4º terminal** e execute:

```powershell
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server\dashboard
npm run dev
```

Acesse no navegador: **http://localhost:5173**

> 📱 **Acesso pelo celular / outra máquina:** o dashboard aponta para o nó principal através das constantes `SERVER_IP` e `SERVER_PORT` em [App.tsx](server/dashboard/src/App.tsx#L16-L18). Para acessar de outro dispositivo na mesma rede, ajuste `SERVER_IP` para o **IP de rede local** da máquina que roda os nós (ex.: `192.168.0.9`). Para uso apenas local, use `localhost`.

No dashboard, você pode:
1. Selecionar a via (A/B/C/D) e digitar o número de veículos
2. Clicar em **"Enviar Relatório de Tráfego"**
3. O dado é enviado ao Nó 1 via HTTP e propagado para os outros nós pela malha
4. Acompanhar o **cronômetro regressivo** e a transição Verde → Amarelo → Vermelho em tempo real (polling de 1s)

---

### Passo 5 — Testar as funcionalidades

#### ✅ Teste 1: Sensor Automático
Apenas aguarde — a cada **12 segundos**, cada nó gera um valor aleatório de tráfego. Se o valor for maior que 70, ele notifica os vizinhos automaticamente. Observe os logs nos terminais.

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

#### ✅ Teste 4: Eleição de Líder (Bully) e Tolerância a Falhas
1. Com os 3 nós rodando, **feche o terminal do Nó 3** (Ctrl+C)
2. Os nós restantes continuam operando (degradação graciosa) e as chamadas ao nó offline falham silenciosamente
3. O nó com maior ID entre os restantes se declara coordenador

#### ✅ Teste 5: Relógio de Lamport
Observe nos logs a mensagem `[Relógio Lamport] Sincronizado para: X`. O valor do relógio sempre aumenta a cada evento, garantindo a ordenação causal dos eventos distribuídos.

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
| POST   | `/report`                     | Público  | Envio de leitura pelo dashboard            |
| GET    | `/intersection-status`        | Público  | Estado das 4 vias + relógio de Lamport     |
