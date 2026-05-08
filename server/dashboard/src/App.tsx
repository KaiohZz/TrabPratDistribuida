// dashboard/src/App.tsx
import { useState, useEffect } from 'react'

function App() {
  const [trafficCount, setTrafficCount] = useState(0)
  const [status, setStatus] = useState('Verde') // Verde, Amarelo, Vermelho
  const [log, setLog] = useState<string[]>([])

  const sendTraffic = async () => {
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
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-8 font-sans">
      <h1 className="text-3xl font-bold mb-8">Nó Semáforo</h1>
      
      {/* Visual do Semáforo */}
      <div className="bg-black p-4 rounded-3xl flex flex-col gap-4 border-4 border-slate-700">
        <div className={`w-20 h-20 rounded-full ${status === 'Vermelho' ? 'bg-red-600 shadow-[0_0_20px_red]' : 'bg-red-900/30'}`} />
        <div className={`w-20 h-20 rounded-full ${status === 'Amarelo' ? 'bg-yellow-500 shadow-[0_0_20px_yellow]' : 'bg-yellow-900/30'}`} />
        <div className={`w-20 h-20 rounded-full ${status === 'Verde' ? 'bg-green-600 shadow-[0_0_20px_green]' : 'bg-green-900/30'}`} />
      </div>

      <div className="mt-8 flex flex-col gap-4 w-full max-w-xs">
        <label className="text-center">Veículos detectados (Sensor):</label>
        <input 
          type="number" 
          value={trafficCount}
          onChange={(e) => setTrafficCount(Number(e.target.value))}
          className="bg-slate-800 p-2 rounded border border-slate-600 text-center text-xl"
        />
        <button 
          onClick={sendTraffic}
          className="bg-blue-600 hover:bg-blue-700 font-bold py-3 rounded-lg transition-colors"
        >
          Enviar Relatório de Tráfego
        </button>
      </div>

      <div className="mt-8 w-full max-w-md bg-slate-800 p-4 rounded-lg h-40 overflow-y-auto text-sm border border-slate-700">
        <p className="font-bold border-b border-slate-700 mb-2">Logs do Sistema Distribuído:</p>
        {log.map((entry, i) => <p key={i} className="text-green-400">{entry}</p>)}
      </div>
    </div>
  )
}

export default App