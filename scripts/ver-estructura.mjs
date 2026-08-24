/**
 * Aplica lib/estructura.mjs a los datos reales y lo imprime en claro.
 * Solo describe lo que hay en el grafico. No juzga ni sugiere nada.
 */
import { readFileSync } from 'node:fs';
import { atr, ultimo } from '../lib/indicadores.mjs';
import { pivotes, estructuraMercado, nivelesClave, contextoNiveles, posicionEnRango } from '../lib/estructura.mjs';

const datos = JSON.parse(readFileSync('data/ohlcv.json', 'utf8'));
const usd = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 0 });

for (const tf of ['1d', '4h']) {
  const serie = datos.series[tf];
  // Solo velas cerradas: la viva desplazaria los pivotes al minuto siguiente.
  const velas = serie.ultimaEnCurso ? serie.velas.slice(0, -1) : serie.velas;
  const precio = velas[velas.length - 1].c;

  const atrActual = ultimo(atr(velas, 14));
  const p = pivotes(velas, 5, 5);
  const e = estructuraMercado(p);
  // La semivida se escala con la temporalidad: 50 velas diarias son ~2 meses,
  // 50 velas de 4h son ~8 dias. Ambas son ventanas de relevancia razonables
  // para su horizonte, asi que el mismo numero sirve para las dos.
  const niveles = nivelesClave(velas, p, atrActual, { toleranciaATR: 0.5, maxNiveles: 20, semivida: 50 });
  const dias = Math.round((velas[velas.length - 1].t - velas[0].t) / 86400000);
  const ctx = contextoNiveles(niveles, precio, 3, {
    barras: velas.length, dias,
    desde: velas[0].fecha.slice(0, 10),
    maximo: Math.max(...velas.map((v) => v.h)),
  });
  const rango = posicionEnRango(velas, 60);

  console.log('\n' + '='.repeat(64));
  console.log('BTCUSDT ' + tf + '   precio ' + usd(precio) + ' USDT   ATR(14) ' + usd(atrActual));
  console.log('='.repeat(64));

  console.log('\nESTRUCTURA');
  console.log('  tendencia por secuencia de pivotes : ' + e.tendencia);
  console.log('  ultimos 4 giros                    : ' + e.secuenciaReciente.join(' -> '));
  console.log('  pivotes detectados                 : ' + e.totalAltos + ' altos, ' + e.totalBajos + ' bajos');
  if (e.nivelDeInvalidacion) {
    const d = (((e.nivelDeInvalidacion - precio) / precio) * 100).toFixed(1);
    console.log('  la lectura dejaria de sostenerse en : ' + usd(e.nivelDeInvalidacion) + ' (' + d + '%)');
  }

  console.log('\nPOSICION EN EL RANGO DE ' + rango.barras + ' VELAS');
  const barra = Math.round(rango.posicion * 40);
  console.log('  ' + usd(rango.minimo) + '  [' + '-'.repeat(barra) + 'O' + '-'.repeat(40 - barra) + ']  ' + usd(rango.maximo));
  console.log('  posicion ' + (rango.posicion * 100).toFixed(0) + '% del recorrido   amplitud del rango ' + rango.amplitudPct + '%');

  const fila = (n) =>
    '  ' + usd(n.precio).padStart(8)
    + '   fuerza ' + String(n.fuerza).padStart(5)
    + '   ' + String(n.toques).padStart(2) + ' toques'
    + '   vol ' + String(n.volumenRelativoTotal).padStart(5) + 'x'
    + '   ' + (n.distanciaPct > 0 ? '+' : '') + String(n.distanciaPct).padStart(6) + '%'
    + '   ' + String(n.distanciaATR).padStart(5) + ' ATR'
    + '   ' + n.ultimoToque.slice(0, 10);

  console.log('\nLO QUE EL PRECIO TIENE ENCIMA Y DEBAJO  (ordenado por cercania)');
  if (ctx.enDescubrimiento) {
    console.log('  Sin pivotes por encima EN ESTA VENTANA (' + ctx.cobertura.barras + ' velas = '
      + ctx.cobertura.dias + ' dias, desde ' + ctx.cobertura.desde + ').');
    console.log('  Maximo de la ventana: ' + usd(ctx.cobertura.maximo) + '. Esto NO significa maximo');
    console.log('  historico: comprueba la temporalidad mayor antes de concluir nada.');
  } else {
    for (const n of [...ctx.resistencias].reverse()) console.log(fila(n));
  }
  console.log('  ' + '-'.repeat(84));
  console.log('  ' + usd(precio).padStart(8) + '   <- precio actual');
  console.log('  ' + '-'.repeat(84));
  for (const n of ctx.soportes) console.log(fila(n));

  console.log('\nZONAS MAS FUERTES DEL GRAFICO  (ordenado por fuerza, independientemente de la distancia)');
  for (const n of niveles.slice(0, 4)) console.log(fila(n));

  console.log('\n  Fuerza y distancia son ejes distintos: un nivel no es mas fuerte por');
  console.log('  estar cerca, solo mas alcanzable. Escala de distancia en ATR: menos');
  console.log('  de 1 es alcance de una sola vela; mas de 3 requiere varias sesiones.');
}

console.log('\n' + '-'.repeat(64));
console.log('Descripcion tecnica con fines educativos. No es asesoramiento');
console.log('financiero ni una sugerencia de operar.');
