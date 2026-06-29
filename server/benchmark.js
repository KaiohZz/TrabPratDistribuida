/*
 * Benchmark simples de desempenho: compara o tempo de uma escrita no modo
 * DISTRIBUÍDO (POST /report no Nó 1, que processa e propaga via HTTP Mesh para
 * os outros nós) contra o modo CENTRALIZADO de referência (a mesma operação
 * feita apenas em memória, sem rede).
 *
 * Pré-requisito: o Nó 1 precisa estar rodando na porta 50051.
 * Como rodar:  node benchmark.js
 */

const TARGET = 'http://127.0.0.1:50051/report';
const N = 50; // número de requisições medidas

function stats(arr) {
    const ordenado = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
        media: avg.toFixed(2) + ' ms',
        min: ordenado[0].toFixed(2) + ' ms',
        max: ordenado[ordenado.length - 1].toFixed(2) + ' ms'
    };
}

// Modo distribuído: cada escrita passa pela rede e é propagada aos peers
async function benchDistribuido() {
    const tempos = [];
    for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        await fetch(TARGET, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vehicle_count: 5, road_id: 'Via A' })
        });
        tempos.push(performance.now() - t0);
    }
    return stats(tempos);
}

// Modo centralizado (referência): a mesma escrita feita só em memória, sem rede
function benchCentralizado() {
    const estado = { 'Via A': { vehicle_count: 0 } };
    const tempos = [];
    for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        const body = JSON.parse(JSON.stringify({ vehicle_count: 5, road_id: 'Via A' }));
        estado[body.road_id].vehicle_count += body.vehicle_count;
        tempos.push(performance.now() - t0);
    }
    return stats(tempos);
}

(async () => {
    console.log(`\nMedindo ${N} escritas em cada modo...\n`);

    let distribuido;
    try {
        distribuido = await benchDistribuido();
    } catch (err) {
        console.error('ERRO: o Nó 1 (porta 50051) não está respondendo. Inicie os nós antes de rodar o benchmark.');
        process.exit(1);
    }

    const centralizado = benchCentralizado();

    console.table({
        'Distribuído (HTTP Mesh + propagação)': distribuido,
        'Centralizado (memória, sem rede)': centralizado
    });
})();
