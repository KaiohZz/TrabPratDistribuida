import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [trafficCount, setTrafficCount] = useState(0)
  const [selectedVia, setSelectedVia] = useState('Via A')
  const [intersection, setIntersection] = useState<any>({
    'Via A': { status: 'Verde', vehicle_count: 0, time_left: 0 },
    'Via B': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
    'Via C': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
    'Via D': { status: 'Vermelho', vehicle_count: 0, time_left: 0 },
  })
  const [log, setLog] = useState<string[]>([])
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null)

  // Endereço do Nó 1 que centraliza a API HTTP na porta 50051
  const SERVER_IP = '192.168.0.52' 
  const SERVER_PORT = '50051'

  // Polling para atualizar o semáforo e os tempos em tempo real
  const fetchStatus = async () => {
    try {
      const res = await fetch(`http://${SERVER_IP}:${SERVER_PORT}/intersection-status`)
      const data = await res.json()
      setIntersection(data.vias)
    } catch (err) {
      // Silencioso para manter a fluidez visual
    }
  }

  useEffect(() => {
    const interval = setInterval(fetchStatus, 1000) // Polling de 1s para o cronômetro atualizar fluido
    return () => clearInterval(interval)
  }, [])

  const sendTraffic = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setTimeout(() => setRipple(null), 600)

    try {
      const res = await fetch(`http://${SERVER_IP}:${SERVER_PORT}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_count: trafficCount, road_id: selectedVia })
      })
      const data = await res.json()
      setIntersection(data.vias)
      setLog(prev => [`[${new Date().toLocaleTimeString()}] Sincronizado ${selectedVia}`, ...prev])
    } catch (err) {
      setLog(prev => ['Erro ao conectar na rede', ...prev])
    }
  }

  const currentStatus = intersection[selectedVia]?.status || 'Vermelho'
  const currentTimeLeft = intersection[selectedVia]?.time_left ?? 0

  return (
    <div className="app min-h-screen text-white flex flex-col justify-between p-4 md:p-8 relative overflow-x-hidden">
      
      <div className="bg-effects">
        <div className="bg-orb bg-orb--1" />
        <div className="bg-orb bg-orb--2" />
        <div className="bg-orb bg-orb--3" />
        <div className="bg-grid" />
      </div>

      <div className="content max-w-4xl w-full mx-auto flex flex-col justify-between flex-grow z-10 gap-6">
        
        <header className="header text-center flex flex-col items-center">
          <div className="header__badge inline-flex items-center gap-2">
            <span className="header__badge-dot" />
            Nó Atuador de Borda
          </div>
          <h1 className="header__title text-3xl md:text-5xl font-black mt-2">TP01 - CD</h1>
          <p className="header__subtitle text-sm md:text-base max-w-xl text-slate-400 mt-2">
            Gerenciamento Dinâmico de Cruzamento de 4 Vias com Sincronização e Tolerância a Falhas
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start w-full">
          
          <div className="card">
            <div className="card__header">
              <div className="card__icon card__icon--traffic">🚦</div>
              <div>
                <div className="card__title">Controle do Cruzamento</div>
                <div className="card__description">Selecione a via e envie a métrica do sensor</div>
              </div>
            </div>

            <div className="semaphore-section flex flex-col gap-5 mt-4">
              
              <div className="select-group">
                <label className="input-group__label">Ponto de Controle Atual</label>
                <select 
                  value={selectedVia} 
                  onChange={(e) => setSelectedVia(e.target.value)}
                  className="select-field"
                >
                  <option value="Via A">Via A (Norte)</option>
                  <option value="Via B">Via B (Sul)</option>
                  <option value="Via C">Via C (Leste)</option>
                  <option value="Via D">Via D (Oeste)</option>
                </select>
              </div>

              {/* Semáforo Visual Ajustado com Contador de Tempo Coordenado */}
              <div className="semaphore-wrapper bg-slate-950/40 p-4 rounded-2xl border border-slate-800/60 flex items-center justify-around gap-4">
                <div className="semaphore">
                  <div className={`semaphore__light semaphore__light--red ${currentStatus === 'Vermelho' ? 'active' : ''}`} />
                  <div className={`semaphore__light semaphore__light--yellow ${currentStatus === 'Amarelo' ? 'active' : ''}`} />
                  <div className={`semaphore__light semaphore__light--green ${currentStatus === 'Verde' ? 'active' : ''}`} />
                </div>

                <div className="status-label flex flex-col gap-1">
                  <div className="status-label__text text-xs text-slate-500">Sinal na {selectedVia}</div>
                  <div className={`status-label__value font-bold text-sm status-label__value--${currentStatus === 'Verde' ? 'green' : currentStatus === 'Amarelo' ? 'yellow' : 'red'}`}>
                    {currentStatus === 'Verde' ? '● Aberto' : currentStatus === 'Amarelo' ? '● Atenção' : '● Fechado'}
                  </div>
                  {/* Cronômetro Coordenado */}
                  <div className="text-[11px] font-mono text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800/80 w-fit">
                    Tempo restante: <span className="text-cyan-400 font-bold">{currentTimeLeft}s</span>
                  </div>
                </div>
              </div>

              <div className="input-group">
                <label className="input-group__label">Veículos Detectados por Minuto</label>
                <input
                  type="number"
                  value={trafficCount}
                  onChange={(e) => setTrafficCount(Math.max(0, Number(e.target.value)))}
                  className="input-group__field text-center font-bold text-2xl bg-slate-950/60"
                  placeholder="0"
                />
                <div className="input-group__hint text-xs text-slate-500 mt-1">
                  Valores acima de 70 forçam a abertura desta via e reiniciam a temporização do cluster
                </div>
              </div>

              <button onClick={sendTraffic} className="btn-send w-full relative overflow-hidden py-4 rounded-xl font-bold tracking-wide shadow-lg">
                {ripple && (
                  <span
                    className="btn-send__ripple"
                    style={{ left: ripple.x, top: ripple.y }}
                  />
                )}
                <span className="btn-send__content flex items-center justify-center gap-2">
                  📡 Enviar Relatório de Tráfego
                </span>
              </button>
            </div>
          </div>

          <div className="card h-full flex flex-col justify-between">
            <div>
              <div className="card__header">
                <div className="card__icon card__icon--logs">📋</div>
                <div>
                  <div className="card__title">Histórico de Eventos</div>
                  <div className="card__description">Sincronização com o líder em tempo real</div>
                </div>
              </div>

              <div className="logs-panel mt-4">
                <div className="logs-container max-h-[280px] overflow-y-auto pr-2">
                  {log.length === 0 ? (
                    <div className="logs-empty py-12">
                      <span className="logs-empty__icon text-2xl">📭</span>
                      <span className="text-sm text-slate-400">Nenhum evento registrado</span>
                      <span className="text-xs text-slate-600">Altere os dados acima para interagir</span>
                    </div>
                  ) : (
                    log.map((entry, i) => (
                      <div key={i} className="log-entry p-2 border-b border-slate-800/40 text-xs flex items-center gap-2">
                        <span className={`log-entry__dot ${entry.includes('Erro') ? 'log-entry__dot--error' : ''}`} />
                        <span className={entry.includes('Erro') ? 'text-red-400' : 'text-slate-300'}>
                          {entry}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>

        <footer className="footer text-center mt-6 flex flex-col items-center gap-3 border-t border-slate-800/40 pt-4">
          <div className="footer__tech flex flex-wrap justify-center gap-2 text-[10px] uppercase font-semibold text-slate-400">
            <span className="footer__tag bg-slate-800/60 px-2 py-0.5 rounded">⚡ HTTP Mesh</span>
            <span className="footer__tag bg-slate-800/60 px-2 py-0.5 rounded">⏱️ Lamport</span>
            <span className="footer__tag bg-slate-800/60 px-2 py-0.5 rounded">👑 Bully</span>
            <span className="footer__tag bg-slate-800/60 px-2 py-0.5 rounded">⚛️ React</span>
          </div>
          <span className="text-xs text-slate-500">Computação Distribuída · PUC Minas</span>
        </footer>
      </div>
    </div>
  )
}

export default App