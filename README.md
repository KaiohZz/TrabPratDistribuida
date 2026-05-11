# 🚦 Sistema de Controle de Tráfego Distribuído

Sistema distribuído de monitoramento e controle de tráfego urbano em tempo real, onde múltiplos nós (interseções/semáforos) se comunicam para detectar congestionamentos e coordenar respostas de forma autônoma.

---

## 📌 Sobre o Projeto

Este projeto foi desenvolvido como Trabalho Prático da disciplina de **Computação Distribuída** da PUC Minas.

A proposta é implementar uma **rede de sensores distribuídos** (opção 4 do enunciado) que simula o monitoramento de tráfego urbano. Cada nó da rede representa uma interseção com semáforo inteligente, capaz de:

- Detectar o volume de veículos localmente (via sensor simulado)
- Comunicar-se com nós vizinhos quando há congestionamento
- Eleger um líder/coordenador para tomada de decisões globais
- Manter a sincronização lógica de eventos entre todos os nós

---

## 🏗️ Arquitetura do Sistema

O sistema é composto por **3 nós distribuídos** que se comunicam via **gRPC** e um **Dashboard Web** para visualização e interação.

```
┌─────────────┐     gRPC      ┌─────────────┐     gRPC      ┌─────────────┐
│   Nó 1      │◄─────────────►│   Nó 2      │◄─────────────►│   Nó 3      │
│  porta 50051│               │  porta 50052│               │  porta 50053│
│  (Sensor)   │               │  (Sensor)   │               │  (Sensor)   │
└──────┬──────┘               └─────────────┘               └─────────────┘
       │
       │ REST API (porta 3000)
       │
┌──────▼──────┐
│  Dashboard  │
│  (React)    │
│  porta 5173 │
└─────────────┘
```

### Fluxo de Comunicação

1. **Sensor Local** → Cada nó gera leituras de tráfego aleatórias a cada 10 segundos (0 a 100 veículos/min)
2. **Detecção de Congestionamento** → Se o volume ultrapassa **70 veículos/min**, o nó envia alertas gRPC aos vizinhos
3. **Propagação** → Os nós vizinhos recebem o alerta, atualizam seus relógios lógicos e ajustam semáforos locais
4. **Dashboard** → O usuário pode enviar leituras manuais pelo painel web, que são propagadas pela rede gRPC

---

## ⚙️ Requisitos Implementados

### 1. RPC com gRPC

Toda a comunicação entre os nós é feita via **gRPC** usando Protocol Buffers. O arquivo `proto/traffic.proto` define três serviços:

| Serviço            | Descrição                                              |
|--------------------|--------------------------------------------------------|
| `ReportTraffic`    | Envia dados de tráfego de um nó para outro             |
| `Election`         | Inicia um pedido de eleição de líder                   |
| `SetCoordinator`   | Notifica todos os nós sobre o novo líder eleito        |

### 2. Relógio Lógico de Lamport

Cada mensagem gRPC carrega um campo `lamport_clock`. Ao receber uma mensagem, o nó atualiza seu relógio com a regra:

```
relógio_local = max(relógio_local, relógio_recebido) + 1
```

Isso garante a **ordenação causal dos eventos** no sistema distribuído, mesmo sem sincronização de relógios físicos.

### 3. Eleição de Líder (Algoritmo do Valentão / Bully)

Quando um nó detecta que o coordenador está offline, ele inicia uma eleição:

1. O nó envia mensagens `Election` para todos os nós com **ID maior** que o seu
2. Se nenhum nó com ID maior responder em **2 segundos**, ele se declara líder
3. O novo líder envia `SetCoordinator` para todos os outros nós

### 4. Web Services (API REST Bridge)

O Nó 1 expõe uma API REST na porta 3000 que serve como ponte entre o dashboard web e a rede gRPC:

- **`POST /report`** → Recebe dados de tráfego do dashboard e propaga via gRPC para os vizinhos

