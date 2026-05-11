// dashboard/src/App.tsx
import { useState } from 'react'
import './App.css'

function App() {
  const [trafficCount, setTrafficCount] = useState(0)
  const [status, setStatus] = useState('Verde') // Verde, Amarelo, Vermelho
  const [log, setLog] = useState<string[]>([])
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null)

  const sendTraffic = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Ripple effect
    const rect = e.currentTarget.getBoundingClientRect()
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setTimeout(() => setRipple(null), 600)

    try {
      const res = await fetch('http://localhost:3000/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_count: trafficCount, node_id: 'Mobile-1' })
      })
      const data = await res.json()
      setLog(prev => [`[${new Date().toLocaleTimeString()}] ${data.status}`, ...prev])
    } catch (err) {
      setLog(prev => ['Erro ao conectar no servidor', ...prev])
    }
  }

  return (
    <div className="app">
      {/* Animated Background */}
      <div className="bg-effects">
        <div className="bg-orb bg-orb--1" />
        <div className="bg-orb bg-orb--2" />
        <div className="bg-orb bg-orb--3" />
        <div className="bg-grid" />
      </div>

      <div className="content">
        {/* Header */}
        <header className="header">
          <div className="header__badge">
            <span className="header__badge-dot" />
            Sistema Distribuído
          </div>
          <h1 className="header__title">TP01 - CD</h1>
          <p className="header__subtitle">
            Sistema de controle de tráfego distribuído em tempo real com comunicação
            gRPC, Relógio de Lamport e Eleição de Líder
          </p>
        </header>

        {/* Main Grid */}
        <div className="main-grid">
          {/* Traffic Control Card */}
          <div className="card">
            <div className="card__header">
              <div className="card__icon card__icon--traffic">🚦</div>
              <div>
                <div className="card__title">Controle de Semáforo</div>
                <div className="card__description">Envie dados de tráfego para a rede gRPC</div>
              </div>
            </div>

            <div className="semaphore-section">
              <div className="semaphore-wrapper">
                <div className="semaphore">
                  <div className={`semaphore__light semaphore__light--red ${status === 'Vermelho' ? 'active' : ''}`} />
                  <div className={`semaphore__light semaphore__light--yellow ${status === 'Amarelo' ? 'active' : ''}`} />
                  <div className={`semaphore__light semaphore__light--green ${status === 'Verde' ? 'active' : ''}`} />
                </div>

                <div className="status-label">
                  <div className="status-label__text">Status atual</div>
                  <div className={`status-label__value status-label__value--${status === 'Verde' ? 'green' : status === 'Amarelo' ? 'yellow' : 'red'}`}>
                    {status === 'Verde' ? '● Fluxo Normal' : status === 'Amarelo' ? '● Atenção' : '● Congestionado'}
                  </div>
                </div>
              </div>

              <div className="input-group">
                <label className="input-group__label">Veículos detectados (Sensor)</label>
                <input
                  type="number"
                  value={trafficCount}
                  onChange={(e) => setTrafficCount(Number(e.target.value))}
                  className="input-group__field"
                  placeholder="0"
                />
                <div className="input-group__hint">
                  Valores acima de 70 disparam alerta de congestionamento na rede
                </div>
              </div>

              <button onClick={sendTraffic} className="btn-send">
                {ripple && (
                  <span
                    className="btn-send__ripple"
                    style={{ left: ripple.x, top: ripple.y }}
                  />
                )}
                <span className="btn-send__content">
                  📡 Enviar Relatório de Tráfego
                </span>
              </button>
            </div>
          </div>

          {/* Logs Card */}
          <div className="card">
            <div className="card__header">
              <div className="card__icon card__icon--logs">📋</div>
              <div>
                <div className="card__title">Logs do Sistema</div>
                <div className="card__description">Eventos da rede distribuída em tempo real</div>
              </div>
            </div>

            <div className="logs-panel">
              <div className="logs-container">
                {log.length === 0 ? (
                  <div className="logs-empty">
                    <span className="logs-empty__icon">📭</span>
                    <span>Nenhum evento registrado</span>
                    <span>Envie um relatório de tráfego para começar</span>
                  </div>
                ) : (
                  log.map((entry, i) => (
                    <div key={i} className="log-entry" style={{ animationDelay: `${i * 0.05}s` }}>
                      <span className={`log-entry__dot ${entry.includes('Erro') ? 'log-entry__dot--error' : ''}`} />
                      <span className={`log-entry__text ${entry.includes('Erro') ? 'log-entry__text--error' : ''}`}>
                        {entry}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="info-section">
            <div className="info-grid">
              {/* About Card */}
              <div className="card">
                <div className="card__header">
                  <div className="card__icon card__icon--info">🔬</div>
                  <div>
                    <div className="card__title">Sobre o Projeto</div>
                    <div className="card__description">Computação Distribuída — PUC Minas</div>
                  </div>
                </div>

                <ul className="feature-list">
                  <li className="feature-item">
                    <span className="feature-item__icon">📡</span>
                    <div className="feature-item__content">
                      <div className="feature-item__title">Comunicação gRPC</div>
                      <div className="feature-item__desc">
                        3 nós se comunicam via Protocol Buffers com chamadas de procedimento remoto em tempo real
                      </div>
                    </div>
                  </li>
                  <li className="feature-item">
                    <span className="feature-item__icon">⏱️</span>
                    <div className="feature-item__content">
                      <div className="feature-item__title">Relógio de Lamport</div>
                      <div className="feature-item__desc">
                        Sincronização lógica de eventos: cada mensagem carrega um timestamp para garantir ordenação causal
                      </div>
                    </div>
                  </li>
                  <li className="feature-item">
                    <span className="feature-item__icon">👑</span>
                    <div className="feature-item__content">
                      <div className="feature-item__title">Eleição de Líder (Bully)</div>
                      <div className="feature-item__desc">
                        Se um nó cair, os demais iniciam eleição automática para definir um novo coordenador da rede
                      </div>
                    </div>
                  </li>
                  <li className="feature-item">
                    <span className="feature-item__icon">🌐</span>
                    <div className="feature-item__content">
                      <div className="feature-item__title">API REST Bridge</div>
                      <div className="feature-item__desc">
                        Este dashboard envia dados via HTTP que são propagados pela rede gRPC automaticamente
                      </div>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Terminal Instructions Card */}
              <div className="card">
                <div className="card__header">
                  <div className="card__icon card__icon--terminal">💻</div>
                  <div>
                    <div className="card__title">Como Executar</div>
                    <div className="card__description">Abra 3 terminais para simular os nós</div>
                  </div>
                </div>

                <div className="terminal">
                  <div className="terminal__bar">
                    <span className="terminal__dot terminal__dot--red" />
                    <span className="terminal__dot terminal__dot--yellow" />
                    <span className="terminal__dot terminal__dot--green" />
                    <span className="terminal__title">PowerShell — server/</span>
                  </div>
                  <div className="terminal__body">
                    <div><span className="terminal__comment"># Terminal 1 — Nó 1 (principal)</span></div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__cmd">cd server</span>
                    </div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">NODE_ID=1; </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">PORT=50051; npx ts-node node.ts</span>
                    </div>
                    <div><span className="terminal__output">→ Nó 1 rodando na porta 50051</span></div>
                    <br />
                    <div><span className="terminal__comment"># Terminal 2 — Nó 2</span></div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">NODE_ID=2; </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">PORT=50052; npx ts-node node.ts</span>
                    </div>
                    <div><span className="terminal__output">→ Nó 2 rodando na porta 50052</span></div>
                    <br />
                    <div><span className="terminal__comment"># Terminal 3 — Nó 3</span></div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">NODE_ID=3; </span>
                      <span className="terminal__flag">$env:</span>
                      <span className="terminal__cmd">PORT=50053; npx ts-node node.ts</span>
                    </div>
                    <div><span className="terminal__output">→ Nó 3 rodando na porta 50053</span></div>
                    <br />
                    <div><span className="terminal__comment"># Terminal 4 — Dashboard (este painel)</span></div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__cmd">cd server/dashboard</span>
                    </div>
                    <div>
                      <span className="terminal__prompt">❯ </span>
                      <span className="terminal__cmd">npm run dev</span>
                    </div>
                    <div><span className="terminal__output">→ Acesse http://localhost:5173</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="footer">
          <div className="footer__tech">
            <span className="footer__tag">⚡ gRPC</span>
            <span className="footer__tag">📦 Protocol Buffers</span>
            <span className="footer__tag">🟢 Node.js</span>
            <span className="footer__tag">⚛️ React</span>
            <span className="footer__tag">🔷 TypeScript</span>
            <span className="footer__tag">🚀 Vite</span>
          </div>
          <span>Computação Distribuída · PUC Minas · 2026</span>
        </footer>
      </div>
    </div>
  )
}

export default App