---

## 🛠️ Tecnologias Utilizadas

| Tecnologia       | Uso                                      |
|------------------|------------------------------------------|
| **TypeScript**   | Linguagem principal do backend           |
| **gRPC**         | Comunicação entre os nós distribuídos    |
| **Protocol Buffers** | Definição dos contratos de comunicação |
| **Express.js**   | API REST (Bridge para o dashboard)       |
| **React + Vite** | Dashboard web de visualização            |
| **Node.js**      | Runtime de execução                      |

---

## 📂 Estrutura do Projeto

```
TrabPratDistribuida/
├── proto/
│   └── traffic.proto          # Definição dos serviços e mensagens gRPC
├── server/
│   ├── node.ts                # Código principal de cada nó distribuído
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

> ⚠️ **Importante:** Todos os comandos abaixo devem ser executados a partir da pasta raiz do projeto. Abra o terminal e rode primeiro:

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

> **💡 Dica:** O Nó 1 também abre a API Bridge na porta 3000, que é usada pelo dashboard. Os nós 2 e 3 podem mostrar um erro de porta 3000 — isso é normal e não afeta o funcionamento do gRPC.

Você verá mensagens como:
```
Nó 1 rodando na porta 50051
API Bridge disponível em http://localhost:3000
[Sensor Local] Tráfego atual na minha zona: 42
```

---

### Passo 4 — Iniciar o Dashboard (opcional)

Abra um **4º terminal** e execute:

```powershell
cd e:\faculdade\CC_PUC\CD\TP1\TrabPratDistribuida\server\dashboard
npm run dev
```

Acesse no navegador: **http://localhost:5173**

No dashboard, você pode:
1. Digitar um número de veículos no campo
2. Clicar em **"Enviar Relatório de Tráfego"**
3. O dado é enviado ao Nó 1 via REST e propagado para os outros nós via gRPC

---

### Passo 5 — Testar as funcionalidades

#### ✅ Teste 1: Sensor Automático
Apenas aguarde — a cada **10 segundos**, cada nó gera um valor aleatório de tráfego. Se o valor for maior que 70, ele notifica os vizinhos automaticamente. Observe os logs nos terminais.

#### ✅ Teste 2: Envio Manual pelo Dashboard
No dashboard, insira um valor **acima de 70** (ex: 85) e clique em enviar. Observe nos terminais dos nós 2 e 3 as mensagens de alerta recebidas.

#### ✅ Teste 3: Envio Manual via Terminal (sem dashboard)
```powershell
# Tráfego alto — dispara alerta nos vizinhos
Invoke-RestMethod -Uri http://localhost:3000/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 85}'

# Tráfego normal — sem alerta
Invoke-RestMethod -Uri http://localhost:3000/report -Method POST -ContentType "application/json" -Body '{"vehicle_count": 30}'
```

#### ✅ Teste 4: Eleição de Líder
1. Com os 3 nós rodando, **feche o terminal do Nó 3** (Ctrl+C)
2. Observe nos nós restantes as mensagens de eleição
3. O nó com maior ID entre os restantes se declara coordenador

#### ✅ Teste 5: Relógio de Lamport
Observe nos logs a mensagem `[Relógio] Novo tempo de Lamport: X`. O valor do relógio sempre aumenta a cada evento, garantindo a ordenação causal dos eventos distribuídos.

---

## 📊 Resumo dos Endpoints e Portas

| Componente      | Porta  | Protocolo | Descrição                    |
|-----------------|--------|-----------|------------------------------|
| Nó 1            | 50051  | gRPC      | Nó distribuído               |
| Nó 2            | 50052  | gRPC      | Nó distribuído               |
| Nó 3            | 50053  | gRPC      | Nó distribuído               |
| API Bridge      | 3000   | REST/HTTP | Ponte Dashboard ↔ gRPC       |
| Dashboard       | 5173   | HTTP      | Interface web (Vite dev)     |
